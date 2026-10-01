-- =====================================================================
-- 20261003120000 — ONE PERSON · ONE CODE · ONE PASSWORD · MANY ACCOUNTS
--   (حساب واحد للشخص — خادم · مخدوم · كاهن — وتبديل الحساب بلا خروج)
--
-- Before this migration the SAME code could carry THREE different
-- passwords: the servant one in Supabase Auth, the child one in
-- `person_credentials`, the priest one in `priests.password_hash`.
-- Signing up a second time with the same code was refused.
--
-- Now:
--   1. `person_credentials` is THE password of the person. Every path that
--      sets a password writes it there (and mirrors it to `priests` for the
--      legacy priest_login; the servant Auth account is synced by the server
--      route /api/account/sync-password with the service role — the DB
--      cannot touch Supabase Auth).
--   2. `person_accounts(person)` lists the accounts (kinds) of a person
--      without duplicates: servant (with role / status / places), child
--      (classes), priest (church / title / status).
--   3. Signup «as another kind» for an existing code = ADD an enrollment to
--      the same person after proving the EXISTING password
--      (`person_verify_password`). The wizard RPCs accept the current
--      password instead of inventing a second one.
--   4. Switching accounts WITHOUT signing out: `account_switch` verifies the
--      current session (child token / priest token / servant JWT) and mints
--      the target session. For the servant target it issues a one-time
--      SWITCH TICKET that the server exchanges for an Auth session
--      (`account_switch_tickets`).
--
-- Idempotent: create or replace / if not exists everywhere.
-- =====================================================================
begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 0. person_credentials — who set it & from where (audit only)
-- ---------------------------------------------------------------------
alter table public.person_credentials add column if not exists source text;
comment on column public.person_credentials.source is
  'آخر مصدر ضبط كلمة المرور: child_signup · servant_signup · priest_signup · admin · self · migration';

-- ---------------------------------------------------------------------
-- 1. Back-fill — a priest whose person has no credentials yet: his priest
--    password becomes the person's password. (Servant Auth passwords cannot
--    be read; the owner may re-sync them from the UI — see README.)
-- ---------------------------------------------------------------------
insert into public.person_credentials (person_id, password_hash, source)
select pr.person_id, pr.password_hash, 'migration'
  from public.priests pr
 where pr.password_hash is not null
   and not exists (select 1 from public.person_credentials c where c.person_id = pr.person_id)
on conflict (person_id) do nothing;

-- and the other direction: a priest row keeps the SAME hash as the person
update public.priests pr
   set password_hash = c.password_hash
  from public.person_credentials c
 where c.person_id = pr.person_id
   and pr.password_hash is distinct from c.password_hash;

-- ---------------------------------------------------------------------
-- 2. The ONE write path for the password + the verifier
-- ---------------------------------------------------------------------
create or replace function public.person_set_password_hash(p_person uuid, p_hash text, p_source text default null, p_set_by uuid default null)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  if p_person is null or coalesce(p_hash, '') = '' then return; end if;
  insert into public.person_credentials (person_id, password_hash, set_by, source)
  values (p_person, p_hash, p_set_by, p_source)
  on conflict (person_id) do update
    set password_hash = excluded.password_hash,
        set_by = coalesce(excluded.set_by, public.person_credentials.set_by),
        source = excluded.source,
        updated_at = now();
  -- mirror: the priest row (legacy column still read by priest_login)
  update public.priests set password_hash = p_hash, updated_at = now()
   where person_id = p_person and password_hash is distinct from p_hash;
end $$;
revoke all on function public.person_set_password_hash(uuid, text, text, uuid) from public, anon, authenticated;

create or replace function public.person_set_password(p_person uuid, p_password text, p_source text default null, p_set_by uuid default null)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  if length(coalesce(p_password, '')) < 6 then raise exception 'weak_password' using errcode = '22023'; end if;
  perform public.person_set_password_hash(p_person, crypt(p_password, gen_salt('bf', 10)), p_source, p_set_by);
end $$;
revoke all on function public.person_set_password(uuid, text, text, uuid) from public, anon, authenticated;

-- true when the password matches the person's password (the DEFAULT
-- password 000000 applies while none was ever set — same rule as child_login)
create or replace function public.person_password_ok(p_person uuid, p_password text)
returns boolean language plpgsql stable security definer set search_path = public, extensions as $$
declare c public.person_credentials;
begin
  if p_person is null then return false; end if;
  select * into c from public.person_credentials where person_id = p_person;
  if not found then
    return coalesce(p_password, '') = public.default_password();
  end if;
  return coalesce(p_password, '') <> '' and c.password_hash = crypt(p_password, c.password_hash);
end $$;
revoke all on function public.person_password_ok(uuid, text) from public, anon, authenticated;

-- keep the priest mirror in sync when the credentials row changes by any path
create or replace function public.person_credentials_mirror_priest()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.priests set password_hash = new.password_hash, updated_at = now()
   where person_id = new.person_id and password_hash is distinct from new.password_hash;
  return new;
end $$;
drop trigger if exists trg_person_credentials_mirror_priest on public.person_credentials;
create trigger trg_person_credentials_mirror_priest
after insert or update of password_hash on public.person_credentials
for each row execute function public.person_credentials_mirror_priest();

-- a NEW priest row always carries the person's password when one exists
create or replace function public.priests_take_person_password()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_hash text;
begin
  select password_hash into v_hash from public.person_credentials where person_id = new.person_id;
  if v_hash is not null then
    new.password_hash := v_hash;
  elsif new.password_hash is not null then
    -- first password of the person = the one typed for the priest account
    insert into public.person_credentials (person_id, password_hash, source)
    values (new.person_id, new.password_hash, 'priest_signup')
    on conflict (person_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists trg_priests_take_person_password on public.priests;
create trigger trg_priests_take_person_password
before insert on public.priests
for each row execute function public.priests_take_person_password();

-- ---------------------------------------------------------------------
-- 3. Existing RPCs now write through the ONE path
-- ---------------------------------------------------------------------
-- 3a. child self change (old + new) — same body as 0043, writes via helper
create or replace function public.child_change_password(p_token text, p_current text, p_new text)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare p public.persons;
begin
  p := public.child_portal_person(p_token);
  if length(coalesce(p_new, '')) < 6 then raise exception 'weak_password' using errcode = 'P0001'; end if;
  if not public.person_password_ok(p.id, p_current) then raise exception 'wrong_password' using errcode = 'P0010'; end if;
  perform public.person_set_password(p.id, p_new, 'self', null);
  delete from public.child_sessions where person_id = p.id and token_hash <> encode(digest(trim(p_token), 'sha256'), 'hex');
  delete from public.priest_sessions s using public.priests pr where pr.id = s.priest_id and pr.person_id = p.id;
end $$;
grant execute on function public.child_change_password(text, text, text) to anon, authenticated;

-- 3b. priest self change (old + new) → the PERSON password
create or replace function public.priest_change_password(p_token text, p_current text, p_new text)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests;
begin
  pr := public.priest_portal_self(p_token);
  if length(coalesce(p_new, '')) < 6 then raise exception 'weak_password' using errcode = 'P0001'; end if;
  if not public.person_password_ok(pr.person_id, p_current) then raise exception 'wrong_password' using errcode = 'P0010'; end if;
  perform public.person_set_password(pr.person_id, p_new, 'self', null);
  delete from public.priest_sessions where priest_id = pr.id and token_hash <> encode(digest(trim(p_token), 'sha256'), 'hex');
  delete from public.child_sessions where person_id = pr.person_id;
end $$;
grant execute on function public.priest_change_password(text, text, text) to anon, authenticated;

-- 3c. a superior resets a child → the person password
create or replace function public.admin_set_child_password(p_person uuid, p_password text)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  if public.my_role() is null then raise exception 'not_approved' using errcode = '42501'; end if;
  if not (public.is_owner() or public.can_access_person(p_person)
          or exists (select 1 from public.persons x where x.id = p_person and x.created_by = auth.uid())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'weak_password' using errcode = '22023'; end if;
  perform public.person_set_password(p_person, p_password, 'admin', auth.uid());
  delete from public.child_sessions where person_id = p_person;
  delete from public.priest_sessions s using public.priests pr where pr.id = s.priest_id and pr.person_id = p_person;
end $$;
revoke all on function public.admin_set_child_password(uuid, text) from public, anon;
grant execute on function public.admin_set_child_password(uuid, text) to authenticated;

-- 3d. the owner resets a priest → the person password
create or replace function public.owner_set_priest_password(p_priest uuid, p_password text)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_person uuid;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'weak_password' using errcode = '22023'; end if;
  select person_id into v_person from public.priests where id = p_priest;
  if v_person is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.person_set_password(v_person, p_password, 'admin', auth.uid());
  delete from public.priest_sessions where priest_id = p_priest;
  delete from public.child_sessions where person_id = v_person;
end $$;
revoke all on function public.owner_set_priest_password(uuid, text) from public, anon;
grant execute on function public.owner_set_priest_password(uuid, text) to authenticated;

-- 3e. priest login — accepts the PERSON password (the mirror column is kept
--     in sync, but the credentials row is authoritative)
create or replace function public.priest_login(p_code text, p_password text, p_remember boolean default false, p_user_agent text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  p public.persons;
  pr public.priests;
  v_token text;
  v_exp timestamptz;
begin
  if nullif(trim(coalesce(p_code, '')), '') is null then raise exception 'invalid_code' using errcode = 'P0001'; end if;
  if exists (select 1 from public.priest_requests r where r.code = trim(p_code) and r.status = 'pending') then
    raise exception 'pending_approval' using errcode = 'P0001';
  end if;
  select * into p from public.persons where national_id = trim(p_code);
  if not found then raise exception 'unknown_code' using errcode = 'P0002'; end if;
  select * into pr from public.priests where person_id = p.id;
  if not found then raise exception 'not_priest' using errcode = 'P0002'; end if;
  if not public.person_password_ok(p.id, p_password)
     and not (coalesce(p_password, '') <> '' and pr.password_hash = crypt(p_password, pr.password_hash)) then
    perform pg_sleep(0.25);
    raise exception 'wrong_password' using errcode = 'P0010';
  end if;
  if pr.status = 'pending' then raise exception 'pending_approval' using errcode = 'P0001'; end if;
  if pr.status = 'rejected' then raise exception 'account_rejected' using errcode = 'P0001'; end if;
  if pr.status = 'suspended' then raise exception 'account_stopped' using errcode = 'P0001'; end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_exp := case when coalesce(p_remember, false) then now() + interval '90 days' else now() + interval '12 hours' end;
  insert into public.priest_sessions (priest_id, token_hash, remember, expires_at, user_agent)
  values (pr.id, encode(digest(v_token, 'sha256'), 'hex'), coalesce(p_remember, false), v_exp, left(p_user_agent, 300));
  delete from public.priest_sessions where expires_at < now() - interval '1 day';
  perform set_config('app.priest_actor', pr.id::text, true);
  return jsonb_build_object('token', v_token, 'expires_at', v_exp, 'priest_id', pr.id, 'remember', coalesce(p_remember, false));
end $$;
grant execute on function public.priest_login(text, text, boolean, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. person_accounts(person) — every account of the person, no duplicates
-- ---------------------------------------------------------------------
create or replace function public.person_accounts(p_person uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(a order by a->>'order') from (
      -- servant (one login account per person)
      select jsonb_build_object(
          'order', '1', 'kind', 'servant', 'id', s.id, 'status', s.status, 'role', s.role,
          'label', 'خادم',
          'places', (select coalesce(jsonb_agg(jsonb_build_object('church', ch.name, 'service', sv.name, 'class', cl.name)), '[]'::jsonb)
                       from (select s.church_id, s.service_id, s.class_id
                             union select x.church_id, x.service_id, x.class_id from public.servant_scopes x where x.servant_id = s.id) sc
                       left join public.churches ch on ch.id = sc.church_id
                       left join public.services sv on sv.id = sc.service_id
                       left join public.classes cl on cl.id = sc.class_id
                       where sc.church_id is not null)) a
        from public.servant_enrollments s where s.person_id = p_person
      union all
      -- child (ONE entry for all his classes)
      select jsonb_build_object(
          'order', '2', 'kind', 'child', 'id', p_person,
          'status', case when exists (select 1 from public.enrollments e where e.person_id = p_person and e.kind = 'child' and e.status = 'active') then 'active' else 'stopped' end,
          'label', 'مخدوم',
          'places', (select coalesce(jsonb_agg(jsonb_build_object('church', ch.name, 'service', sv.name, 'class', cl.name) order by ch.name, sv.name, cl.name), '[]'::jsonb)
                       from public.enrollments e
                       join public.churches ch on ch.id = e.church_id
                       join public.services sv on sv.id = e.service_id
                       join public.classes cl on cl.id = e.class_id
                      where e.person_id = p_person and e.kind = 'child'))
       where exists (select 1 from public.enrollments e where e.person_id = p_person and e.kind = 'child')
      union all
      -- priest
      select jsonb_build_object(
          'order', '3', 'kind', 'priest', 'id', pr.id, 'status', pr.status, 'title', pr.title,
          'label', 'كاهن',
          'places', jsonb_build_array(jsonb_build_object('church', ch.name, 'service', null, 'class', null)))
        from public.priests pr join public.churches ch on ch.id = pr.church_id
       where pr.person_id = p_person
    ) t(a)
  ), '[]'::jsonb)
$$;
revoke all on function public.person_accounts(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Who am I (from ANY session) → person + accounts
--    p_kind: 'servant' (auth.uid()) · 'child' (child token) · 'priest' (priest token)
-- ---------------------------------------------------------------------
create or replace function public.session_person(p_kind text, p_token text default null)
returns uuid language plpgsql stable security definer set search_path = public, extensions as $$
declare v uuid; s public.child_sessions; ps public.priest_sessions;
begin
  if p_kind = 'servant' then
    if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
    select person_id into v from public.servant_enrollments where id = auth.uid();
    if v is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    return v;
  elsif p_kind = 'child' then
    if p_token is null or length(trim(p_token)) < 20 then raise exception 'session_expired' using errcode = 'P0002'; end if;
    select * into s from public.child_sessions where token_hash = encode(digest(trim(p_token), 'sha256'), 'hex');
    if not found or s.expires_at < now() then raise exception 'session_expired' using errcode = 'P0002'; end if;
    return s.person_id;
  elsif p_kind = 'priest' then
    if p_token is null or length(trim(p_token)) < 20 then raise exception 'session_expired' using errcode = 'P0002'; end if;
    select * into ps from public.priest_sessions where token_hash = encode(digest(trim(p_token), 'sha256'), 'hex');
    if not found or ps.expires_at < now() then raise exception 'session_expired' using errcode = 'P0002'; end if;
    select person_id into v from public.priests where id = ps.priest_id;
    if v is null then raise exception 'session_expired' using errcode = 'P0002'; end if;
    return v;
  end if;
  raise exception 'invalid_kind' using errcode = '22023';
end $$;
revoke all on function public.session_person(text, text) from public, anon, authenticated;

create or replace function public.my_accounts(p_kind text, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v uuid; p public.persons;
begin
  v := public.session_person(p_kind, p_token);
  select * into p from public.persons where id = v;
  return jsonb_build_object(
    'person', jsonb_build_object('id', p.id, 'name', p.name, 'code', p.national_id, 'image_url', p.image_url),
    'current', p_kind,
    'accounts', public.person_accounts(v));
end $$;
grant execute on function public.my_accounts(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. SWITCH ACCOUNT — no sign-out, no password
-- ---------------------------------------------------------------------
create table if not exists public.account_switch_tickets (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.persons(id) on delete cascade,
  servant_id   uuid not null references public.servant_enrollments(id) on delete cascade,
  ticket_hash  text not null unique,
  remember     boolean not null default true,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz
);
comment on table public.account_switch_tickets is
  'تذاكر تبديل الحساب إلى حساب الخادم — تُستبدل مرة واحدة خلال دقيقتين بجلسة Supabase Auth عبر /api/account/switch';
alter table public.account_switch_tickets enable row level security;
revoke all on public.account_switch_tickets from anon, authenticated;

create or replace function public.account_switch(p_from_kind text, p_from_token text, p_to_kind text, p_remember boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_person uuid;
  p public.persons;
  s public.servant_enrollments;
  pr public.priests;
  v_token text;
  v_exp timestamptz;
begin
  v_person := public.session_person(p_from_kind, p_from_token);
  select * into p from public.persons where id = v_person;
  v_exp := case when coalesce(p_remember, true) then now() + interval '90 days' else now() + interval '12 hours' end;

  if p_to_kind = 'child' then
    if not exists (select 1 from public.enrollments e where e.person_id = v_person and e.kind = 'child') then
      raise exception 'no_such_account' using errcode = 'P0002';
    end if;
    if not exists (select 1 from public.enrollments e where e.person_id = v_person and e.kind = 'child' and e.status = 'active') then
      raise exception 'account_stopped' using errcode = 'P0011';
    end if;
    v_token := encode(gen_random_bytes(32), 'hex');
    insert into public.child_sessions (person_id, token_hash, remember, expires_at, user_agent)
    values (v_person, encode(digest(v_token, 'sha256'), 'hex'), coalesce(p_remember, true), v_exp, 'switch:' || p_from_kind);
    return jsonb_build_object('kind', 'child', 'token', v_token, 'expires_at', v_exp, 'person_id', v_person);

  elsif p_to_kind = 'priest' then
    select * into pr from public.priests where person_id = v_person;
    if not found then raise exception 'no_such_account' using errcode = 'P0002'; end if;
    if pr.status = 'pending' then raise exception 'pending_approval' using errcode = 'P0001'; end if;
    if pr.status <> 'approved' then raise exception 'account_stopped' using errcode = 'P0001'; end if;
    v_token := encode(gen_random_bytes(32), 'hex');
    insert into public.priest_sessions (priest_id, token_hash, remember, expires_at, user_agent)
    values (pr.id, encode(digest(v_token, 'sha256'), 'hex'), coalesce(p_remember, true), v_exp, 'switch:' || p_from_kind);
    perform set_config('app.priest_actor', pr.id::text, true);
    return jsonb_build_object('kind', 'priest', 'token', v_token, 'expires_at', v_exp, 'priest_id', pr.id);

  elsif p_to_kind = 'servant' then
    select * into s from public.servant_enrollments where person_id = v_person;
    if not found then raise exception 'no_such_account' using errcode = 'P0002'; end if;
    if s.status = 'pending' then raise exception 'pending_approval' using errcode = 'P0001'; end if;
    if s.status <> 'approved' then raise exception 'account_stopped' using errcode = 'P0001'; end if;
    -- one-time ticket, 2 minutes, exchanged by the server for an Auth session
    v_token := encode(gen_random_bytes(32), 'hex');
    delete from public.account_switch_tickets where expires_at < now();
    insert into public.account_switch_tickets (person_id, servant_id, ticket_hash, remember, expires_at)
    values (v_person, s.id, encode(digest(v_token, 'sha256'), 'hex'), coalesce(p_remember, true), now() + interval '2 minutes');
    return jsonb_build_object('kind', 'servant', 'ticket', v_token, 'servant_id', s.id, 'code', p.national_id);
  end if;
  raise exception 'invalid_kind' using errcode = '22023';
end $$;
grant execute on function public.account_switch(text, text, text, boolean) to anon, authenticated;

-- the server (service role) redeems the ticket exactly once
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
  return jsonb_build_object('servant_id', s.id, 'user_id', s.user_id, 'remember', t.remember, 'person_id', t.person_id);
end $$;
revoke all on function public.account_switch_redeem(text) from public, anon, authenticated;
grant execute on function public.account_switch_redeem(text) to service_role;

-- ---------------------------------------------------------------------
-- 7. SIGNUP as another kind for an EXISTING code
-- ---------------------------------------------------------------------
-- 7a. One lookup for every wizard: does the code already belong to a person
--     with an account, and which kinds? The wizard then asks for the
--     EXISTING password instead of a new one.
create or replace function public.account_code_lookup(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when nullif(trim(p_code), '') is null then null
    when exists (select 1 from public.families f where f.code = trim(p_code)) then jsonb_build_object('family', true, 'exists', false)
    else coalesce((
      select jsonb_build_object(
        'exists', true, 'family', false,
        'name', p.name, 'image_url', p.image_url,
        'has_password', exists (select 1 from public.person_credentials c where c.person_id = p.id),
        'is_servant', exists (select 1 from public.servant_enrollments s where s.person_id = p.id),
        'servant_status', (select s.status::text from public.servant_enrollments s where s.person_id = p.id limit 1),
        'is_child', exists (select 1 from public.enrollments e where e.person_id = p.id and e.kind = 'child'),
        'is_priest', exists (select 1 from public.priests pr where pr.person_id = p.id),
        'priest_status', (select pr.status from public.priests pr where pr.person_id = p.id limit 1),
        'child_pending', exists (select 1 from public.child_join_requests r where r.code = p.national_id and r.status = 'pending'),
        'priest_pending', exists (select 1 from public.priest_requests r where r.code = p.national_id and r.status = 'pending'),
        'has_account', exists (select 1 from public.servant_enrollments s where s.person_id = p.id)
                    or exists (select 1 from public.priests pr where pr.person_id = p.id)
                    or exists (select 1 from public.person_credentials c where c.person_id = p.id)
      ) from public.persons p where p.national_id = trim(p_code) limit 1),
      jsonb_build_object('exists', false, 'family', false,
        'child_pending', exists (select 1 from public.child_join_requests r where r.code = trim(p_code) and r.status = 'pending'),
        'priest_pending', exists (select 1 from public.priest_requests r where r.code = trim(p_code) and r.status = 'pending')))
  end
$$;
grant execute on function public.account_code_lookup(text) to anon, authenticated;

-- 7b. prove the existing password of a code (anonymous — rate-limited by
--     the pg_sleep; returns true/false only, never the person)
create or replace function public.person_verify_password(p_code text, p_password text)
returns boolean language plpgsql volatile security definer set search_path = public, extensions as $$
declare v uuid; ok boolean;
begin
  select id into v from public.persons where national_id = trim(coalesce(p_code, ''));
  if v is null then return false; end if;
  -- an account must exist for the default-password rule to apply
  if not exists (select 1 from public.person_credentials c where c.person_id = v)
     and not exists (select 1 from public.enrollments e where e.person_id = v and e.kind = 'child') then
    return false;
  end if;
  ok := public.person_password_ok(v, p_password);
  if not ok then perform pg_sleep(0.25); end if;
  return ok;
end $$;
grant execute on function public.person_verify_password(text, text) to anon, authenticated;

-- 7c. child signup for a code that already has an account (servant / priest):
--     the EXISTING password is required; the request is created as usual and
--     keeps the person's hash (so approval never overwrites it).
create or replace function public.child_signup(
  p_code text, p_name text, p_password text,
  p_gender text default null, p_birthdate date default null, p_phone text default null,
  p_address text default null, p_notes text default null, p_image_url text default null,
  p_church uuid default null, p_service uuid default null, p_class uuid default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_code text := nullif(trim(coalesce(p_code, '')), '');
  v_id uuid;
  v_person public.persons;
  v_hash text;
begin
  if v_code is null then raise exception 'code_required' using errcode = '22023'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required' using errcode = '22023'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'weak_password' using errcode = '22023'; end if;
  if p_gender is not null and p_gender not in ('male', 'female') then raise exception 'invalid_gender' using errcode = '22023'; end if;
  if p_church is null then raise exception 'church_required' using errcode = '22023'; end if;
  if p_service is not null and not exists (select 1 from public.services s where s.id = p_service and s.church_id = p_church) then
    raise exception 'service_not_in_church' using errcode = '22023';
  end if;
  if p_class is not null and (p_service is null
      or not exists (select 1 from public.classes c where c.id = p_class and c.service_id = p_service)) then
    raise exception 'class_not_in_service' using errcode = '22023';
  end if;
  if exists (select 1 from public.families f where f.code = v_code) then raise exception 'code_is_family' using errcode = '23505'; end if;
  if exists (select 1 from public.child_join_requests r where r.code = v_code and r.status = 'pending') then
    raise exception 'pending_exists' using errcode = '23505';
  end if;

  select * into v_person from public.persons where national_id = v_code;
  if found then
    if exists (select 1 from public.person_credentials c where c.person_id = v_person.id) then
      -- already a CHILD account with a password → log in instead (0042 rule)
      if exists (select 1 from public.enrollments e where e.person_id = v_person.id and e.kind = 'child') then
        raise exception 'already_registered' using errcode = '23505';
      end if;
      -- another kind of account (servant / priest) → the SAME password is required
      if not public.person_password_ok(v_person.id, p_password) then
        perform pg_sleep(0.25);
        raise exception 'wrong_password' using errcode = 'P0010';
      end if;
      select password_hash into v_hash from public.person_credentials where person_id = v_person.id;
    end if;
    -- no password yet (a child added by a servant, or a pre-migration servant /
    -- priest account): the typed password becomes the person's password on approval
  end if;
  v_hash := coalesce(v_hash, crypt(p_password, gen_salt('bf', 10)));

  insert into public.child_join_requests
    (code, name, gender, birthdate, phone, address, notes, image_url, password_hash, church_id, service_id, class_id)
  values
    (v_code, trim(p_name), p_gender, p_birthdate,
     nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_address, '')), ''),
     nullif(trim(coalesce(p_notes, '')), ''), p_image_url, v_hash, p_church, p_service, p_class)
  returning id into v_id;
  return jsonb_build_object('request_id', v_id, 'code', v_code, 'linked', v_person.id is not null);
end $$;
grant execute on function public.child_signup(text, text, text, text, date, text, text, text, text, uuid, uuid, uuid) to anon, authenticated;

-- 7d. approval of a child request keeps the person's EXISTING password
create or replace function public.review_child_join_request(
  p_request uuid, p_approve boolean, p_note text default null,
  p_church uuid default null, p_service uuid default null, p_class uuid default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  r public.child_join_requests;
  v_church uuid; v_service uuid; v_class uuid;
  v_person public.persons%rowtype;
  v_created boolean := false;
  v_enr uuid;
begin
  if public.my_role() is null then raise exception 'not_approved' using errcode = '42501'; end if;
  select * into r from public.child_join_requests where id = p_request;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'not_pending' using errcode = 'P0001'; end if;
  if not (public.is_owner() or (r.church_id is not null and public.can_access(r.church_id, r.service_id, r.class_id))) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not p_approve then
    update public.child_join_requests
       set status = 'rejected', decision_note = nullif(trim(coalesce(p_note, '')), ''),
           decided_by = auth.uid(), decided_at = now()
     where id = r.id;
    return jsonb_build_object('status', 'rejected');
  end if;

  v_church := coalesce(p_church, r.church_id);
  v_service := coalesce(p_service, r.service_id);
  v_class := coalesce(p_class, r.class_id);
  if v_church is null or v_service is null or v_class is null then
    raise exception 'scope_required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.classes c where c.id = v_class and c.service_id = v_service and c.church_id = v_church) then
    raise exception 'class_not_in_service' using errcode = '22023';
  end if;
  if not public.can_access(v_church, v_service, v_class) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_person from public.persons where national_id = r.code;
  if not found then
    insert into public.persons (national_id, name, gender, birthdate, phone, address, notes, image_url, created_by, edited_by)
    values (r.code, r.name, r.gender, r.birthdate, r.phone, r.address, r.notes, r.image_url, auth.uid(), auth.uid())
    returning * into v_person;
    v_created := true;
  else
    update public.persons set
      gender    = coalesce(gender, r.gender),
      birthdate = coalesce(birthdate, r.birthdate),
      phone     = coalesce(phone, r.phone),
      address   = coalesce(address, r.address),
      notes     = coalesce(notes, r.notes),
      image_url = coalesce(image_url, r.image_url),
      edited_by = auth.uid(), edited_at = now()
    where id = v_person.id
    returning * into v_person;
  end if;

  insert into public.enrollments (person_id, church_id, service_id, class_id, created_by, edited_by)
  values (v_person.id, v_church, v_service, v_class, auth.uid(), auth.uid())
  on conflict (person_id, class_id) do nothing
  returning id into v_enr;
  if v_enr is null then
    select id into v_enr from public.enrollments where person_id = v_person.id and class_id = v_class;
  end if;

  -- the person's password: set ONLY when he has none yet (one password per person)
  if not exists (select 1 from public.person_credentials c where c.person_id = v_person.id) then
    perform public.person_set_password_hash(v_person.id, r.password_hash, 'child_signup', auth.uid());
  end if;

  update public.child_join_requests
     set status = 'approved', decision_note = nullif(trim(coalesce(p_note, '')), ''),
         decided_by = auth.uid(), decided_at = now(),
         church_id = v_church, service_id = v_service, class_id = v_class,
         person_id = v_person.id, enrollment_id = v_enr
   where id = r.id;

  return jsonb_build_object('status', 'approved', 'person_id', v_person.id, 'person_created', v_created, 'enrollment_id', v_enr);
end $$;
revoke all on function public.review_child_join_request(uuid, boolean, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.review_child_join_request(uuid, boolean, text, uuid, uuid, uuid) to authenticated;

-- 7e. priest signup for a code that already has an account → same password
create or replace function public.priest_signup(
  p_code text, p_name text, p_password text, p_church uuid,
  p_title text default null, p_gender text default null, p_birthdate date default null,
  p_phone text default null, p_address text default null, p_notes text default null, p_image_url text default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_code text := nullif(trim(coalesce(p_code, '')), '');
  v_id uuid;
  v_person public.persons;
  v_hash text;
begin
  if v_code is null then raise exception 'code_required' using errcode = '22023'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required' using errcode = '22023'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'weak_password' using errcode = '22023'; end if;
  if p_gender is not null and p_gender not in ('male', 'female') then raise exception 'invalid_gender' using errcode = '22023'; end if;
  if p_church is null or not exists (select 1 from public.churches c where c.id = p_church) then
    raise exception 'church_required' using errcode = '22023';
  end if;
  if exists (select 1 from public.families f where f.code = v_code) then raise exception 'code_is_family' using errcode = '23505'; end if;
  if exists (select 1 from public.persons p join public.priests pr on pr.person_id = p.id where p.national_id = v_code) then
    raise exception 'already_registered' using errcode = '23505';
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
          nullif(trim(coalesce(p_notes, '')), ''), p_image_url, v_hash, p_church)
  returning id into v_id;
  return jsonb_build_object('request_id', v_id, 'code', v_code, 'linked', v_person.id is not null);
end $$;
grant execute on function public.priest_signup(text, text, text, uuid, text, text, date, text, text, text, text) to anon, authenticated;

-- (owner_review_priest_request / owner_add_priest insert into priests → the
--  BEFORE INSERT trigger adopts the person's password or seeds it — no change
--  to their bodies is needed.)

-- 7f. servant signup lookup — `has_account` now means «has a SERVANT
--     account» (unchanged meaning), plus the other kinds so the wizard can
--     ask for the existing password
create or replace function public.signup_lookup_code(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when nullif(trim(p_code), '') is null then null
    else coalesce(
      (select jsonb_build_object(
          'name', p.name, 'gender', p.gender, 'birthdate', p.birthdate,
          'phone', p.phone, 'address', p.address, 'image_url', p.image_url,
          'has_account', exists (select 1 from public.servant_enrollments s where s.person_id = p.id),
          'has_password', exists (select 1 from public.person_credentials c where c.person_id = p.id),
          'is_child', exists (select 1 from public.enrollments e where e.person_id = p.id and e.kind = 'child'),
          'is_priest', exists (select 1 from public.priests pr where pr.person_id = p.id))
         from public.persons p where p.national_id = trim(p_code) limit 1),
      case when exists (select 1 from public.families f where f.code = trim(p_code))
           then jsonb_build_object('family', true) end)
  end
$$;
grant execute on function public.signup_lookup_code(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Servant password changes (Auth side) are mirrored to the person by
--    the server routes with the service role — this is the helper they call.
--    p_hash: a bcrypt hash computed in the DB from the plain password.
-- ---------------------------------------------------------------------
create or replace function public.admin_mirror_servant_password(p_servant uuid, p_password text, p_source text default 'admin')
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_person uuid;
begin
  if auth.role() <> 'service_role' and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select person_id into v_person from public.servant_enrollments where id = p_servant;
  if v_person is null then return; end if;
  perform public.person_set_password(v_person, p_password, p_source, null);
  delete from public.child_sessions where person_id = v_person;
  delete from public.priest_sessions s using public.priests pr where pr.id = s.priest_id and pr.person_id = v_person;
end $$;
revoke all on function public.admin_mirror_servant_password(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_mirror_servant_password(uuid, text, text) to service_role;

-- the signed-in servant changed HIS OWN password in Auth (old + new) → mirror
-- Called after every successful servant login too (the Auth password just
-- proved itself) — a no-op when the person's password already matches, so
-- legacy accounts converge without kicking the other portals' sessions.
create or replace function public.servant_mirror_own_password(p_password text)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_person uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select person_id into v_person from public.servant_enrollments where id = auth.uid();
  if v_person is null then return; end if;
  if exists (select 1 from public.person_credentials c where c.person_id = v_person)
     and public.person_password_ok(v_person, p_password) then
    return;
  end if;
  perform public.person_set_password(v_person, p_password, 'self', auth.uid());
  delete from public.child_sessions where person_id = v_person;
  delete from public.priest_sessions s using public.priests pr where pr.id = s.priest_id and pr.person_id = v_person;
end $$;
grant execute on function public.servant_mirror_own_password(text) to authenticated;

-- ---------------------------------------------------------------------
-- 9. The child / priest wizard lookups learn about the OTHER kinds
-- ---------------------------------------------------------------------
create or replace function public.child_signup_lookup_code(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when nullif(trim(p_code), '') is null then null
    else jsonb_build_object(
      'exists', exists (select 1 from public.persons p where p.national_id = trim(p_code)),
      'has_password', exists (select 1 from public.persons p join public.person_credentials c on c.person_id = p.id
                               where p.national_id = trim(p_code)),
      'is_child', exists (select 1 from public.persons p join public.enrollments e on e.person_id = p.id and e.kind = 'child'
                           where p.national_id = trim(p_code)),
      'is_servant', exists (select 1 from public.persons p join public.servant_enrollments s on s.person_id = p.id
                             where p.national_id = trim(p_code)),
      'is_priest', exists (select 1 from public.persons p join public.priests pr on pr.person_id = p.id
                            where p.national_id = trim(p_code)),
      'pending', exists (select 1 from public.child_join_requests r where r.code = trim(p_code) and r.status = 'pending'),
      'name', (select p.name from public.persons p where p.national_id = trim(p_code) limit 1),
      'family', exists (select 1 from public.families f where f.code = trim(p_code))
    )
  end
$$;
grant execute on function public.child_signup_lookup_code(text) to anon, authenticated;

create or replace function public.priest_signup_lookup_code(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when nullif(trim(p_code), '') is null then null
    else jsonb_build_object(
      'exists', exists (select 1 from public.persons p where p.national_id = trim(p_code)),
      'is_priest', exists (select 1 from public.persons p join public.priests pr on pr.person_id = p.id where p.national_id = trim(p_code)),
      'is_servant', exists (select 1 from public.persons p join public.servant_enrollments s on s.person_id = p.id where p.national_id = trim(p_code)),
      'is_child', exists (select 1 from public.persons p join public.enrollments e on e.person_id = p.id and e.kind = 'child' where p.national_id = trim(p_code)),
      'has_password', exists (select 1 from public.persons p join public.person_credentials c on c.person_id = p.id where p.national_id = trim(p_code)),
      'pending', exists (select 1 from public.priest_requests r where r.code = trim(p_code) and r.status = 'pending'),
      'family', exists (select 1 from public.families f where f.code = trim(p_code)),
      'name', (select p.name from public.persons p where p.national_id = trim(p_code) limit 1)
    )
  end
$$;
grant execute on function public.priest_signup_lookup_code(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 11. /api/account/sync-password — a child / priest changed the ONE password
--     in his portal; the server must push it to the servant Auth account.
--     Service role only: resolves the session, re-checks that `p_password`
--     IS the person's current password, returns the servant account id.
-- ---------------------------------------------------------------------
create or replace function public.account_servant_for_sync(p_kind text, p_token text, p_password text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_person uuid; v_servant uuid;
begin
  if auth.role() <> 'service_role' and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_person := public.session_person(p_kind, p_token);
  if not public.person_password_ok(v_person, p_password) then raise exception 'wrong_password' using errcode = 'P0010'; end if;
  select id into v_servant from public.servant_enrollments where person_id = v_person;
  return jsonb_build_object('person_id', v_person, 'servant_id', v_servant);
end $$;
revoke all on function public.account_servant_for_sync(text, text, text) from public, anon, authenticated;
grant execute on function public.account_servant_for_sync(text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 12. /api/servants/create — the manager adds a servant whose code ALREADY
--     belongs to a person with a password (a child / priest): the new Auth
--     account is created with the SAME bcrypt hash (auth.admin.createUser
--     accepts password_hash), so the typed password is ignored and the
--     person keeps his one password. Service role only.
-- ---------------------------------------------------------------------
create or replace function public.admin_person_password_hash(p_code text)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (select c.password_hash from public.person_credentials c
            join public.persons p on p.id = c.person_id
           where p.national_id = trim(coalesce(p_code, '')) limit 1);
end $$;
revoke all on function public.admin_person_password_hash(text) from public, anon, authenticated;
grant execute on function public.admin_person_password_hash(text) to service_role;

-- (backup label of `account_switch_tickets` lives in src/lib/backup.ts)

commit;
