-- =====================================================================
-- 1. «بدون تسجيلات» = NO church at all.
--    A servant bound to a whole church («كل الخدمات») or a whole service
--    («كل الفصول») has no mirror `enrollments` row (mirrors exist per CLASS
--    only), so إدارة الأفراد counted him as «بدون تسجيلات». Now a person is
--    unenrolled ONLY when he has no child enrollment, no servant place with
--    a church, and no priest account. The scope filter matches a servant
--    whose place is the whole church / service too.
--
-- 2. A servant who ALREADY has an account opens a new دعوة خادم (another
--    service / class): instead of «ask the manager», he proves his password,
--    signs in and REQUESTS the new places → `servant_scope_requests`
--    (pending). The responsible manager approves them from
--    إدارة الخدام → الطلبات (→ set_servant_scopes adds the places) or rejects.
--
-- 3. The owner may add another SERVANT place / PRIEST church from إدارة
--    الأفراد → تسجيل even when the person already holds that kind:
--    `owner_add_servant_places(servant, places)` appends places (keeps the
--    existing ones) — the priest stays one church (its church can be edited
--    from الكهنة).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 2. servant_scope_requests — «أريد خدمة أخرى» from an existing servant
-- ---------------------------------------------------------------------
create table if not exists public.servant_scope_requests (
  id            uuid primary key default gen_random_uuid(),
  servant_id    uuid not null references public.servant_enrollments(id) on delete cascade,
  church_id     uuid not null references public.churches(id) on delete cascade,
  service_id    uuid references public.services(id) on delete cascade,
  class_id      uuid references public.classes(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  invite_id     uuid references public.signup_invites(id) on delete set null,
  decision_note text,
  decided_by    uuid references public.servant_enrollments(id) on delete set null,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
comment on table public.servant_scope_requests is
  'طلبات أماكن خدمة إضافية من خادم له حساب بالفعل (دعوة خادم جديدة) — يعتمدها مسؤول النطاق فتُضاف إلى أماكنه';
create index if not exists idx_servant_scope_requests_servant on public.servant_scope_requests(servant_id);
create index if not exists idx_servant_scope_requests_pending on public.servant_scope_requests(status) where status = 'pending';
alter table public.servant_scope_requests enable row level security;
alter table public.servant_scope_requests replica identity full;
revoke all on public.servant_scope_requests from anon, authenticated;
grant select on public.servant_scope_requests to authenticated;
grant all on public.servant_scope_requests to service_role;
drop policy if exists servant_scope_requests_select on public.servant_scope_requests;
create policy servant_scope_requests_select on public.servant_scope_requests for select to authenticated using (
  servant_id = auth.uid()
  or (select public.is_owner())
  or public.scope_grantable(church_id, service_id, class_id)
);
do $$ begin
  alter publication supabase_realtime add table public.servant_scope_requests;
exception when duplicate_object then null; end $$;
do $$ begin
  if to_regprocedure('public.activity_audit_attach(text)') is not null then
    perform public.activity_audit_attach('servant_scope_requests');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. unenrolled = no church anywhere
-- ---------------------------------------------------------------------
create or replace function public.person_has_any_place(p_person uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.enrollments e where e.person_id = p_person)
      or exists (select 1 from public.priests pr where pr.person_id = p_person)
      or exists (select 1 from public.servant_enrollments s
                  where s.person_id = p_person
                    and (s.church_id is not null
                         or exists (select 1 from public.servant_scopes x where x.servant_id = s.id)))
$$;
revoke all on function public.person_has_any_place(uuid) from public, anon;
grant execute on function public.person_has_any_place(uuid) to authenticated;

drop function if exists public.owner_persons_page(text, text, uuid, uuid, uuid, text, text, integer, integer);
create or replace function public.owner_persons_page(
  p_search      text default null,
  p_scope_mode  text default 'all',
  p_church      uuid default null,
  p_service     uuid default null,
  p_class       uuid default null,
  p_gender      text default null,
  p_kind        text default 'all',
  p_limit       integer default 100,
  p_offset      integer default 0
) returns table (
  id            uuid,
  national_id   text,
  name          text,
  birthdate     date,
  gender        text,
  phone         text,
  address       text,
  notes         text,
  image_url     text,
  created_at    timestamptz,
  edited_at     timestamptz,
  enrollments   jsonb,
  servant       jsonb,
  priest        jsonb,
  has_password  boolean,
  total_count   bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_mode   text := coalesce(p_scope_mode, 'all');
  v_kind   text := coalesce(p_kind, 'all');
  v_limit  integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_mode not in ('all', 'scope', 'none') then raise exception 'invalid_scope_mode' using errcode = '22023'; end if;
  if v_kind not in ('all', 'child', 'servant', 'priest') then raise exception 'invalid_kind' using errcode = '22023'; end if;
  if p_gender is not null and p_gender not in ('male', 'female') then raise exception 'invalid_gender' using errcode = '22023'; end if;
  if v_mode = 'scope' and p_church is null then raise exception 'church_required' using errcode = '22023'; end if;

  return query
  with base as (
    select p.*
      from public.persons p
     where (v_search is null
            or p.name ilike '%' || v_search || '%'
            or p.phone ilike '%' || v_search || '%'
            or p.national_id ilike '%' || v_search || '%')
       and (p_gender is null or p.gender = p_gender)
       and (
         v_mode = 'all'
         or (v_mode = 'none' and not public.person_has_any_place(p.id))
         or (v_mode = 'scope' and (
              exists (
                select 1 from public.enrollments e
                 where e.person_id = p.id
                   and e.church_id = p_church
                   and (p_service is null or e.service_id = p_service)
                   and (p_class   is null or e.class_id   = p_class))
              -- a servant whose place is the whole church / service (no mirror row)
              or exists (
                select 1 from public.servant_enrollments s
                join public.servant_all_scopes(s.id) t on true
                 where s.person_id = p.id
                   and t.church_id = p_church
                   and (p_service is null or t.service_id is null or t.service_id = p_service)
                   and (p_class   is null or t.class_id   is null or t.class_id   = p_class))
              or (p_service is null and p_class is null
                  and exists (select 1 from public.priests pr where pr.person_id = p.id and pr.church_id = p_church))))
       )
       and (
         v_kind = 'all'
         or (v_kind = 'servant' and exists (select 1 from public.servant_enrollments s where s.person_id = p.id))
         or (v_kind = 'child'   and exists (select 1 from public.enrollments e where e.person_id = p.id and e.kind = 'child'))
         or (v_kind = 'priest'  and exists (select 1 from public.priests pr where pr.person_id = p.id))
       )
  ),
  counted as (
    select b.*, count(*) over () as total_count
      from base b
     order by b.name collate "C", b.id
     limit v_limit offset v_offset
  )
  select
    c.id, c.national_id, c.name, c.birthdate, c.gender, c.phone, c.address, c.notes, c.image_url,
    c.created_at, c.edited_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'church_id', e.church_id, 'service_id', e.service_id, 'class_id', e.class_id,
               'kind', e.kind, 'servant_id', e.servant_id, 'status', e.status,
               'points', e.points, 'attendance_count', e.attendance_count, 'created_at', e.created_at)
             order by e.created_at)
        from public.enrollments e where e.person_id = c.id
    ), '[]'::jsonb) as enrollments,
    (
      select jsonb_build_object(
               'id', s.id, 'role', s.role, 'status', s.status,
               'church_id', s.church_id, 'service_id', s.service_id, 'class_id', s.class_id,
               'scopes', coalesce((
                 select jsonb_agg(jsonb_build_object('church_id', x.church_id, 'service_id', x.service_id, 'class_id', x.class_id))
                   from public.servant_scopes x where x.servant_id = s.id), '[]'::jsonb),
               'pending_scopes', coalesce((
                 select jsonb_agg(jsonb_build_object('church_id', r.church_id, 'service_id', r.service_id, 'class_id', r.class_id))
                   from public.servant_scope_requests r where r.servant_id = s.id and r.status = 'pending'), '[]'::jsonb))
        from public.servant_enrollments s where s.person_id = c.id
       limit 1
    ) as servant,
    (
      select jsonb_build_object('id', pr.id, 'church_id', pr.church_id, 'title', pr.title, 'status', pr.status, 'created_at', pr.created_at)
        from public.priests pr where pr.person_id = c.id
       limit 1
    ) as priest,
    exists (select 1 from public.person_credentials pc where pc.person_id = c.id) as has_password,
    c.total_count
  from counted c
  order by c.name collate "C", c.id;
end $$;
revoke all on function public.owner_persons_page(text, text, uuid, uuid, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.owner_persons_page(text, text, uuid, uuid, uuid, text, text, integer, integer) to authenticated;

create or replace function public.owner_persons_counts()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_owner() then jsonb_build_object(
    'total',      (select count(*) from public.persons),
    'unenrolled', (select count(*) from public.persons p where not public.person_has_any_place(p.id)),
    'servants',   (select count(*) from public.persons p where exists (select 1 from public.servant_enrollments s where s.person_id = p.id)),
    'children',   (select count(*) from public.persons p where exists (select 1 from public.enrollments e where e.person_id = p.id and e.kind = 'child')),
    'priests',    (select count(*) from public.persons p where exists (select 1 from public.priests pr where pr.person_id = p.id))
  ) else null end
$$;
revoke all on function public.owner_persons_counts() from public, anon;
grant execute on function public.owner_persons_counts() to authenticated;

-- the signed-in servant asks for more places (the invite is consumed; its
-- scope is the first place when none is given)
create or replace function public.servant_request_scopes(p_scopes jsonb, p_invite text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid(); s public.servant_enrollments; inv public.signup_invites;
  v jsonb; v_c uuid; v_s uuid; v_k uuid; v_scopes jsonb; n int := 0; v_skipped int := 0;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into s from public.servant_enrollments where id = v_uid;
  if not found then raise exception 'no_such_account' using errcode = 'P0002'; end if;
  if s.status <> 'approved' then raise exception 'account_not_approved' using errcode = 'P0001'; end if;
  inv := public.signup_invite_consume(p_invite, 'servant');
  v_scopes := case
    when p_scopes is not null and jsonb_typeof(p_scopes) = 'array' and jsonb_array_length(p_scopes) > 0 then p_scopes
    when inv.church_id is not null then jsonb_build_array(jsonb_build_object('church_id', inv.church_id, 'service_id', inv.service_id, 'class_id', inv.class_id))
    else '[]'::jsonb end;
  if jsonb_array_length(v_scopes) = 0 then raise exception 'scopes_required' using errcode = '22023'; end if;
  for v in select * from jsonb_array_elements(v_scopes) loop
    v_c := nullif(v->>'church_id', '')::uuid; v_s := nullif(v->>'service_id', '')::uuid; v_k := nullif(v->>'class_id', '')::uuid;
    if v_c is null then raise exception 'church_required' using errcode = '22023'; end if;
    if s.role = 'church_manager' then v_s := null; v_k := null; end if;
    if s.role = 'service_manager' then v_k := null; end if;
    if v_s is not null and not exists (select 1 from public.services x where x.id = v_s and x.church_id = v_c) then
      raise exception 'service_not_in_church' using errcode = '22023';
    end if;
    if v_k is not null and (v_s is null or not exists (select 1 from public.classes x where x.id = v_k and x.service_id = v_s)) then
      raise exception 'class_not_in_service' using errcode = '22023';
    end if;
    -- already one of his places, or already requested → skip
    if exists (select 1 from public.servant_all_scopes(v_uid) t
                where t.church_id = v_c and t.service_id is not distinct from v_s and t.class_id is not distinct from v_k)
       or exists (select 1 from public.servant_scope_requests r
                   where r.servant_id = v_uid and r.status = 'pending'
                     and r.church_id = v_c and r.service_id is not distinct from v_s and r.class_id is not distinct from v_k) then
      v_skipped := v_skipped + 1; continue;
    end if;
    insert into public.servant_scope_requests (servant_id, church_id, service_id, class_id, invite_id)
    values (v_uid, v_c, v_s, v_k, inv.id);
    n := n + 1;
  end loop;
  return jsonb_build_object('requested', n, 'skipped', v_skipped);
end $$;
grant execute on function public.servant_request_scopes(jsonb, text) to authenticated;

-- the manager decides (approve → the place is appended to the servant's places)
create or replace function public.review_servant_scope_request(p_request uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r public.servant_scope_requests; cur jsonb;
begin
  if public.my_role() is null then raise exception 'not_approved' using errcode = '42501'; end if;
  select * into r from public.servant_scope_requests where id = p_request for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'not_pending' using errcode = 'P0001'; end if;
  if not (public.is_owner() or public.scope_grantable(r.church_id, r.service_id, r.class_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_approve then
    -- current places + the new one (set_servant_scopes keeps the ones outside the caller's area)
    select coalesce(jsonb_agg(jsonb_build_object('church_id', t.church_id, 'service_id', t.service_id, 'class_id', t.class_id)), '[]'::jsonb)
      into cur from public.servant_all_scopes(r.servant_id) t;
    perform public.set_servant_scopes(r.servant_id,
      cur || jsonb_build_object('church_id', r.church_id, 'service_id', r.service_id, 'class_id', r.class_id));
  end if;
  update public.servant_scope_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decision_note = nullif(trim(coalesce(p_note, '')), ''), decided_by = auth.uid(), decided_at = now()
   where id = r.id;
  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end, 'servant_id', r.servant_id);
end $$;
revoke all on function public.review_servant_scope_request(uuid, boolean, text) from public, anon;
grant execute on function public.review_servant_scope_request(uuid, boolean, text) to authenticated;

-- the pending-count badge of إدارة الخدام counts both kinds of requests
create or replace function public.pending_servant_requests_count()
returns integer language sql stable security definer set search_path = public as $$
  select (select count(*) from public.servant_enrollments s where s.status = 'pending'
            and (public.is_owner() or public.servant_in_my_scope(s.id) or s.church_id is null
                 or public.scope_grantable(s.church_id, s.service_id, s.class_id)))::int
       + (select count(*) from public.servant_scope_requests r where r.status = 'pending'
            and (public.is_owner() or public.scope_grantable(r.church_id, r.service_id, r.class_id)))::int
$$;
revoke all on function public.pending_servant_requests_count() from public, anon;
grant execute on function public.pending_servant_requests_count() to authenticated;

-- ---------------------------------------------------------------------
-- 3. owner appends places to an EXISTING servant account (إدارة الأفراد → تسجيل كخادم)
-- ---------------------------------------------------------------------
create or replace function public.owner_add_servant_places(p_servant uuid, p_scopes jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare cur jsonb;
begin
  if not (public.is_owner() or public.can_manage_servant(p_servant)) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_scopes is null or jsonb_typeof(p_scopes) <> 'array' or jsonb_array_length(p_scopes) = 0 then
    raise exception 'scopes_required' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('church_id', t.church_id, 'service_id', t.service_id, 'class_id', t.class_id)), '[]'::jsonb)
    into cur from public.servant_all_scopes(p_servant) t;
  return public.set_servant_scopes(p_servant, cur || p_scopes);
end $$;
revoke all on function public.owner_add_servant_places(uuid, jsonb) from public, anon;
grant execute on function public.owner_add_servant_places(uuid, jsonb) to authenticated;
comment on function public.owner_add_servant_places(uuid, jsonb) is
  'إضافة أماكن خدمة إلى حساب خادم موجود (تبقى أماكنه الحالية) — المالك أو مدير نطاقه';

commit;
