-- =====================================================================
-- Functional test for migration 0037 (تسجيلات الخدام + الصلاحيات). Run on
-- the local shim DB after all migrations:
--   psql -d app -f supabase/tests/servants_permissions_test.sql
-- Every assert raises on failure; a clean run ends with «SERVANTS TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;
\i supabase/tests/_test_invites.sql

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000002'),  -- new servant (signs up)
  ('00000000-0000-0000-0000-000000000003'),  -- another account, same code
  ('00000000-0000-0000-0000-000000000004');  -- church manager
insert into public.churches (id, name) values ('10000000-0000-0000-0000-000000000001', 'كنيسة');
insert into public.services (id, church_id, name) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ');

-- bootstrap owner the OLD way (0002 script, through the compat view) → auto person
insert into public.profiles (id, full_name, user_id, phone, role, status, approved_at)
values ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', now());
insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id)
values ('00000000-0000-0000-0000-000000000004', 'مدير', 'manager', '0104', 'church_manager', 'approved', '10000000-0000-0000-0000-000000000001');

do $$ begin
  if (select person_id from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000001') is null then
    raise exception 'owner did not get an auto person';
  end if;
  if (select p.national_id from public.persons p join public.servant_enrollments s on s.person_id = p.id where s.id = '00000000-0000-0000-0000-000000000001') <> 'owner' then
    raise exception 'auto person code should be the user_id';
  end if;
end $$;

-- ---------- signup ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';

do $$ begin
  if public.signup_lookup_code('29901010000009') is not null then raise exception 'unknown code must return null'; end if;
end $$;

do $$ begin
  perform public.servant_signup('29901010000009', 'مينا', 'male', null, null, null, null, null, null, null, null, null, current_setting('test.inv_servant'));
  raise exception 'phone should be required';
exception when others then
  if sqlerrm <> 'phone_required' then raise; end if;
end $$;

do $$ begin
  perform public.servant_signup('29901010000009', 'مينا', 'male', null, '+201001234567', null, null,
    '10000000-0000-0000-0000-000000000001', null, '30000000-0000-0000-0000-000000000001', null, null, current_setting('test.inv_servant'));
  raise exception 'class without service should fail';
exception when others then
  if sqlerrm <> 'class_not_in_service' then raise; end if;
end $$;

create temp table _v (k text primary key, v text);
insert into _v values ('r', public.servant_signup('29901010000009', 'مينا خادم', 'male', '1999-01-01', '+201001234567', 'الأقصر', 'ملاحظة',
  '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', null, null, current_setting('test.inv_servant'))::text);
do $$ declare r jsonb := (select v::jsonb from _v where k = 'r'); begin
  if not (r->>'person_created')::boolean then raise exception 'person should be created'; end if;
  if r->>'user_id' <> '29901010000009' then raise exception 'user_id should equal the code'; end if;
end $$;

do $$
declare s public.servant_enrollments; p public.persons;
begin
  select * into s from public.servant_enrollments where id = auth.uid();
  if s.status <> 'pending' or s.role <> 'class_servant' then raise exception 'signup must be a pending class_servant'; end if;
  if s.person_id is null then raise exception 'servant must be bound to a person'; end if;
  if s.class_id <> '30000000-0000-0000-0000-000000000001' then raise exception 'scope not stored'; end if;
  select * into p from public.persons where id = s.person_id;
  if p.name <> 'مينا خادم' or p.gender <> 'male' or p.phone <> '+201001234567' or p.address <> 'الأقصر' or p.notes <> 'ملاحظة' then
    raise exception 'person data not stored: %', to_jsonb(p);
  end if;
  if (public.signup_lookup_code('29901010000009')->>'has_account')::boolean is not true then raise exception 'lookup should say has_account'; end if;
end $$;

do $$ begin
  if (select count(*) from public.persons) <> 1 then raise exception 'pending servant should see exactly his person, saw %', (select count(*) from public.persons); end if;
  if (select count(*) from public.permission_profiles) <> 0 then raise exception 'pending servant sees permission profiles'; end if;
end $$;

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
do $$ begin
  perform public.servant_signup('29901010000009', 'آخر', 'male', null, '+201000000000', null, null, null, null, null, null, null, current_setting('test.inv_servant'));
  raise exception 'duplicate code must fail';
exception when others then
  if sqlerrm <> 'code_taken' then raise; end if;
end $$;

-- ---------- approval + permissions (owner) ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
update public.servant_enrollments set status = 'approved', approved_by = auth.uid(), approved_at = now()
 where id = '00000000-0000-0000-0000-000000000002';

with i as (insert into public.permission_profiles (name, permissions) values ('خادم فصل', array['children.view', 'children.attendance']) returning id)
insert into _v select 'pp', id::text from i;
with i as (insert into public.permission_profiles (name, permissions) values ('كاشير', array['children.points']) returning id)
insert into _v select 'pp2', id::text from i;
do $$ begin
  if (select created_by from public.permission_profiles where id = (select v::uuid from _v where k = 'pp')) <> auth.uid() then raise exception 'created_by not stamped'; end if;
  if public.my_permissions() <> array['*'] then raise exception 'owner must have *'; end if;
  if not public.has_permission('anything.at.all') then raise exception 'owner has everything'; end if;
end $$;
insert into public.permissions (servant_id, permission_profile_id) values ('00000000-0000-0000-0000-000000000002', (select v::uuid from _v where k = 'pp'));

-- ---------- church manager grants the second profile (in his scope) ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
do $$ begin
  if not public.can_manage_servant('00000000-0000-0000-0000-000000000002') then raise exception 'manager should manage servant in his church'; end if;
  if public.can_manage_servant('00000000-0000-0000-0000-000000000001') then raise exception 'manager must not manage the owner'; end if;
  if public.can_manage_servant(auth.uid()) then raise exception 'nobody manages himself'; end if;
end $$;
insert into public.permissions (servant_id, permission_profile_id) values ('00000000-0000-0000-0000-000000000002', (select v::uuid from _v where k = 'pp2'));
do $$ begin
  if (select granted_by from public.permissions where permission_profile_id = (select v::uuid from _v where k = 'pp2')) <> auth.uid() then raise exception 'granted_by not stamped'; end if;
  begin
    insert into public.permission_profiles (name, permissions) values ('x', '{}');
    raise exception 'manager created a permission profile';
  exception when insufficient_privilege or check_violation then null;
  end;
  if (select count(*) from public.permission_profiles) <> 2 then raise exception 'manager should read all profiles'; end if;
  if (select count(*) from public.servant_permission_map()) <> 1 then raise exception 'permission map'; end if;
end $$;

-- ---------- the servant ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$
declare ks text[];
begin
  ks := public.my_permissions();
  if not ('children.view' = any(ks) and 'children.attendance' = any(ks) and 'children.points' = any(ks)) then
    raise exception 'servant keys wrong: %', ks;
  end if;
  if public.has_permission('children.delete') then raise exception 'servant must not have delete'; end if;
  if (select count(*) from public.permissions) <> 2 then raise exception 'servant sees only his grants'; end if;
  if (select count(*) from public.permission_profiles) <> 2 then raise exception 'approved servant reads profiles'; end if;
  begin
    insert into public.permissions (servant_id, permission_profile_id) values (auth.uid(), (select v::uuid from _v where k = 'pp'));
    raise exception 'servant granted himself';
  exception when insufficient_privilege or check_violation or unique_violation then null;
  end;
  update public.servant_enrollments set role = 'owner', person_id = null where id = auth.uid();
  if (select role from public.servant_enrollments where id = auth.uid()) <> 'class_servant' then raise exception 'guard: role changed'; end if;
  if (select person_id from public.servant_enrollments where id = auth.uid()) is null then raise exception 'guard: person_id changed'; end if;
end $$;

-- mirror: person ↔ servant enrollment
update public.persons set name = 'مينا المعدل', phone = '+201099999999' where id = (select person_id from public.servant_enrollments where id = auth.uid());
do $$ begin
  if (select full_name from public.servant_enrollments where id = auth.uid()) <> 'مينا المعدل' then raise exception 'person→servant mirror'; end if;
  if (select phone from public.servant_enrollments where id = auth.uid()) <> '+201099999999' then raise exception 'person→servant phone mirror'; end if;
end $$;
update public.servant_enrollments set full_name = 'مينا ٣', photo_url = 'https://x/y.webp' where id = auth.uid();
do $$ begin
  if (select name from public.persons where id = (select person_id from public.servant_enrollments where id = auth.uid())) <> 'مينا ٣' then raise exception 'servant→person mirror'; end if;
  if (select image_url from public.persons where id = (select person_id from public.servant_enrollments where id = auth.uid())) <> 'https://x/y.webp' then raise exception 'servant→person photo mirror'; end if;
end $$;

-- legacy view keeps working (read + write) with RLS
do $$ begin
  if (select full_name from public.profiles where id = auth.uid()) <> 'مينا ٣' then raise exception 'profiles view read'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'profiles view must apply RLS'; end if;
end $$;
update public.profiles set phone = '+201011111111' where id = auth.uid();
do $$ begin
  if (select phone from public.servant_enrollments where id = auth.uid()) <> '+201011111111' then raise exception 'profiles view write'; end if;
  if public.my_role() <> 'class_servant' then raise exception 'my_role via view'; end if;
  if not public.can_access('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001') then raise exception 'can_access via view'; end if;
end $$;

-- deleting the enrollment cascades the permissions; the person stays
reset role;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
-- (rows inserted in THIS transaction are re-checked by Postgres on every
--  update — clear the audit columns first; in production the cascading
--  ON DELETE SET NULL of 4b does this on its own)
update public.persons set created_by = null, edited_by = null where created_by = '00000000-0000-0000-0000-000000000002' or edited_by = '00000000-0000-0000-0000-000000000002';
delete from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000002';
do $$ begin
  if (select count(*) from public.permissions) <> 0 then raise exception 'permissions not cascaded'; end if;
  if (select count(*) from public.persons where national_id = '29901010000009') <> 1 then raise exception 'person must survive'; end if;
end $$;

do $$ begin
  -- 0046: servant_enrollments moved to broadcast (zzz_rt_* triggers);
  -- 20261015120000: permission_profiles / permissions too (global config → every church topic)
  if (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('permission_profiles', 'permissions')) <> 0 then
    raise exception 'permission tables should have left the realtime publication';
  end if;
  if (select count(*) from pg_trigger where tgname = 'zzz_rt_upd' and tgrelid in ('public.permission_profiles'::regclass, 'public.permissions'::regclass)) <> 2 then
    raise exception 'permission tables broadcast triggers missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'zzz_rt_upd' and tgrelid = 'public.servant_enrollments'::regclass) then
    raise exception 'servant_enrollments broadcast trigger missing';
  end if;
end $$;

rollback;
\echo SERVANTS TESTS PASSED
