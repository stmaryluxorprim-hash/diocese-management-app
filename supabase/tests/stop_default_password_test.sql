-- =====================================================================
-- Functional test for migration 0043 (stop + default password 000000).
--   psql -d app -f supabase/tests/stop_default_password_test.sql
-- Ends with «STOP / DEFAULT PASSWORD TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000006'),  -- class servant (فصل أ)
  ('00000000-0000-0000-0000-000000000007');  -- class servant (فصل ب)
insert into public.churches (id, name) values ('10000000-0000-0000-0000-000000000001', 'كنيسة أ');
insert into public.services (id, church_id, name) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل ب');

insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000006', 'خادم أ', 'cs-a', '0106', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now()),
  ('00000000-0000-0000-0000-000000000007', 'خادم ب', 'cs-b', '0107', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', now());

insert into public.events (id, church_id, service_id, class_id, name, recurrence, weekdays, points) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', null, null, 'قداس', 'weekly', '{0,1,2,3,4,5,6}', 5);

-- ---------- A. default password + status column ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';

do $$
declare r jsonb; tok text; e1 uuid; e2 uuid;
begin
  -- add two children WITHOUT a password
  r := public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001', 'مينا', 'KID-1');
  e1 := (r->>'enrollment_id')::uuid;
  if (r->>'has_password')::boolean then raise exception 'no password expected'; end if;
  r := public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001', 'مريم', 'KID-2');
  e2 := (r->>'enrollment_id')::uuid;

  if (select status from public.enrollments where id = e1) <> 'active' then raise exception 'default status must be active'; end if;

  -- default password logs in
  r := public.child_login('KID-1', '000000', false);
  if not (r->>'default_password')::boolean then raise exception 'login must flag the default password'; end if;
  tok := r->>'token';
  -- wrong default is refused
  if public.child_login('KID-1', '111111', false)->>'error' is distinct from 'wrong_password' then
    raise exception 'wrong password accepted';
  end if;
  -- change: old (= default) + new
  begin
    perform public.child_change_password(tok, 'bad', 'secret1');
    raise exception 'wrong old password accepted';
  exception when others then
    if sqlerrm not like '%wrong_password%' then raise; end if;
  end;
  perform public.child_change_password(tok, '000000', 'secret1');
  r := public.child_login('KID-1', 'secret1', false);
  if public.child_login('KID-1', '000000', false)->>'error' is distinct from 'wrong_password' then
    raise exception 'default must stop working after a change';
  end if;

  -- ---------- B. stop ONE child ----------
  r := public.set_enrollments_status('stopped', array[e2]);
  if (r->>'children')::int <> 1 then raise exception 'one child must be stopped'; end if;
  if (select status from public.enrollments where id = e2) <> 'stopped' then raise exception 'status not stopped'; end if;

  -- no attendance / points for a stopped child
  begin
    insert into public.attendance_log (enrollment_id, event_id, points_delta, attended_on, recorded_by)
    values (e2, '40000000-0000-0000-0000-000000000001', 5, current_date, auth.uid());
    raise exception 'attendance on a stopped child must fail';
  exception when others then
    if sqlerrm not like '%enrollment_stopped%' then raise; end if;
  end;
  begin
    insert into public.points_log (enrollment_id, delta, recorded_by) values (e2, 3, auth.uid());
    raise exception 'points on a stopped child must fail';
  exception when others then
    if sqlerrm not like '%enrollment_stopped%' then raise; end if;
  end;
  -- the active one still works
  insert into public.attendance_log (enrollment_id, event_id, points_delta, attended_on, recorded_by)
  values (e1, '40000000-0000-0000-0000-000000000001', 5, current_date, auth.uid());

  -- stopped child cannot log in
  begin
    perform public.child_login('KID-2', '000000', false);
    raise exception 'stopped child must not log in';
  exception when others then
    if sqlerrm not like '%account_stopped%' then raise; end if;
  end;

  -- re-activate
  r := public.set_enrollments_status('active', array[e2]);
  if (r->>'children')::int <> 1 then raise exception 'one child must be re-activated'; end if;
  r := public.child_login('KID-2', '000000', false);

  -- ---------- C. stop a WHOLE class ----------
  r := public.set_enrollments_status('stopped', null, '10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'child');
  if (r->>'children')::int <> 2 then raise exception 'whole class: 2 children expected, got %', r->>'children'; end if;
  if (select count(*) from public.enrollments where class_id = '30000000-0000-0000-0000-000000000001' and kind = 'child' and status = 'stopped') <> 2 then
    raise exception 'class not fully stopped';
  end if;
  -- live session dies
  begin
    perform public.child_session_touch(tok);
    raise exception 'session of a stopped child must be refused';
  exception when others then
    if sqlerrm not like '%account_stopped%' then raise; end if;
  end;

  -- a class servant may NOT stop another class
  begin
    perform public.set_enrollments_status('stopped', null, '10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'child');
    raise exception 'class servant must not stop another class';
  exception when others then
    if sqlerrm not like '%forbidden%' then raise; end if;
  end;
end $$;

-- ---------- D. owner stops a WHOLE church incl. servants ----------
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local request.jwt.claim.role = 'authenticated';
do $$
declare r jsonb;
begin
  r := public.set_enrollments_status('stopped', null, '10000000-0000-0000-0000-000000000001', null, null, 'all');
  if (r->>'servants')::int <> 2 then raise exception 'church: 2 servants expected, got %', r->>'servants'; end if;
  if (select status from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000007') <> 'suspended' then
    raise exception 'servant must be suspended';
  end if;
  -- the servant mirror follows
  if (select status from public.enrollments where servant_id = '00000000-0000-0000-0000-000000000007') <> 'stopped' then
    raise exception 'servant mirror must be stopped';
  end if;
  -- back on
  r := public.set_enrollments_status('active', null, '10000000-0000-0000-0000-000000000001', null, null, 'all');
  if (r->>'children')::int <> 2 or (r->>'servants')::int <> 2 then raise exception 'church re-activation counts wrong: %', r; end if;
  if (select status from public.enrollments where servant_id = '00000000-0000-0000-0000-000000000007') <> 'active' then
    raise exception 'servant mirror must be active again';
  end if;

  -- scanner lookup exposes the status
  if (select status from public.lookup_enrollments_by_national_id('KID-1') limit 1) <> 'active' then
    raise exception 'lookup must expose status';
  end if;
end $$;

reset role;
rollback;
\echo 'STOP / DEFAULT PASSWORD TESTS PASSED'
