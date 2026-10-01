-- =====================================================================
-- Functional test for migration 0045 (one person → many places).
--   psql -d app -f supabase/tests/multi_scope_test.sql
-- Ends with «MULTI SCOPE TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;
\i supabase/tests/_test_invites.sql

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000002'),  -- church manager (كنيسة أ)
  ('00000000-0000-0000-0000-000000000003'),  -- service manager (خدمة أ1)
  ('00000000-0000-0000-0000-000000000006'),  -- class servant: فصل أ1-1 (+ فصل ب1-1 later — two churches!)
  ('00000000-0000-0000-0000-000000000007'),  -- class servant: فصل أ2-1 only
  ('00000000-0000-0000-0000-000000000008');  -- signup account
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة أ'),
  ('10000000-0000-0000-0000-000000000002', 'كنيسة ب');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'خدمة أ1'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'خدمة أ2'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'خدمة ب1');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ1-1'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'فصل أ2-1'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', 'فصل ب1-1');

insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000002', 'مدير أ', 'cm-a', '0102', 'church_manager', 'approved', '10000000-0000-0000-0000-000000000001', null, null, now()),
  ('00000000-0000-0000-0000-000000000003', 'مسؤول أ1', 'sm-a1', '0103', 'service_manager', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, now()),
  ('00000000-0000-0000-0000-000000000006', 'خادم متعدد', 'cs-multi', '0106', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now()),
  ('00000000-0000-0000-0000-000000000007', 'خادم أ2', 'cs-a2', '0107', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', now());

insert into public.persons (id, national_id, name) values
  ('50000000-0000-0000-0000-000000000001', 'K1', 'مخدوم أ1'),
  ('50000000-0000-0000-0000-000000000002', 'K2', 'مخدوم أ2'),
  ('50000000-0000-0000-0000-000000000003', 'K3', 'مخدوم ب1');
insert into public.enrollments (person_id, church_id, service_id, class_id) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002'),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003');

-- ---------- A. baseline: one scope → sees one class ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';
do $$
begin
  if (select count(*) from public.enrollments where kind = 'child') <> 1 then raise exception 'A1 should see 1 child'; end if;
  if (select count(*) from public.classes) <> 1 then raise exception 'A2 should see 1 class'; end if;
  if (select count(*) from public.churches) <> 1 then raise exception 'A3 should see 1 church'; end if;
  if (select count(*) from public.enrollments where servant_id = '00000000-0000-0000-0000-000000000006') <> 1 then raise exception 'A4 one mirror'; end if;
end $$;

-- ---------- B. the OWNER adds a second place in ANOTHER church ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare r jsonb;
begin
  r := public.set_servant_scopes('00000000-0000-0000-0000-000000000006', jsonb_build_array(
        jsonb_build_object('church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000001', 'class_id', '30000000-0000-0000-0000-000000000001'),
        jsonb_build_object('church_id', '10000000-0000-0000-0000-000000000002', 'service_id', '20000000-0000-0000-0000-000000000003', 'class_id', '30000000-0000-0000-0000-000000000003')));
  if (r->>'count')::int <> 2 then raise exception 'B1 two scopes expected, got %', r; end if;
  if (select count(*) from public.servant_scopes where servant_id = '00000000-0000-0000-0000-000000000006') <> 1 then raise exception 'B2 one extra row'; end if;
  if (select class_id from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000006') <> '30000000-0000-0000-0000-000000000001' then
    raise exception 'B3 primary must stay the first';
  end if;
  if (select count(*) from public.enrollments where servant_id = '00000000-0000-0000-0000-000000000006') <> 2 then raise exception 'B4 two mirrors'; end if;
end $$;

-- ---------- C. the servant now sees BOTH places ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
do $$
begin
  if (select count(*) from public.enrollments where kind = 'child') <> 2 then raise exception 'C1 should see 2 children'; end if;
  if (select count(*) from public.classes) <> 2 then raise exception 'C2 should see 2 classes'; end if;
  if (select count(*) from public.churches) <> 2 then raise exception 'C3 should see 2 churches'; end if;
  if (select count(*) from public.services) <> 2 then raise exception 'C4 should see 2 services'; end if;
  if not public.can_access('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003') then
    raise exception 'C5 can_access must accept the extra scope';
  end if;
  if public.can_access('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002') then
    raise exception 'C6 can_access must still refuse a foreign class';
  end if;
  if (select count(*) from public.my_scopes()) <> 2 then raise exception 'C7 my_scopes = 2'; end if;
  begin
    perform public.set_servant_scopes('00000000-0000-0000-0000-000000000006', '[]'::jsonb);
    raise exception 'C8 self edit must fail';
  exception when others then
    if sqlerrm not like '%forbidden%' then raise; end if;
  end;
end $$;

-- ---------- D. the church manager of كنيسة أ ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$
declare r jsonb;
begin
  if not exists (select 1 from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000006') then raise exception 'D1'; end if;
  if not public.can_manage_servant('00000000-0000-0000-0000-000000000006') then raise exception 'D2 manageable'; end if;
  begin
    perform public.set_servant_scopes('00000000-0000-0000-0000-000000000007', jsonb_build_array(
      jsonb_build_object('church_id', '10000000-0000-0000-0000-000000000002', 'service_id', '20000000-0000-0000-0000-000000000003', 'class_id', '30000000-0000-0000-0000-000000000003')));
    raise exception 'D3 foreign church must fail';
  exception when others then
    if sqlerrm not like '%scope_not_allowed%' then raise; end if;
  end;
  -- move inside HIS church: فصل أ1-1 → فصل أ2-1; the كنيسة ب scope is KEPT
  r := public.set_servant_scopes('00000000-0000-0000-0000-000000000006', jsonb_build_array(
        jsonb_build_object('church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000002', 'class_id', '30000000-0000-0000-0000-000000000002')));
  if (r->>'count')::int <> 2 then raise exception 'D4 kept the foreign scope, got %', r; end if;
  if (select class_id from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000006') <> '30000000-0000-0000-0000-000000000002' then
    raise exception 'D5 primary must be the new class';
  end if;
  if not exists (select 1 from public.servant_scopes where servant_id = '00000000-0000-0000-0000-000000000006' and class_id = '30000000-0000-0000-0000-000000000003') then
    raise exception 'D6 foreign scope must survive';
  end if;
end $$;
-- (mirrors checked without RLS: the church manager cannot see the كنيسة ب row — by design)
reset role;
do $$
begin
  if (select count(*) from public.enrollments where servant_id = '00000000-0000-0000-0000-000000000006') <> 2 then raise exception 'D7'; end if;
  if exists (select 1 from public.enrollments where servant_id = '00000000-0000-0000-0000-000000000006' and class_id = '30000000-0000-0000-0000-000000000001') then raise exception 'D8'; end if;
end $$;

-- ---------- E. service manager of خدمة أ1 ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
do $$
begin
  if public.can_manage_servant('00000000-0000-0000-0000-000000000007') then raise exception 'E1 not yet in my service'; end if;
  if exists (select 1 from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000007') then raise exception 'E2 not visible yet'; end if;
end $$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select (public.set_servant_scopes('00000000-0000-0000-0000-000000000007', jsonb_build_array(
  jsonb_build_object('church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000002', 'class_id', '30000000-0000-0000-0000-000000000002'),
  jsonb_build_object('church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000001', 'class_id', '30000000-0000-0000-0000-000000000001'))))->>'count' as e_scopes;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
do $$
declare r jsonb;
begin
  if not public.can_manage_servant('00000000-0000-0000-0000-000000000007') then raise exception 'E3 now in my service'; end if;
  if not exists (select 1 from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000007') then raise exception 'E4 now visible'; end if;
  r := public.set_enrollments_status('stopped', null, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, 'servant');
  if (r->>'servants')::int <> 1 then raise exception 'E5 one servant suspended, got %', r; end if;
  if (select status from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000007') <> 'suspended' then raise exception 'E6'; end if;
end $$;
reset role;   -- both mirrors (also the one in خدمة أ2 the service manager cannot see) are stopped
do $$
begin
  if (select count(*) from public.enrollments where servant_id = '00000000-0000-0000-0000-000000000007' and status = 'stopped') <> 2 then raise exception 'E7 both mirrors stopped'; end if;
end $$;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
do $$
begin
  perform public.set_enrollments_status('active', null, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, 'servant');
  if (select status from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000007') <> 'approved' then raise exception 'E8'; end if;
end $$;

-- ---------- F. signup with several places ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000008';
do $$
declare r jsonb;
begin
  r := public.servant_signup('NEW-1', 'خادم جديد', 'male', null, '+201000000008', null, null, null, null, null, null,
        jsonb_build_array(
          jsonb_build_object('church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000001', 'class_id', '30000000-0000-0000-0000-000000000001'),
          jsonb_build_object('church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000002', 'class_id', '30000000-0000-0000-0000-000000000002')),
        current_setting('test.inv_servant'));
  if (r->>'scopes')::int <> 2 then raise exception 'F1'; end if;
  if (select class_id from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000008') <> '30000000-0000-0000-0000-000000000001' then raise exception 'F2 primary'; end if;
  if (select count(*) from public.servant_scopes where servant_id = '00000000-0000-0000-0000-000000000008') <> 1 then raise exception 'F3 one extra'; end if;
  if exists (select 1 from public.enrollments where servant_id = '00000000-0000-0000-0000-000000000008') then raise exception 'F4 pending has no mirror'; end if;
end $$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
update public.servant_enrollments set status = 'approved', approved_by = '00000000-0000-0000-0000-000000000002', approved_at = now()
 where id = '00000000-0000-0000-0000-000000000008';
do $$
begin
  if (select count(*) from public.enrollments where servant_id = '00000000-0000-0000-0000-000000000008') <> 2 then raise exception 'F5 two mirrors after approval'; end if;
end $$;

-- ---------- G. admin_add_servant with p_scopes (service role) ----------
reset role;
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000009');
set local role service_role;
do $$
declare r jsonb;
begin
  r := public.admin_add_servant('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000009', 'ADD-9', 'خادم مضاف',
        'class_servant', null, null, null, null, null, '+201000000009', null, null, null, '{}',
        jsonb_build_array(
          jsonb_build_object('church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000001', 'class_id', '30000000-0000-0000-0000-000000000001'),
          jsonb_build_object('church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000002', 'class_id', '30000000-0000-0000-0000-000000000002')));
  if (r->>'scopes')::int <> 2 then raise exception 'G1'; end if;
  begin
    perform public.admin_add_servant('00000000-0000-0000-0000-000000000002', gen_random_uuid(), 'ADD-X', 'خادم خارجي',
        'class_servant', null, null, null, null, null, null, null, null, null, '{}',
        jsonb_build_array(jsonb_build_object('church_id', '10000000-0000-0000-0000-000000000002', 'service_id', '20000000-0000-0000-0000-000000000003', 'class_id', '30000000-0000-0000-0000-000000000003')));
    raise exception 'G3 must fail';
  exception when others then
    if sqlerrm not like '%scope_not_allowed%' then raise; end if;
  end;
end $$;

-- ---------- H. mirrors of the added servant · deleting removes every mirror + scope ----------
reset role;
do $$
begin
  if (select count(*) from public.enrollments where servant_id = '00000000-0000-0000-0000-000000000009') <> 2 then raise exception 'G2 two mirrors'; end if;
end $$;
delete from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000009';
do $$
begin
  if exists (select 1 from public.enrollments where servant_id = '00000000-0000-0000-0000-000000000009') then raise exception 'H1'; end if;
  if exists (select 1 from public.servant_scopes where servant_id = '00000000-0000-0000-0000-000000000009') then raise exception 'H2'; end if;
end $$;

select 'MULTI SCOPE TESTS PASSED' as result;
rollback;
