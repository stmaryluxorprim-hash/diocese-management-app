-- =====================================================================
-- 20261004120000 — ONE LOGIN PAGE · ONE ENROLLMENT PER SESSION · INVITE-ONLY SIGNUP
--   (دخول واحد · الجلسة لتسجيل واحد · التسجيل بالدعوة فقط)
--
-- Builds on 20261003120000 (one person · one password · many accounts).
--
--   1. SESSION = ONE ENROLLMENT. A servant who serves in several places and
--      a child who is in several classes no longer see everything at once:
--        • child_sessions.enrollment_id — the class of THIS session; the
--          child profile RPC reads only that enrollment (null = legacy / all).
--        • servant_active_places — the place the servant chose for his
--          current login; my_scopes() returns ONLY that place when chosen.
--      person_accounts() lists ONE ROW PER ENROLLMENT (servant per place,
--      child per class, priest once) and account_switch() targets one.
--   2. ONE PRIEST ACCOUNT per person (unique(person_id) + explicit refusal)
--      — unlimited servant / child enrollments beside it.
--   3. ONE LOGIN: account_login(code, password) verifies the ONE password and
--      returns the person + his accounts; the client picks (or prompts when
--      several) and mints the session via account_session_from_login.
--   4. INVITE-ONLY SIGNUP: signup_invites (kind · scope · expiry · max uses)
--      are created from the app; the three wizards need ?invite=<token> and
--      the signup RPCs verify + consume it.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. child_sessions.enrollment_id — the class of this session
-- ---------------------------------------------------------------------
alter table public.child_sessions add column if not exists enrollment_id uuid references public.enrollments(id) on delete cascade;
create index if not exists idx_child_sessions_enrollment on public.child_sessions(enrollment_id);
comment on column public.child_sessions.enrollment_id is 'التسجيل (الفصل) الذي تعمل عليه هذه الجلسة — null = كل الفصول (جلسات قديمة)';

create or replace function public.child_session_enrollment(p_token text)
returns uuid language sql stable security definer set search_path = public, extensions as $$
  select s.enrollment_id from public.child_sessions s
   where s.token_hash = encode(digest(trim(coalesce(p_token, '')), 'sha256'), 'hex')
$$;
revoke all on function public.child_session_enrollment(text) from public, anon, authenticated;

create or replace function public.child_portal_profile(p_national_id text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare p public.persons; enr jsonb; v_enr uuid;
begin
  p := public.child_portal_person(p_national_id);
  v_enr := public.child_session_enrollment(p_national_id);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'church_id', e.church_id, 'service_id', e.service_id, 'class_id', e.class_id,
           'attendance_count', e.attendance_count, 'points', e.points, 'created_at', e.created_at, 'status', e.status,
           'church_name', ch.name, 'church_logo', ch.logo_url,
           'service_name', sv.name, 'service_photo', sv.photo_url,
           'class_name', cl.name, 'class_photo', cl.photo_url
         ) order by e.created_at), '[]'::jsonb)
    into enr
    from public.enrollments e
    join public.churches ch on ch.id = e.church_id
    join public.services sv on sv.id = e.service_id
    join public.classes  cl on cl.id = e.class_id
   where e.person_id = p.id and e.kind = 'child'
     and (v_enr is null or e.id = v_enr);
  return jsonb_build_object(
    'person', jsonb_build_object(
      'id', p.id, 'national_id', p.national_id, 'name', p.name, 'birthdate', p.birthdate, 'gender', p.gender,
      'phone', p.phone, 'address', p.address, 'image_url', p.image_url, 'created_at', p.created_at),
    'enrollments', enr,
    'session_enrollment_id', v_enr,
    'other_enrollments', (select count(*) from public.enrollments e
                           where e.person_id = p.id and e.kind = 'child' and v_enr is not null and e.id <> v_enr));
end $$;
grant execute on function public.child_portal_profile(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. servant_active_places — the place of the servant's current login
-- ---------------------------------------------------------------------
create table if not exists public.servant_active_places (
  servant_id  uuid primary key references public.servant_enrollments(id) on delete cascade,
  church_id   uuid references public.churches(id) on delete cascade,
  service_id  uuid references public.services(id) on delete cascade,
  class_id    uuid references public.classes(id) on delete cascade,
  updated_at  timestamptz not null default now()
);
comment on table public.servant_active_places is
  'المكان الذي اختاره الخادم لجلسته الحالية (من بين أماكن خدمته) — my_scopes() يُرجع هذا المكان فقط';
alter table public.servant_active_places enable row level security;
revoke all on public.servant_active_places from anon, authenticated;
grant select on public.servant_active_places to authenticated;
drop policy if exists servant_active_places_self on public.servant_active_places;
create policy servant_active_places_self on public.servant_active_places for select to authenticated using (servant_id = auth.uid());
alter table public.servant_active_places replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.servant_active_places;
exception when duplicate_object then null; end $$;

create or replace function public.servant_places(p_servant uuid)
returns table (church_id uuid, service_id uuid, class_id uuid, is_primary boolean)
language sql stable security definer set search_path = public as $$
  select s.church_id, s.service_id, s.class_id, true
    from public.servant_enrollments s where s.id = p_servant and s.church_id is not null
  union
  select x.church_id, x.service_id, x.class_id, false
    from public.servant_scopes x where x.servant_id = p_servant
$$;
revoke all on function public.servant_places(uuid) from public, anon;
grant execute on function public.servant_places(uuid) to authenticated;

create or replace function public.servant_set_active_place(p_church uuid, p_service uuid default null, p_class uuid default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_church is null then
    delete from public.servant_active_places where servant_id = auth.uid();
    return;
  end if;
  if not exists (select 1 from public.servant_places(auth.uid()) p
                  where p.church_id = p_church and p.service_id is not distinct from p_service and p.class_id is not distinct from p_class) then
    raise exception 'scope_not_allowed' using errcode = '42501';
  end if;
  insert into public.servant_active_places (servant_id, church_id, service_id, class_id)
  values (auth.uid(), p_church, p_service, p_class)
  on conflict (servant_id) do update
    set church_id = excluded.church_id, service_id = excluded.service_id, class_id = excluded.class_id, updated_at = now();
end $$;
grant execute on function public.servant_set_active_place(uuid, uuid, uuid) to authenticated;

-- my_scopes(): ONLY the active place when one is chosen (and still his)
create or replace function public.my_scopes()
returns table (role public.app_role, church_id uuid, service_id uuid, class_id uuid)
language sql stable security definer set search_path = public as $$
  with me as (select s.id, s.role, s.church_id, s.service_id, s.class_id
                from public.servant_enrollments s where s.id = auth.uid() and s.status = 'approved'),
  active as (
    select a.church_id, a.service_id, a.class_id
      from public.servant_active_places a join me on me.id = a.servant_id
     where exists (select 1 from public.servant_places(me.id) p
                    where p.church_id = a.church_id and p.service_id is not distinct from a.service_id and p.class_id is not distinct from a.class_id))
  select me.role, active.church_id, active.service_id, active.class_id from me, active
  union all
  select me.role, me.church_id, me.service_id, me.class_id from me where not exists (select 1 from active)
  union all
  select me.role, x.church_id, x.service_id, x.class_id
    from me join public.servant_scopes x on x.servant_id = me.id
   where not exists (select 1 from active)
$$;
grant execute on function public.my_scopes() to authenticated, anon;

-- single-row helper used by my_role() and legacy code → the first active scope
create or replace function public.my_scope()
returns table (role public.app_role, church_id uuid, service_id uuid, class_id uuid)
language sql stable security definer set search_path = public as $$
  select role, church_id, service_id, class_id from public.my_scopes() limit 1
$$;

-- the two predicates inlined by the ~30 policies now follow my_scopes()
create or replace function public.extra_scope_visible(p_church uuid, p_service uuid, p_class uuid, s_role public.app_role)
returns boolean language sql stable security definer set search_path = public cost 500 as $$
  select s_role is not null and s_role <> 'owner' and exists (
    select 1 from public.my_scopes() x
     where case s_role
         when 'church_manager' then p_church = x.church_id
         when 'service_manager' then (x.service_id is null and p_church = x.church_id) or p_service = x.service_id
         when 'class_servant' then
           (x.class_id is null and ((x.service_id is null and p_church = x.church_id) or p_service = x.service_id))
           or p_class = x.class_id
         else false
       end)
$$;
grant execute on function public.extra_scope_visible(uuid, uuid, uuid, public.app_role) to authenticated, anon;

-- enrollment_visible keeps the 0045 shape: the fast check on the caller's
-- (now ACTIVE) scope passed by the policy, then the rest of my_scopes().
create or replace function public.enrollment_visible(p_church uuid, p_service uuid, p_class uuid,
  s_role public.app_role, s_church uuid, s_service uuid, s_class uuid)
returns boolean language sql stable as $$
  select coalesce(case s_role
    when 'owner' then true
    when 'church_manager' then p_church = s_church
    when 'service_manager' then (s_service is null and p_church = s_church) or p_service = s_service
    when 'class_servant' then
      (s_class is null and ((s_service is null and p_church = s_church) or p_service = s_service))
      or p_class = s_class
    else false
  end, false)
  or public.extra_scope_visible(p_church, p_service, p_class, s_role)
$$;

-- ---------------------------------------------------------------------
-- 3. person_accounts — ONE ROW PER ENROLLMENT (servant per place · child per
--    class · priest once). `enrollment_id` identifies the row to switch to.
-- ---------------------------------------------------------------------
create or replace function public.person_accounts(p_person uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(a order by a->>'order', a->>'label2') from (
      select jsonb_build_object(
          'order', '1', 'kind', 'servant', 'id', s.id, 'status', s.status, 'role', s.role, 'label', 'خادم',
          'enrollment_id', s.id,
          'church_id', pl.church_id, 'service_id', pl.service_id, 'class_id', pl.class_id,
          'is_primary', coalesce(pl.is_primary, true),
          'label2', coalesce(ch.name, '') || coalesce(' ← ' || sv.name, '') || coalesce(' ← ' || cl.name, ''),
          'places', case when pl.church_id is null then '[]'::jsonb
                         else jsonb_build_array(jsonb_build_object('church', ch.name, 'service', sv.name, 'class', cl.name)) end) a
        from public.servant_enrollments s
        left join lateral public.servant_places(s.id) pl on true
        left join public.churches ch on ch.id = pl.church_id
        left join public.services sv on sv.id = pl.service_id
        left join public.classes cl on cl.id = pl.class_id
       where s.person_id = p_person
      union all
      select jsonb_build_object(
          'order', '2', 'kind', 'child', 'id', e.id, 'enrollment_id', e.id, 'status', e.status, 'label', 'مخدوم',
          'church_id', e.church_id, 'service_id', e.service_id, 'class_id', e.class_id,
          'label2', ch.name || ' ← ' || sv.name || ' ← ' || cl.name,
          'places', jsonb_build_array(jsonb_build_object('church', ch.name, 'service', sv.name, 'class', cl.name)))
        from public.enrollments e
        join public.churches ch on ch.id = e.church_id
        join public.services sv on sv.id = e.service_id
        join public.classes cl on cl.id = e.class_id
       where e.person_id = p_person and e.kind = 'child'
      union all
      select jsonb_build_object(
          'order', '3', 'kind', 'priest', 'id', pr.id, 'enrollment_id', pr.id, 'status', pr.status, 'title', pr.title, 'label', 'كاهن',
          'church_id', pr.church_id, 'label2', ch.name,
          'places', jsonb_build_array(jsonb_build_object('church', ch.name, 'service', null, 'class', null)))
        from public.priests pr join public.churches ch on ch.id = pr.church_id
       where pr.person_id = p_person
    ) t(a)
  ), '[]'::jsonb)
$$;
revoke all on function public.person_accounts(uuid) from public, anon, authenticated;

create or replace function public.my_accounts(p_kind text, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v uuid; p public.persons; v_cur uuid; v_place jsonb;
begin
  v := public.session_person(p_kind, p_token);
  select * into p from public.persons where id = v;
  if p_kind = 'child' then
    v_cur := public.child_session_enrollment(p_token);
  elsif p_kind = 'priest' then
    select pr.id into v_cur from public.priests pr where pr.person_id = v;
  else
    v_cur := auth.uid();
    select jsonb_build_object('church_id', a.church_id, 'service_id', a.service_id, 'class_id', a.class_id)
      into v_place from public.servant_active_places a where a.servant_id = auth.uid();
  end if;
  return jsonb_build_object(
    'person', jsonb_build_object('id', p.id, 'name', p.name, 'code', p.national_id, 'image_url', p.image_url),
    'current', p_kind, 'current_enrollment_id', v_cur, 'current_place', v_place,
    'accounts', public.person_accounts(v));
end $$;
grant execute on function public.my_accounts(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Minting a session for ONE enrollment (shared by login + switch)
-- ---------------------------------------------------------------------
alter table public.account_switch_tickets add column if not exists church_id uuid;
alter table public.account_switch_tickets add column if not exists service_id uuid;
alter table public.account_switch_tickets add column if not exists class_id uuid;

create or replace function public.account_mint(
  p_person uuid, p_to_kind text, p_enrollment uuid, p_remember boolean, p_ua text,
  p_church uuid default null, p_service uuid default null, p_class uuid default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  p public.persons; s public.servant_enrollments; pr public.priests; e public.enrollments;
  v_token text; v_exp timestamptz;
begin
  select * into p from public.persons where id = p_person;
  v_exp := case when coalesce(p_remember, true) then now() + interval '90 days' else now() + interval '12 hours' end;

  if p_to_kind = 'child' then
    if p_enrollment is not null then
      select * into e from public.enrollments where id = p_enrollment and person_id = p_person and kind = 'child';
      if not found then raise exception 'no_such_account' using errcode = 'P0002'; end if;
      if e.status <> 'active' then raise exception 'account_stopped' using errcode = 'P0011'; end if;
    else
      if not exists (select 1 from public.enrollments x where x.person_id = p_person and x.kind = 'child') then
        raise exception 'no_such_account' using errcode = 'P0002';
      end if;
      if not exists (select 1 from public.enrollments x where x.person_id = p_person and x.kind = 'child' and x.status = 'active') then
        raise exception 'account_stopped' using errcode = 'P0011';
      end if;
    end if;
    v_token := encode(gen_random_bytes(32), 'hex');
    insert into public.child_sessions (person_id, token_hash, remember, expires_at, user_agent, enrollment_id)
    values (p_person, encode(digest(v_token, 'sha256'), 'hex'), coalesce(p_remember, true), v_exp, left(p_ua, 300), p_enrollment);
    return jsonb_build_object('kind', 'child', 'token', v_token, 'expires_at', v_exp, 'person_id', p_person, 'enrollment_id', p_enrollment);

  elsif p_to_kind = 'priest' then
    select * into pr from public.priests where person_id = p_person;
    if not found then raise exception 'no_such_account' using errcode = 'P0002'; end if;
    if pr.status = 'pending' then raise exception 'pending_approval' using errcode = 'P0001'; end if;
    if pr.status <> 'approved' then raise exception 'account_stopped' using errcode = 'P0001'; end if;
    v_token := encode(gen_random_bytes(32), 'hex');
    insert into public.priest_sessions (priest_id, token_hash, remember, expires_at, user_agent)
    values (pr.id, encode(digest(v_token, 'sha256'), 'hex'), coalesce(p_remember, true), v_exp, left(p_ua, 300));
    perform set_config('app.priest_actor', pr.id::text, true);
    return jsonb_build_object('kind', 'priest', 'token', v_token, 'expires_at', v_exp, 'priest_id', pr.id);

  elsif p_to_kind = 'servant' then
    select * into s from public.servant_enrollments where person_id = p_person;
    if not found then raise exception 'no_such_account' using errcode = 'P0002'; end if;
    if s.status = 'pending' then raise exception 'pending_approval' using errcode = 'P0001'; end if;
    if s.status <> 'approved' then raise exception 'account_stopped' using errcode = 'P0001'; end if;
    if p_church is not null and not exists (select 1 from public.servant_places(s.id) x
         where x.church_id = p_church and x.service_id is not distinct from p_service and x.class_id is not distinct from p_class) then
      raise exception 'scope_not_allowed' using errcode = '42501';
    end if;
    v_token := encode(gen_random_bytes(32), 'hex');
    delete from public.account_switch_tickets where expires_at < now();
    insert into public.account_switch_tickets (person_id, servant_id, ticket_hash, remember, expires_at, church_id, service_id, class_id)
    values (p_person, s.id, encode(digest(v_token, 'sha256'), 'hex'), coalesce(p_remember, true), now() + interval '2 minutes',
            p_church, p_service, p_class);
    return jsonb_build_object('kind', 'servant', 'ticket', v_token, 'servant_id', s.id, 'code', p.national_id);
  end if;
  raise exception 'invalid_kind' using errcode = '22023';
end $$;
revoke all on function public.account_mint(uuid, text, uuid, boolean, text, uuid, uuid, uuid) from public, anon, authenticated;

-- redeem: the chosen place becomes the active one of the servant's login
create or replace function public.account_switch_redeem(p_ticket text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare t public.account_switch_tickets; s public.servant_enrollments;
begin
  if auth.role() <> 'service_role' and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_ticket is null or length(trim(p_ticket)) < 20 then raise exception 'invalid_ticket' using errcode = 'P0001'; end if;
  select * into t from public.account_switch_tickets where ticket_hash = encode(digest(trim(p_ticket), 'sha256'), 'hex');
  if not found or t.used_at is not null or t.expires_at < now() then raise exception 'invalid_ticket' using errcode = 'P0001'; end if;
  update public.account_switch_tickets set used_at = now() where id = t.id;
  select * into s from public.servant_enrollments where id = t.servant_id;
  if not found or s.status <> 'approved' then raise exception 'account_stopped' using errcode = 'P0001'; end if;
  if t.church_id is not null then
    insert into public.servant_active_places (servant_id, church_id, service_id, class_id)
    values (s.id, t.church_id, t.service_id, t.class_id)
    on conflict (servant_id) do update
      set church_id = excluded.church_id, service_id = excluded.service_id, class_id = excluded.class_id, updated_at = now();
  else
    delete from public.servant_active_places where servant_id = s.id;
  end if;
  return jsonb_build_object('servant_id', s.id, 'user_id', s.user_id, 'remember', t.remember, 'person_id', t.person_id);
end $$;
revoke all on function public.account_switch_redeem(text) from public, anon, authenticated;
grant execute on function public.account_switch_redeem(text) to service_role;

drop function if exists public.account_switch(text, text, text, boolean);
create or replace function public.account_switch(
  p_from_kind text, p_from_token text, p_to_kind text, p_remember boolean default true,
  p_enrollment uuid default null, p_church uuid default null, p_service uuid default null, p_class uuid default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  return public.account_mint(public.session_person(p_from_kind, p_from_token), p_to_kind, p_enrollment, p_remember,
                             'switch:' || p_from_kind, p_church, p_service, p_class);
end $$;
grant execute on function public.account_switch(text, text, text, boolean, uuid, uuid, uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. ONE LOGIN — code + password → a 5-minute grant + the accounts
-- ---------------------------------------------------------------------
create table if not exists public.login_grants (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.persons(id) on delete cascade,
  grant_hash  text not null unique,
  remember    boolean not null default false,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
comment on table public.login_grants is 'إثبات دخول قصير العمر (5 دقائق) بين التحقق من كلمة المرور واختيار الحساب في صفحة الدخول الواحدة';
alter table public.login_grants enable row level security;
revoke all on public.login_grants from anon, authenticated;

create or replace function public.account_login(p_code text, p_password text, p_remember boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare p public.persons; v_grant text; acc jsonb;
begin
  if nullif(trim(coalesce(p_code, '')), '') is null then raise exception 'invalid_code' using errcode = 'P0001'; end if;
  select * into p from public.persons where national_id = trim(p_code);
  if not found then perform pg_sleep(0.25); raise exception 'unknown_code' using errcode = 'P0002'; end if;
  acc := public.person_accounts(p.id);
  if jsonb_array_length(acc) = 0 then
    if exists (select 1 from public.child_join_requests r where r.code = p.national_id and r.status = 'pending')
       or exists (select 1 from public.priest_requests r where r.code = p.national_id and r.status = 'pending') then
      raise exception 'pending_approval' using errcode = 'P0001';
    end if;
    raise exception 'no_account' using errcode = 'P0002';
  end if;
  -- a servant / priest whose password was never mirrored (legacy): the
  -- client falls back to Supabase Auth and the mirror catches up
  if not exists (select 1 from public.person_credentials c where c.person_id = p.id)
     and not exists (select 1 from public.enrollments e where e.person_id = p.id and e.kind = 'child') then
    raise exception 'password_unknown' using errcode = 'P0012';
  end if;
  if not public.person_password_ok(p.id, p_password) then
    perform pg_sleep(0.25);
    raise exception 'wrong_password' using errcode = 'P0010';
  end if;
  v_grant := encode(gen_random_bytes(32), 'hex');
  delete from public.login_grants where expires_at < now();
  insert into public.login_grants (person_id, grant_hash, remember, expires_at)
  values (p.id, encode(digest(v_grant, 'sha256'), 'hex'), coalesce(p_remember, false), now() + interval '5 minutes');
  return jsonb_build_object(
    'grant', v_grant,
    'person', jsonb_build_object('id', p.id, 'name', p.name, 'code', p.national_id, 'image_url', p.image_url),
    'accounts', acc);
end $$;
grant execute on function public.account_login(text, text, boolean) to anon, authenticated;

create or replace function public.account_session_from_login(
  p_grant text, p_kind text, p_enrollment uuid default null,
  p_church uuid default null, p_service uuid default null, p_class uuid default null, p_user_agent text default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare g public.login_grants;
begin
  if p_grant is null or length(trim(p_grant)) < 20 then raise exception 'session_expired' using errcode = 'P0002'; end if;
  select * into g from public.login_grants where grant_hash = encode(digest(trim(p_grant), 'sha256'), 'hex');
  if not found or g.expires_at < now() then raise exception 'session_expired' using errcode = 'P0002'; end if;
  delete from public.login_grants where id = g.id;
  return public.account_mint(g.person_id, p_kind, p_enrollment, g.remember, p_user_agent, p_church, p_service, p_class);
end $$;
grant execute on function public.account_session_from_login(text, text, uuid, uuid, uuid, uuid, text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 6. INVITE-ONLY SIGNUP — دعوات التسجيل
-- ---------------------------------------------------------------------
create table if not exists public.signup_invites (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('servant', 'child', 'priest')),
  token_hash  text not null unique,
  church_id   uuid references public.churches(id) on delete cascade,
  service_id  uuid references public.services(id) on delete cascade,
  class_id    uuid references public.classes(id) on delete cascade,
  created_by  uuid references public.servant_enrollments(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  max_uses    integer,
  uses        integer not null default 0,
  revoked_at  timestamptz,
  note        text
);
create index if not exists idx_signup_invites_creator on public.signup_invites(created_by, created_at desc);
comment on table public.signup_invites is
  'دعوات التسجيل — التسجيل (خادم · مخدوم · كاهن) لا يُفتح إلا برابط/QR يحمل دعوة صالحة أنشأها مسؤول من التطبيق';
alter table public.signup_invites enable row level security;
revoke all on public.signup_invites from anon, authenticated;
grant select (id, kind, church_id, service_id, class_id, created_by, created_at, expires_at, max_uses, uses, revoked_at, note),
      update (revoked_at) on public.signup_invites to authenticated;
drop policy if exists signup_invites_mine on public.signup_invites;
create policy signup_invites_mine on public.signup_invites for select to authenticated
  using (created_by = auth.uid() or (select public.is_owner()));
drop policy if exists signup_invites_revoke on public.signup_invites;
create policy signup_invites_revoke on public.signup_invites for update to authenticated
  using (created_by = auth.uid() or (select public.is_owner()));

-- who may invite: servant → owner / church manager / service manager (inside
-- scope) · child → anyone who can access the class · priest → OWNER only
create or replace function public.signup_invite_create(
  p_kind text, p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_days integer default 7, p_max_uses integer default null, p_note text default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_role public.app_role := public.my_role(); v_token text; v_id uuid; v_exp timestamptz;
begin
  if v_role is null then raise exception 'not_approved' using errcode = '42501'; end if;
  if p_kind not in ('servant', 'child', 'priest') then raise exception 'invalid_kind' using errcode = '22023'; end if;
  if p_kind = 'priest' and not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_kind = 'servant' and v_role = 'class_servant' then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_kind = 'child' then
    if p_church is null or p_service is null or p_class is null then raise exception 'scope_required' using errcode = '22023'; end if;
    if not public.can_access(p_church, p_service, p_class) then raise exception 'forbidden' using errcode = '42501'; end if;
  elsif p_kind = 'servant' and p_church is not null and not public.scope_contains(p_church, p_service, p_class) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_service is not null and not exists (select 1 from public.services s where s.id = p_service and s.church_id = p_church) then
    raise exception 'service_not_in_church' using errcode = '22023';
  end if;
  if p_class is not null and not exists (select 1 from public.classes c where c.id = p_class and c.service_id = p_service) then
    raise exception 'class_not_in_service' using errcode = '22023';
  end if;
  v_exp := now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 365)));
  v_token := encode(gen_random_bytes(18), 'hex');
  insert into public.signup_invites (kind, token_hash, church_id, service_id, class_id, created_by, expires_at, max_uses, note)
  values (p_kind, encode(digest(v_token, 'sha256'), 'hex'), p_church, p_service, p_class, auth.uid(), v_exp, p_max_uses, nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token, 'kind', p_kind, 'church_id', p_church, 'service_id', p_service, 'class_id', p_class, 'expires_at', v_exp);
end $$;
grant execute on function public.signup_invite_create(text, uuid, uuid, uuid, integer, integer, text) to authenticated;

create or replace function public.signup_invite_check(p_token text, p_kind text)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select coalesce((
    select jsonb_build_object('valid', true, 'kind', i.kind, 'church_id', i.church_id, 'service_id', i.service_id, 'class_id', i.class_id,
                              'church_name', (select name from public.churches where id = i.church_id),
                              'service_name', (select name from public.services where id = i.service_id),
                              'class_name', (select name from public.classes where id = i.class_id),
                              'expires_at', i.expires_at)
      from public.signup_invites i
     where i.token_hash = encode(digest(trim(coalesce(p_token, '')), 'sha256'), 'hex')
       and i.kind = p_kind and i.revoked_at is null and i.expires_at > now()
       and (i.max_uses is null or i.uses < i.max_uses)
  ), jsonb_build_object('valid', false))
$$;
grant execute on function public.signup_invite_check(text, text) to anon, authenticated;

create or replace function public.signup_invite_consume(p_token text, p_kind text)
returns public.signup_invites language plpgsql volatile security definer set search_path = public, extensions as $$
declare i public.signup_invites;
begin
  if nullif(trim(coalesce(p_token, '')), '') is null then raise exception 'invite_required' using errcode = '42501'; end if;
  select * into i from public.signup_invites
   where token_hash = encode(digest(trim(p_token), 'sha256'), 'hex') and kind = p_kind for update;
  if not found or i.revoked_at is not null or i.expires_at < now() or (i.max_uses is not null and i.uses >= i.max_uses) then
    raise exception 'invite_invalid' using errcode = '42501';
  end if;
  update public.signup_invites set uses = uses + 1 where id = i.id;
  return i;
end $$;
revoke all on function public.signup_invite_consume(text, text) from public, anon, authenticated;


-- 6a. child_signup — invite required; its scope wins. A person who is a child
--     in ANOTHER class may add this class (same password).
drop function if exists public.child_signup(text, text, text, text, date, text, text, text, text, uuid, uuid, uuid);
create or replace function public.child_signup(
  p_code text, p_name text, p_password text,
  p_gender text default null, p_birthdate date default null, p_phone text default null,
  p_address text default null, p_notes text default null, p_image_url text default null,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_invite text default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_code text := nullif(trim(coalesce(p_code, '')), '');
  v_id uuid; v_person public.persons; v_hash text; inv public.signup_invites;
  v_church uuid; v_service uuid; v_class uuid;
begin
  inv := public.signup_invite_consume(p_invite, 'child');
  v_church := coalesce(inv.church_id, p_church); v_service := coalesce(inv.service_id, p_service); v_class := coalesce(inv.class_id, p_class);
  if v_code is null then raise exception 'code_required' using errcode = '22023'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required' using errcode = '22023'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'weak_password' using errcode = '22023'; end if;
  if p_gender is not null and p_gender not in ('male', 'female') then raise exception 'invalid_gender' using errcode = '22023'; end if;
  if v_church is null then raise exception 'church_required' using errcode = '22023'; end if;
  if v_service is not null and not exists (select 1 from public.services s where s.id = v_service and s.church_id = v_church) then
    raise exception 'service_not_in_church' using errcode = '22023';
  end if;
  if v_class is not null and (v_service is null or not exists (select 1 from public.classes c where c.id = v_class and c.service_id = v_service)) then
    raise exception 'class_not_in_service' using errcode = '22023';
  end if;
  if exists (select 1 from public.families f where f.code = v_code) then raise exception 'code_is_family' using errcode = '23505'; end if;
  if exists (select 1 from public.child_join_requests r where r.code = v_code and r.status = 'pending') then
    raise exception 'pending_exists' using errcode = '23505';
  end if;
  select * into v_person from public.persons where national_id = v_code;
  if found then
    if v_class is not null and exists (select 1 from public.enrollments e where e.person_id = v_person.id and e.class_id = v_class) then
      raise exception 'already_registered' using errcode = '23505';
    end if;
    if exists (select 1 from public.person_credentials c where c.person_id = v_person.id) then
      if not public.person_password_ok(v_person.id, p_password) then
        perform pg_sleep(0.25);
        raise exception 'wrong_password' using errcode = 'P0010';
      end if;
      select password_hash into v_hash from public.person_credentials where person_id = v_person.id;
    end if;
  end if;
  v_hash := coalesce(v_hash, crypt(p_password, gen_salt('bf', 10)));
  insert into public.child_join_requests
    (code, name, gender, birthdate, phone, address, notes, image_url, password_hash, church_id, service_id, class_id)
  values
    (v_code, trim(p_name), p_gender, p_birthdate,
     nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_address, '')), ''),
     nullif(trim(coalesce(p_notes, '')), ''), p_image_url, v_hash, v_church, v_service, v_class)
  returning id into v_id;
  return jsonb_build_object('request_id', v_id, 'code', v_code, 'linked', v_person.id is not null);
end $$;
grant execute on function public.child_signup(text, text, text, text, date, text, text, text, text, uuid, uuid, uuid, text) to anon, authenticated;

-- 6b. priest_signup — the OWNER's invite; ONE priest account per person
drop function if exists public.priest_signup(text, text, text, uuid, text, text, date, text, text, text, text);
create or replace function public.priest_signup(
  p_code text, p_name text, p_password text, p_church uuid,
  p_title text default null, p_gender text default null, p_birthdate date default null,
  p_phone text default null, p_address text default null, p_notes text default null, p_image_url text default null,
  p_invite text default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_code text := nullif(trim(coalesce(p_code, '')), '');
  v_id uuid; v_person public.persons; v_hash text; inv public.signup_invites; v_church uuid;
begin
  inv := public.signup_invite_consume(p_invite, 'priest');
  v_church := coalesce(inv.church_id, p_church);
  if v_code is null then raise exception 'code_required' using errcode = '22023'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required' using errcode = '22023'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'weak_password' using errcode = '22023'; end if;
  if p_gender is not null and p_gender not in ('male', 'female') then raise exception 'invalid_gender' using errcode = '22023'; end if;
  if v_church is null or not exists (select 1 from public.churches c where c.id = v_church) then
    raise exception 'church_required' using errcode = '22023';
  end if;
  if exists (select 1 from public.families f where f.code = v_code) then raise exception 'code_is_family' using errcode = '23505'; end if;
  if exists (select 1 from public.persons p join public.priests pr on pr.person_id = p.id where p.national_id = v_code) then
    raise exception 'already_registered' using errcode = '23505';   -- ONE priest account per person
  end if;
  if exists (select 1 from public.priest_requests r where r.code = v_code and r.status = 'pending') then
    raise exception 'pending_exists' using errcode = '23505';
  end if;
  select * into v_person from public.persons where national_id = v_code;
  if found and exists (select 1 from public.person_credentials c where c.person_id = v_person.id) then
    if not public.person_password_ok(v_person.id, p_password) then
      perform pg_sleep(0.25);
      raise exception 'wrong_password' using errcode = 'P0010';
    end if;
    select password_hash into v_hash from public.person_credentials where person_id = v_person.id;
  end if;
  v_hash := coalesce(v_hash, crypt(p_password, gen_salt('bf', 10)));
  insert into public.priest_requests (code, name, title, gender, birthdate, phone, address, notes, image_url, password_hash, church_id)
  values (v_code, trim(p_name), nullif(trim(coalesce(p_title, '')), ''), p_gender, p_birthdate,
          nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_address, '')), ''),
          nullif(trim(coalesce(p_notes, '')), ''), p_image_url, v_hash, v_church)
  returning id into v_id;
  return jsonb_build_object('request_id', v_id, 'code', v_code, 'linked', v_person.id is not null);
end $$;
grant execute on function public.priest_signup(text, text, text, uuid, text, text, date, text, text, text, text, text) to anon, authenticated;


-- 6c. servant_signup — invite required (the wizard checks it BEFORE auth.signUp
--     so no orphan Auth account is created; the RPC re-checks and consumes)
drop function if exists public.servant_signup(text, text, text, date, text, text, text, uuid, uuid, uuid, text, jsonb);
create or replace function public.servant_signup(
  p_code text,
  p_full_name text,
  p_gender text default null,
  p_birthdate date default null,
  p_phone text default null,
  p_address text default null,
  p_notes text default null,
  p_church uuid default null,
  p_service uuid default null,
  p_class uuid default null,
  p_image_url text default null,
  p_scopes jsonb default null,
  p_invite text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_code text := nullif(trim(p_code), '');
  v_user_id text;
  v_person public.persons%rowtype;
  v_created boolean := false;
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_scopes jsonb;
  v jsonb; v_c uuid; v_s uuid; v_k uuid;
  v_i int := 0;
  inv public.signup_invites;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  inv := public.signup_invite_consume(p_invite, 'servant');
  if v_code is null then raise exception 'code_required' using errcode = '22023'; end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'name_required' using errcode = '22023'; end if;
  if p_gender is not null and p_gender not in ('male', 'female') then raise exception 'invalid_gender' using errcode = '22023'; end if;
  if v_phone is null then raise exception 'phone_required' using errcode = '22023'; end if;

  -- the list of places: p_scopes, or the legacy single scope
  v_scopes := case
    when p_scopes is not null and jsonb_typeof(p_scopes) = 'array' and jsonb_array_length(p_scopes) > 0 then p_scopes
    when p_church is not null then jsonb_build_array(jsonb_build_object('church_id', p_church, 'service_id', p_service, 'class_id', p_class))
    when inv.church_id is not null then jsonb_build_array(jsonb_build_object('church_id', inv.church_id, 'service_id', inv.service_id, 'class_id', inv.class_id))
    else '[]'::jsonb end;

  -- every chain must be consistent (all optional — the approver may set it)
  for v in select * from jsonb_array_elements(v_scopes) loop
    v_c := nullif(v->>'church_id', '')::uuid; v_s := nullif(v->>'service_id', '')::uuid; v_k := nullif(v->>'class_id', '')::uuid;
    if v_c is null then raise exception 'church_required' using errcode = '22023'; end if;
    if v_s is not null and not exists (select 1 from public.services s where s.id = v_s and s.church_id = v_c) then
      raise exception 'service_not_in_church' using errcode = '22023';
    end if;
    if v_k is not null and (v_s is null or not exists (select 1 from public.classes c where c.id = v_k and c.service_id = v_s)) then
      raise exception 'class_not_in_service' using errcode = '22023';
    end if;
  end loop;
  -- primary = the first place
  v_c := nullif(v_scopes->0->>'church_id', '')::uuid;
  v_s := nullif(v_scopes->0->>'service_id', '')::uuid;
  v_k := nullif(v_scopes->0->>'class_id', '')::uuid;

  v_user_id := public.code_to_user_id(v_code);
  if exists (select 1 from public.servant_enrollments s where s.user_id = v_user_id and s.id <> v_uid) then
    raise exception 'code_taken' using errcode = '23505';
  end if;

  perform set_config('app.in_servant_signup', '1', true);
  insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id)
  values (v_uid, trim(p_full_name), v_user_id, v_phone, 'class_servant', 'pending', v_c, v_s, v_k)
  on conflict (id) do nothing;
  if not exists (select 1 from public.servant_enrollments s where s.id = v_uid and s.status = 'pending') then
    raise exception 'already_registered' using errcode = '23505';
  end if;

  select * into v_person from public.persons where national_id = v_code;
  if not found then
    insert into public.persons (national_id, name, gender, birthdate, phone, address, notes, image_url, created_by, edited_by)
    values (v_code, trim(p_full_name), p_gender, p_birthdate, v_phone,
            nullif(trim(coalesce(p_address, '')), ''), nullif(trim(coalesce(p_notes, '')), ''),
            p_image_url, v_uid, v_uid)
    returning * into v_person;
    v_created := true;
  else
    update public.persons set
      gender    = coalesce(gender, p_gender),
      birthdate = coalesce(birthdate, p_birthdate),
      phone     = coalesce(phone, v_phone),
      address   = coalesce(address, nullif(trim(coalesce(p_address, '')), '')),
      notes     = coalesce(notes, nullif(trim(coalesce(p_notes, '')), '')),
      image_url = coalesce(image_url, p_image_url),
      edited_by = v_uid, edited_at = now()
    where id = v_person.id
    returning * into v_person;
  end if;

  update public.servant_enrollments set
    person_id  = v_person.id,
    full_name  = v_person.name,
    user_id    = v_user_id,
    phone      = coalesce(v_person.phone, v_phone),
    church_id  = v_c,
    service_id = v_s,
    class_id   = v_k,
    photo_url  = v_person.image_url,
    updated_at = now()
  where id = v_uid and status = 'pending';

  -- the other requested places (re-running the signup refreshes them)
  delete from public.servant_scopes where servant_id = v_uid;
  for v in select * from jsonb_array_elements(v_scopes) loop
    v_i := v_i + 1;
    if v_i = 1 then continue; end if;
    insert into public.servant_scopes (servant_id, church_id, service_id, class_id, created_by)
    values (v_uid, nullif(v->>'church_id', '')::uuid, nullif(v->>'service_id', '')::uuid, nullif(v->>'class_id', '')::uuid, v_uid)
    on conflict do nothing;
  end loop;

  perform set_config('app.in_servant_signup', '0', true);
  return jsonb_build_object('person_id', v_person.id, 'person_created', v_created,
                            'national_id', v_person.national_id, 'user_id', v_user_id,
                            'scopes', jsonb_array_length(v_scopes));
end $$;
grant execute on function public.servant_signup(text, text, text, date, text, text, text, uuid, uuid, uuid, text, jsonb, text) to authenticated;

commit;
