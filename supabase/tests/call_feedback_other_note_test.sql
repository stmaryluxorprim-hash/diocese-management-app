-- =====================================================================
-- Functional test for 20261012120000 (call feedback «أخرى» — a manually
-- written cause stored in contact_log.note).
--   psql -d app -f supabase/tests/call_feedback_other_note_test.sql
-- Ends with «CALL FEEDBACK OTHER NOTE TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000006');  -- class servant (فصل أ)
insert into public.churches (id, name) values ('10000000-0000-0000-0000-000000000001', 'كنيسة أ');
insert into public.services (id, church_id, name) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ');

insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000006', 'خادم أ', 'cs-a', '0106', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now());

insert into public.events (id, church_id, service_id, class_id, name, recurrence, weekdays, points) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', null, null, 'قداس', 'weekly', '{0,1,2,3,4,5,6}', 5);

insert into public.call_feedbacks (id, church_id, name, color, icon) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مريض', '#ef4444', 'thermometer');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';

do $$
declare r jsonb; e1 uuid; n int;
begin
  r := public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001', 'مينا', 'KID-1', 'male', null, '+201000000001');
  e1 := (r->>'enrollment_id')::uuid;

  -- ---------- A. plain dial (call button) — no occurrence, no feedback, no note ----------
  insert into public.contact_log (enrollment_id, event_id, kind, recorded_by)
  values (e1, '40000000-0000-0000-0000-000000000001', 'call', '00000000-0000-0000-0000-000000000006');

  -- ---------- B. predefined feedback still works as before ----------
  insert into public.contact_log (enrollment_id, event_id, kind, occurrence_on, feedback_id, recorded_by)
  values (e1, '40000000-0000-0000-0000-000000000001', 'call', current_date, '50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000006');

  -- ---------- C. «أخرى»: feedback_id null + written note ----------
  insert into public.contact_log (enrollment_id, event_id, kind, occurrence_on, feedback_id, note, recorded_by)
  values (e1, '40000000-0000-0000-0000-000000000001', 'call', current_date, null, '  سافر مع أهله لمدة أسبوع  ', '00000000-0000-0000-0000-000000000006');

  select count(*) into n from public.contact_log
   where enrollment_id = e1 and occurrence_on = current_date and (feedback_id is not null or note is not null);
  if n <> 2 then raise exception 'expected 2 feedback rows (predefined + other), got %', n; end if;

  -- the plain dial is NOT a feedback row
  select count(*) into n from public.contact_log
   where enrollment_id = e1 and occurrence_on is null and feedback_id is null and note is null;
  if n <> 1 then raise exception 'the plain dial row must stay a non-feedback row'; end if;

  -- ---------- D. an empty / blank note is refused ----------
  begin
    insert into public.contact_log (enrollment_id, event_id, kind, occurrence_on, note, recorded_by)
    values (e1, '40000000-0000-0000-0000-000000000001', 'call', current_date, '   ', '00000000-0000-0000-0000-000000000006');
    raise exception 'blank note accepted';
  exception when check_violation then
    null; -- expected
  end;

  -- ---------- E. an over-long note is refused ----------
  begin
    insert into public.contact_log (enrollment_id, event_id, kind, occurrence_on, note, recorded_by)
    values (e1, '40000000-0000-0000-0000-000000000001', 'call', current_date, repeat('x', 501), '00000000-0000-0000-0000-000000000006');
    raise exception 'over-long note accepted';
  exception when check_violation then
    null; -- expected
  end;

  -- ---------- F. the servant can read his rows back with the note ----------
  if not exists (
    select 1 from public.contact_log where enrollment_id = e1 and note like '%سافر%'
  ) then raise exception 'note not readable'; end if;
end $$;

reset role;

-- the lookup index exists with the new predicate
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_contact_log_followup_lookup') then
    raise exception 'idx_contact_log_followup_lookup missing';
  end if;
end $$;

rollback;
\echo CALL FEEDBACK OTHER NOTE TESTS PASSED
