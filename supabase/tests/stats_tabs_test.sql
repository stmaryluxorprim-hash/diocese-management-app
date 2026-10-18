-- =====================================================================
-- Functional test for 20261018120000 (statistics tabs — calls /
-- attendance / points period analytics).
--   psql -d app -f supabase/tests/stats_tabs_test.sql
-- Ends with «STATS TABS TESTS PASSED».
--
-- Fixture: one church, one service, two classes (أ · ب), a weekly event
-- on every weekday, one feedback «مريض», an owner, a class servant of أ
-- and a class servant of ب. Four children: two in أ, two in ب.
--   day D-2: مينا (أ) and كيرلس (ب) attended; نادي (أ) got +3 by cause.
--   day D-1: مينا attended again.
--   calls: servant أ dialed نادي (D-1) and recorded feedback «مريض» (D);
--          servant أ wrote «أخرى» for نادي (D); servant ب dialed مريم (D)
--          and sent her a whatsapp (D). كيرلس was never called.
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000006'),  -- class servant أ
  ('00000000-0000-0000-0000-000000000007');  -- class servant ب
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
insert into public.causes (id, church_id, name, points) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'حفظ آية', 3);
insert into public.call_feedbacks (id, church_id, name, color, icon) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مريض', '#ef4444', 'thermometer');

-- ---------- seed as owner ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local request.jwt.claim.role = 'authenticated';

create temp table ids (k text primary key, v uuid);
do $$
declare r jsonb;
begin
  r := public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'مينا', 'KID-1', 'male', null, '+201000000001');
  insert into ids values ('mina', (r->>'enrollment_id')::uuid);
  r := public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'نادي', 'KID-2', 'male', null, '+201000000002');
  insert into ids values ('nady', (r->>'enrollment_id')::uuid);
  r := public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'كيرلس', 'KID-3', 'male', null, '+201000000003');
  insert into ids values ('kyrillos', (r->>'enrollment_id')::uuid);
  r := public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'مريم', 'KID-4', 'female', null, '+201000000004');
  insert into ids values ('mariam', (r->>'enrollment_id')::uuid);
end $$;

-- log rows are seeded as superuser (the insert policies require
-- recorded_by = auth.uid(); here we deliberately mix two recorders)
reset role;
insert into public.attendance_log (enrollment_id, event_id, points_delta, recorded_by, attended_on, created_at)
select v, '40000000-0000-0000-0000-000000000001', 5, '00000000-0000-0000-0000-000000000006', current_date - 2, ((current_date - 2)::timestamp + time '10:30') at time zone 'Africa/Cairo' from ids where k = 'mina';
insert into public.attendance_log (enrollment_id, event_id, points_delta, recorded_by, attended_on, created_at)
select v, '40000000-0000-0000-0000-000000000001', 5, '00000000-0000-0000-0000-000000000007', current_date - 2, ((current_date - 2)::timestamp + time '10:45') at time zone 'Africa/Cairo' from ids where k = 'kyrillos';
insert into public.attendance_log (enrollment_id, event_id, points_delta, recorded_by, attended_on, created_at)
select v, '40000000-0000-0000-0000-000000000001', 5, '00000000-0000-0000-0000-000000000006', current_date - 1, ((current_date - 1)::timestamp + time '11:05') at time zone 'Africa/Cairo' from ids where k = 'mina';

-- cause points
insert into public.points_log (enrollment_id, cause_id, event_id, delta, recorded_by, created_at)
select v, '60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 3, '00000000-0000-0000-0000-000000000006', ((current_date - 2)::timestamp + time '12:00') at time zone 'Africa/Cairo' from ids where k = 'nady';
insert into public.points_log (enrollment_id, cause_id, event_id, delta, recorded_by, created_at)
select v, '60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', -1, '00000000-0000-0000-0000-000000000007', ((current_date - 1)::timestamp + time '12:00') at time zone 'Africa/Cairo' from ids where k = 'mariam';

-- calls / messages
insert into public.contact_log (enrollment_id, event_id, kind, recorded_by, contacted_on, created_at)
select v, '40000000-0000-0000-0000-000000000001', 'call', '00000000-0000-0000-0000-000000000006', current_date - 1, now() - interval '1 day' from ids where k = 'nady';
insert into public.contact_log (enrollment_id, event_id, kind, occurrence_on, feedback_id, recorded_by, contacted_on, created_at)
select v, '40000000-0000-0000-0000-000000000001', 'call', current_date - 1, '50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000006', current_date, now() - interval '2 hours' from ids where k = 'nady';
insert into public.contact_log (enrollment_id, event_id, kind, occurrence_on, note, recorded_by, contacted_on, created_at)
select v, '40000000-0000-0000-0000-000000000001', 'call', current_date - 1, 'سافر', '00000000-0000-0000-0000-000000000006', current_date, now() - interval '1 hour' from ids where k = 'nady';
insert into public.contact_log (enrollment_id, event_id, kind, recorded_by, contacted_on, created_at)
select v, '40000000-0000-0000-0000-000000000001', 'call', '00000000-0000-0000-0000-000000000007', current_date, now() - interval '30 minutes' from ids where k = 'mariam';
insert into public.contact_log (enrollment_id, event_id, kind, message, recorded_by, contacted_on, created_at)
select v, '40000000-0000-0000-0000-000000000001', 'whatsapp', 'مرحبا', '00000000-0000-0000-0000-000000000007', current_date, now() - interval '20 minutes' from ids where k = 'mariam';

-- =====================================================================
-- OWNER — sees everything
-- =====================================================================
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local request.jwt.claim.role = 'authenticated';
do $$
declare r record; n int; f date := current_date - 6; t date := current_date;
begin
  -- ---------- calls summary ----------
  select * into r from public.stats_calls_summary(f, t);
  if r.calls <> 4 then raise exception 'calls: expected 4 got %', r.calls; end if;
  if r.dials <> 2 then raise exception 'dials: expected 2 got %', r.dials; end if;
  if r.feedbacks <> 2 then raise exception 'feedbacks: expected 2 got %', r.feedbacks; end if;
  if r.other_feedbacks <> 1 then raise exception 'other: expected 1 got %', r.other_feedbacks; end if;
  if r.persons_called <> 2 then raise exception 'persons_called: expected 2 got %', r.persons_called; end if;
  if r.messages <> 1 then raise exception 'messages: expected 1 got %', r.messages; end if;
  if r.servants <> 2 then raise exception 'servants: expected 2 got %', r.servants; end if;
  if r.scope_persons <> 4 then raise exception 'scope_persons: expected 4 got %', r.scope_persons; end if;
  if r.absentees <> 2 then raise exception 'absentees: expected 2 (نادي · مريم) got %', r.absentees; end if;
  if r.absentees_called <> 2 then raise exception 'absentees_called: expected 2 got %', r.absentees_called; end if;
  if r.attendees_called <> 0 then raise exception 'attendees_called: expected 0 got %', r.attendees_called; end if;

  -- ---------- by servant ----------
  select count(*) into n from public.stats_calls_by_servant(f, t);
  if n <> 2 then raise exception 'by_servant rows: expected 2 got %', n; end if;
  select * into r from public.stats_calls_by_servant(f, t) where servant_id = '00000000-0000-0000-0000-000000000006';
  if r.calls <> 3 or r.persons_called <> 1 or r.feedbacks <> 2 or r.other_feedbacks <> 1 or r.messages <> 0 then
    raise exception 'servant أ: calls % persons % feedbacks % other % messages %', r.calls, r.persons_called, r.feedbacks, r.other_feedbacks, r.messages;
  end if;
  if r.servant_name <> 'خادم أ' or r.class_name <> 'فصل أ' then raise exception 'servant أ naming wrong: % / %', r.servant_name, r.class_name; end if;
  select * into r from public.stats_calls_by_servant(f, t) where servant_id = '00000000-0000-0000-0000-000000000007';
  if r.calls <> 1 or r.messages <> 1 then raise exception 'servant ب: calls % messages %', r.calls, r.messages; end if;

  -- ---------- by class ----------
  select * into r from public.stats_calls_by_class(f, t) where class_id = '30000000-0000-0000-0000-000000000001';
  if r.enrolled <> 2 or r.absentees <> 1 or r.calls <> 3 or r.persons_called <> 1 or r.absentees_called <> 1 or r.feedbacks <> 2 then
    raise exception 'class أ: enrolled % absentees % calls % persons % abs_called % fb %', r.enrolled, r.absentees, r.calls, r.persons_called, r.absentees_called, r.feedbacks;
  end if;
  select * into r from public.stats_calls_by_class(f, t) where class_id = '30000000-0000-0000-0000-000000000002';
  if r.enrolled <> 2 or r.absentees <> 1 or r.calls <> 1 or r.messages <> 1 or r.feedbacks <> 0 then
    raise exception 'class ب: enrolled % absentees % calls % messages % fb %', r.enrolled, r.absentees, r.calls, r.messages, r.feedbacks;
  end if;

  -- ---------- by feedback ----------
  select count(*) into n from public.stats_calls_by_feedback(f, t);
  if n <> 3 then raise exception 'by_feedback rows: expected 3 (مريض · أخرى · بدون) got %', n; end if;
  select * into r from public.stats_calls_by_feedback(f, t) where feedback_kind = 'feedback';
  if r.feedback_name <> 'مريض' or r.entries <> 1 or r.color <> '#ef4444' then raise exception 'feedback row wrong'; end if;
  select * into r from public.stats_calls_by_feedback(f, t) where feedback_kind = 'none';
  if r.entries <> 2 then raise exception 'none feedback: expected 2 got %', r.entries; end if;

  -- ---------- timeline ----------
  select coalesce(sum(calls), 0) into n from public.stats_calls_timeline(f, t, 'day');
  if n <> 4 then raise exception 'timeline calls sum: expected 4 got %', n; end if;
  select count(*) into n from public.stats_calls_timeline(f, t, 'month');
  if n < 1 or n > 2 then raise exception 'month buckets: %', n; end if;

  -- ---------- persons ----------
  select count(*) into n from public.stats_calls_persons(f, t, p_only => 'all');
  if n <> 4 then raise exception 'persons all: expected 4 got %', n; end if;
  select count(*) into n from public.stats_calls_persons(f, t, p_only => 'called');
  if n <> 2 then raise exception 'persons called: expected 2 got %', n; end if;
  select count(*) into n from public.stats_calls_persons(f, t, p_only => 'not_called');
  if n <> 2 then raise exception 'persons not_called: expected 2 got %', n; end if;
  select count(*) into n from public.stats_calls_persons(f, t, p_only => 'absent_not_called');
  if n <> 0 then raise exception 'absent_not_called: expected 0 got %', n; end if;
  select * into r from public.stats_calls_persons(f, t, p_only => 'called') where name = 'نادي';
  if r.calls <> 3 or r.feedbacks <> 2 or r.last_caller <> 'خادم أ' or r.last_feedback <> 'سافر' or r.last_feedback_color <> '#f97316' then
    raise exception 'نادي row: calls % fb % caller % last %', r.calls, r.feedbacks, r.last_caller, r.last_feedback;
  end if;

  -- event filter — a different event → nothing
  select * into r from public.stats_calls_summary(f, t, p_event => gen_random_uuid());
  if r.calls <> 0 or r.scope_persons <> 0 then raise exception 'unknown event must yield empty scope'; end if;
  select * into r from public.stats_calls_summary(f, t, p_event => '40000000-0000-0000-0000-000000000001');
  if r.calls <> 4 then raise exception 'event filter lost rows'; end if;

  -- ---------- attendance period ----------
  select * into r from public.stats_attendance_period_summary(f, t);
  if r.attendance <> 3 or r.attendees <> 2 or r.scope_persons <> 4 or r.never_attended <> 2 or r.days_with_attendance <> 2 then
    raise exception 'att summary: rows % attendees % scope % never % days %', r.attendance, r.attendees, r.scope_persons, r.never_attended, r.days_with_attendance;
  end if;
  if r.expected_occurrences <> 7 then raise exception 'expected_occurrences: expected 7 got %', r.expected_occurrences; end if;
  if r.best_day <> current_date - 2 or r.best_day_count <> 2 then raise exception 'best day wrong: % (%)', r.best_day, r.best_day_count; end if;
  if r.points <> 15 or r.males_attended <> 2 or r.females_attended <> 0 then raise exception 'att points/gender wrong'; end if;
  if r.avg_per_day <> 1.5 then raise exception 'avg_per_day: %', r.avg_per_day; end if;

  select count(*) into n from public.stats_attendance_distribution(f, t);
  if n <> 3 then raise exception 'distribution buckets: expected 3 (0,1,2) got %', n; end if;
  select persons into n from public.stats_attendance_distribution(f, t) where times = 0;
  if n <> 2 then raise exception 'distribution 0: expected 2 got %', n; end if;

  select coalesce(sum(attendance), 0) into n from public.stats_attendance_hour_profile(f, t);
  if n <> 3 then raise exception 'hour profile sum: %', n; end if;
  select attendance into n from public.stats_attendance_hour_profile(f, t) where hour = 10;
  if n <> 2 then raise exception 'hour 10: expected 2 got %', n; end if;

  select * into r from public.stats_attendance_by_class_period(f, t) where class_id = '30000000-0000-0000-0000-000000000001';
  if r.enrolled <> 2 or r.attendees <> 1 or r.attendance <> 2 or r.days <> 2 then raise exception 'class أ att period wrong'; end if;

  select * into r from public.stats_attendance_persons(f, t, p_order => 'most', p_limit => 1);
  if r.name <> 'مينا' or r.attendance <> 2 or r.days_since_last <> 1 then raise exception 'most attendance wrong: % %', r.name, r.attendance; end if;
  select * into r from public.stats_attendance_persons(f, t, p_order => 'least', p_limit => 1);
  if r.attendance <> 0 then raise exception 'least attendance wrong'; end if;

  -- ---------- points period ----------
  select * into r from public.stats_points_period_summary(f, t);
  if r.attendance_points <> 15 or r.cause_added <> 3 or r.cause_removed <> 1 or r.net <> 17 or r.cause_entries <> 2 then
    raise exception 'points summary: att % added % removed % net % entries %', r.attendance_points, r.cause_added, r.cause_removed, r.net, r.cause_entries;
  end if;
  if r.recipients <> 4 or r.scope_persons <> 4 or r.causes_used <> 1 or r.servants <> 2 then
    raise exception 'points summary 2: recipients % scope % causes % servants %', r.recipients, r.scope_persons, r.causes_used, r.servants;
  end if;
  if r.best_day <> current_date - 2 or r.best_day_net <> 13 then raise exception 'points best day: % (%)', r.best_day, r.best_day_net; end if;

  select count(*) into n from public.stats_points_distribution(10);
  if n < 1 then raise exception 'points distribution empty'; end if;

  select * into r from public.stats_points_by_class_period(f, t) where class_id = '30000000-0000-0000-0000-000000000001';
  if r.attendance_points <> 10 or r.cause_added <> 3 or r.net <> 13 or r.recipients <> 2 then raise exception 'class أ points period wrong'; end if;

  select * into r from public.stats_points_by_servant(f, t) where servant_id = '00000000-0000-0000-0000-000000000006';
  if r.entries <> 1 or r.added <> 3 or r.attendance_scans <> 2 or r.attendance_points <> 10 then
    raise exception 'servant أ points: entries % added % scans % apts %', r.entries, r.added, r.attendance_scans, r.attendance_points;
  end if;
  select * into r from public.stats_points_by_servant(f, t) where servant_id = '00000000-0000-0000-0000-000000000007';
  if r.removed <> 1 or r.attendance_scans <> 1 then raise exception 'servant ب points wrong'; end if;

  select * into r from public.stats_points_persons(f, t, p_order => 'period', p_limit => 1);
  if r.name <> 'مينا' or r.period_net <> 10 then raise exception 'top points person wrong: % %', r.name, r.period_net; end if;
  select * into r from public.stats_points_persons(f, t, p_order => 'removed', p_limit => 1);
  if r.name <> 'مريم' or r.period_removed <> 1 then raise exception 'most removed wrong'; end if;
end $$;

-- =====================================================================
-- CLASS SERVANT أ — only his class, even when asking for the whole church
-- =====================================================================
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
do $$
declare r record; n int; f date := current_date - 6; t date := current_date;
begin
  select * into r from public.stats_calls_summary(f, t);
  if r.calls <> 3 or r.scope_persons <> 2 or r.messages <> 0 or r.servants <> 1 then
    raise exception 'servant أ scope leak: calls % scope % messages % servants %', r.calls, r.scope_persons, r.messages, r.servants;
  end if;
  -- asking for class ب explicitly → nothing
  select * into r from public.stats_calls_summary(f, t, p_class => '30000000-0000-0000-0000-000000000002');
  if r.calls <> 0 or r.scope_persons <> 0 then raise exception 'servant أ can see class ب'; end if;
  select count(*) into n from public.stats_calls_by_class(f, t);
  if n <> 1 then raise exception 'servant أ by_class rows: %', n; end if;
  select count(*) into n from public.stats_calls_by_servant(f, t);
  if n <> 1 then raise exception 'servant أ by_servant rows: %', n; end if;
  select count(*) into n from public.stats_calls_persons(f, t);
  if n <> 2 then raise exception 'servant أ persons rows: %', n; end if;
  select * into r from public.stats_attendance_period_summary(f, t);
  if r.attendance <> 2 or r.scope_persons <> 2 then raise exception 'servant أ attendance leak'; end if;
  select * into r from public.stats_points_period_summary(f, t);
  if r.attendance_points <> 10 or r.cause_added <> 3 or r.cause_removed <> 0 then raise exception 'servant أ points leak'; end if;
  select count(*) into n from public.stats_points_by_servant(f, t);
  if n <> 1 then raise exception 'servant أ points_by_servant rows: %', n; end if;
end $$;

reset role;

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_contact_log_recorded_by_day') then
    raise exception 'idx_contact_log_recorded_by_day missing';
  end if;
end $$;

rollback;
\echo STATS TABS TESTS PASSED
