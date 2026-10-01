-- =====================================================================
-- Test for migration 20261007120000:
--   1. activity_log RLS evaluated once per statement — every role still
--      sees exactly the rows activity_row_visible() allowed before, and
--      activity_summary / activity_feed finish fast on a big log.
--   2. signup_invites: token stored & readable by the creator / owner
--      only · signup_invite_update · signup_invite_delete · delete policy.
-- Run on the local shim DB after run_migrations.sh:
--   psql -d app -f supabase/tests/activity_rls_fast_invites_editable_test.sql
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
begin;

-- ---------- seed (same shape as activity_log_test) ----------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000002'),  -- class servant A (no permission)
  ('00000000-0000-0000-0000-000000000003'),  -- class servant B (activity.view)
  ('00000000-0000-0000-0000-000000000004'),  -- service manager
  ('00000000-0000-0000-0000-000000000005'),  -- church manager of church 2
  ('00000000-0000-0000-0000-000000000006');  -- servant of church 2 (actor only)
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة ١'),
  ('10000000-0000-0000-0000-000000000002', 'كنيسة ٢');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'مدارس الأحد ٢');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل ب'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'فصل ج');
insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null),
  ('00000000-0000-0000-0000-000000000002', 'خادم أ', 'servant_a', '0101', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000003', 'خادم ب', 'servant_b', '0102', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000004', 'مسؤول الخدمة', 'svc_mgr', '0103', 'service_manager', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null),
  ('00000000-0000-0000-0000-000000000005', 'مدير كنيسة ٢', 'ch2_mgr', '0104', 'church_manager', 'approved',
     '10000000-0000-0000-0000-000000000002', null, null),
  ('00000000-0000-0000-0000-000000000006', 'خادم ج', 'servant_c', '0105', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003');
insert into public.permission_profiles (id, name, permissions) values
  ('70000000-0000-0000-0000-000000000001', 'سجل النشاط', array['activity.view']);
insert into public.permissions (servant_id, permission_profile_id) values
  ('00000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000001');
insert into public.module_access (module_key, church_id) values ('activity', null);

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
create or replace function pg_temp.as_super() returns void language plpgsql as $$
begin perform set_config('role', 'postgres', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $$;

-- wipe the seed noise, then a controlled log
select set_config('app.audit_off', '1', true);
delete from public.activity_log;
insert into public.activity_log (created_at, actor_kind, actor_id, actor_name, actor_role, table_name, op, action, church_id, service_id, class_id, source) values
  -- church 1 · service 1 · class A  (servant A acting)
  (now() - interval '1 minute', 'servant', '00000000-0000-0000-0000-000000000002', 'خادم أ', 'class_servant', 'attendance_log', 'INSERT', 'attendance.add',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'app'),
  -- church 1 · service 1 · class B
  (now() - interval '2 minutes', 'servant', '00000000-0000-0000-0000-000000000002', 'خادم أ', 'class_servant', 'attendance_log', 'INSERT', 'attendance.add',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'app'),
  -- church 1 · service level (no class)
  (now() - interval '3 minutes', 'servant', '00000000-0000-0000-0000-000000000004', 'مسؤول الخدمة', 'service_manager', 'events', 'INSERT', 'event.add',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, 'db'),
  -- church 2 · class C
  (now() - interval '4 minutes', 'servant', '00000000-0000-0000-0000-000000000006', 'خادم ج', 'class_servant', 'attendance_log', 'INSERT', 'attendance.add',
     '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', 'app'),
  -- no church · made by servant of church 2
  (now() - interval '5 minutes', 'servant', '00000000-0000-0000-0000-000000000006', 'خادم ج', 'class_servant', 'app', 'EVENT', 'auth.login', null, null, null, 'app'),
  -- no church · made by servant of church 1
  (now() - interval '6 minutes', 'servant', '00000000-0000-0000-0000-000000000002', 'خادم أ', 'class_servant', 'app', 'EVENT', 'auth.login', null, null, null, 'app'),
  -- no church · system
  (now() - interval '7 minutes', 'system', null, null, 'system', 'app', 'EVENT', 'activity.prune', null, null, null, 'system');

-- ---------- 1a. truth table: same as activity_row_visible() per role ----------
create or replace function pg_temp.visible_count() returns bigint language sql as $$ select count(*) from public.activity_log $$;
create or replace function pg_temp.legacy_count() returns bigint language sql as $$
  select count(*) from public.activity_log where public.activity_row_visible(church_id, service_id, class_id, actor_kind, actor_id)
$$;

do $$
declare n bigint;
begin
  -- owner → 7
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000001');
  select pg_temp.visible_count() into n; if n <> 7 then raise exception 'owner must see 7, got %', n; end if;
  if (select (public.activity_summary('{}'::jsonb))->>'total')::int <> 7 then raise exception 'owner summary total'; end if;

  -- class servant A: no permission → 0
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000002');
  select pg_temp.visible_count() into n; if n <> 0 then raise exception 'servant A (no permission) must see 0, got %', n; end if;
  if (select (public.activity_summary('{}'::jsonb))->>'total')::int <> 0 then raise exception 'servant A summary must be 0'; end if;

  -- class servant B (activity.view, class B): class B row + service-level row (class unset) = 2
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000003');
  select pg_temp.visible_count() into n; if n <> 2 then raise exception 'servant B must see 2, got %', n; end if;
  if pg_temp.visible_count() <> pg_temp.legacy_count() then raise exception 'servant B: policy and activity_row_visible disagree'; end if;
  if (select count(*) from public.activity_feed('{}'::jsonb, 100)) <> 2 then raise exception 'servant B feed'; end if;
  if (select (public.activity_summary('{}'::jsonb))->>'total')::int <> 2 then raise exception 'servant B summary'; end if;
  if (select count(*) from public.activity_actors('{}'::jsonb)) <> 2 then raise exception 'servant B actors'; end if;
  if exists (select 1 from public.activity_log where class_id = '30000000-0000-0000-0000-000000000001') then raise exception 'servant B must not see class A'; end if;
  if exists (select 1 from public.activity_log where church_id is null) then raise exception 'servant B must not see church-less rows'; end if;

  -- service manager (church 1 · service 1): 3 rows of his service (view is implicit for service managers)
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000004');
  select pg_temp.visible_count() into n; if n <> 3 then raise exception 'service manager must see 3, got %', n; end if;
  if pg_temp.visible_count() <> pg_temp.legacy_count() then raise exception 'service manager: policy and activity_row_visible disagree'; end if;
  if exists (select 1 from public.activity_log where church_id = '10000000-0000-0000-0000-000000000002') then raise exception 'service manager must not see church 2'; end if;

  -- church manager 2: church 2 row + church-less row by servant of church 2 = 2 (not church 1's, not system)
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000005');
  select pg_temp.visible_count() into n; if n <> 2 then raise exception 'church manager 2 must see 2, got %', n; end if;
  if pg_temp.visible_count() <> pg_temp.legacy_count() then raise exception 'church manager: policy and activity_row_visible disagree'; end if;
  if not exists (select 1 from public.activity_log where church_id is null and actor_id = '00000000-0000-0000-0000-000000000006') then raise exception 'church manager must see his servant''s church-less row'; end if;
  if exists (select 1 from public.activity_log where church_id is null and actor_id = '00000000-0000-0000-0000-000000000002') then raise exception 'church manager must not see church 1 servant rows'; end if;
  if (select (public.activity_summary('{}'::jsonb))->>'total')::int <> 2 then raise exception 'church manager summary'; end if;

  -- anon → nothing
  perform pg_temp.as_anon();
  if (select count(*) from public.activity_log) <> 0 then raise exception 'anon must see nothing'; end if;
  perform pg_temp.as_super();
end $$;

-- ---------- 1b. speed: 20k rows, summary as a class servant must be sub-second ----------
insert into public.activity_log (created_at, actor_kind, actor_id, actor_name, actor_role, table_name, op, action, church_id, service_id, class_id, source)
select now() - (g || ' seconds')::interval, 'servant', '00000000-0000-0000-0000-000000000002', 'خادم أ', 'class_servant', 'attendance_log', 'INSERT', 'attendance.add',
  '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'app'
from generate_series(1, 20000) g;
analyze public.activity_log;
do $$
declare t0 timestamptz; ms numeric; n int;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000003');
  t0 := clock_timestamp();
  select ((public.activity_summary('{}'::jsonb))->>'total')::int into n;
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  if n <> 20002 then raise exception 'servant B must see 20002 after bulk, got %', n; end if;
  if ms > 5000 then raise exception 'activity_summary too slow for a servant: % ms', ms; end if;
  t0 := clock_timestamp();
  perform count(*) from public.activity_feed('{}'::jsonb, 100);
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  if ms > 2000 then raise exception 'activity_feed too slow for a servant: % ms', ms; end if;
  raise notice 'servant summary over 20k rows OK';
  perform pg_temp.as_super();
end $$;

-- ---------- 2. invites: token stored · update · delete ----------
do $$
declare inv jsonb; inv2 jsonb; r public.signup_invites; ok boolean := false; t text;
begin
  -- service manager creates a servant invite
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000004');
  inv := public.signup_invite_create('servant', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, 7, 20, 'للخدام');
  -- the token is readable again by its creator
  select token into t from public.signup_invites where id = (inv->>'id')::uuid;
  if t is null or t <> inv->>'token' then raise exception 'creator must read the stored token'; end if;
  -- update validity / uses / note
  r := public.signup_invite_update((inv->>'id')::uuid, 30, 5, false, 'ملاحظة جديدة', false);
  if r.max_uses <> 5 or r.note <> 'ملاحظة جديدة' then raise exception 'update fields'; end if;
  if r.expires_at < now() + interval '29 days' then raise exception 'update expiry'; end if;
  if r.updated_at is null then raise exception 'updated_at'; end if;
  if r.token <> inv->>'token' then raise exception 'token must survive the update'; end if;
  -- unlimited uses
  r := public.signup_invite_update((inv->>'id')::uuid, null, null, true, null, false);
  if r.max_uses is not null then raise exception 'clear max uses'; end if;
  -- revoke then reactivate
  update public.signup_invites set revoked_at = now() where id = (inv->>'id')::uuid;
  if (public.signup_invite_check(inv->>'token', 'servant')->>'valid')::boolean then raise exception 'revoked must be invalid'; end if;
  r := public.signup_invite_update((inv->>'id')::uuid, null, null, false, null, true);
  if r.revoked_at is not null then raise exception 'reactivate'; end if;
  if not (public.signup_invite_check(inv->>'token', 'servant')->>'valid')::boolean then raise exception 'reactivated must be valid'; end if;

  -- another servant (class servant B) cannot read / update / delete it
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000003');
  if exists (select 1 from public.signup_invites where id = (inv->>'id')::uuid) then raise exception 'foreign invite must be hidden'; end if;
  ok := false;
  begin perform public.signup_invite_update((inv->>'id')::uuid, 3, null, false, null, false);
  exception when others then ok := sqlerrm like '%forbidden%'; end;
  if not ok then raise exception 'foreign update must be refused'; end if;
  ok := false;
  begin perform public.signup_invite_delete((inv->>'id')::uuid);
  exception when others then ok := sqlerrm like '%forbidden%'; end;
  if not ok then raise exception 'foreign delete must be refused'; end if;
  delete from public.signup_invites where id = (inv->>'id')::uuid;   -- policy: 0 rows, no error
  perform pg_temp.as_super();
  if not exists (select 1 from public.signup_invites where id = (inv->>'id')::uuid) then raise exception 'policy must block foreign delete'; end if;

  -- the owner reads every token and may edit / delete
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000001');
  select token into t from public.signup_invites where id = (inv->>'id')::uuid;
  if t <> inv->>'token' then raise exception 'owner must read the token'; end if;
  r := public.signup_invite_update((inv->>'id')::uuid, null, 50, false, null, false);
  if r.max_uses <> 50 then raise exception 'owner update'; end if;
  inv2 := public.signup_invite_create('priest', null, null, null, 3, 1, 'أبونا');
  perform public.signup_invite_delete((inv2->>'id')::uuid);
  perform pg_temp.as_super();
  if exists (select 1 from public.signup_invites where id = (inv2->>'id')::uuid) then raise exception 'owner delete'; end if;

  -- the creator deletes his own invite through the table (policy)
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000004');
  delete from public.signup_invites where id = (inv->>'id')::uuid;
  perform pg_temp.as_super();
  if exists (select 1 from public.signup_invites where id = (inv->>'id')::uuid) then raise exception 'creator delete through policy'; end if;

  -- anon: no token, no rows
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000001');
  inv := public.signup_invite_create('servant', null, null, null, 7, null, null);
  perform pg_temp.as_anon();
  ok := false;
  begin perform token from public.signup_invites; exception when others then ok := true; end;
  if not ok then raise exception 'anon must not read tokens'; end if;
  if not (public.signup_invite_check(inv->>'token', 'servant')->>'valid')::boolean then raise exception 'anon check still works'; end if;
  perform pg_temp.as_super();
end $$;

\echo ACTIVITY RLS FAST / INVITES EDITABLE TESTS PASSED
rollback;
