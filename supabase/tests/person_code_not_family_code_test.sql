-- =====================================================================
-- Functional test for 20260930120000_person_code_not_family_code.sql
--   (كود واحد — شخص أو عائلة: a person code can never equal a family code)
--   psql -d app -f supabase/tests/person_code_not_family_code_test.sql
-- Ends with «PERSON CODE / FAMILY CODE TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000003');  -- service manager
insert into public.churches (id, name) values ('10000000-0000-0000-0000-000000000001', 'كنيسة أ');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ');
insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000003', 'مسؤول الخدمة', 'sm', '0103', 'service_manager', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, now());

insert into public.persons (id, national_id, name, gender) values
  ('50000000-0000-0000-0000-000000000001', 'KID-1', 'مينا', 'male'),
  ('50000000-0000-0000-0000-000000000002', 'KID-2', 'مريم', 'female');
insert into public.families (id, code, name) values
  ('80000000-0000-0000-0000-000000000001', 'FAM-001', 'عائلة أ'),
  ('80000000-0000-0000-0000-000000000002', 'FAM-002', 'عائلة ب');

-- ---------- A. the trigger: insert / update of a person with a family code ----------
do $$
declare ok boolean;
begin
  -- insert a person with an existing family code → refused
  ok := false;
  begin
    insert into public.persons (national_id, name) values ('FAM-001', 'دخيل');
  exception when others then ok := sqlerrm like '%code_is_family%' and sqlstate = '23505'; end;
  if not ok then raise exception 'insert person with family code must raise code_is_family'; end if;

  -- change an existing person's code to a family code → refused
  ok := false;
  begin
    update public.persons set national_id = 'FAM-002' where national_id = 'KID-1';
  exception when others then ok := sqlerrm like '%code_is_family%'; end;
  if not ok then raise exception 'update person code to family code must raise code_is_family'; end if;
  if (select national_id from public.persons where id = '50000000-0000-0000-0000-000000000001') <> 'KID-1' then
    raise exception 'refused update must not change the code';
  end if;

  -- trimmed input still matches (the app trims before writing; the trigger compares exactly)
  update public.persons set national_id = 'KID-1-NEW' where national_id = 'KID-1';   -- a free code is fine
  update public.persons set name = 'مينا الجديد' where national_id = 'KID-1-NEW';    -- unrelated update is fine
end $$;

-- ---------- B. legacy collision: an unrelated update never fails ----------
do $$
declare ok boolean;
begin
  -- simulate a pre-rule collision by bypassing the trigger
  alter table public.persons disable trigger trg_persons_code_not_family;
  insert into public.persons (id, national_id, name) values ('50000000-0000-0000-0000-000000000009', 'FAM-002', 'قديم');
  alter table public.persons enable trigger trg_persons_code_not_family;

  -- touching other columns must NOT re-validate the (legacy) code
  update public.persons set phone = '+201000000000' where id = '50000000-0000-0000-0000-000000000009';
  -- setting the SAME code again is not a change either
  update public.persons set national_id = 'FAM-002' where id = '50000000-0000-0000-0000-000000000009';
  -- but changing it to ANOTHER family code is refused
  ok := false;
  begin
    update public.persons set national_id = 'FAM-001' where id = '50000000-0000-0000-0000-000000000009';
  exception when others then ok := sqlerrm like '%code_is_family%'; end;
  if not ok then raise exception 'legacy person changing to another family code must be refused'; end if;
  -- and moving him to a free code repairs the collision
  update public.persons set national_id = 'OLD-FIXED' where id = '50000000-0000-0000-0000-000000000009';
end $$;

-- ---------- C. the RPCs go through the trigger too (service manager) ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
set local request.jwt.claim.role = 'authenticated';

do $$
declare ok boolean; r jsonb; i int;
begin
  -- إضافة مخدوم with a family code → code_is_family
  ok := false;
  begin
    perform public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
                                         '30000000-0000-0000-0000-000000000001', 'طفل', 'FAM-001');
  exception when others then ok := sqlerrm like '%code_is_family%'; end;
  if not ok then raise exception 'add_person_and_enroll with a family code must raise code_is_family'; end if;
  if exists (select 1 from public.persons where name = 'طفل') then raise exception 'refused person must not exist'; end if;

  -- a free code works as before
  r := public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
                                    '30000000-0000-0000-0000-000000000001', 'طفل جديد', 'KID-3');
  if not (r ->> 'person_created')::boolean then raise exception 'free code must create the person: %', r; end if;

  -- person_code_lookup — live check
  r := public.person_code_lookup('FAM-001');
  if (r ->> 'free')::boolean or r -> 'family' ->> 'name' <> 'عائلة أ' or r -> 'person' <> 'null'::jsonb then
    raise exception 'lookup of a family code: %', r;
  end if;
  r := public.person_code_lookup(' KID-3 ');
  if (r ->> 'free')::boolean or r -> 'person' ->> 'name' <> 'طفل جديد' then raise exception 'lookup of a person code: %', r; end if;
  r := public.person_code_lookup('FREE-1');
  if not (r ->> 'free')::boolean then raise exception 'lookup of a free code: %', r; end if;
  r := public.person_code_lookup('');
  if (r ->> 'free')::boolean then raise exception 'empty code is never free: %', r; end if;

  -- admin_servant_code_lookup / signup lookups know about families
  r := public.admin_servant_code_lookup('FAM-001');
  if r ->> 'family' <> 'عائلة أ' or r -> 'person' <> 'null'::jsonb then raise exception 'admin lookup family key: %', r; end if;
  r := public.admin_servant_code_lookup('KID-3');
  if r -> 'family' <> 'null'::jsonb then raise exception 'admin lookup of a person code must have no family: %', r; end if;
  r := public.signup_lookup_code('FAM-001');
  if not (r ->> 'family')::boolean then raise exception 'signup lookup of a family code: %', r; end if;
  r := public.signup_lookup_code('KID-3');
  if r ->> 'name' <> 'طفل جديد' or r ? 'family' then raise exception 'signup lookup of a person code: %', r; end if;
  r := public.child_signup_lookup_code('FAM-001');
  if not (r ->> 'family')::boolean or (r ->> 'exists')::boolean then raise exception 'child signup lookup of a family code: %', r; end if;

  -- the generator never hands out a family code (many rounds — the fallback
  -- alphabet is random; we simply assert every generated code is free)
  for i in 1..25 loop
    r := public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
                                      '30000000-0000-0000-0000-000000000001', 'مولَّد ' || i, null);
    if exists (select 1 from public.families f where f.code = r ->> 'national_id') then
      raise exception 'generated person code equals a family code: %', r ->> 'national_id';
    end if;
  end loop;
end $$;
reset role;

-- ---------- D. the family side still refuses a person code (unchanged) ----------
do $$
declare ok boolean := false;
begin
  begin
    insert into public.families (code, name) values ('KID-3', 'عائلة بكود طفل');
  exception when others then ok := sqlerrm like '%code_is_person%'; end;
  if not ok then raise exception 'family with a person code must still raise code_is_person'; end if;
end $$;

rollback;
\echo PERSON CODE / FAMILY CODE TESTS PASSED
