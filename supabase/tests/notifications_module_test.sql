-- =====================================================================
-- Functional test for migration 0034 (الإشعارات). Run on the local shim DB
-- after run_migrations.sh:  psql -d app -f supabase/tests/notifications_module_test.sql
-- Every "assert" raises on failure; a clean run ends with «NOTIFICATION TESTS PASSED».
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
  ('40000000-0000-0000-0000-000000000001', '29901010000001', 'مينا جرجس'),
  ('40000000-0000-0000-0000-000000000002', '29901010000002', 'مريم'),
  ('40000000-0000-0000-0000-000000000003', '29901010000003', 'يوسف');
-- 0042: the portal now needs a session token; for the legacy tests the raw code doubles as the token
insert into public.child_sessions (person_id, token_hash, expires_at)
select id, encode(digest(national_id, 'sha256'), 'hex'), now() + interval '1 day' from public.persons;

insert into public.enrollments (id, person_id, church_id, service_id, class_id, points) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 0),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 0),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 0);
insert into public.events (id, church_id, service_id, class_id, name, recurrence, weekdays, points) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', null, null, 'القداس', 'weekly', array[0,1,2,3,4,5,6]::smallint[], 2);
insert into public.causes (id, church_id, name, points) values
  ('61000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'سلوك', 5);

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

-- ---------- 1. module NOT granted → send refused, history empty ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  if (public.notif_permissions()->>'visible')::boolean then raise exception 'visible without grant'; end if;
  begin
    perform public.notif_send(jsonb_build_object('title', 'x', 'target_kind', 'class',
      'church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000001', 'class_id', '30000000-0000-0000-0000-000000000001'));
    raise exception 'send allowed without grant';
  exception when insufficient_privilege then null; end;
  if jsonb_array_length(public.notif_history()) <> 0 then raise exception 'history without grant'; end if;
end $$;
reset role;

-- ---------- 2. owner grants the module to the whole church ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.module_access (module_key, church_id) values ('notifications', '10000000-0000-0000-0000-000000000001');
reset role;

-- ---------- 3. class servant A: audience count + send to his class ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$
declare n public.notifications; c int;
begin
  c := public.notif_audience_count(jsonb_build_object('target_kind', 'class',
        'church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000001', 'class_id', '30000000-0000-0000-0000-000000000001'));
  if c <> 2 then raise exception 'class A audience = % (expected 2)', c; end if;
  c := public.notif_audience_count(jsonb_build_object('target_kind', 'class',
        'church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000001', 'class_id', '30000000-0000-0000-0000-000000000002'));
  if c <> 0 then raise exception 'class B audience for servant A = % (expected 0)', c; end if;

  n := public.notif_send(jsonb_build_object('title', 'تذكير', 'body', 'القداس غداً ٩ صباحاً', 'link_url', '/child/attendance', 'target_kind', 'class',
        'church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000001', 'class_id', '30000000-0000-0000-0000-000000000001'));
  if n.status <> 'sent' or n.recipients_count <> 2 then raise exception 'send class A: status % count %', n.status, n.recipients_count; end if;
  if (select count(*) from public.notification_recipients where notification_id = n.id and person_id is not null) <> 2 then raise exception 'recipient rows'; end if;

  begin
    perform public.notif_send(jsonb_build_object('title', 'x', 'target_kind', 'class',
      'church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000001', 'class_id', '30000000-0000-0000-0000-000000000002'));
    raise exception 'servant A sent to class B';
  exception when insufficient_privilege then null; end;
  begin
    perform public.notif_send(jsonb_build_object('title', 'x', 'target_kind', 'church', 'church_id', '10000000-0000-0000-0000-000000000001'));
    raise exception 'servant A sent to church';
  exception when insufficient_privilege then null; end;
  begin
    perform public.notif_send(jsonb_build_object('title', 'x', 'target_kind', 'all'));
    raise exception 'servant A sent to all';
  exception when insufficient_privilege then null; end;
  -- bad link is dropped, javascript: never stored
  n := public.notif_send(jsonb_build_object('title', 'رابط', 'link_url', 'javascript:alert(1)', 'target_kind', 'person',
        'enrollment_ids', jsonb_build_array('50000000-0000-0000-0000-000000000001')));
  if n.link_url is not null then raise exception 'bad link stored'; end if;
  if n.recipients_count <> 1 then raise exception 'person send count %', n.recipients_count; end if;
  begin
    perform public.notif_send(jsonb_build_object('title', 'x', 'target_kind', 'person', 'enrollment_ids', jsonb_build_array('50000000-0000-0000-0000-000000000003')));
    raise exception 'servant A sent to child of class B';
  exception when insufficient_privilege then null; end;
  begin
    perform public.notif_send(jsonb_build_object('title', '  ', 'target_kind', 'person', 'enrollment_ids', jsonb_build_array('50000000-0000-0000-0000-000000000001')));
    raise exception 'empty title accepted';
  exception when invalid_parameter_value then null; end;
end $$;

-- ---------- 4. schedule + cancel + tick ----------
do $$
declare n public.notifications; n2 public.notifications; h jsonb;
begin
  n := public.notif_send(jsonb_build_object('title', 'مجدول', 'target_kind', 'class', 'scheduled_at', (now() + interval '1 hour')::text,
        'church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000001', 'class_id', '30000000-0000-0000-0000-000000000001'));
  if n.status <> 'scheduled' or n.recipients_count <> 0 then raise exception 'schedule status %', n.status; end if;
  if (select count(*) from public.notification_recipients where notification_id = n.id) <> 0 then raise exception 'scheduled has recipients'; end if;
  begin
    perform public.notif_send(jsonb_build_object('title', 'x', 'target_kind', 'class', 'scheduled_at', (now() - interval '1 day')::text,
      'church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000001', 'class_id', '30000000-0000-0000-0000-000000000001'));
    raise exception 'past schedule accepted';
  exception when invalid_parameter_value then null; end;
  h := public.notif_history();
  if not exists (select 1 from jsonb_array_elements(h) x where x->>'id' = n.id::text and x->>'status' = 'scheduled' and (x->>'can_cancel')::boolean) then
    raise exception 'scheduled not in history / not cancellable';
  end if;
  n2 := public.notif_cancel(n.id);
  if n2.status <> 'cancelled' then raise exception 'cancel failed'; end if;
  begin perform public.notif_cancel(n.id); raise exception 'cancel twice'; exception when raise_exception then null; end;

  n := public.notif_send(jsonb_build_object('title', 'مجدول ٢', 'target_kind', 'class', 'scheduled_at', (now() + interval '2 minutes')::text,
        'church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000001', 'class_id', '30000000-0000-0000-0000-000000000001'));
  reset role;
  update public.notifications set scheduled_at = now() - interval '1 minute' where id = n.id;
  perform public.notif_tick();
  select * into n2 from public.notifications where id = n.id;
  if n2.status <> 'sent' or n2.recipients_count <> 2 then raise exception 'tick did not release: % %', n2.status, n2.recipients_count; end if;
end $$;
reset role;

-- ---------- 5. history visibility ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
do $$
declare h jsonb;
begin
  h := public.notif_history();
  if jsonb_array_length(h) <> 0 then raise exception 'servant B sees class A history (%)', jsonb_array_length(h); end if;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
do $$
declare h jsonb;
begin
  h := public.notif_history();
  if jsonb_array_length(h) < 4 then raise exception 'service manager history = %', jsonb_array_length(h); end if;
  if public.notif_audience_count(jsonb_build_object('target_kind', 'service', 'audience', 'staff',
       'church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000001')) <> 2 then
    raise exception 'staff audience';
  end if;
  perform public.notif_send(jsonb_build_object('title', 'اجتماع خدام', 'target_kind', 'service', 'audience', 'staff',
       'church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000001'));
end $$;
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$
declare inbox jsonb;
begin
  if public.notif_unread_count() <> 1 then raise exception 'unread = %', public.notif_unread_count(); end if;
  inbox := public.notif_inbox();
  if jsonb_array_length(inbox) <> 1 or inbox->0->>'title' <> 'اجتماع خدام' then raise exception 'inbox %', inbox; end if;
  if public.notif_mark_read() <> 1 then raise exception 'mark read'; end if;
  if public.notif_unread_count() <> 0 then raise exception 'still unread'; end if;
  if exists (select 1 from public.notification_recipients where profile_id = '00000000-0000-0000-0000-000000000003') then
    raise exception 'RLS: other servant rows visible';
  end if;
end $$;
reset role;

-- ---------- 6. child portal ----------
select pg_temp.as_anon();
do $$
declare inbox jsonb;
begin
  if public.child_notif_unread('29901010000001') <> 3 then raise exception 'child unread = %', public.child_notif_unread('29901010000001'); end if;
  inbox := public.child_notifications('29901010000001');
  if jsonb_array_length(inbox) <> 3 then raise exception 'child inbox %', jsonb_array_length(inbox); end if;
  if not exists (select 1 from jsonb_array_elements(inbox) x where x->>'link_url' = '/child/attendance') then raise exception 'link missing'; end if;
  perform public.child_notif_mark_read('29901010000001', array[(inbox->0->>'id')::uuid]);
  if public.child_notif_unread('29901010000001') <> 2 then raise exception 'child unread after one = %', public.child_notif_unread('29901010000001'); end if;
  perform public.child_notif_mark_read('29901010000001');
  if public.child_notif_unread('29901010000001') <> 0 then raise exception 'child unread after all'; end if;
  if public.child_notif_unread('29901010000003') <> 0 then raise exception 'child B leak'; end if;
  begin perform public.child_notifications('bad'); raise exception 'unknown code accepted'; exception when no_data_found then null; end;
  begin perform count(*) from public.notification_recipients; raise exception 'anon read'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---------- 7. push subscriptions ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$
declare sid uuid;
begin
  sid := public.push_subscribe(jsonb_build_object('endpoint', 'https://push.example/a1', 'keys', jsonb_build_object('p256dh', 'P', 'auth', 'A')));
  if (select profile_id from public.push_subscriptions where id = sid) <> '00000000-0000-0000-0000-000000000002' then raise exception 'sub owner'; end if;
  if public.push_subscribe(jsonb_build_object('endpoint', 'https://push.example/a1', 'keys', jsonb_build_object('p256dh', 'P2', 'auth', 'A2'))) <> sid then raise exception 'upsert'; end if;
  begin
    perform public.push_subscribe(jsonb_build_object('endpoint', 'http://insecure', 'keys', jsonb_build_object('p256dh', 'P', 'auth', 'A')));
    raise exception 'insecure endpoint accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.notif_push_queue(10); raise exception 'queue callable by servant'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.as_anon();
do $$
declare sid uuid;
begin
  sid := public.child_push_subscribe('29901010000001', jsonb_build_object('endpoint', 'https://push.example/c1', 'keys', jsonb_build_object('p256dh', 'P', 'auth', 'A')));
  if sid is null then raise exception 'child sub id'; end if;
  begin
    perform (select count(*) from public.push_subscriptions);
    raise exception 'anon can read push_subscriptions';
  exception when insufficient_privilege then null; end;
  if not public.child_push_unsubscribe('29901010000001', 'https://push.example/c1') then raise exception 'child unsubscribe'; end if;
  if public.child_push_unsubscribe('29901010000003', 'https://push.example/c1') then raise exception 'child B unsubscribed A device'; end if;
  perform public.child_push_subscribe('29901010000001', jsonb_build_object('endpoint', 'https://push.example/c1', 'keys', jsonb_build_object('p256dh', 'P', 'auth', 'A')));
end $$;
reset role;
do $$ begin
  if (select person_id from public.push_subscriptions where endpoint = 'https://push.example/c1') <> '40000000-0000-0000-0000-000000000001' then raise exception 'child sub owner'; end if;
end $$;

-- ---------- 8. automations ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
insert into public.notification_automations (id, church_id, service_id, trigger_key, recipient, name, title_template, body_template, config) values
  ('80000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'points_added', 'student', 'نقاط', '🎉 نقاط جديدة', 'تمت إضافة [النقاط] نقطة إلى رصيدك يا [الاسم الأول] — السبب: [السبب]', '{"min_points": 5}'),
  ('80000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'attendance', 'student', 'حضور', '✅ تم تسجيل حضورك', '[الاسم]، تم تسجيل حضورك في [المناسبة] (+[النقاط])', '{}'),
  ('80000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'attendance', 'class_servants', 'حضور للخدام', 'حضور: [الاسم]', 'حضر [الاسم] من [الفصل]', '{}');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  begin
    insert into public.notification_automations (church_id, service_id, trigger_key, recipient, name, title_template)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'attendance', 'student', 'x', 'x');
    raise exception 'servant A created service automation';
  exception when insufficient_privilege then null; end;
  insert into public.notification_automations (church_id, service_id, class_id, trigger_key, recipient, name, title_template, is_active)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'points_deducted', 'student', 'خصم', 'خصم [النقاط]', false);
end $$;
reset role;

do $$
declare before int; after int; r record;
begin
  select count(*) into before from public.notification_recipients where person_id = '40000000-0000-0000-0000-000000000001';
  insert into public.points_log (enrollment_id, cause_id, delta) values ('50000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 3);
  select count(*) into after from public.notification_recipients where person_id = '40000000-0000-0000-0000-000000000001';
  if after <> before then raise exception 'min_points ignored'; end if;
  insert into public.points_log (enrollment_id, cause_id, delta) values ('50000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 5);
  select count(*) into after from public.notification_recipients where person_id = '40000000-0000-0000-0000-000000000001';
  if after <> before + 1 then raise exception 'points automation did not fire (% → %)', before, after; end if;
  -- all rows share now() inside this transaction → pick the automation row explicitly
  select nr.* into r from public.notification_recipients nr join public.notifications n on n.id = nr.notification_id
   where nr.person_id = '40000000-0000-0000-0000-000000000001' and n.source = 'automation' order by nr.id desc limit 1;
  if r.title is null then raise exception 'automation row missing'; end if;
  if r.title <> '🎉 نقاط جديدة' or r.body <> 'تمت إضافة 5 نقطة إلى رصيدك يا مينا — السبب: سلوك' then raise exception 'render: % / %', r.title, r.body; end if;
  if r.link_url <> '/child/points' then raise exception 'default link %', r.link_url; end if;
  insert into public.points_log (enrollment_id, cause_id, delta) values ('50000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', -2);
  select count(*) into after from public.notification_recipients where person_id = '40000000-0000-0000-0000-000000000001';
  if after <> before + 1 then raise exception 'disabled automation fired'; end if;

  insert into public.attendance_log (enrollment_id, event_id, points_delta) values ('50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 2);
  if (select count(*) from public.notification_recipients where person_id = '40000000-0000-0000-0000-000000000002' and title = '✅ تم تسجيل حضورك') <> 1 then raise exception 'attendance student'; end if;
  if (select count(*) from public.notification_recipients where profile_id = '00000000-0000-0000-0000-000000000002' and title = 'حضور: مريم') <> 1 then raise exception 'attendance staff A'; end if;
  if (select count(*) from public.notification_recipients where profile_id = '00000000-0000-0000-0000-000000000003' and title = 'حضور: مريم') <> 0 then raise exception 'attendance staff B leak'; end if;
  if (select count(*) from public.notification_recipients where profile_id = '00000000-0000-0000-0000-000000000004' and title = 'حضور: مريم') <> 1 then raise exception 'attendance staff manager'; end if;
  delete from public.attendance_log where enrollment_id = '50000000-0000-0000-0000-000000000002';
  insert into public.attendance_log (enrollment_id, event_id, points_delta) values ('50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 2);
  if (select count(*) from public.notification_recipients where person_id = '40000000-0000-0000-0000-000000000002' and title = '✅ تم تسجيل حضورك') <> 1 then raise exception 'attendance repeated same day'; end if;
  if (select count(*) from public.notifications where source = 'automation') < 3 then raise exception 'automation history'; end if;
end $$;

-- ---------- 9. module grant removed → automations silent ----------
delete from public.module_access where module_key = 'notifications';
do $$
declare before int; after int;
begin
  select count(*) into before from public.notification_recipients;
  insert into public.points_log (enrollment_id, cause_id, delta) values ('50000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 10);
  select count(*) into after from public.notification_recipients;
  if after <> before then raise exception 'automation fired without module grant'; end if;
end $$;
insert into public.module_access (module_key, church_id) values ('notifications', '10000000-0000-0000-0000-000000000001');

-- ---------- 10. push queue (service role) ----------
-- (the local shim's service_role has no table grants; on Supabase it bypasses RLS — RPCs are security definer so
--  we call them as service_role and verify side effects as superuser)
create temp table _q as select null::jsonb as q;
grant all on _q to service_role;
set role service_role;
do $$
declare qq jsonb; n int;
begin
  qq := public.notif_push_queue(100);
  if not exists (select 1 from jsonb_array_elements(qq) x where x->>'endpoint' = 'https://push.example/a1') then raise exception 'queue missing servant device'; end if;
  if not exists (select 1 from jsonb_array_elements(qq) x where x->>'endpoint' = 'https://push.example/c1') then raise exception 'queue missing child device'; end if;
  update _q set q = qq;
  n := public.notif_push_mark(jsonb_build_array(
    jsonb_build_object('recipient_id', qq->0->>'recipient_id', 'subscription_id', qq->0->>'subscription_id', 'ok', true),
    jsonb_build_object('recipient_id', qq->1->>'recipient_id', 'subscription_id', qq->1->>'subscription_id', 'ok', false, 'gone', true, 'error', '410')));
  if n <> 2 then raise exception 'mark count'; end if;
end $$;
reset role;
do $$
declare q jsonb;
begin
  select _q.q into q from _q;
  if exists (select 1 from public.notification_recipients r where r.push_status = 'pending' and r.person_id = '40000000-0000-0000-0000-000000000002') then raise exception 'no_device not marked'; end if;
  if (select push_status from public.notification_recipients where id = (q->0->>'recipient_id')::uuid) <> 'sent' then raise exception 'mark sent'; end if;
  if exists (select 1 from public.push_subscriptions where id = (q->1->>'subscription_id')::uuid) then raise exception 'gone device kept'; end if;
end $$;

-- ---------- 11. realtime publication ----------
do $$ begin
  -- 0046: notification_recipients moved to broadcast (zzz_rt_* triggers)
  -- 20261016: broadcast bus triggers instead of the publication
  if (select count(*) from pg_trigger where tgname = 'zzz_rt_ins'
        and tgrelid in ('public.notifications'::regclass, 'public.notification_automations'::regclass)) <> 2 then
    raise exception 'notifications broadcast triggers missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'zzz_rt_ins' and tgrelid = 'public.notification_recipients'::regclass) then
    raise exception 'notification_recipients broadcast trigger missing';
  end if;
end $$;

select 'NOTIFICATION TESTS PASSED' as result;
rollback;
