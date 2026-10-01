-- =====================================================================
-- إدارة الأفراد — enrollment KINDS · add any kind · MERGE two persons
--
-- 1. owner_persons_page / owner_persons_counts learn about the PRIEST
--    account (`priest` jsonb) and the kind filter accepts 'priest'.
--    'child' now means «has ≥ 1 child enrollment» (not «is not a servant»).
-- 2. owner_add_priest_for_person — add a PRIEST account to an EXISTING
--    person from إدارة الأفراد (the child kind goes through
--    owner_bulk_enroll, the servant kind through POST /api/servants/create
--    → admin_add_servant with the person's code).
-- 3. owner_merge_persons(keep, remove, fields) — TWO persons rows that are
--    really ONE human (e.g. a servant account registered under one code and
--    a child enrollment under another): every row that points at `remove`
--    is re-pointed at `keep` (enrollments — same-class pairs are merged
--    with their counters and logs —, servant account, priest account,
--    confessors, families, store, exams, …), the owner CHOOSES the value of
--    every identity field (name · gender · birthdate · phone · address ·
--    notes · photo · code) and `remove` is deleted. Refused when both
--    persons own a servant account or both own a priest account.
--
-- Everything is owner-only. Idempotent.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. owner_persons_page — + priest · kind 'priest' · child = has child row
-- ---------------------------------------------------------------------
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
  if not public.is_owner() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_mode not in ('all', 'scope', 'none') then
    raise exception 'invalid_scope_mode' using errcode = '22023';
  end if;
  if v_kind not in ('all', 'child', 'servant', 'priest') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if p_gender is not null and p_gender not in ('male', 'female') then
    raise exception 'invalid_gender' using errcode = '22023';
  end if;
  if v_mode = 'scope' and p_church is null then
    raise exception 'church_required' using errcode = '22023';
  end if;

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
         or (v_mode = 'none' and not exists (select 1 from public.enrollments e where e.person_id = p.id)
                               and not exists (select 1 from public.priests pr where pr.person_id = p.id))
         or (v_mode = 'scope' and (
              exists (
                select 1 from public.enrollments e
                 where e.person_id = p.id
                   and e.church_id = p_church
                   and (p_service is null or e.service_id = p_service)
                   and (p_class   is null or e.class_id   = p_class))
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
                   from public.servant_scopes x where x.servant_id = s.id), '[]'::jsonb))
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

comment on function public.owner_persons_page(text, text, uuid, uuid, uuid, text, text, integer, integer) is
  'إدارة الأفراد (المالك): كل الأشخاص مع تسجيلاتهم وحساب الخادم وحساب الكاهن — بحث · نطاق · الصنف (مخدوم/خادم/كاهن) · النوع · ترقيم';

create or replace function public.owner_persons_counts()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_owner() then jsonb_build_object(
    'total',      (select count(*) from public.persons),
    'unenrolled', (select count(*) from public.persons p
                    where not exists (select 1 from public.enrollments e where e.person_id = p.id)
                      and not exists (select 1 from public.priests pr where pr.person_id = p.id)),
    'servants',   (select count(*) from public.persons p where exists (select 1 from public.servant_enrollments s where s.person_id = p.id)),
    'children',   (select count(*) from public.persons p where exists (select 1 from public.enrollments e where e.person_id = p.id and e.kind = 'child')),
    'priests',    (select count(*) from public.persons p where exists (select 1 from public.priests pr where pr.person_id = p.id))
  ) else null end
$$;
revoke all on function public.owner_persons_counts() from public, anon;
grant execute on function public.owner_persons_counts() to authenticated;

-- ---------------------------------------------------------------------
-- 2. owner_add_priest_for_person — a PRIEST account for an existing person
--    (approved at once). The password: the person's existing one (BEFORE
--    INSERT trigger priests_take_person_password adopts it) — otherwise
--    p_password, or the default password when none is given.
-- ---------------------------------------------------------------------
create or replace function public.owner_add_priest_for_person(
  p_person uuid, p_church uuid, p_title text default null, p_password text default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_priest uuid; v_code text;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  select national_id into v_code from public.persons where id = p_person;
  if v_code is null then raise exception 'person_not_found' using errcode = 'P0002'; end if;
  if p_church is null or not exists (select 1 from public.churches c where c.id = p_church) then
    raise exception 'church_required' using errcode = '22023';
  end if;
  if exists (select 1 from public.priests where person_id = p_person) then
    raise exception 'already_registered' using errcode = '23505';
  end if;
  if p_password is not null and length(p_password) < 6 then raise exception 'weak_password' using errcode = '22023'; end if;
  insert into public.priests (person_id, church_id, title, status, password_hash, approved_by, approved_at)
  values (p_person, p_church, nullif(trim(coalesce(p_title, '')), ''), 'approved',
          crypt(coalesce(p_password, public.default_password()), gen_salt('bf', 10)), auth.uid(), now())
  returning id into v_priest;
  update public.priest_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), priest_id = v_priest
   where code = v_code and status = 'pending';
  return jsonb_build_object('priest_id', v_priest, 'person_id', p_person, 'code', v_code);
end $$;
revoke all on function public.owner_add_priest_for_person(uuid, uuid, text, text) from public, anon;
grant execute on function public.owner_add_priest_for_person(uuid, uuid, text, text) to authenticated;
comment on function public.owner_add_priest_for_person(uuid, uuid, text, text) is
  'إدارة الأفراد: إضافة حساب كاهن لشخص موجود (معتمد فورًا، بكلمة مرور الشخص نفسها)';

-- ---------------------------------------------------------------------
-- 3. MERGE helpers
-- ---------------------------------------------------------------------
-- Re-point every row of `p_table.p_col` from p_remove to p_keep. A row that
-- would collide with an existing one of p_keep (unique key — the same fact
-- recorded for both persons) is DELETED instead. Internal.
create or replace function public.merge_repoint(p_table regclass, p_col name, p_keep uuid, p_remove uuid)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare n integer := 0; r record;
begin
  begin
    execute format('update %s set %I = $1 where %I = $2', p_table, p_col, p_col) using p_keep, p_remove;
    get diagnostics n = row_count;
    return n;
  exception when unique_violation or check_violation or raise_exception or exclusion_violation then
    null;   -- fall back to row by row below
  end;
  for r in execute format('select ctid as t from %s where %I = $1', p_table, p_col) using p_remove loop
    begin
      execute format('update %s set %I = $1 where ctid = $2', p_table, p_col) using p_keep, r.t;
      n := n + 1;
    exception when unique_violation or check_violation or raise_exception or exclusion_violation then
      execute format('delete from %s where ctid = $1', p_table) using r.t;
    end;
  end loop;
  return n;
end $$;
revoke all on function public.merge_repoint(regclass, name, uuid, uuid) from public, anon, authenticated;

-- Fold enrollment p_remove into p_keep (same person, same class): counters
-- are summed, every log / request / session that pointed at p_remove is
-- re-pointed, then p_remove goes. Internal.
create or replace function public.merge_enrollments(p_keep uuid, p_remove uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare rm public.enrollments; fk record;
begin
  if p_keep = p_remove or not exists (select 1 from public.enrollments where id = p_remove) then return; end if;
  -- 1) move every log / request / session (a duplicate — e.g. the same
  --    attendance day — is dropped; its delete trigger adjusts p_remove's
  --    counters, so the counters read below are exact)
  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'f' and c.confrelid = 'public.enrollments'::regclass and array_length(c.conkey, 1) = 1
  loop
    perform public.merge_repoint(fk.tbl, fk.col, p_keep, p_remove);
  end loop;
  -- 2) counters + kind
  select * into rm from public.enrollments where id = p_remove;
  update public.enrollments
     set attendance_count = attendance_count + rm.attendance_count,
         points = points + rm.points,
         -- a servant mirror wins over a plain child row (the servant account decides)
         kind = case when rm.kind = 'servant' then 'servant' else kind end,
         servant_id = coalesce(servant_id, rm.servant_id)
   where id = p_keep;
  -- 3) nothing is left under p_remove
  delete from public.enrollments where id = p_remove;
end $$;
revoke all on function public.merge_enrollments(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. owner_merge_persons(keep, remove, fields)
--    p_fields: {name, gender, birthdate, phone, address, notes, image_url,
--    national_id} — the value the owner picked for every field (a missing
--    key keeps `keep`'s value). national_id may be either person's code.
--    Returns {person_id, code, moved: {table: n}, servant_id, priest_id,
--    realign_servant} — realign_servant = the servant Auth account must be
--    re-synced (e-mail / password hash) by POST /api/servants/account
--    {action: 'realign'} because its code or password changed.
-- ---------------------------------------------------------------------
create or replace function public.owner_merge_persons(p_keep uuid, p_remove uuid, p_fields jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  k public.persons; r public.persons;
  fk record; pair record; n integer;
  v_moved jsonb := '{}'::jsonb;
  v_code text; v_tmp text;
  v_servant uuid; v_priest uuid;
  v_keep_servant uuid; v_rm_servant uuid;
  v_keep_pw text; v_rm_pw text;
  v_realign boolean := false;
  v_gender text; v_birth date;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_keep is null or p_remove is null or p_keep = p_remove then raise exception 'two_persons_required' using errcode = '22023'; end if;
  select * into k from public.persons where id = p_keep for update;
  if not found then raise exception 'person_not_found' using errcode = 'P0002'; end if;
  select * into r from public.persons where id = p_remove for update;
  if not found then raise exception 'person_not_found' using errcode = 'P0002'; end if;

  select id into v_keep_servant from public.servant_enrollments where person_id = p_keep limit 1;
  select id into v_rm_servant   from public.servant_enrollments where person_id = p_remove limit 1;
  if v_keep_servant is not null and v_rm_servant is not null then
    raise exception 'both_servants' using errcode = 'P0001',
      hint = 'احذف أحد حسابي الخادم من إدارة الخدام أولاً';
  end if;
  if exists (select 1 from public.priests where person_id = p_keep) and exists (select 1 from public.priests where person_id = p_remove) then
    raise exception 'both_priests' using errcode = 'P0001',
      hint = 'احذف أحد حسابي الكاهن من الكهنة أولاً';
  end if;

  -- the chosen code (default: keep's)
  v_code := coalesce(nullif(trim(coalesce(p_fields->>'national_id', '')), ''), k.national_id);
  if v_code not in (k.national_id, r.national_id) then raise exception 'invalid_code' using errcode = '22023'; end if;
  v_gender := coalesce(p_fields->>'gender', k.gender);
  if v_gender is not null and v_gender not in ('male', 'female') then raise exception 'invalid_gender' using errcode = '22023'; end if;
  v_birth := case when p_fields ? 'birthdate' then nullif(p_fields->>'birthdate', '')::date else k.birthdate end;

  -- password: keep's wins; remove's is adopted only when keep has none
  select password_hash into v_keep_pw from public.person_credentials where person_id = p_keep;
  select password_hash into v_rm_pw   from public.person_credentials where person_id = p_remove;
  if v_keep_pw is null and v_rm_pw is not null then
    update public.person_credentials set person_id = p_keep where person_id = p_remove;
  end if;
  -- the servant Auth account (login e-mail = code, bcrypt hash) must be
  -- re-synced when the code or the password of ITS person changed
  if v_keep_servant is not null then
    v_realign := v_code <> k.national_id or coalesce(v_keep_pw, v_rm_pw) is distinct from v_keep_pw;
  elsif v_rm_servant is not null then
    v_realign := v_code <> r.national_id or coalesce(v_keep_pw, v_rm_pw) is distinct from v_rm_pw;
  end if;

  -- a) same-class enrollment pairs → fold
  for pair in
    select e1.id as keep_e, e2.id as rm_e
      from public.enrollments e1
      join public.enrollments e2 on e2.class_id = e1.class_id
     where e1.person_id = p_keep and e2.person_id = p_remove
  loop
    perform public.merge_enrollments(pair.keep_e, pair.rm_e);
  end loop;
  -- b) the remaining enrollments → keep (before the servant account moves,
  --    so its mirror rows are already his when sync_servant_mirrors runs)
  n := public.merge_repoint('public.enrollments'::regclass, 'person_id', p_keep, p_remove);
  if n > 0 then v_moved := v_moved || jsonb_build_object('enrollments', n); end if;

  -- c) every other table that points at persons
  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'f' and c.confrelid = 'public.persons'::regclass and array_length(c.conkey, 1) = 1
       and c.conrelid not in ('public.enrollments'::regclass, 'public.person_credentials'::regclass)
     order by case when c.conrelid = 'public.servant_enrollments'::regclass then 1 else 0 end
  loop
    n := public.merge_repoint(fk.tbl, fk.col, p_keep, p_remove);
    if n > 0 then v_moved := v_moved || jsonb_build_object(replace(fk.tbl::text, 'public.', ''), n); end if;
  end loop;

  -- d) requests keyed by the CODE text
  if v_code <> r.national_id then
    update public.child_join_requests set code = v_code where code = r.national_id;
    update public.priest_requests     set code = v_code where code = r.national_id;
  end if;

  -- e) the code: free remove's first when it is the chosen one
  if v_code = r.national_id and v_code <> k.national_id then
    v_tmp := 'merged-' || replace(p_remove::text, '-', '');
    update public.persons set national_id = v_tmp where id = p_remove;
  end if;

  -- f) the chosen identity values (LAST — the servant→person sync trigger
  --    may have written the servant's name / phone / photo above)
  update public.persons set
    national_id = v_code,
    name      = coalesce(nullif(trim(coalesce(p_fields->>'name', '')), ''), k.name),
    gender    = v_gender,
    birthdate = v_birth,
    phone     = case when p_fields ? 'phone'     then nullif(trim(coalesce(p_fields->>'phone', '')), '')     else k.phone end,
    address   = case when p_fields ? 'address'   then nullif(trim(coalesce(p_fields->>'address', '')), '')   else k.address end,
    notes     = case when p_fields ? 'notes'     then nullif(trim(coalesce(p_fields->>'notes', '')), '')     else k.notes end,
    image_url = case when p_fields ? 'image_url' then nullif(trim(coalesce(p_fields->>'image_url', '')), '') else k.image_url end,
    edited_by = auth.uid(), edited_at = now()
  where id = p_keep;

  -- g) the servant account must show the final identity (login name = code)
  select id into v_servant from public.servant_enrollments where person_id = p_keep limit 1;
  if v_servant is not null then
    perform set_config('app.in_servant_signup', '1', true);
    update public.servant_enrollments s
       set user_id = public.code_to_user_id(v_code),
           full_name = p.name, phone = coalesce(p.phone, s.phone), photo_url = p.image_url, updated_at = now()
      from public.persons p
     where s.id = v_servant and p.id = p_keep;
    perform set_config('app.in_servant_signup', '0', true);
    perform public.sync_servant_mirrors(v_servant);
  end if;
  -- the priest mirror hash follows the person's ONE password
  select id into v_priest from public.priests where person_id = p_keep limit 1;
  if v_priest is not null then
    update public.priests pr set password_hash = c.password_hash, updated_at = now()
      from public.person_credentials c
     where pr.id = v_priest and c.person_id = p_keep and pr.password_hash is distinct from c.password_hash;
  end if;

  -- h) good-bye
  delete from public.persons where id = p_remove;

  return jsonb_build_object(
    'person_id', p_keep, 'code', v_code, 'moved', v_moved,
    'servant_id', v_servant, 'priest_id', v_priest,
    'realign_servant', v_realign and v_servant is not null);
end $$;
revoke all on function public.owner_merge_persons(uuid, uuid, jsonb) from public, anon;
grant execute on function public.owner_merge_persons(uuid, uuid, jsonb) to authenticated;
comment on function public.owner_merge_persons(uuid, uuid, jsonb) is
  'دمج شخصين في شخص واحد (المالك): تُنقل كل التسجيلات والحسابات والسجلات إلى الشخص المُبقى، والمالك يختار قيمة كل حقل (الاسم · النوع · الميلاد · الهاتف · العنوان · الملاحظات · الصورة · الكود)؛ يُرفض إن كان للاثنين حساب خادم أو حساب كاهن';

-- ---------------------------------------------------------------------
-- 5. Service-role helper for the realign step — the servant account's code
--    (login e-mail) and password hash as they must be after a merge.
-- ---------------------------------------------------------------------
create or replace function public.admin_servant_identity(p_servant uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (select jsonb_build_object(
            'servant_id', s.id, 'person_id', s.person_id, 'code', p.national_id,
            'user_id', public.code_to_user_id(p.national_id),
            'password_hash', (select c.password_hash from public.person_credentials c where c.person_id = p.id))
            from public.servant_enrollments s join public.persons p on p.id = s.person_id
           where s.id = p_servant);
end $$;
revoke all on function public.admin_servant_identity(uuid) from public, anon, authenticated;
grant execute on function public.admin_servant_identity(uuid) to service_role;

commit;
