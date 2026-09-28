-- =====================================================================
-- Functional test for 20260930130000_families_managed_by_owner_and_church_manager.sql
--   (العائلات — مالك التطبيق ومدير الكنيسة يديران العائلات بجانب الكاهن)
--   psql -d app -f supabase/tests/families_owner_church_manager_test.sql
-- Ends with «FAMILIES OWNER / CHURCH MANAGER TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000002'),  -- church manager of كنيسة أ
  ('00000000-0000-0000-0000-000000000003'),  -- service manager (مدارس الأحد, كنيسة أ)
  ('00000000-0000-0000-0000-000000000005');  -- church manager of كنيسة ب
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة أ'),
  ('10000000-0000-0000-0000-000000000002', 'كنيسة ب');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ');
insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000002', 'مدير أ', 'cm-a', '0102', 'church_manager', 'approved', '10000000-0000-0000-0000-000000000001', null, null, now()),
  ('00000000-0000-0000-0000-000000000003', 'مسؤول خدمة', 'sm', '0103', 'service_manager', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, now()),
  ('00000000-0000-0000-0000-000000000005', 'مدير ب', 'cm-b', '0105', 'church_manager', 'approved', '10000000-0000-0000-0000-000000000002', null, null, now());
insert into public.persons (id, national_id, name) values
  ('50000000-0000-0000-0000-000000000001', 'KID-1', 'مينا'),
  ('50000000-0000-0000-0000-000000000002', 'KID-2', 'مريم');
insert into public.enrollments (person_id, church_id, service_id, class_id) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';

-- ---------- A. church manager of كنيسة أ: manage inside his church ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$
declare f uuid; r jsonb; n int;
begin
  if not (public.family_permissions() ->> 'manage')::boolean then raise exception 'church manager must manage families'; end if;
  select count(*) into n from public.family_manage_churches();
  if n <> 1 then raise exception 'church manager manages exactly his church, got %', n; end if;

  -- no church given → his church is filled
  insert into public.families (name) values ('عائلة أ') returning id into f;
  if (select church_id from public.families where id = f) <> '10000000-0000-0000-0000-000000000001' then raise exception 'church must be filled from the manager scope'; end if;
  -- an empty family of his church is visible to him
  if not exists (select 1 from public.families where id = f) then raise exception 'manager must see his church''s family'; end if;

  -- another church → refused
  begin
    insert into public.families (name, church_id) values ('x', '10000000-0000-0000-0000-000000000002');
    raise exception 'other church must be refused';
  exception when others then if sqlerrm not like '%church_forbidden%' then raise; end if; end;

  -- members
  r := public.family_add_member_by_code(f, 'KID-1', 'son');
  if r ->> 'member_id' is null then raise exception 'add member failed: %', r; end if;
  r := public.family_add_new_member(f, 'أم', 'MOM-1', 'female', p_relation => 'mother');
  if not (r ->> 'person_created')::boolean then raise exception 'new member failed: %', r; end if;
  -- edit + delete allowed
  update public.families set name = 'عائلة أ المعدّلة' where id = f;
  if (select name from public.families where id = f) <> 'عائلة أ المعدّلة' then raise exception 'edit must work'; end if;
end $$;

-- remember the id of the كنيسة أ family for the RLS-bypassing RPC checks below
reset role;
do $$
declare f uuid;
begin
  select id into f from public.families where name = 'عائلة أ المعدّلة';
  perform set_config('app.test_fam_a', f::text, true);
end $$;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';

-- ---------- B. church manager of كنيسة ب: sees / touches nothing of كنيسة أ ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
do $$
declare f uuid; ok boolean := false;
begin
  if exists (select 1 from public.families where name = 'عائلة أ المعدّلة') then raise exception 'family of another church must be hidden'; end if;
  -- an update through RLS silently touches 0 rows (checked below as superuser)
  update public.families set name = 'hack' where church_id = '10000000-0000-0000-0000-000000000001';
  -- the RPC path (security definer) → no_access
  begin
    perform public.family_add_member_by_code(current_setting('app.test_fam_a')::uuid, 'KID-2');
  exception when others then ok := sqlerrm like '%no_access%'; end;
  if not ok then raise exception 'manager of ب must get no_access on a family of أ'; end if;
  -- his own church works
  insert into public.families (name) values ('عائلة ب') returning id into f;
  if (select church_id from public.families where id = f) <> '10000000-0000-0000-0000-000000000002' then raise exception 'church ب must be filled'; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.families where name = 'hack') then raise exception 'manager of ب must not edit a family of أ'; end if;
end $$;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';

-- ---------- C. service manager: view only (no longer manages) ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
do $$
declare ok boolean := false;
begin
  if (public.family_permissions() ->> 'manage')::boolean then raise exception 'service manager must NOT manage families any more'; end if;
  if not (public.family_permissions() ->> 'view')::boolean then raise exception 'service manager must still view'; end if;
  -- sees the family through مينا (enrolled in his service)
  if not exists (select 1 from public.families where name = 'عائلة أ المعدّلة') then raise exception 'service manager must see the family via a member in scope'; end if;
  begin
    insert into public.families (name) values ('x');
    raise exception 'service manager must not insert';
  exception when others then if sqlerrm not like '%row-level security%' then raise; end if; end;
  begin
    perform public.family_add_member_by_code(current_setting('app.test_fam_a')::uuid, 'KID-2');
  exception when others then ok := sqlerrm like '%forbidden%'; end;
  if not ok then raise exception 'service manager must be forbidden to add members'; end if;
end $$;

-- ---------- D. owner: everything, but must choose the church ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare f uuid; n int; ok boolean := false;
begin
  if not (public.family_permissions() ->> 'manage')::boolean then raise exception 'owner must manage'; end if;
  select count(*) into n from public.family_manage_churches();
  if n <> 2 then raise exception 'owner manages every church, got %', n; end if;
  begin
    insert into public.families (name) values ('بلا كنيسة');
  exception when others then ok := sqlerrm like '%church_required%'; end;
  if not ok then raise exception 'owner without a church must get church_required'; end if;
  insert into public.families (name, church_id) values ('عائلة المالك', '10000000-0000-0000-0000-000000000002') returning id into f;
  if (select church_id from public.families where id = f) <> '10000000-0000-0000-0000-000000000002' then raise exception 'owner church kept'; end if;
  -- the owner edits a family of any church
  update public.families set notes = 'ملاحظة المالك' where id = current_setting('app.test_fam_a')::uuid;
  if (select notes from public.families where id = current_setting('app.test_fam_a')::uuid) <> 'ملاحظة المالك' then raise exception 'owner must edit any family'; end if;
  perform public.family_add_member_by_code(current_setting('app.test_fam_a')::uuid, 'KID-2', 'daughter');
  if (select count(*) from public.family_members where family_id = current_setting('app.test_fam_a')::uuid) <> 3 then raise exception 'owner must add members anywhere'; end if;
  delete from public.families where id = f;
  if exists (select 1 from public.families where id = f) then raise exception 'owner must delete'; end if;
end $$;
reset role;

rollback;
\echo FAMILIES OWNER / CHURCH MANAGER TESTS PASSED
