-- Test for 20261016120000: scope_visible / my_scope_sets RLS (InitPlan),
-- stats_attendance_timeline rewrite, every table on the broadcast bus.
-- Run on a local DB built by tests/run_migrations.sh:
--   psql -h /tmp -p 5433 -U postgres -d app -v ON_ERROR_STOP=1 -f supabase/tests/rls_initplan_realtime_test.sql
begin;

-- Mock realtime.send → collect messages
create schema if not exists realtime;
create table if not exists realtime.messages (
  topic text, extension text, payload jsonb, private boolean, inserted_at timestamptz default now()
);
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean)
returns void language sql as $$
  insert into realtime.messages(topic, extension, payload, private) values (topic, event, payload, private)
$$;

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.as_super() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('role', 'postgres', true);
end $$;

-- ---------------------------------------------------------------------
-- Fixture: 2 churches · 3 services · 4 classes · 8 children · 6 servants
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000aa01', 'owner@t'),
  ('00000000-0000-0000-0000-00000000aa02', 'cm@t'),
  ('00000000-0000-0000-0000-00000000aa03', 'sm@t'),
  ('00000000-0000-0000-0000-00000000aa04', 'smc@t'),
  ('00000000-0000-0000-0000-00000000aa05', 'cs@t'),
  ('00000000-0000-0000-0000-00000000aa06', 'css@t'),
  ('00000000-0000-0000-0000-00000000aa07', 'pending@t');
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'C1'), ('10000000-0000-0000-0000-000000000002', 'C2');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'S1'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'S2'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'S3');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'K1'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'K2'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'K3'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', 'K4');
insert into public.servant_enrollments (id, role, status, full_name, user_id, phone, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-00000000aa01', 'owner',           'approved', 'Owner', 'o',  '0100', null, null, null, now()),
  ('00000000-0000-0000-0000-00000000aa02', 'church_manager',  'approved', 'CM',    'cm', '0101', '10000000-0000-0000-0000-000000000001', null, null, now()),
  ('00000000-0000-0000-0000-00000000aa03', 'service_manager', 'approved', 'SM',    'sm', '0102', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, now()),
  ('00000000-0000-0000-0000-00000000aa04', 'service_manager', 'approved', 'SMC',   'smc','0103', '10000000-0000-0000-0000-000000000002', null, null, now()),
  ('00000000-0000-0000-0000-00000000aa05', 'class_servant',   'approved', 'CS',    'cs', '0104', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now()),
  ('00000000-0000-0000-0000-00000000aa06', 'class_servant',   'approved', 'CSS',   'css','0105', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', null, now()),
  ('00000000-0000-0000-0000-00000000aa07', 'class_servant',   'pending',  'P',     'p',  '0106', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', null);
-- extra scope: CS also serves K3 (other service, same church)
insert into public.servant_scopes (servant_id, church_id, service_id, class_id) values
  ('00000000-0000-0000-0000-00000000aa05', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003');

insert into public.persons (id, national_id, name)
select ('40000000-0000-0000-0000-00000000000' || g)::uuid, 'N' || g, 'P' || g from generate_series(1, 8) g;
insert into public.enrollments (id, person_id, church_id, service_id, class_id)
select ('50000000-0000-0000-0000-00000000000' || g)::uuid, ('40000000-0000-0000-0000-00000000000' || g)::uuid,
       c.church_id, c.service_id, c.id
  from generate_series(1, 8) g
  join public.classes c on c.id = ('30000000-0000-0000-0000-00000000000' || (((g - 1) % 4) + 1))::uuid;
-- K1: e1,e5 · K2: e2,e6 · K3: e3,e7 · K4: e4,e8

insert into public.events (id, church_id, name, event_date, points) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'E1', current_date, 5),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'E2', current_date, 5);
insert into public.attendance_log (enrollment_id, event_id, points_delta, attended_on, recorded_by)
select e.id, case when e.church_id = '10000000-0000-0000-0000-000000000001' then '60000000-0000-0000-0000-000000000001' else '60000000-0000-0000-0000-000000000002' end::uuid,
       5, current_date - d, '00000000-0000-0000-0000-00000000aa01'
  from public.enrollments e cross join generate_series(0, 2) d;
-- 8 enrollments × 3 days = 24 rows

-- ---------------------------------------------------------------------
-- 1. Visibility per role — exact enrollment sets (old semantics)
-- ---------------------------------------------------------------------
create or replace function pg_temp.vis(u text) returns text language plpgsql as $$
declare got text;
begin
  perform pg_temp.as_user(u);
  select coalesce(string_agg(right(id::text, 1), '' order by id), '') into got from public.enrollments where id::text like '50000000-0000-0000-0000-00000000000%';
  perform pg_temp.as_super();
  return got;
end $$;
do $$
declare u text; want text; got text;
begin
  for u, want in select * from (values
    ('00000000-0000-0000-0000-00000000aa01', '12345678'),  -- owner: all
    ('00000000-0000-0000-0000-00000000aa02', '123567'),    -- CM C1: all but K4 (4,8)
    ('00000000-0000-0000-0000-00000000aa03', '1256'),      -- SM S1: K1+K2
    ('00000000-0000-0000-0000-00000000aa04', '48'),        -- SM whole church C2: K4
    ('00000000-0000-0000-0000-00000000aa05', '1357'),      -- CS K1 + extra K3
    ('00000000-0000-0000-0000-00000000aa06', '37'),        -- CS whole service S2: K3
    ('00000000-0000-0000-0000-00000000aa07', '')           -- pending: nothing
  ) v(u, w) loop
    got := pg_temp.vis(u);
    if got <> want then raise exception 'user % sees "%", expected "%"', right(u, 2), got, want; end if;
  end loop;
  raise notice 'visibility per role OK';
end $$;

-- the arrays behind it
do $$
declare r record;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000aa05');
  select * into r from public.my_scope_sets();
  perform pg_temp.as_super();
  if r.is_owner then raise exception 'cs is_owner'; end if;
  if r.churches is not null then raise exception 'cs churches should be null, got %', r.churches; end if;
  if r.services is not null then raise exception 'cs services should be null, got %', r.services; end if;
  if r.classes is distinct from array['30000000-0000-0000-0000-000000000001'::uuid, '30000000-0000-0000-0000-000000000003'::uuid]
     and r.classes is distinct from array['30000000-0000-0000-0000-000000000003'::uuid, '30000000-0000-0000-0000-000000000001'::uuid] then
    raise exception 'cs classes = %', r.classes;
  end if;
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000aa04');
  select * into r from public.my_scope_sets();
  perform pg_temp.as_super();
  if r.churches is distinct from array['10000000-0000-0000-0000-000000000002'::uuid] then raise exception 'smc churches = %', r.churches; end if;
  raise notice 'my_scope_sets OK';
end $$;

-- the policies no longer call the per-row path, and the InitPlan shape is used
do $$
declare n int;
begin
  select count(*) into n from pg_policies where schemaname = 'public'
    and (qual ilike '%enrollment_visible(%' or with_check ilike '%enrollment_visible(%');
  if n <> 0 then raise exception '% policies still use enrollment_visible', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public'
    and (qual ilike '%scope_visible(%' or with_check ilike '%scope_visible(%');
  if n < 30 then raise exception 'only % policies use scope_visible', n; end if;
  raise notice 'policies rewritten (%)', n;
end $$;

-- dependent tables follow (attendance_log via enrollments)
do $$
declare n int;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000aa05');
  select count(*) into n from public.attendance_log where enrollment_id::text like '50000000-0000-0000-0000-00000000000%';
  perform pg_temp.as_super();
  if n <> 12 then raise exception 'cs attendance rows = %, expected 12 (4 enrollments × 3 days)', n; end if;
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000aa07');
  select count(*) into n from public.attendance_log;
  perform pg_temp.as_super();
  if n <> 0 then raise exception 'pending sees % attendance rows', n; end if;
  -- insert check still enforced
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000aa05');
  begin
    insert into public.attendance_log (enrollment_id, event_id, points_delta, attended_on, recorded_by)
    values ('50000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000002', 5, current_date, '00000000-0000-0000-0000-00000000aa05');
    raise exception 'cs inserted attendance outside scope';
  exception when insufficient_privilege or check_violation then null;
  end;
  perform pg_temp.as_super();
  raise notice 'dependent RLS OK';
end $$;

-- ---------------------------------------------------------------------
-- 2. stats_attendance_timeline — same numbers as a direct scoped query
-- ---------------------------------------------------------------------
create or replace function pg_temp.tl(u text, out att bigint, out pts bigint, out rows_n int) language plpgsql as $$
begin
  perform pg_temp.as_user(u);
  select coalesce(sum(attendance), 0), coalesce(sum(points), 0), count(*) into att, pts, rows_n
    from public.stats_attendance_timeline(current_date - 2, current_date, 'day');
  perform pg_temp.as_super();
end $$;
do $$
declare r record; t record; u text; want_att bigint; want_rows int; att bigint;
begin
  for u, want_att, want_rows in select * from (values
    ('00000000-0000-0000-0000-00000000aa01', 24::bigint, 6), -- owner: 3 days × 2 events
    ('00000000-0000-0000-0000-00000000aa02', 18::bigint, 3), -- CM C1: 6 enrollments × 3 days, 1 event
    ('00000000-0000-0000-0000-00000000aa05', 12::bigint, 3), -- CS: 4 × 3
    ('00000000-0000-0000-0000-00000000aa04', 6::bigint, 3),  -- SMC: 2 × 3
    ('00000000-0000-0000-0000-00000000aa07', 0::bigint, 0)   -- pending
  ) v(u, a, n) loop
    t := pg_temp.tl(u);
    if t.att <> want_att then raise exception 'user % timeline attendance = %, expected %', right(u, 2), t.att, want_att; end if;
    if t.pts <> want_att * 5 then raise exception 'user % points = %', right(u, 2), t.pts; end if;
    if t.rows_n <> want_rows then raise exception 'user % rows = %, expected %', right(u, 2), t.rows_n, want_rows; end if;
  end loop;
  -- event names + week bucket
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000aa01');
  select * into r from public.stats_attendance_timeline(current_date - 2, current_date, 'week') limit 1;
  perform pg_temp.as_super();
  if r.event_name not in ('E1', 'E2') then raise exception 'event name = %', r.event_name; end if;
  -- explicit scope filter still applies
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000aa01');
  select coalesce(sum(attendance), 0) into att from public.stats_attendance_timeline(current_date - 2, current_date, 'day', null, null, '30000000-0000-0000-0000-000000000004');
  perform pg_temp.as_super();
  if att <> 6 then raise exception 'class filter attendance = %', att; end if;
  raise notice 'timeline OK';
end $$;

-- ---------------------------------------------------------------------
-- 3. Every table on the bus · publication empty · messages per statement
-- ---------------------------------------------------------------------
do $$
declare n int; t text;
begin
  select count(*) into n from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public';
  if n <> 0 then raise exception '% tables still in supabase_realtime', n; end if;
  foreach t in array array['events', 'causes', 'call_feedbacks', 'churches', 'services', 'classes', 'occasions',
                           'exams', 'online_classes', 'store_items', 'data_change_requests', 'child_join_requests',
                           'shepherd_groups', 'notifications', 'birthday_greetings', 'library_books'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    if not exists (select 1 from pg_trigger where tgname = 'zzz_rt_ins' and tgrelid = ('public.' || t)::regclass) then
      raise exception 'no bus trigger on %', t;
    end if;
  end loop;
  raise notice 'bus coverage OK';
end $$;

-- scoped-nullable: a church-bound row → scope:all + its church only
delete from realtime.messages;
insert into public.causes (id, church_id, name, points) values ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Cause', 3);
do $$
declare n int;
begin
  select count(*) into n from realtime.messages where payload->>'t' = 'causes';
  if n <> 2 then raise exception 'causes: expected 2 messages (all + C1), got %', n; end if;
  if exists (select 1 from realtime.messages where payload->>'t' = 'causes' and topic = 'scope:church:10000000-0000-0000-0000-000000000002') then
    raise exception 'causes: leaked to C2';
  end if;
  if not exists (select 1 from realtime.messages where payload->>'t' = 'causes' and (payload->'ids') ? '70000000-0000-0000-0000-000000000001') then
    raise exception 'causes: ids missing';
  end if;
end $$;

-- global (no church_id): every church + scope:all
delete from realtime.messages;
update public.churches set name = name || '!' where id = '10000000-0000-0000-0000-000000000001';
do $$
declare n int;
begin
  select count(*) into n from realtime.messages where payload->>'t' = 'churches';
  if n <> 3 then raise exception 'churches: expected 3 messages (all + 2 churches), got %', n; end if;
end $$;

-- bulk statement → still one message per topic
delete from realtime.messages;
update public.events set points = 6;
do $$
declare n int;
begin
  select count(*) into n from realtime.messages where payload->>'t' = 'events';
  if n <> 3 then raise exception 'events bulk update: expected 3 messages, got %', n; end if;
  if (select (payload->>'n')::int from realtime.messages where payload->>'t' = 'events' and topic = 'scope:all') <> 2 then
    raise exception 'events: n should be 2';
  end if;
end $$;


do $$ begin raise notice 'RLS INITPLAN / REALTIME CONSOLIDATION TESTS PASSED'; end $$;
rollback;
