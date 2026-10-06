-- =====================================================================
-- Functional test for migration 0027 (الامتحانات). Run on the local
-- shim DB after run_migrations.sh:  psql -d app -f supabase/tests/exam_module_test.sql
-- Every "assert" raises on failure; a clean run ends with «EXAM TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

-- ---------- seed ----------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000002'),  -- class servant (class A)
  ('00000000-0000-0000-0000-000000000003');  -- class servant (class B)
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
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
insert into public.persons (id, national_id, name) values
  ('40000000-0000-0000-0000-000000000001', '29901010000001', 'مينا'),
  ('40000000-0000-0000-0000-000000000002', '29901010000002', 'مريم');
-- 0042: the portal now needs a session token; for the legacy tests the raw code doubles as the token
insert into public.child_sessions (person_id, token_hash, expires_at)
select id, encode(digest(national_id, 'sha256'), 'hex'), now() + interval '1 day' from public.persons;

insert into public.enrollments (id, person_id, church_id, service_id, class_id, points) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 10),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 0);

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

-- ---------- 1. module NOT granted → servant sees nothing / can't create ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  if (select count(*) from public.exams) <> 0 then raise exception 'exams visible without grant'; end if;
  begin
    insert into public.exams (church_id, service_id, class_id, title) values
      ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'x');
    raise exception 'exam created without module grant';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- child: module not granted → no exams listed
select pg_temp.as_anon();
do $$ begin
  if jsonb_array_length(public.child_portal_exams('29901010000001')) <> 0 then raise exception 'child sees exams without grant'; end if;
end $$;
reset role;

-- ---------- 2. owner grants the module ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.module_access (module_key, church_id) values ('exams', null);
reset role;

-- ---------- 3. servant A creates an exam for class A + questions ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
insert into public.exams (id, church_id, service_id, class_id, title, default_seconds, pass_mode, pass_value,
                          points_pass, points_full, question_mode, random_count, shuffle_questions, shuffle_options, show_answers)
values ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001', 'امتحان الكتاب المقدس', 30, 'percent', 50, 5, 10, 'all', 10, false, true, true);
insert into public.exam_questions (exam_id, sort_order, text, options, correct_index, points) values
  ('60000000-0000-0000-0000-000000000001', 1, 'س1', '["أ","ب","ج"]', 0, 2),
  ('60000000-0000-0000-0000-000000000001', 2, 'س2', '["أ","ب","ج","د"]', 3, 3),
  ('60000000-0000-0000-0000-000000000001', 3, 'س3', '["نعم","لا"]', 1, 5);
-- validation: bad options
do $$ begin
  begin
    insert into public.exam_questions (exam_id, text, options, correct_index) values ('60000000-0000-0000-0000-000000000001', 'x', '["a"]', 0);
    raise exception 'one option accepted';
  exception when others then if sqlerrm not like '%options_count_out_of_range%' then raise; end if; end;
  begin
    insert into public.exam_questions (exam_id, text, options, correct_index) values ('60000000-0000-0000-0000-000000000001', 'x', '["a","b"]', 2);
    raise exception 'bad correct index accepted';
  exception when others then if sqlerrm not like '%correct_index_out_of_range%' then raise; end if; end;
  begin
    insert into public.exam_questions (exam_id, text, options, correct_index) values ('60000000-0000-0000-0000-000000000001', 'x', '["a",""]', 0);
    raise exception 'blank option accepted';
  exception when others then if sqlerrm not like '%option_blank%' then raise; end if; end;
  -- class servant can't create a church-wide exam
  begin
    insert into public.exams (church_id, title) values ('10000000-0000-0000-0000-000000000001', 'church-wide');
    raise exception 'class servant created a church-wide exam';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- servant B (class B) must not see class A's exam
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
do $$ begin
  if (select count(*) from public.exams) <> 0 then raise exception 'servant B sees class A exam'; end if;
  if (select count(*) from public.exam_questions) <> 0 then raise exception 'servant B sees class A questions'; end if;
end $$;
reset role;

-- ---------- 4. child: draft exam is invisible; can't start ----------
select pg_temp.as_anon();
do $$ begin
  if jsonb_array_length(public.child_portal_exams('29901010000001')) <> 0 then raise exception 'draft exam listed to child'; end if;
  begin
    perform public.child_exam_start('29901010000001', '60000000-0000-0000-0000-000000000001');
    raise exception 'started a draft exam';
  exception when others then if sqlerrm not like '%exam_not_published%' then raise; end if; end;
end $$;
reset role;

-- publish
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
update public.exams set status = 'published' where id = '60000000-0000-0000-0000-000000000001';
reset role;

-- ---------- 5. child in class B: exam out of scope ----------
select pg_temp.as_anon();
do $$ begin
  if jsonb_array_length(public.child_portal_exams('29901010000002')) <> 0 then raise exception 'class B child sees class A exam'; end if;
  begin
    perform public.child_exam_start('29901010000002', '60000000-0000-0000-0000-000000000001');
    raise exception 'class B child started class A exam';
  exception when others then if sqlerrm not like '%exam_out_of_scope%' then raise; end if; end;
end $$;

-- ---------- 6. child A: list → start → answer flow ----------
do $$
declare
  lst jsonb; r jsonb; q jsonb; att uuid; opts jsonb; sel int; i int; cnt int;
  ans public.exam_answers;
begin
  lst := public.child_portal_exams('29901010000001');
  if jsonb_array_length(lst) <> 1 then raise exception 'child should see 1 exam, sees %', jsonb_array_length(lst); end if;
  if (lst->0->>'is_open')::boolean is not true then raise exception 'exam should be open'; end if;
  if (lst->0->>'total_questions')::int <> 3 then raise exception 'total_questions wrong'; end if;

  r := public.child_exam_start('29901010000001', '60000000-0000-0000-0000-000000000001');
  att := (r->>'attempt_id')::uuid;
  if (r->>'finished')::boolean then raise exception 'finished at start'; end if;
  if (r->>'questions_count')::int <> 3 then raise exception 'questions_count wrong'; end if;
  q := r->'question';
  if (q->>'position')::int <> 0 then raise exception 'first position must be 0'; end if;
  if q ? 'correct_index' then raise exception 'correct index leaked to child'; end if;
  if q->>'text' <> 'س1' then raise exception 'shuffle_questions=false must keep order, got %', q->>'text'; end if;
  if q->>'deadline_at' is null then raise exception 'no deadline served'; end if;

  -- resume returns the same attempt / same question
  r := public.child_exam_start('29901010000001', '60000000-0000-0000-0000-000000000001');
  if (r->>'attempt_id')::uuid <> att then raise exception 'resume created a second attempt'; end if;
  if (r->'question'->>'position')::int <> 0 then raise exception 'resume changed position'; end if;

  -- answering a future position is rejected
  begin
    perform public.child_exam_answer('29901010000001', att, 2, 0);
    raise exception 'future position accepted';
  exception when others then if sqlerrm not like '%position_mismatch%' then raise; end if; end;

  -- Q1: find the served index of the correct option "أ" and answer it (correct, 2 pts)
  opts := q->'options';
  sel := null;
  for i in 0 .. jsonb_array_length(opts) - 1 loop
    if opts->>i = 'أ' then sel := i; end if;
  end loop;
  r := public.child_exam_answer('29901010000001', att, 0, sel);
  if (r->'question'->>'position')::int <> 1 then raise exception 'did not advance to Q2'; end if;
  -- a late duplicate answer for Q1 is ignored (no error, no change)
  r := public.child_exam_answer('29901010000001', att, 0, 0);
  if (r->'question'->>'position')::int <> 1 then raise exception 'stale answer moved the cursor'; end if;

  -- Q2: pick a WRONG option ("أ" is wrong; correct is "د")
  opts := r->'question'->'options';
  for i in 0 .. jsonb_array_length(opts) - 1 loop
    if opts->>i = 'أ' then sel := i; end if;
  end loop;
  r := public.child_exam_answer('29901010000001', att, 1, sel);
  if (r->'question'->>'position')::int <> 2 then raise exception 'did not advance to Q3'; end if;

  -- anon must NOT be able to touch answers directly (RLS: no write policies)
  update public.exam_answers set deadline_at = now() + interval '1 day' where attempt_id = att and position = 2;
  if (select deadline_at from public.exam_answers where attempt_id = att and position = 2) is not null then
    raise exception 'anon can read/write exam_answers directly';
  end if;
  -- Q3: simulate the timer running out → deadline in the past (as superuser), then poll current
  perform set_config('role', 'postgres', true);
  update public.exam_answers set served_at = now() - interval '60 seconds', deadline_at = now() - interval '30 seconds'
   where attempt_id = att and position = 2;
  perform pg_temp.as_anon();
  r := public.child_exam_current('29901010000001', att);
  if not (r->>'finished')::boolean then raise exception 'timed-out last question should finish the attempt'; end if;

  -- result: 2 of 10 → 20% → fail, no points
  if (r->'result'->>'score')::numeric <> 2 then raise exception 'score should be 2, got %', r->'result'->>'score'; end if;
  if (r->'result'->>'max_score')::numeric <> 10 then raise exception 'max should be 10'; end if;
  if (r->'result'->>'passed')::boolean then raise exception 'should have failed'; end if;
  if (r->'result'->>'timed_out_count')::int <> 1 then raise exception 'timed_out_count should be 1'; end if;
  if (r->'result'->>'points_granted')::int <> 0 then raise exception 'no points expected'; end if;
  if not (r->'result' ? 'answers') then raise exception 'show_answers=true → answers expected'; end if;
  select * into ans from public.exam_answers where attempt_id = att and position = 2;
  if not ans.timed_out then raise exception 'Q3 should be timed_out'; end if;
  select count(*) into cnt from public.points_log where enrollment_id = '50000000-0000-0000-0000-000000000001';
  if cnt <> 0 then raise exception 'points_log written on fail'; end if;

  -- attempts exhausted (max 1)
  begin
    perform public.child_exam_start('29901010000001', '60000000-0000-0000-0000-000000000001');
    raise exception 'second attempt allowed';
  exception when others then if sqlerrm not like '%no_attempts_left%' then raise; end if; end;

  -- list now shows last_result + attempts_used
  lst := public.child_portal_exams('29901010000001');
  if (lst->0->>'attempts_used')::int <> 1 then raise exception 'attempts_used should be 1'; end if;
  if lst->0->'last_result' is null then raise exception 'last_result missing'; end if;
end $$;
reset role;

-- ---------- 7. servant: sees the attempt; servant B does not; cancel refunds → retake ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
do $$ begin
  if (select count(*) from public.exam_attempts) <> 0 then raise exception 'servant B sees class A attempts'; end if;
end $$;
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$
declare att uuid; d jsonb;
begin
  select id into att from public.exam_attempts where exam_id = '60000000-0000-0000-0000-000000000001';
  if att is null then raise exception 'servant A cannot see the attempt'; end if;
  if (select count(*) from public.exam_answers where attempt_id = att) <> 3 then raise exception 'answers not visible'; end if;
  d := public.exam_attempt_detail(att);
  if jsonb_array_length(d->'answers') <> 3 then raise exception 'detail should have 3 answers'; end if;
  -- attempts are read-only through the API
  begin
    update public.exam_attempts set score = 100 where id = att;
    if (select score from public.exam_attempts where id = att) = 100 then raise exception 'attempt updated via API'; end if;
  exception when insufficient_privilege then null; end;
  perform public.exam_cancel_attempt(att, 'إعادة');
  if (select status from public.exam_attempts where id = att) <> 'cancelled' then raise exception 'not cancelled'; end if;
  begin
    perform public.exam_cancel_attempt(att);
    raise exception 'double cancel accepted';
  exception when others then if sqlerrm not like '%already_cancelled%' then raise; end if; end;
end $$;
-- raise the reward so a pass grants points; allow 2 attempts, random 2 of 3
update public.exams set max_attempts = 2, question_mode = 'random', random_count = 2, pass_mode = 'score', pass_value = 1
 where id = '60000000-0000-0000-0000-000000000001';
reset role;

-- ---------- 8. child retakes: random 2 of 3, full mark → points_full (10) ----------
select pg_temp.as_anon();
do $$
declare
  r jsonb; att uuid; q jsonb; opts jsonb; sel int; i int; pos int; correct text;
  before_pts int; after_pts int;
begin
  select points into before_pts from public.enrollments where id = '50000000-0000-0000-0000-000000000001';
  r := public.child_exam_start('29901010000001', '60000000-0000-0000-0000-000000000001');
  att := (r->>'attempt_id')::uuid;
  if (r->>'questions_count')::int <> 2 then raise exception 'random mode should serve 2 questions, got %', r->>'questions_count'; end if;
  if (select attempt_no from public.exam_attempts where id = att) <> 1 then raise exception 'cancelled attempt must not count (attempt_no)'; end if;

  -- answer both correctly using the snapshot (test-side knowledge)
  while not (r->>'finished')::boolean loop
    q := r->'question'; pos := (q->>'position')::int; opts := q->'options';
    perform set_config('role', 'postgres', true);
    select (a.options ->> a.correct_index) into correct from public.exam_answers a where a.attempt_id = att and a.position = pos;
    perform pg_temp.as_anon();
    if correct is null then raise exception 'snapshot missing for position %', pos; end if;
    sel := null;
    for i in 0 .. jsonb_array_length(opts) - 1 loop
      if opts->>i = correct then sel := i; end if;
    end loop;
    r := public.child_exam_answer('29901010000001', att, pos, sel);
  end loop;

  if not (r->'result'->>'full_mark')::boolean then raise exception 'expected full mark'; end if;
  if not (r->'result'->>'passed')::boolean then raise exception 'expected pass'; end if;
  if (r->'result'->>'points_granted')::int <> 10 then raise exception 'expected 10 points, got %', r->'result'->>'points_granted'; end if;
  select points into after_pts from public.enrollments where id = '50000000-0000-0000-0000-000000000001';
  if after_pts <> before_pts + 10 then raise exception 'balance not updated: % → %', before_pts, after_pts; end if;
  -- child points list shows the exam source
  if not exists (select 1 from public.child_portal_points('29901010000001') where source = 'exam' and delta = 10) then
    raise exception 'exam row missing from child_portal_points';
  end if;
  -- result RPC
  if (public.child_exam_result('29901010000001', att)->>'status') <> 'submitted' then raise exception 'result rpc failed'; end if;
end $$;
reset role;

-- ---------- 9. cancel a passed attempt → refund ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$
declare att uuid; pts int;
begin
  select id into att from public.exam_attempts where exam_id = '60000000-0000-0000-0000-000000000001' and status = 'submitted';
  perform public.exam_cancel_attempt(att);
  select points into pts from public.enrollments where id = '50000000-0000-0000-0000-000000000001';
  if pts <> 10 then raise exception 'refund failed, balance %', pts; end if;
  if (select refund_points_log_id from public.exam_attempts where id = att) is null then raise exception 'refund log missing'; end if;
end $$;

-- ---------- 10. duplicate + closed window ----------
do $$
declare nid uuid;
begin
  nid := public.exam_duplicate('60000000-0000-0000-0000-000000000001', null);
  if (select count(*) from public.exam_questions where exam_id = nid) <> 3 then raise exception 'duplicate lost questions'; end if;
  if (select status from public.exams where id = nid) <> 'draft' then raise exception 'duplicate must be draft'; end if;
end $$;
update public.exams set closes_at = now() - interval '1 hour', opens_at = now() - interval '2 hours' where id = '60000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.as_anon();
do $$ begin
  begin
    perform public.child_exam_start('29901010000001', '60000000-0000-0000-0000-000000000001');
    raise exception 'started a closed-window exam';
  exception when others then if sqlerrm not like '%exam_closed%' then raise; end if; end;
end $$;
reset role;

-- ---------- 11. realtime publication ----------
do $$ begin
  -- 20261016: broadcast bus triggers instead of the publication
  if (select count(*) from pg_trigger where tgname = 'zzz_rt_ins'
        and tgrelid in ('public.exams'::regclass, 'public.exam_questions'::regclass, 'public.exam_attempts'::regclass)) <> 3 then
    raise exception 'exam broadcast triggers missing';
  end if;
end $$;

select 'EXAM TESTS PASSED' as result;
rollback;
