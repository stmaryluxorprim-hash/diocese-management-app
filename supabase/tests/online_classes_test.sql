-- =====================================================================
-- Functional test for migration 0030 (الفصول الأونلاين). Run on the local
-- shim DB after run_migrations.sh:  psql -d app -f supabase/tests/online_classes_test.sql
-- Every "assert" raises on failure; a clean run ends with «ONLINE TESTS PASSED».
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
-- the 4 children of the spec example + one from class B
insert into public.persons (id, national_id, name) values
  ('40000000-0000-0000-0000-000000000001', '29901010000001', 'أحمد'),
  ('40000000-0000-0000-0000-000000000002', '29901010000002', 'مريم'),
  ('40000000-0000-0000-0000-000000000003', '29901010000003', 'يوسف'),
  ('40000000-0000-0000-0000-000000000004', '29901010000004', 'مارك'),
  ('40000000-0000-0000-0000-000000000005', '29901010000005', 'فصل ب');
-- 0042: the portal now needs a session token; for the legacy tests the raw code doubles as the token
insert into public.child_sessions (person_id, token_hash, expires_at)
select id, encode(digest(national_id, 'sha256'), 'hex'), now() + interval '1 day' from public.persons;

insert into public.enrollments (id, person_id, church_id, service_id, class_id, points) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 0),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 0),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 0),
  ('50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 0),
  ('50000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 0);

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

-- ---------- 1. module NOT granted → servant sees nothing / can't create; child sees nothing ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  if (select count(*) from public.online_classes) <> 0 then raise exception 'classes visible without grant'; end if;
  begin
    insert into public.online_classes (church_id, service_id, class_id, title, starts_at, ends_at) values
      ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'x', now(), now() + interval '1 hour');
    raise exception 'class created without module grant';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.as_anon();
do $$ begin
  if jsonb_array_length(public.child_online_classes('29901010000001')) <> 0 then raise exception 'child sees classes without grant'; end if;
end $$;
reset role;

-- ---------- 2. owner grants the module ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.module_access (module_key, church_id) values ('online', null);
reset role;

-- ---------- 3. servant A creates a class for class A (rules: 60% · 4 checks · 2 successful) ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
insert into public.online_classes (id, church_id, service_id, class_id, title, starts_at, ends_at, platform, stream_url,
                                   min_time_percent, checks_required, checks_min_success, min_answers, attendance_points, created_by)
values ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001', 'درس أونلاين', now() + interval '1 hour', now() + interval '2 hours',
        'youtube', 'https://youtu.be/abc123', 60, 4, 2, 0, 5, '00000000-0000-0000-0000-000000000002');
do $$ begin
  begin
    insert into public.online_classes (church_id, service_id, class_id, title, starts_at, ends_at, checks_required, checks_min_success)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'x', now(), now() + interval '1 hour', 2, 3);
    raise exception 'min_success > required accepted';
  exception when check_violation then null; end;
  begin
    insert into public.online_classes (church_id, service_id, class_id, title, starts_at, ends_at)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'x', now(), now() - interval '1 hour');
    raise exception 'end before start accepted';
  exception when check_violation then null; end;
  begin
    insert into public.online_classes (church_id, title, starts_at, ends_at) values ('10000000-0000-0000-0000-000000000001', 'church-wide', now(), now() + interval '1 hour');
    raise exception 'class servant created a church-wide class';
  exception when insufficient_privilege then null; end;
end $$;
insert into public.online_class_questions (id, class_id, sort_order, text, options, correct_index, points, created_by) values
  ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 1, 'من بنى الفلك؟', '["نوح","موسى","داود"]', 0, 3, '00000000-0000-0000-0000-000000000002'),
  ('70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 2, 'ما رأيك في الدرس؟', null, null, 0, '00000000-0000-0000-0000-000000000002');
do $$ begin
  begin
    insert into public.online_class_questions (class_id, text, options, correct_index) values ('60000000-0000-0000-0000-000000000001', 'x', '["a"]', 0);
    raise exception 'one option accepted';
  exception when others then if sqlerrm not like '%options_count_out_of_range%' then raise; end if; end;
  begin
    insert into public.online_class_questions (class_id, text, options, correct_index) values ('60000000-0000-0000-0000-000000000001', 'x', '["a","b"]', 5);
    raise exception 'bad correct index accepted';
  exception when others then if sqlerrm not like '%correct_index_out_of_range%' then raise; end if; end;
end $$;
reset role;

-- servant B (class B) must not see class A's online class
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
do $$ begin
  if (select count(*) from public.online_classes) <> 0 then raise exception 'servant B sees class A online class'; end if;
  if (select count(*) from public.online_class_questions) <> 0 then raise exception 'servant B sees class A questions'; end if;
  begin
    perform public.online_class_start('60000000-0000-0000-0000-000000000001');
    raise exception 'servant B started class A';
  exception when others then if sqlerrm not like '%forbidden%' then raise; end if; end;
end $$;
reset role;

-- ---------- 4. child: scheduled class listed but not joinable; class-B child sees nothing ----------
select pg_temp.as_anon();
do $$
declare l jsonb;
begin
  l := public.child_online_classes('29901010000001');
  if jsonb_array_length(l) <> 1 then raise exception 'child A should see 1 scheduled class, got %', jsonb_array_length(l); end if;
  if l->0->>'status' <> 'scheduled' then raise exception 'status should be scheduled'; end if;
  if l->0->>'teacher_name' <> 'خادم أ' then raise exception 'teacher name missing'; end if;
  if l->0->'participant' <> 'null'::jsonb then raise exception 'participant should be null before joining'; end if;
  if jsonb_array_length(public.child_online_classes('29901010000005')) <> 0 then raise exception 'class B child sees class A class'; end if;
  begin
    perform public.child_online_join('29901010000001', '60000000-0000-0000-0000-000000000001');
    raise exception 'joined a scheduled class';
  exception when others then if sqlerrm not like '%class_not_live%' then raise; end if; end;
  begin
    perform public.child_online_join('29901010000005', '60000000-0000-0000-0000-000000000001');
    raise exception 'class B child joined class A';
  exception when others then if sqlerrm not like '%class_out_of_scope%' then raise; end if; end;
end $$;
reset role;

-- ---------- 5. servant starts the class ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$
declare c public.online_classes;
begin
  c := public.online_class_start('60000000-0000-0000-0000-000000000001');
  if c.status <> 'live' or c.started_at is null then raise exception 'start failed'; end if;
  begin
    perform public.online_class_send_check('60000000-0000-0000-0000-000000000001', null, 5);
    raise exception 'bad seconds accepted';
  exception when others then if sqlerrm not like '%invalid_seconds%' then raise; end if; end;
end $$;
reset role;

-- ---------- 6. the 4 children join ----------
select pg_temp.as_anon();
do $$
declare r jsonb;
begin
  r := public.child_online_join('29901010000001', '60000000-0000-0000-0000-000000000001');
  if (r->'participant'->>'id') is null then raise exception 'join did not create a participant'; end if;
  perform public.child_online_join('29901010000002', '60000000-0000-0000-0000-000000000001');
  perform public.child_online_join('29901010000003', '60000000-0000-0000-0000-000000000001');
  perform public.child_online_join('29901010000004', '60000000-0000-0000-0000-000000000001');
  perform public.child_online_join('29901010000001', '60000000-0000-0000-0000-000000000001');   -- idempotent re-join
  r := public.child_online_heartbeat('29901010000001', '60000000-0000-0000-0000-000000000001');
  if (r->'participant'->>'seconds')::int < 0 then raise exception 'heartbeat seconds'; end if;
  begin
    perform public.child_online_heartbeat('29901010000005', '60000000-0000-0000-0000-000000000001');
    raise exception 'class B child heartbeat accepted';
  exception when others then if sqlerrm not like '%class_out_of_scope%' then raise; end if; end;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.online_class_participants where class_id = '60000000-0000-0000-0000-000000000001') <> 4 then raise exception 'expected 4 participants'; end if;
  if (select count(*) from public.online_class_sessions where class_id = '60000000-0000-0000-0000-000000000001') <> 4 then raise exception 'expected 4 sessions (re-join must not open a second one)'; end if;
end $$;

-- ---------- 7. 4 attention checks; أحمد 4/4 · مريم 3/4 · يوسف 1/4 · مارك 2/4 ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$
declare k public.online_class_checks; i int;
begin
  for i in 1..4 loop
    k := public.online_class_send_check('60000000-0000-0000-0000-000000000001', 'هل أنت معنا؟', 60);
    if k.seq <> i then raise exception 'seq mismatch'; end if;
  end loop;
end $$;
reset role;
create temp table tmp_checks as select id, seq from public.online_class_checks where class_id = '60000000-0000-0000-0000-000000000001';
grant select on tmp_checks to anon, authenticated;
select pg_temp.as_anon();
do $$
declare k record; i int := 0; r jsonb;
begin
  r := public.child_online_class('29901010000001', '60000000-0000-0000-0000-000000000001');
  if r->'pending_check' = 'null'::jsonb then raise exception 'pending check not surfaced'; end if;
  for k in select * from tmp_checks order by seq loop
    i := i + 1;
    perform public.child_online_check_respond('29901010000001', k.id);
    if i <= 3 then perform public.child_online_check_respond('29901010000002', k.id); end if;
    if i = 1 then perform public.child_online_check_respond('29901010000003', k.id); end if;
    if i <= 2 then perform public.child_online_check_respond('29901010000004', k.id); end if;
  end loop;
  perform public.child_online_check_respond('29901010000001', (select id from tmp_checks where seq = 1));
end $$;
reset role;
do $$ begin
  if (select checks_ok from public.online_class_participants where person_id = '40000000-0000-0000-0000-000000000001') <> 4 then raise exception 'أحمد checks'; end if;
  if (select checks_ok from public.online_class_participants where person_id = '40000000-0000-0000-0000-000000000002') <> 3 then raise exception 'مريم checks'; end if;
  if (select checks_ok from public.online_class_participants where person_id = '40000000-0000-0000-0000-000000000003') <> 1 then raise exception 'يوسف checks'; end if;
  if (select checks_ok from public.online_class_participants where person_id = '40000000-0000-0000-0000-000000000004') <> 2 then raise exception 'مارك checks'; end if;
  if (select count(*) from public.online_class_check_responses where class_id = '60000000-0000-0000-0000-000000000001') <> 10 then raise exception 'responses count'; end if;
end $$;
-- late response recorded, not counted
update public.online_class_checks set sent_at = now() - interval '10 minutes', expires_at = now() - interval '9 minutes'
 where class_id = '60000000-0000-0000-0000-000000000001' and seq = 4;
select pg_temp.as_anon();
select public.child_online_check_respond('29901010000003', (select id from tmp_checks where seq = 4));
reset role;
do $$ begin
  if (select checks_ok from public.online_class_participants where person_id = '40000000-0000-0000-0000-000000000003') <> 1 then raise exception 'late counted as ok'; end if;
  if (select checks_late from public.online_class_participants where person_id = '40000000-0000-0000-0000-000000000003') <> 1 then raise exception 'late not recorded'; end if;
end $$;

-- ---------- 8. live questions ----------
select pg_temp.as_anon();
do $$ begin
  begin
    perform public.child_online_answer('29901010000001', '70000000-0000-0000-0000-000000000001', 0, null);
    raise exception 'answered a draft question';
  exception when others then if sqlerrm not like '%question_closed%' then raise; end if; end;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
update public.online_class_questions set status = 'open' where class_id = '60000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.as_anon();
do $$
declare r jsonb;
begin
  r := public.child_online_answer('29901010000001', '70000000-0000-0000-0000-000000000001', 0, null);   -- correct → +3
  r := public.child_online_answer('29901010000002', '70000000-0000-0000-0000-000000000001', 1, null);   -- wrong
  r := public.child_online_answer('29901010000001', '70000000-0000-0000-0000-000000000002', null, 'رائع');
  begin
    perform public.child_online_answer('29901010000001', '70000000-0000-0000-0000-000000000001', 0, null);
    raise exception 'double answer accepted';
  exception when others then if sqlerrm not like '%already_answered%' then raise; end if; end;
  begin
    perform public.child_online_answer('29901010000003', '70000000-0000-0000-0000-000000000001', 9, null);
    raise exception 'invalid option accepted';
  exception when others then if sqlerrm not like '%invalid_option%' then raise; end if; end;
  begin
    perform public.child_online_answer('29901010000003', '70000000-0000-0000-0000-000000000002', null, '   ');
    raise exception 'blank text accepted';
  exception when others then if sqlerrm not like '%answer_blank%' then raise; end if; end;
  r := public.child_online_class('29901010000001', '60000000-0000-0000-0000-000000000001');
  if (select q->>'correct_index' from jsonb_array_elements(r->'questions') q where q->>'id' = '70000000-0000-0000-0000-000000000001') is not null then
    raise exception 'correct index leaked while open';
  end if;
end $$;
reset role;
do $$ begin
  if (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000001') <> 3 then raise exception 'points not granted for the correct answer'; end if;
  if (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000002') <> 0 then raise exception 'points granted for a wrong answer'; end if;
  if (select answers_count from public.online_class_participants where person_id = '40000000-0000-0000-0000-000000000001') <> 2 then raise exception 'answers_count'; end if;
  if (select correct_count from public.online_class_participants where person_id = '40000000-0000-0000-0000-000000000001') <> 1 then raise exception 'correct_count'; end if;
  if (select count(*) from public.child_portal_points('29901010000001') where source = 'online' and delta = 3) <> 1 then raise exception 'portal points row for the online answer missing'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
update public.online_class_questions set status = 'closed' where id = '70000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.as_anon();
do $$
declare r jsonb;
begin
  r := public.child_online_class('29901010000001', '60000000-0000-0000-0000-000000000001');
  if (select (q->>'correct_index')::int from jsonb_array_elements(r->'questions') q where q->>'id' = '70000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'correct index not revealed after close';
  end if;
end $$;
reset role;

-- ---------- 9. chat ----------
select pg_temp.as_anon();
select public.child_online_chat_send('29901010000001', '60000000-0000-0000-0000-000000000001', 'مساء الخير');
do $$ begin
  begin
    perform public.child_online_chat_send('29901010000005', '60000000-0000-0000-0000-000000000001', 'x');
    raise exception 'class B child chatted in class A';
  exception when others then if sqlerrm not like '%class_out_of_scope%' then raise; end if; end;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
-- (+1s: the child's message was sent in the same transaction → same now(); keep the order deterministic)
insert into public.online_class_messages (class_id, sender_profile_id, body, created_at) values ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'أهلاً بكم', now() + interval '1 second');
do $$
declare l jsonb;
begin
  begin
    insert into public.online_class_messages (class_id, sender_profile_id, body) values ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'x');
    raise exception 'impersonation accepted';
  exception when insufficient_privilege then null; end;
  l := public.online_class_messages_list('60000000-0000-0000-0000-000000000001');
  if jsonb_array_length(l) <> 2 then raise exception 'servant chat list should have 2 messages'; end if;
  if (l->0->>'sender_name') <> 'أحمد' or (l->0->>'is_servant')::boolean then raise exception 'child message not attributed'; end if;
  if (l->1->>'sender_name') <> 'خادم أ' or not (l->1->>'is_servant')::boolean then raise exception 'servant message not attributed'; end if;
end $$;
update public.online_classes set chat_enabled = false where id = '60000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.as_anon();
do $$
declare l jsonb;
begin
  begin
    perform public.child_online_chat_send('29901010000001', '60000000-0000-0000-0000-000000000001', 'x');
    raise exception 'chat sent while disabled';
  exception when others then if sqlerrm not like '%chat_disabled%' then raise; end if; end;
  l := public.child_online_messages('29901010000001', '60000000-0000-0000-0000-000000000001');
  if jsonb_array_length(l) <> 2 then raise exception 'child chat list should have 2 messages'; end if;
  if not (l->0->>'mine')::boolean then raise exception 'mine flag missing'; end if;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
update public.online_classes set chat_enabled = true where id = '60000000-0000-0000-0000-000000000001';
reset role;

-- ---------- 10. servant B can't read class A participants / chat / stats ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
do $$ begin
  if (select count(*) from public.online_class_participants) <> 0 then raise exception 'servant B sees class A participants'; end if;
  if (select count(*) from public.online_class_messages) <> 0 then raise exception 'servant B sees class A chat'; end if;
  begin
    perform public.online_class_live_stats('60000000-0000-0000-0000-000000000001');
    raise exception 'servant B read live stats';
  exception when others then if sqlerrm not like '%forbidden%' then raise; end if; end;
end $$;
reset role;

-- ---------- 11. emulate the spec timeline (7:00 → 8:00) ----------
-- أحمد 7:00–8:00 (100%) · مريم 7:10–8:00 (83%) · يوسف 7:30–8:00 (50%) · مارك 7:00–7:20 (33%)
update public.online_classes set started_at = now() - interval '60 minutes', starts_at = now() - interval '60 minutes', ends_at = now()
 where id = '60000000-0000-0000-0000-000000000001';
update public.online_class_sessions s set joined_at = now() - interval '60 minutes', last_seen_at = now(), left_at = null
  from public.online_class_participants p where s.participant_id = p.id and p.person_id = '40000000-0000-0000-0000-000000000001';
update public.online_class_sessions s set joined_at = now() - interval '50 minutes', last_seen_at = now(), left_at = null
  from public.online_class_participants p where s.participant_id = p.id and p.person_id = '40000000-0000-0000-0000-000000000002';
update public.online_class_sessions s set joined_at = now() - interval '30 minutes', last_seen_at = now(), left_at = null
  from public.online_class_participants p where s.participant_id = p.id and p.person_id = '40000000-0000-0000-0000-000000000003';
update public.online_class_sessions s set joined_at = now() - interval '60 minutes', last_seen_at = now() - interval '40 minutes', left_at = now() - interval '40 minutes'
  from public.online_class_participants p where s.participant_id = p.id and p.person_id = '40000000-0000-0000-0000-000000000004';

select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$
declare st jsonb; r jsonb;
begin
  st := public.online_class_live_stats('60000000-0000-0000-0000-000000000001');
  if (st->'totals'->>'entered')::int <> 4 then raise exception 'entered total'; end if;
  if (st->'totals'->>'eligible')::int <> 4 then raise exception 'eligible total'; end if;
  if (st->>'checks_sent')::int <> 4 then raise exception 'checks_sent'; end if;
  for r in select * from jsonb_array_elements(st->'participants') loop
    case r->>'name'
      when 'أحمد' then if r->>'status' <> 'present' or (r->>'percent')::numeric < 99 then raise exception 'أحمد should be present ~100%%: %', r; end if;
      when 'مريم' then if r->>'status' <> 'present' or (r->>'percent')::numeric not between 80 and 86 then raise exception 'مريم should be present ~83%%: %', r; end if;
      when 'يوسف' then if r->>'status' <> 'absent' or (r->>'percent')::numeric not between 48 and 52 then raise exception 'يوسف should be absent ~50%%: %', r; end if;
      when 'مارك' then if r->>'status' <> 'absent' or (r->>'percent')::numeric not between 31 and 35 then raise exception 'مارك should be absent ~33%%: %', r; end if;
      else raise exception 'unexpected participant %', r->>'name';
    end case;
  end loop;
  if (st->'totals'->>'present')::int <> 2 or (st->'totals'->>'absent')::int <> 2 then raise exception 'present/absent totals'; end if;
end $$;

-- ---------- 12. END → automatic attendance ----------
do $$
declare res jsonb;
begin
  res := public.online_class_end('60000000-0000-0000-0000-000000000001');
  if (res->>'present')::int <> 2 or (res->>'absent')::int <> 2 then raise exception 'finalize totals: %', res; end if;
  begin
    perform public.online_class_end('60000000-0000-0000-0000-000000000001');
    raise exception 'ended twice';
  exception when others then if sqlerrm not like '%class_not_live%' then raise; end if; end;
end $$;
reset role;
do $$ begin
  if (select status from public.online_classes where id = '60000000-0000-0000-0000-000000000001') <> 'ended' then raise exception 'status not ended'; end if;
  if (select final_status from public.online_class_participants where person_id = '40000000-0000-0000-0000-000000000001') <> 'present' then raise exception 'أحمد final'; end if;
  if (select final_status from public.online_class_participants where person_id = '40000000-0000-0000-0000-000000000002') <> 'present' then raise exception 'مريم final'; end if;
  if (select final_status from public.online_class_participants where person_id = '40000000-0000-0000-0000-000000000003') <> 'absent'  then raise exception 'يوسف final'; end if;
  if (select final_status from public.online_class_participants where person_id = '40000000-0000-0000-0000-000000000004') <> 'absent'  then raise exception 'مارك final'; end if;
  if (select count(*) from public.attendance_log) <> 2 then raise exception 'expected 2 attendance rows, got %', (select count(*) from public.attendance_log); end if;
  if (select attendance_count from public.enrollments where id = '50000000-0000-0000-0000-000000000001') <> 1 then raise exception 'أحمد attendance_count'; end if;
  if (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000001') <> 8 then raise exception 'أحمد points should be 3 + 5'; end if;
  if (select attendance_count from public.enrollments where id = '50000000-0000-0000-0000-000000000003') <> 0 then raise exception 'يوسف should have no attendance'; end if;
  if exists (select 1 from public.online_class_sessions where class_id = '60000000-0000-0000-0000-000000000001' and left_at is null) then raise exception 'open sessions after end'; end if;
end $$;
select pg_temp.as_anon();
do $$
declare r jsonb;
begin
  if (select count(*) from public.child_portal_attendance('29901010000001') where event_name like 'فصل أونلاين%') <> 1 then raise exception 'portal attendance label'; end if;
  if (select count(*) from public.child_portal_points('29901010000001') where source = 'attendance' and delta = 5) <> 1 then raise exception 'portal attendance points row'; end if;
  r := public.child_online_class('29901010000003', '60000000-0000-0000-0000-000000000001');
  if r->'participant'->>'live_status' <> 'absent' then raise exception 'يوسف live_status after end'; end if;
  r := public.child_online_heartbeat('29901010000001', '60000000-0000-0000-0000-000000000001');
  if r->>'status' <> 'ended' then raise exception 'heartbeat after end'; end if;
  begin
    perform public.child_online_join('29901010000001', '60000000-0000-0000-0000-000000000001');
    raise exception 'joined an ended class';
  exception when others then if sqlerrm not like '%class_not_live%' then raise; end if; end;
end $$;
reset role;

-- ---------- 13. manual override ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$
declare pid uuid; res jsonb;
begin
  select id into pid from public.online_class_participants where person_id = '40000000-0000-0000-0000-000000000003';
  res := public.online_class_set_override(pid, 'present');
  if (res->>'present')::int <> 3 then raise exception 'override present total: %', res; end if;
  if (select attendance_count from public.enrollments where id = '50000000-0000-0000-0000-000000000003') <> 1 then raise exception 'override did not write attendance'; end if;
  res := public.online_class_set_override(pid, null);
  if (res->>'present')::int <> 2 then raise exception 'override reset total: %', res; end if;
  if (select attendance_count from public.enrollments where id = '50000000-0000-0000-0000-000000000003') <> 0 then raise exception 'override reset did not remove attendance'; end if;
  begin
    perform public.online_class_set_override(pid, 'maybe');
    raise exception 'bad status accepted';
  exception when others then if sqlerrm not like '%invalid_status%' then raise; end if; end;
end $$;

-- ---------- 14. reopen → end again ----------
do $$
declare c public.online_classes; res jsonb;
begin
  c := public.online_class_reopen('60000000-0000-0000-0000-000000000001');
  if c.status <> 'live' then raise exception 'reopen status'; end if;
  if (select count(*) from public.attendance_log) <> 0 then raise exception 'reopen kept attendance rows'; end if;
  if (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000001') <> 3 then raise exception 'reopen did not revert attendance points'; end if;
  res := public.online_class_end('60000000-0000-0000-0000-000000000001');
  if (res->>'present')::int <> 2 then raise exception 're-end totals: %', res; end if;
  if (select count(*) from public.attendance_log) <> 2 then raise exception 're-end attendance rows'; end if;
end $$;
reset role;

-- ---------- 15. servant B can't reopen ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
do $$ begin
  begin
    perform public.online_class_reopen('60000000-0000-0000-0000-000000000001');
    raise exception 'servant B reopened class A';
  exception when others then if sqlerrm not like '%forbidden%' then raise; end if; end;
end $$;
reset role;

-- ---------- 16. bound exam / event scope validation ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.module_access (module_key, church_id) values ('exams', null);
insert into public.exams (id, church_id, service_id, class_id, title, status) values
  ('80000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'امتحان فصل ب', 'published');
insert into public.events (id, church_id, service_id, class_id, name, points) values
  ('90000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, 'اجتماع الخدمة', 2);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  begin
    update public.online_classes set exam_id = '80000000-0000-0000-0000-000000000001' where id = '60000000-0000-0000-0000-000000000001';
    raise exception 'exam of class B bound to class A';
  exception when others then if sqlerrm not like '%exam_out_of_scope%' then raise; end if; end;
  update public.online_classes set event_id = '90000000-0000-0000-0000-000000000001' where id = '60000000-0000-0000-0000-000000000001';
end $$;
reset role;

-- ---------- 17. realtime publication ----------
do $$ begin
  -- 20261016: broadcast bus triggers instead of the publication
  if (select count(*) from pg_trigger where tgname = 'zzz_rt_ins'
        and tgrelid in ('public.online_classes'::regclass, 'public.online_class_participants'::regclass, 'public.online_class_checks'::regclass,
                        'public.online_class_check_responses'::regclass, 'public.online_class_questions'::regclass,
                        'public.online_class_answers'::regclass, 'public.online_class_messages'::regclass)) <> 7 then
    raise exception 'online broadcast triggers missing';
  end if;
end $$;

select 'ONLINE TESTS PASSED' as result;
rollback;
