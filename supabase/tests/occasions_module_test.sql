-- =====================================================================
-- Functional test for migration 0032 (الفعاليات). Run on the local shim DB
-- after run_migrations.sh:  psql -d app -f supabase/tests/occasions_module_test.sql
-- Every "assert" raises on failure; a clean run ends with «OCCASION TESTS PASSED».
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

-- ---------- 1. module NOT granted → nothing visible, insert rejected, child sees nothing ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  if (public.occasion_permissions()->>'view')::boolean then raise exception 'view without grant'; end if;
  begin
    insert into public.occasions (church_id, title, starts_at) values ('10000000-0000-0000-0000-000000000001', 'x', now() + interval '1 day');
    raise exception 'insert allowed without grant';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.as_anon();
do $$ begin
  if jsonb_array_length(public.child_portal_occasions('29901010000001')) <> 0 then raise exception 'child sees occasions without grant'; end if;
end $$;
reset role;

-- ---------- 2. owner grants the module + creates occasions ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.module_access (module_key, church_id) values ('occasions', '10000000-0000-0000-0000-000000000001');

-- service-wide trip · capacity 2 · manual confirm · 10 check-in points
insert into public.occasions (id, church_id, service_id, title, kind, starts_at, ends_at, capacity, checkin_points, registration_deadline) values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'رحلة الدير', 'trip', now() + interval '7 days', now() + interval '7 days 8 hours', 2, 10, now() + interval '5 days');
-- class A only · auto confirm · unlimited
insert into public.occasions (id, church_id, service_id, class_id, title, kind, starts_at, auto_confirm) values
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
   'احتفال الفصل', 'celebration', now() + interval '2 days', true);
-- draft (children must not see it)
insert into public.occasions (id, church_id, title, starts_at, status) values
  ('70000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'مسودة', now() + interval '3 days', 'draft');
-- deadline passed
insert into public.occasions (id, church_id, title, starts_at, registration_deadline) values
  ('70000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'فات الموعد', now() + interval '3 days', now() - interval '1 hour');

-- constraint / scope validation
do $$ begin
  begin
    insert into public.occasions (church_id, title, starts_at, ends_at) values ('10000000-0000-0000-0000-000000000001', 'bad', now() + interval '2 days', now() + interval '1 day');
    raise exception 'ends before start accepted';
  exception when check_violation then null; end;
  begin
    insert into public.occasions (church_id, service_id, class_id, title, starts_at) values
      ('10000000-0000-0000-0000-000000000001', null, '30000000-0000-0000-0000-000000000001', 'bad', now());
    raise exception 'class without service accepted';
  exception when check_violation then null; when others then if sqlerrm not like 'class does not belong%' then raise; end if; end;
  begin
    insert into public.occasions (church_id, title, starts_at, capacity) values ('10000000-0000-0000-0000-000000000001', 'bad', now(), 0);
    raise exception 'capacity 0 accepted';
  exception when check_violation then null; end;
end $$;

-- checklist items for the trip
insert into public.occasion_checklist_items (id, occasion_id, label, sort_order) values
  ('80000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'الدفع', 1),
  ('80000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', 'إذن ولي الأمر', 2);
-- an announcement
insert into public.occasion_notifications (occasion_id, kind, body, created_by) values
  ('70000000-0000-0000-0000-000000000001', 'announcement', 'التجمع ٧ صباحاً أمام الكنيسة', '00000000-0000-0000-0000-000000000001');
reset role;

-- ---------- 3. RLS per role ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');   -- servant B (class B)
do $$ declare n int; begin
  select count(*) into n from public.occasions;
  -- sees: trip (service-wide), draft (church), deadline (church) — NOT the class-A celebration
  if n <> 3 then raise exception 'servant B should see 3 occasions, got %', n; end if;
  if exists (select 1 from public.occasions where id = '70000000-0000-0000-0000-000000000002') then raise exception 'servant B sees class A occasion'; end if;
  if (public.occasion_permissions()->>'delete')::boolean then raise exception 'class servant can delete'; end if;
  -- class servant cannot create a service-wide occasion
  begin
    insert into public.occasions (church_id, service_id, title, starts_at) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'x', now() + interval '1 day');
    raise exception 'class servant created service-wide occasion';
  exception when insufficient_privilege then null; end;
  -- but can create for his class
  insert into public.occasions (church_id, service_id, class_id, title, starts_at) values
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'نشاط فصل ب', now() + interval '1 day');
  -- cannot announce on the service-wide trip (scope_contains)
  begin
    insert into public.occasion_notifications (occasion_id, kind, body, created_by) values
      ('70000000-0000-0000-0000-000000000001', 'announcement', 'x', '00000000-0000-0000-0000-000000000003');
    raise exception 'class servant announced on service-wide occasion';
  exception when insufficient_privilege then null; end;
  -- cannot add checklist items to the trip
  begin
    insert into public.occasion_checklist_items (occasion_id, label) values ('70000000-0000-0000-0000-000000000001', 'x');
    raise exception 'class servant edited trip checklist';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-000000000004');   -- service manager
do $$ begin
  if not (public.occasion_permissions()->>'delete')::boolean then raise exception 'service manager cannot delete'; end if;
  if (select count(*) from public.occasions) <> 5 then raise exception 'service manager should see 5'; end if;
end $$;
reset role;

-- ---------- 4. leader registers participants · capacity · duplicate ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');   -- servant A
do $$ declare r public.occasion_registrations; begin
  -- direct insert is blocked (RPC only)
  begin
    insert into public.occasion_registrations (occasion_id, enrollment_id, person_id, church_id, service_id, class_id, ticket_code)
    values ('70000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
            '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'X');
    raise exception 'direct registration insert allowed';
  exception when insufficient_privilege then null; end;

  r := public.occasion_register('70000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'confirmed');
  if r.status <> 'confirmed' or r.ticket_code !~ '^T-[0-9A-F]{10}$' or r.source <> 'leader' then raise exception 'bad registration %', r; end if;
  if r.person_id <> '40000000-0000-0000-0000-000000000001' or r.class_id <> '30000000-0000-0000-0000-000000000001' then raise exception 'trigger fill failed'; end if;
  -- duplicate
  begin
    perform public.occasion_register('70000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001');
    raise exception 'duplicate accepted';
  exception when others then if sqlerrm <> 'already_registered' then raise; end if; end;
  -- servant A cannot register class B's child
  begin
    perform public.occasion_register('70000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003');
    raise exception 'cross-class registration accepted';
  exception when others then if sqlerrm <> 'forbidden' then raise; end if; end;
  -- مريم on the class A celebration (leader, confirmed)
  perform public.occasion_register('70000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'confirmed');
end $$;
reset role;

-- service manager fills the trip: seat 2 → Yusuf; seat 3 → full
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
do $$ begin
  perform public.occasion_register('70000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003', 'pending');
  begin
    perform public.occasion_register('70000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002');
    raise exception 'capacity not enforced';
  exception when others then if sqlerrm <> 'occasion_full' then raise; end if; end;
  begin
    perform public.occasion_register('70000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000003');
    raise exception 'out-of-scope registration accepted';
  exception when others then if sqlerrm <> 'out_of_scope' then raise; end if; end;
end $$;

-- counts (whole occasion)
do $$ declare c record; begin
  select * into c from public.occasion_counts(array['70000000-0000-0000-0000-000000000001'::uuid]);
  if c.pending <> 1 or c.confirmed <> 1 or c.active <> 2 or c.cancelled <> 0 then raise exception 'bad counts %', c; end if;
end $$;
reset role;

-- ---------- 5. participant visibility: servant A sees only his child on the trip ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ declare n int; begin
  select count(*) into n from public.occasion_participants('70000000-0000-0000-0000-000000000001');
  if n <> 1 then raise exception 'servant A should see 1 participant, got %', n; end if;
  select count(*) into n from public.occasion_registrations where occasion_id = '70000000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'RLS: servant A sees % registrations', n; end if;
end $$;
reset role;
-- cross-class status change: look the id up as owner, then try as servant A
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
create temp table _ids as select id from public.occasion_registrations where enrollment_id = '50000000-0000-0000-0000-000000000003';
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  begin
    perform public.occasion_set_status((select id from _ids limit 1), 'confirmed');
    raise exception 'cross-class status change accepted';
  exception when others then if sqlerrm <> 'forbidden' then raise; end if; end;
end $$;
reset role;

-- ---------- 6. child portal: board · register · pending vs auto confirm · deadline · cancel ----------
select pg_temp.as_anon();
do $$ declare lst jsonb; o jsonb; d jsonb; begin
  lst := public.child_portal_occasions('29901010000002');   -- مريم (class A)
  -- sees: trip, celebration, deadline-passed — not the draft, not class B activity
  if jsonb_array_length(lst) <> 3 then raise exception 'مريم should see 3 occasions, got % — %', jsonb_array_length(lst), lst; end if;
  select x into o from jsonb_array_elements(lst) x where x->>'id' = '70000000-0000-0000-0000-000000000001';
  if (o->>'can_register')::boolean then raise exception 'trip is full but can_register'; end if;
  if (o->>'remaining')::int <> 0 then raise exception 'remaining should be 0'; end if;
  select x into o from jsonb_array_elements(lst) x where x->>'id' = '70000000-0000-0000-0000-000000000002';
  if (o->>'can_register')::boolean then raise exception 'already registered (by leader) but can_register'; end if;
  if o->'my_registration'->>'status' <> 'confirmed' then raise exception 'leader registration not visible to child'; end if;
  select x into o from jsonb_array_elements(lst) x where x->>'id' = '70000000-0000-0000-0000-000000000004';
  if (o->>'can_register')::boolean then raise exception 'deadline passed but can_register'; end if;
  begin
    perform public.child_portal_occasion_register('29901010000002', '70000000-0000-0000-0000-000000000004');
    raise exception 'registered after deadline';
  exception when others then if sqlerrm <> 'deadline_passed' then raise; end if; end;
  begin
    perform public.child_portal_occasion_register('29901010000002', '70000000-0000-0000-0000-000000000001');
    raise exception 'registered on a full occasion';
  exception when others then if sqlerrm <> 'occasion_full' then raise; end if; end;
  begin
    perform public.child_portal_occasion('29901010000002', '70000000-0000-0000-0000-000000000003');
    raise exception 'child opened a draft';
  exception when others then if sqlerrm <> 'occasion_not_found' then raise; end if; end;

  -- يوسف (class B) cannot see / join the class-A celebration
  lst := public.child_portal_occasions('29901010000003');
  if exists (select 1 from jsonb_array_elements(lst) x where x->>'id' = '70000000-0000-0000-0000-000000000002') then raise exception 'يوسف sees class A occasion'; end if;
  begin
    perform public.child_portal_occasion_register('29901010000003', '70000000-0000-0000-0000-000000000002');
    raise exception 'يوسف joined class A occasion';
  exception when others then if sqlerrm <> 'occasion_not_found' then raise; end if; end;

  -- detail: checklist + notifications visible to a registered child (مينا on the trip)
  d := public.child_portal_occasion('29901010000001', '70000000-0000-0000-0000-000000000001');
  if jsonb_array_length(d->'checklist') <> 2 then raise exception 'checklist not returned'; end if;
  if not exists (select 1 from jsonb_array_elements(d->'notifications') n where n->>'kind' = 'announcement') then raise exception 'announcement missing'; end if;
  if not exists (select 1 from jsonb_array_elements(d->'notifications') n where n->>'kind' = 'status' and (n->>'mine')::boolean) then raise exception 'status notification missing'; end if;
  if d->'my_registration'->>'ticket_code' !~ '^T-' then raise exception 'ticket missing in detail'; end if;
end $$;
reset role;

-- free a seat: يوسف cancels himself → مريم joins (pending, manual confirm)
select pg_temp.as_anon();
do $$ declare o jsonb; begin
  o := public.child_portal_occasion_cancel('29901010000003', '70000000-0000-0000-0000-000000000001');
  if o->'my_registration'->>'status' <> 'cancelled' then raise exception 'self cancel failed'; end if;
  begin
    perform public.child_portal_occasion_cancel('29901010000003', '70000000-0000-0000-0000-000000000001');
    raise exception 'double cancel accepted';
  exception when others then if sqlerrm <> 'not_registered' then raise; end if; end;
  o := public.child_portal_occasion_register('29901010000002', '70000000-0000-0000-0000-000000000001');
  if o->'my_registration'->>'status' <> 'pending' then raise exception 'manual-confirm occasion should give pending'; end if;
  if o->'my_registration'->>'source' <> 'self' then raise exception 'source should be self'; end if;
  -- re-register يوسف → full again
  begin
    perform public.child_portal_occasion_register('29901010000003', '70000000-0000-0000-0000-000000000001');
    raise exception 'seat count wrong after cancel + join';
  exception when others then if sqlerrm <> 'occasion_full' then raise; end if; end;
end $$;
reset role;

-- ---------- 7. leader confirms · checklist · check-in (ticket + national id) · points · refund ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');   -- servant A
do $$ declare rid uuid; r public.occasion_registrations; res jsonb; pts int; begin
  select id into rid from public.occasion_registrations where occasion_id = '70000000-0000-0000-0000-000000000001' and enrollment_id = '50000000-0000-0000-0000-000000000002';
  r := public.occasion_set_status(rid, 'confirmed', 'دفعت');
  if r.status <> 'confirmed' or r.confirmed_at is null or r.note <> 'دفعت' then raise exception 'confirm failed'; end if;

  -- checklist marks
  perform public.occasion_checklist_mark(rid, '80000000-0000-0000-0000-000000000001', true);
  perform public.occasion_checklist_mark(rid, '80000000-0000-0000-0000-000000000001', true);   -- idempotent
  perform public.occasion_checklist_mark(rid, '80000000-0000-0000-0000-000000000002', true);
  perform public.occasion_checklist_mark(rid, '80000000-0000-0000-0000-000000000002', false);
  if (select checklist_done from public.occasion_participants('70000000-0000-0000-0000-000000000001') where id = rid) <> 1 then raise exception 'checklist count wrong'; end if;
  begin
    perform public.occasion_checklist_mark(rid, gen_random_uuid(), true);
    raise exception 'unknown item accepted';
  exception when others then if sqlerrm <> 'item_not_found' then raise; end if; end;

  -- check-in with the TICKET code → +10 points
  res := public.occasion_checkin('70000000-0000-0000-0000-000000000001', r.ticket_code);
  if res->>'result' <> 'checked_in' or (res->>'points')::int <> 10 or res->>'person_name' <> 'مريم' then raise exception 'checkin failed %', res; end if;
  select points into pts from public.enrollments where id = '50000000-0000-0000-0000-000000000002';
  if pts <> 10 then raise exception 'check-in points not awarded (%)', pts; end if;
  -- second scan → already
  res := public.occasion_checkin('70000000-0000-0000-0000-000000000001', lower(r.ticket_code));
  if res->>'result' <> 'already_checked_in' then raise exception 'second scan should say already'; end if;
  select points into pts from public.enrollments where id = '50000000-0000-0000-0000-000000000002';
  if pts <> 10 then raise exception 'points doubled'; end if;

  -- check-in مينا with his NATIONAL ID (card QR)
  res := public.occasion_checkin('70000000-0000-0000-0000-000000000001', '29901010000001');
  if res->>'result' <> 'checked_in' then raise exception 'national-id checkin failed'; end if;
  begin
    perform public.occasion_checkin('70000000-0000-0000-0000-000000000001', 'NOPE');
    raise exception 'unknown code accepted';
  exception when others then if sqlerrm <> 'unknown_code' then raise; end if; end;
  -- يوسف is cancelled (and out of servant A's scope) → registration_cancelled / forbidden
  begin
    perform public.occasion_checkin('70000000-0000-0000-0000-000000000001', '29901010000003');
    raise exception 'cancelled child checked in';
  exception when others then if sqlerrm not in ('registration_cancelled', 'forbidden') then raise; end if; end;

  -- move مريم back to confirmed → refund
  r := public.occasion_set_status(rid, 'confirmed');
  select points into pts from public.enrollments where id = '50000000-0000-0000-0000-000000000002';
  if pts <> 0 or r.points_log_id is not null or r.checked_in_at is not null then raise exception 'refund on leaving checked_in failed (%)', pts; end if;
  -- check in again then DELETE → refund by trigger
  r := public.occasion_set_status(rid, 'checked_in');
  select points into pts from public.enrollments where id = '50000000-0000-0000-0000-000000000002';
  if pts <> 10 then raise exception 're-checkin points'; end if;
  delete from public.occasion_registrations where id = rid;
  select points into pts from public.enrollments where id = '50000000-0000-0000-0000-000000000002';
  if pts <> 0 then raise exception 'delete refund failed (%)', pts; end if;

  -- notifications: مينا got status rows (registered-confirmed, then checked in)
  select count(*) into pts from public.occasion_notifications n
   join public.occasion_registrations x on x.id = n.registration_id
   where x.enrollment_id = '50000000-0000-0000-0000-000000000001' and n.kind = 'status';
  if pts < 2 then raise exception 'status notifications missing (%)', pts; end if;
end $$;
reset role;

-- ---------- 8. child portal points list labels the occasion source ----------
select pg_temp.as_anon();
do $$ declare n int; begin
  select count(*) into n from public.child_portal_points('29901010000001') where source = 'occasion' and delta = 10 and reason like 'حضور فعالية%';
  if n <> 1 then raise exception 'occasion points label missing (%)', n; end if;
  if (public.child_portal_occasion('29901010000001', '70000000-0000-0000-0000-000000000001'))->'my_registration'->>'status' <> 'checked_in' then
    raise exception 'portal status should be checked_in';
  end if;
  begin
    perform public.child_portal_occasion_cancel('29901010000001', '70000000-0000-0000-0000-000000000001');
    raise exception 'cancelled after check-in';
  exception when others then if sqlerrm <> 'already_checked_in' then raise; end if; end;
end $$;
reset role;

-- ---------- 9. occasion already started → child cannot register ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.occasions (id, church_id, title, starts_at) values
  ('70000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'بدأت', now() - interval '1 hour');
reset role;
select pg_temp.as_anon();
do $$ begin
  begin
    perform public.child_portal_occasion_register('29901010000001', '70000000-0000-0000-0000-000000000005');
    raise exception 'registered on a started occasion';
  exception when others then if sqlerrm <> 'occasion_started' then raise; end if; end;
end $$;
reset role;

-- ---------- 10. anon cannot read the tables directly ----------
select pg_temp.as_anon();
do $$ declare n int; begin
  select count(*) into n from public.occasions;
  if n <> 0 then raise exception 'anon reads occasions'; end if;
  select count(*) into n from public.occasion_registrations;
  if n <> 0 then raise exception 'anon reads registrations'; end if;
end $$;
reset role;

-- ---------- 11. realtime publication ----------
do $$ declare t text; begin
  foreach t in array array['occasions', 'occasion_registrations', 'occasion_checklist_items', 'occasion_checklist_marks', 'occasion_notifications'] loop
    -- 20261016: broadcast bus trigger instead of the publication
    if not exists (select 1 from pg_trigger where tgname = 'zzz_rt_ins' and tgrelid = ('public.' || t)::regclass) then
      raise exception 'realtime missing for %', t;
    end if;
  end loop;
end $$;

select 'OCCASION TESTS PASSED' as result;
rollback;
