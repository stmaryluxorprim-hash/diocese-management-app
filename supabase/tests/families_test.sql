-- =====================================================================
-- Functional test for 20260924120000_families.sql (العائلات).
--   psql -d app -f supabase/tests/families_test.sql
-- Ends with «FAMILIES TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000003'),  -- church manager (كنيسة أ) — 20260930130000: only owner / church manager manage families
  ('00000000-0000-0000-0000-000000000004'),  -- service manager (مدارس الأحد) — read only since 20260930130000
  ('00000000-0000-0000-0000-000000000006');  -- class servant (فصل أ)
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة أ'),
  ('10000000-0000-0000-0000-000000000002', 'كنيسة ب');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'اجتماع شباب'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'خدمة ب');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'شباب ١'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', 'فصل ب');

insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000003', 'مدير الكنيسة', 'cm', '0103', 'church_manager', 'approved',
   '10000000-0000-0000-0000-000000000001', null, null, now()),
  ('00000000-0000-0000-0000-000000000004', 'مسؤول الخدمة', 'sm', '0104', 'service_manager', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, now()),
  ('00000000-0000-0000-0000-000000000006', 'خادم أ', 'cs-a', '0106', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now());

insert into public.persons (id, national_id, name, gender) values
  ('50000000-0000-0000-0000-000000000001', 'KID-1', 'مينا', 'male'),      -- in فصل أ AND شباب ١ (2 services)
  ('50000000-0000-0000-0000-000000000002', 'KID-2', 'مريم', 'female'),    -- in فصل أ
  ('50000000-0000-0000-0000-000000000003', 'KID-3', 'يوسف', 'male'),      -- in كنيسة ب only
  ('50000000-0000-0000-0000-000000000004', 'KID-4', 'سارة', 'female');    -- in فصل أ, other family
insert into public.enrollments (id, person_id, church_id, service_id, class_id) values
  ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002'),
  ('60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003'),
  ('60000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
insert into public.events (id, church_id, name, recurrence, event_date, points) values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'حضور الأحد', 'once', current_date, 5);

-- ---------- A. church manager creates a family and adds members by code ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
set local request.jwt.claim.role = 'authenticated';

do $$
declare f uuid; r jsonb; other uuid;
begin
  if not (public.family_permissions() ->> 'manage')::boolean then
    raise exception 'church manager must be able to manage families';
  end if;

  insert into public.families (name) values ('عائلة مينا') returning id into f;
  if (select code from public.families where id = f) !~ '^F-[A-Z2-9]{6}$' then
    raise exception 'family code must be generated (F-XXXXXX)';
  end if;
  -- 20260930130000: the church manager's church is filled automatically
  if (select church_id from public.families where id = f) <> '10000000-0000-0000-0000-000000000001' then
    raise exception 'family church must be the manager''s church';
  end if;

  r := public.family_add_member_by_code(f, 'KID-1', 'son');
  if r ->> 'member_id' is null or r -> 'person' ->> 'name' <> 'مينا' then raise exception 'add KID-1 failed: %', r; end if;
  perform public.family_add_member_by_code(f, ' KID-2 ', 'daughter');   -- trimmed
  -- KID-3 belongs to another church; still addable (family spans churches) but his enrollments stay hidden
  perform public.family_add_member_by_code(f, 'KID-3', null);

  -- duplicates / unknown
  begin
    perform public.family_add_member_by_code(f, 'KID-1');
    raise exception 'duplicate must fail';
  exception when others then if sqlerrm not like '%already_member%' then raise; end if; end;
  begin
    perform public.family_add_member_by_code(f, 'NOPE');
    raise exception 'unknown code must fail';
  exception when others then if sqlerrm not like '%person_not_found%' then raise; end if; end;
  begin
    perform public.family_add_member_by_code(f, 'KID-4', 'uncle');
    raise exception 'invalid relation must fail';
  exception when others then if sqlerrm not like '%invalid_relation%' then raise; end if; end;

  -- a second family; KID-4 is there; adding him to the first without p_move fails with in_other_family
  insert into public.families (name) values ('عائلة سارة') returning id into other;
  perform public.family_add_member_by_code(other, 'KID-4', 'daughter');
  begin
    perform public.family_add_member_by_code(f, 'KID-4');
    raise exception 'member of another family must be refused';
  exception when others then if sqlerrm not like '%in_other_family%' then raise; end if; end;
  r := public.family_add_member_by_code(f, 'KID-4', 'daughter', true);
  if r -> 'moved_from' ->> 'name' <> 'عائلة سارة' then raise exception 'move must report the old family: %', r; end if;
  if (select count(*) from public.family_members where family_id = other) <> 0 then raise exception 'old family must be empty'; end if;
  if (select count(*) from public.family_members where family_id = f) <> 4 then raise exception 'family must have 4 members'; end if;

  -- relation edit + remove
  perform public.family_set_relation((select id from public.family_members where person_id = '50000000-0000-0000-0000-000000000003'), 'brother');
  if (select relation from public.family_members where person_id = '50000000-0000-0000-0000-000000000003') <> 'brother' then raise exception 'relation not set'; end if;
end $$;

-- ---------- B. lookup by PERSON code → whole family, scoped enrollments, attended_today ----------
insert into public.attendance_log (enrollment_id, event_id, points_delta, attended_on, recorded_by)
values ('60000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 5, current_date, '00000000-0000-0000-0000-000000000003');

do $$
declare r jsonb; m jsonb; mina jsonb; youssef jsonb;
begin
  r := public.family_lookup('KID-2', current_date);
  if r ->> 'matched' <> 'person' then raise exception 'must match a person: %', r; end if;
  if r -> 'family' ->> 'name' <> 'عائلة مينا' then raise exception 'family must be resolved: %', r; end if;
  if jsonb_array_length(r -> 'members') <> 4 then raise exception 'all 4 members must be listed: %', r; end if;

  select x into mina from jsonb_array_elements(r -> 'members') x where x -> 'person' ->> 'national_id' = 'KID-1';
  -- church manager of كنيسة أ sees both enrollments of مينا (فصل أ + شباب) — the فصل أ one attended today
  if jsonb_array_length(mina -> 'enrollments') <> 2 then raise exception 'church manager must see 2 enrollments of مينا: %', mina; end if;
  if not exists (select 1 from jsonb_array_elements(mina -> 'enrollments') e where (e ->> 'attended_today')::boolean and jsonb_array_length(e -> 'today_event_ids') = 1) then
    raise exception 'مينا attended today in فصل أ: %', mina;
  end if;

  select x into youssef from jsonb_array_elements(r -> 'members') x where x -> 'person' ->> 'national_id' = 'KID-3';
  if youssef is null then raise exception 'members of other churches must still be listed'; end if;
  if jsonb_array_length(youssef -> 'enrollments') <> 0 then raise exception 'other church enrollments must be hidden'; end if;

  -- lookup by FAMILY code
  r := public.family_lookup((select code from public.families where name = 'عائلة مينا'));
  if r ->> 'matched' <> 'family' or r -> 'person' is not null and r ->> 'person' <> 'null' then raise exception 'family code match: %', r; end if;
  if jsonb_array_length(r -> 'members') <> 4 then raise exception 'family code must list members'; end if;

  -- unknown code
  r := public.family_lookup('ZZZ');
  if r ->> 'matched' is not null then raise exception 'unknown must be null'; end if;
end $$;

-- ---------- C. owner sees BOTH enrollments of مينا (2 services → the UI asks) ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare r jsonb; mina jsonb;
begin
  r := public.family_lookup('KID-1');
  select x into mina from jsonb_array_elements(r -> 'members') x where x -> 'person' ->> 'national_id' = 'KID-1';
  if jsonb_array_length(mina -> 'enrollments') <> 2 then raise exception 'owner must see both enrollments: %', mina; end if;
  -- a person with NO family comes back as a lone member with family = null
  insert into public.persons (national_id, name) values ('SOLO', 'وحيد');
  r := public.family_lookup('SOLO');
  if r ->> 'matched' <> 'person' or r -> 'family' <> 'null'::jsonb or jsonb_array_length(r -> 'members') <> 1 then
    raise exception 'lone person shape wrong: %', r;
  end if;
end $$;

-- ---------- D. class servant: view yes (family visible through KID-1 in his class), manage no ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
do $$
declare r jsonb; f uuid;
begin
  if (public.family_permissions() ->> 'manage')::boolean then raise exception 'class servant must not manage without permission'; end if;
  if not (public.family_permissions() ->> 'view')::boolean then raise exception 'class servant must view'; end if;
  select id into f from public.families where name = 'عائلة مينا';
  if f is null then raise exception 'family must be visible through a member in his class'; end if;
  if exists (select 1 from public.families where name = 'عائلة سارة') then raise exception 'an empty family of someone else must be hidden'; end if;
  r := public.family_lookup('KID-1');
  if jsonb_array_length(r -> 'members') <> 4 then raise exception 'lookup must work for the class servant'; end if;
  begin
    perform public.family_add_member_by_code(f, 'SOLO');
    raise exception 'class servant must not add members';
  exception when others then if sqlerrm not like '%forbidden%' then raise; end if; end;
  begin
    insert into public.families (name) values ('x');
    raise exception 'class servant must not insert a family';
  exception when others then if sqlerrm not like '%row-level security%' then raise; end if; end;
end $$;

-- ---------- E. remove member + cascade on person delete ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
do $$
declare m uuid;
begin
  select id into m from public.family_members where person_id = '50000000-0000-0000-0000-000000000004';
  perform public.family_remove_member(m);
  if exists (select 1 from public.family_members where id = m) then raise exception 'member not removed'; end if;
  begin
    perform public.family_remove_member(m);
    raise exception 'removing twice must fail';
  exception when others then if sqlerrm not like '%member_not_found%' then raise; end if; end;
end $$;
reset role;
delete from public.persons where national_id = 'KID-3';
do $$ begin
  if exists (select 1 from public.family_members m join public.persons p on p.id = m.person_id where p.national_id = 'KID-3') then
    raise exception 'cascade on person delete failed';
  end if;
end $$;

-- ---------- F. v2: user-set code · code lookup · person search · add existing / new member ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
set local request.jwt.claim.role = 'authenticated';
do $$
declare f uuid; r jsonb; hits jsonb;
begin
  -- a typed / scanned / generated code is kept
  insert into public.families (code, name) values (' FAM-2026-001 ', 'عائلة بكود مختار') returning id into f;
  if (select code from public.families where id = f) <> 'FAM-2026-001' then raise exception 'typed code must be kept (trimmed)'; end if;
  -- a family code may not be a PERSON code
  begin
    insert into public.families (code, name) values ('KID-1', 'x');
    raise exception 'person code must be refused as family code';
  exception when others then if sqlerrm not like '%code_is_person%' then raise; end if; end;
  -- duplicate family code
  begin
    insert into public.families (code, name) values ('FAM-2026-001', 'y');
    raise exception 'duplicate family code must fail';
  exception when unique_violation then null; end;

  -- live lookup
  r := public.family_code_lookup('FAM-2026-001');
  if (r ->> 'free')::boolean or r -> 'family' ->> 'name' <> 'عائلة بكود مختار' then raise exception 'lookup must report the family: %', r; end if;
  r := public.family_code_lookup('KID-1');
  if (r ->> 'free')::boolean or r -> 'person' ->> 'name' <> 'مينا' then raise exception 'lookup must report the person: %', r; end if;
  r := public.family_code_lookup('FREE-CODE');
  if not (r ->> 'free')::boolean then raise exception 'unknown code must be free'; end if;

  -- search: church manager of كنيسة أ sees مينا / مريم / سارة, not يوسف (كنيسة ب)
  hits := public.family_search_persons('مي');
  if not exists (select 1 from jsonb_array_elements(hits) x where x -> 'person' ->> 'name' = 'مينا') then raise exception 'search must find مينا: %', hits; end if;
  if exists (select 1 from jsonb_array_elements(hits) x where x -> 'person' ->> 'name' = 'يوسف') then raise exception 'search must not leak other church persons'; end if;
  hits := public.family_search_persons('KID-2');
  if jsonb_array_length(hits) <> 1 or hits -> 0 -> 'family' ->> 'name' <> 'عائلة مينا' then raise exception 'search by code must carry the family: %', hits; end if;
  if jsonb_array_length(hits -> 0 -> 'places') <> 1 then raise exception 'search must carry scoped places'; end if;
  if public.family_search_persons('مي', 1) is null or jsonb_array_length(public.family_search_persons('مي', 1)) <> 1 then raise exception 'limit'; end if;
  if jsonb_array_length(public.family_search_persons('x')) <> 0 then raise exception 'short query → empty'; end if;

  -- add an EXISTING person by id (search result) — he is in عائلة مينا → move
  begin
    perform public.family_add_member(f, '50000000-0000-0000-0000-000000000002');
    raise exception 'must refuse without move';
  exception when others then if sqlerrm not like '%in_other_family%' then raise; end if; end;
  r := public.family_add_member(f, '50000000-0000-0000-0000-000000000002', 'daughter', true);
  if r -> 'moved_from' ->> 'name' <> 'عائلة مينا' then raise exception 'move by id failed: %', r; end if;

  -- add a NEW person with an enrollment (فصل أ) in one call
  r := public.family_add_new_member(f, 'أب جديد', 'NEW-DAD', 'male', '1980-01-01', '+201000000000', null, null, null,
         '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'father');
  if not (r ->> 'person_created')::boolean or r ->> 'enrollment_id' is null then raise exception 'new member with class failed: %', r; end if;
  if not exists (select 1 from public.enrollments e join public.persons p on p.id = e.person_id where p.national_id = 'NEW-DAD' and e.class_id = '30000000-0000-0000-0000-000000000001') then
    raise exception 'enrollment must exist';
  end if;
  if (select relation from public.family_members m join public.persons p on p.id = m.person_id where p.national_id = 'NEW-DAD') <> 'father' then raise exception 'relation missing'; end if;

  -- add a NEW bare person (no class) — code required
  begin
    perform public.family_add_new_member(f, 'أم بلا كود');
    raise exception 'bare person needs a code';
  exception when others then if sqlerrm not like '%code_required%' then raise; end if; end;
  r := public.family_add_new_member(f, 'أم جديدة', 'NEW-MOM', 'female', p_relation => 'mother');
  if not (r ->> 'person_created')::boolean or r ->> 'enrollment_id' is not null then raise exception 'bare new member failed: %', r; end if;
  if exists (select 1 from public.enrollments e join public.persons p on p.id = e.person_id where p.national_id = 'NEW-MOM') then raise exception 'bare person must have no enrollment'; end if;
  -- the family code itself can't be used as a person code
  begin
    perform public.family_add_new_member(f, 'x', 'FAM-2026-001');
    raise exception 'family code as person code must fail';
  exception when others then if sqlerrm not like '%code_taken%' then raise; end if; end;
  -- name required
  begin
    perform public.family_add_new_member(f, '  ', 'Z');
    raise exception 'name required';
  exception when others then if sqlerrm not like '%name_required%' then raise; end if; end;

  if (select count(*) from public.family_members where family_id = f) <> 3 then raise exception 'family must have 3 members'; end if;
  -- the scanner sees the bare mother (no enrollments) as a listed member
  r := public.family_lookup('NEW-MOM');
  if r -> 'family' ->> 'name' <> 'عائلة بكود مختار' or jsonb_array_length(r -> 'members') <> 3 then raise exception 'lookup of bare member: %', r; end if;
  -- and by the user-set family code
  r := public.family_lookup('FAM-2026-001');
  if r ->> 'matched' <> 'family' then raise exception 'family code lookup: %', r; end if;
end $$;
reset role;

rollback;
\echo FAMILIES TESTS PASSED
