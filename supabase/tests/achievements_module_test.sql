-- =====================================================================
-- Functional test for migration 0031 (الإنجازات). Run on the local shim DB
-- after run_migrations.sh:  psql -d app -f supabase/tests/achievements_module_test.sql
-- Every "assert" raises on failure; a clean run ends with «ACHIEVEMENT TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

-- ---------- seed ----------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000002'),  -- class servant (class A)
  ('00000000-0000-0000-0000-000000000003'),  -- class servant (class B)
  ('00000000-0000-0000-0000-000000000004');  -- service manager
insert into public.churches (id, name) values ('10000000-0000-0000-0000-000000000001', 'كنيسة');
insert into public.services (id, church_id, name) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل ب');
insert into public.profiles (id, full_name, user_id, phone, role, status, church_id, service_id, class_id) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null),
  ('00000000-0000-0000-0000-000000000002', 'خادم أ', 'servant_a', '0101', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000003', 'خادم ب', 'servant_b', '0102', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000004', 'مسؤول الخدمة', 'svc_mgr', '0103', 'service_manager', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null);
insert into public.persons (id, national_id, name) values
  ('40000000-0000-0000-0000-000000000001', '29901010000001', 'مينا'),
  ('40000000-0000-0000-0000-000000000002', '29901010000002', 'مريم'),
  ('40000000-0000-0000-0000-000000000003', '29901010000003', 'يوسف');
-- 0042: the portal now needs a session token; for the legacy tests the raw code doubles as the token
insert into public.child_sessions (person_id, token_hash, expires_at)
select id, encode(digest(national_id, 'sha256'), 'hex'), now() + interval '1 day' from public.persons;

insert into public.enrollments (id, person_id, church_id, service_id, class_id, points) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 0),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 0),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 0);
-- a weekly event for class A + one church-wide event
insert into public.events (id, church_id, service_id, class_id, name, recurrence, weekdays, points) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'القداس', 'weekly', array[5]::smallint[], 2),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', null, null, 'رحلة', 'once', null, 0);

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('role', 'anon', true);
end $$;

-- ---------- 1. module NOT granted → nothing visible, no permissions, insert rejected ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  if (public.achievement_permissions()->>'view')::boolean then raise exception 'view without grant'; end if;
  begin
    insert into public.achievements (church_id, name, points) values ('10000000-0000-0000-0000-000000000001', 'x', 1);
    raise exception 'insert allowed without grant';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---------- 2. owner grants the module to the whole church + creates achievements ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.module_access (module_key, church_id) values ('achievements', '10000000-0000-0000-0000-000000000001');

-- normal · once · 50 pts · church-wide
insert into public.achievements (id, church_id, name, points, kind, award_mode) values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'أول مشاركة', 50, 'normal', 'once');
-- normal · multiple · max 2 · min 7 days · 10 pts · church-wide
insert into public.achievements (id, church_id, name, points, kind, award_mode, max_awards, min_interval_days) values
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'حضور ممتاز', 10, 'normal', 'multiple', 2, 7);
-- attendance · count 3 · once · class A · 20 pts
insert into public.achievements (id, church_id, service_id, class_id, name, points, kind, award_mode, attendance_rule, attendance_target) values
  ('70000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
   'ثلاث حضورات', 20, 'attendance', 'once', 'count', 3);
-- attendance · streak 4 · multiple unlimited · bound to event القداس · 30 pts
insert into public.achievements (id, church_id, service_id, class_id, event_id, name, points, kind, award_mode, attendance_rule, attendance_target) values
  ('70000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000001', 'المواظب', 30, 'attendance', 'multiple', 'streak', 4);
-- inactive attendance achievement (must never fire)
insert into public.achievements (id, church_id, name, points, kind, is_active, attendance_rule, attendance_target) values
  ('70000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'معطل', 99, 'attendance', false, 'count', 1);

-- validation constraints
do $$ begin
  begin
    insert into public.achievements (church_id, name, kind) values ('10000000-0000-0000-0000-000000000001', 'bad', 'attendance');
    raise exception 'attendance without rule accepted';
  exception when check_violation then null; end;
  begin
    insert into public.achievements (church_id, name, award_mode, max_awards) values ('10000000-0000-0000-0000-000000000001', 'bad', 'once', 3);
    raise exception 'once with max_awards accepted';
  exception when check_violation then null; end;
  begin
    -- event of class A bound to a class-B achievement → out of scope
    insert into public.achievements (church_id, service_id, class_id, event_id, name) values
      ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 'bad');
    raise exception 'event out of scope accepted';
  exception when others then
    if sqlerrm not like '%event_out_of_scope%' then raise; end if;
  end;
end $$;
reset role;

-- ---------- 3. RLS per role ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');   -- servant A
do $$ declare n int; p jsonb; begin
  select count(*) into n from public.achievements;
  if n <> 5 then raise exception 'servant A should see 5 achievements (3 church-wide + 2 class A), sees %', n; end if;
  p := public.achievement_permissions();
  if not (p->>'view')::boolean or not (p->>'create')::boolean or not (p->>'award')::boolean then raise exception 'servant permissions wrong: %', p; end if;
  if (p->>'delete')::boolean then raise exception 'class servant must not delete'; end if;
  begin
    insert into public.achievements (church_id, name) values ('10000000-0000-0000-0000-000000000001', 'church wide by servant');
    raise exception 'class servant wrote a church-wide achievement';
  exception when insufficient_privilege then null; end;
  insert into public.achievements (id, church_id, service_id, class_id, name, points) values
    ('70000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'إنجاز الفصل', 5);
  delete from public.achievements where id = '70000000-0000-0000-0000-000000000006';
  if not exists (select 1 from public.achievements where id = '70000000-0000-0000-0000-000000000006') then raise exception 'class servant deleted'; end if;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');   -- servant B
do $$ declare n int; begin
  select count(*) into n from public.achievements;
  if n <> 3 then raise exception 'servant B should see 3 church-wide achievements, sees %', n; end if;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');   -- service manager deletes
do $$ begin
  if not (public.achievement_permissions()->>'delete')::boolean then raise exception 'service manager must delete'; end if;
  delete from public.achievements where id = '70000000-0000-0000-0000-000000000006';
  if exists (select 1 from public.achievements where id = '70000000-0000-0000-0000-000000000006') then raise exception 'manager delete failed'; end if;
end $$;
reset role;

-- ---------- 4. manual award: once / multiple / interval / scope ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ declare r jsonb; begin
  r := public.achievement_award('70000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001');
  if (r->>'points')::int <> 50 or (r->>'balance_after')::int <> 50 then raise exception 'award result wrong: %', r; end if;
  begin
    perform public.achievement_award('70000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001');
    raise exception 'once awarded twice';
  exception when others then if sqlerrm not like '%already_awarded%' then raise; end if; end;
  r := public.achievement_award('70000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001');
  if (r->>'balance_after')::int <> 60 then raise exception 'balance after multiple #1: %', r; end if;
  begin
    perform public.achievement_award('70000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001');
    raise exception 'interval not enforced';
  exception when others then if sqlerrm not like '%too_soon%' then raise; end if; end;
  begin
    perform public.achievement_award('70000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003');
    raise exception 'cross-class award allowed';
  exception when others then if sqlerrm not like '%forbidden%' then raise; end if; end;
  begin
    insert into public.user_achievements (achievement_id, enrollment_id, person_id, church_id, service_id, class_id)
    values ('70000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002',
            '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
    raise exception 'direct award insert allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.user_achievements set awarded_at = now() - interval '8 days' where achievement_id = '70000000-0000-0000-0000-000000000002';
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  perform public.achievement_award('70000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001');
  begin
    perform public.achievement_award('70000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001');
    raise exception 'max_awards not enforced';
  exception when others then if sqlerrm not like '%max_reached%' then raise; end if; end;
  if (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000001') <> 70 then raise exception 'balance should be 70'; end if;
  if (select count(*) from public.user_achievements where enrollment_id = '50000000-0000-0000-0000-000000000001') <> 3 then raise exception 'expected 3 awards'; end if;
end $$;
reset role;

-- ---------- 5. automatic: count 3 (any event) + streak 4 (القداس, weekly) ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
insert into public.attendance_log (enrollment_id, event_id, points_delta, attended_on, recorded_by, created_at) values
  ('50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 2, '2026-01-02', '00000000-0000-0000-0000-000000000002', '2026-01-02 10:00+02');
insert into public.attendance_log (enrollment_id, event_id, points_delta, attended_on, recorded_by, created_at) values
  ('50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 2, '2026-01-09', '00000000-0000-0000-0000-000000000002', '2026-01-09 10:00+02');
do $$ begin
  if exists (select 1 from public.user_achievements where enrollment_id = '50000000-0000-0000-0000-000000000002') then raise exception 'awarded too early'; end if;
end $$;
insert into public.attendance_log (enrollment_id, event_id, points_delta, attended_on, recorded_by, created_at) values
  ('50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', 0, '2026-01-10', '00000000-0000-0000-0000-000000000002', '2026-01-10 10:00+02');
do $$ declare ua public.user_achievements; begin
  select * into ua from public.user_achievements where enrollment_id = '50000000-0000-0000-0000-000000000002' and achievement_id = '70000000-0000-0000-0000-000000000003';
  if ua.id is null then raise exception 'count achievement not awarded after 3 attendances'; end if;
  if ua.source <> 'attendance' or ua.points_awarded <> 20 or ua.attendance_log_id is null or ua.awarded_by <> '00000000-0000-0000-0000-000000000002' then raise exception 'auto award row wrong'; end if;
  if exists (select 1 from public.user_achievements where enrollment_id = '50000000-0000-0000-0000-000000000002' and achievement_id = '70000000-0000-0000-0000-000000000004') then raise exception 'streak fired early'; end if;
  if (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000002') <> 24 then
    raise exception 'balance expected 24, got %', (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000002'); end if;
  if exists (select 1 from public.user_achievements where achievement_id = '70000000-0000-0000-0000-000000000005') then raise exception 'inactive achievement fired'; end if;
end $$;
do $$ declare pr record; begin
  select * into pr from public.achievement_progress('70000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000002');
  if pr.current_value <> 2 or pr.target_value <> 4 or pr.eligible then raise exception 'streak progress wrong: % / %', pr.current_value, pr.target_value; end if;
end $$;
insert into public.attendance_log (enrollment_id, event_id, points_delta, attended_on, recorded_by, created_at) values
  ('50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 2, '2026-01-16', '00000000-0000-0000-0000-000000000002', '2026-01-16 10:00+02');
insert into public.attendance_log (enrollment_id, event_id, points_delta, attended_on, recorded_by, created_at) values
  ('50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 2, '2026-01-23', '00000000-0000-0000-0000-000000000002', '2026-01-23 10:00+02');
do $$ declare ua public.user_achievements; begin
  select * into ua from public.user_achievements where enrollment_id = '50000000-0000-0000-0000-000000000002' and achievement_id = '70000000-0000-0000-0000-000000000004';
  if ua.id is null then raise exception 'streak 4 not awarded'; end if;
  if ua.event_id <> '60000000-0000-0000-0000-000000000001' or ua.points_awarded <> 30 then raise exception 'streak award row wrong'; end if;
  if (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000002') <> 58 then
    raise exception 'balance expected 58, got %', (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000002'); end if;
end $$;
-- streak restarts after the award (multiple, unlimited): a gap > 7 days breaks it
insert into public.attendance_log (enrollment_id, event_id, points_delta, attended_on, recorded_by, created_at) values
  ('50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 2, '2026-01-30', '00000000-0000-0000-0000-000000000002', '2026-01-30 10:00+02');
insert into public.attendance_log (enrollment_id, event_id, points_delta, attended_on, recorded_by, created_at) values
  ('50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 2, '2026-02-20', '00000000-0000-0000-0000-000000000002', '2026-02-20 10:00+02');
do $$ declare pr record; begin
  select * into pr from public.achievement_progress('70000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000002');
  if pr.current_value <> 1 or pr.awards_count <> 1 then raise exception 'streak should have restarted at 1 (got %, awards %)', pr.current_value, pr.awards_count; end if;
end $$;
reset role;
-- a child of class B: the class-A achievements never apply (owner records it)
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.attendance_log (enrollment_id, event_id, points_delta, attended_on, recorded_by, created_at) values
  ('50000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000002', 0, '2026-01-10', '00000000-0000-0000-0000-000000000001', '2026-01-10 10:00+02');
do $$ begin
  if exists (select 1 from public.user_achievements where enrollment_id = '50000000-0000-0000-0000-000000000003') then raise exception 'class B child got a class A achievement'; end if;
end $$;
reset role;

-- ---------- 6. earners + per-enrollment progress RPCs ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ declare n int; begin
  select count(*) into n from public.achievement_earners('70000000-0000-0000-0000-000000000002');
  if n <> 2 then raise exception 'earners of حضور ممتاز should be 2, got %', n; end if;
  if (select person_name from public.achievement_earners('70000000-0000-0000-0000-000000000003') limit 1) <> 'مريم' then raise exception 'earner name wrong'; end if;
  select count(*) into n from public.achievement_enrollment_progress('50000000-0000-0000-0000-000000000002');
  if n <> 5 then raise exception 'enrollment progress should list 5 achievements, got %', n; end if;
  if (select block from public.achievement_enrollment_progress('50000000-0000-0000-0000-000000000002') where achievement_id = '70000000-0000-0000-0000-000000000003') <> 'already_awarded' then raise exception 'block should be already_awarded'; end if;
  if (select block from public.achievement_enrollment_progress('50000000-0000-0000-0000-000000000002') where achievement_id = '70000000-0000-0000-0000-000000000005') <> 'inactive' then raise exception 'block should be inactive'; end if;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');   -- servant B sees no class-A earners
do $$ begin
  if (select count(*) from public.achievement_earners('70000000-0000-0000-0000-000000000002')) <> 0 then raise exception 'servant B sees class A earners'; end if;
  if (select count(*) from public.user_achievements) <> 0 then raise exception 'servant B sees class A awards via RLS'; end if;
end $$;
reset role;

-- ---------- 7. revoke ----------
-- (servant B can't even SEE the award through RLS → pass its id explicitly)
create temp table t_award as select id from public.user_achievements where achievement_id = '70000000-0000-0000-0000-000000000001' limit 1;
grant select on t_award to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
do $$ begin
  begin
    perform public.achievement_revoke((select id from t_award));
    raise exception 'servant B revoked a class A award';
  exception when others then if sqlerrm not like '%forbidden%' then raise; end if; end;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
do $$ declare r jsonb; begin
  r := public.achievement_revoke((select id from public.user_achievements where achievement_id = '70000000-0000-0000-0000-000000000001' limit 1), 'خطأ');
  if (r->>'refunded')::int <> 50 or (r->>'balance_after')::int <> 20 then raise exception 'revoke result wrong: %', r; end if;
  if exists (select 1 from public.user_achievements where achievement_id = '70000000-0000-0000-0000-000000000001') then raise exception 'award row still there'; end if;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  perform public.achievement_award('70000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001');
  if (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000001') <> 70 then raise exception 'balance after re-award should be 70'; end if;
  perform public.achievement_revoke((select id from public.user_achievements where achievement_id = '70000000-0000-0000-0000-000000000001' limit 1));
  if (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000001') <> 20 then raise exception 'balance after self-revoke should be 20'; end if;
end $$;
reset role;

-- ---------- 8. child portal (anon) ----------
select pg_temp.as_anon();
do $$ declare j jsonb; n int; begin
  j := public.child_portal_achievements('29901010000002');   -- مريم
  if jsonb_array_length(j->'earned') <> 2 then raise exception 'مريم should have 2 earned, got %', j->'earned'; end if;
  if (j->'earned'->0->>'name') <> 'المواظب' then raise exception 'earned order wrong: %', j->'earned'->0; end if;
  if jsonb_array_length(j->'progress') <> 1 then raise exception 'progress list should have 1 item, got %', j->'progress'; end if;
  if (j->'progress'->0->>'current')::int <> 1 or (j->'progress'->0->>'target')::int <> 4 then raise exception 'progress values wrong: %', j->'progress'->0; end if;
  select count(*) into n from public.child_portal_points('29901010000002') where source = 'achievement';
  if n <> 2 then raise exception 'child points should show 2 achievement rows, got %', n; end if;
  -- (rows awarded in the same transaction share created_at → check the label, not the tie order)
  if not exists (select 1 from public.child_portal_points('29901010000002') where source = 'achievement' and reason like 'إنجاز%المواظب%') then raise exception 'achievement reason label wrong'; end if;
end $$;
reset role;
delete from public.module_access where module_key = 'achievements';
insert into public.module_access (module_key, church_id, service_id, class_id) values
  ('achievements', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');  -- class B only
select pg_temp.as_anon();
do $$ declare j jsonb; begin
  j := public.child_portal_achievements('29901010000002');
  if jsonb_array_length(j->'earned') <> 0 or jsonb_array_length(j->'progress') <> 0 then raise exception 'module gate ignored in child portal: %', j; end if;
end $$;
reset role;
-- the trigger does nothing where the module isn't granted
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
insert into public.attendance_log (enrollment_id, event_id, points_delta, attended_on, recorded_by, created_at) values
  ('50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 2, '2026-01-02', '00000000-0000-0000-0000-000000000002', '2026-01-02 10:00+02'),
  ('50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 2, '2026-01-09', '00000000-0000-0000-0000-000000000002', '2026-01-09 10:00+02'),
  ('50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 2, '2026-01-16', '00000000-0000-0000-0000-000000000002', '2026-01-16 10:00+02');
do $$ begin
  if exists (select 1 from public.user_achievements where enrollment_id = '50000000-0000-0000-0000-000000000001' and source = 'attendance') then raise exception 'auto award fired without module grant'; end if;
end $$;
reset role;

-- ---------- 9. realtime publication ----------
do $$ begin
  -- 0046: user_achievements moved to broadcast (zzz_rt_* triggers)
  -- 20261016: every table rides the broadcast bus (statement trigger), none in the publication
  if not exists (select 1 from pg_trigger where tgname = 'zzz_rt_ins' and tgrelid = 'public.achievements'::regclass) then
    raise exception 'achievements broadcast trigger missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'zzz_rt_ins' and tgrelid = 'public.user_achievements'::regclass) then
    raise exception 'user_achievements broadcast trigger missing';
  end if;
end $$;

select 'ACHIEVEMENT TESTS PASSED' as result;
rollback;
