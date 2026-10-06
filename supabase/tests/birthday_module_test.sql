-- =====================================================================
-- Functional test for migration 0028 (أعياد الميلاد). Run on the local
-- shim DB after run_migrations.sh:  psql -d app -f supabase/tests/birthday_module_test.sql
-- Every "assert" raises on failure; a clean run ends with «BIRTHDAY TESTS PASSED».
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
-- persons: 3 born in March (two in class A, one in class B), one in July, one without birthdate
insert into public.persons (id, national_id, name, birthdate, phone) values
  ('40000000-0000-0000-0000-000000000001', '29901010000001', 'مينا',  '2015-03-05', '01000000001'),
  ('40000000-0000-0000-0000-000000000002', '29901010000002', 'مريم',  '2016-03-05', '01000000002'),
  ('40000000-0000-0000-0000-000000000003', '29901010000003', 'يوسف',  '2014-03-20', null),
  ('40000000-0000-0000-0000-000000000004', '29901010000004', 'سارة',  '2013-07-01', '01000000004'),
  ('40000000-0000-0000-0000-000000000005', '29901010000005', 'بلا تاريخ', null, null),
  ('40000000-0000-0000-0000-000000000006', '29901010000006', 'كبيسة', '2016-02-29', null);
-- 0042: the portal now needs a session token; for the legacy tests the raw code doubles as the token
insert into public.child_sessions (person_id, token_hash, expires_at)
select id, encode(digest(national_id, 'sha256'), 'hex'), now() + interval '1 day' from public.persons;

insert into public.enrollments (id, person_id, church_id, service_id, class_id, points, created_at) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 50, '2024-01-01'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 0, '2024-01-01'),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 0, '2024-01-01'),
  ('50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 0, '2024-01-01'),
  ('50000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 0, '2024-01-01'),
  ('50000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 0, '2024-01-01');
-- مينا is ALSO enrolled in class B, later (one person, two enrollments → must appear once, class A first)
insert into public.enrollments (id, person_id, church_id, service_id, class_id, points, created_at) values
  ('50000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 5, '2024-06-01');

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

-- ---------- 1. module NOT granted → gift rejected, greetings invisible ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  begin
    perform public.birthday_gift('50000000-0000-0000-0000-000000000001', 2026, 10);
    raise exception 'gift allowed without module grant';
  exception when others then
    if sqlerrm not like '%module_not_visible%' then raise; end if;
  end;
  begin
    insert into public.birthday_greetings (enrollment_id, year, kind) values ('50000000-0000-0000-0000-000000000001', 2026, 'call');
    raise exception 'greeting insert allowed without grant';
  exception when insufficient_privilege then null; end;
  -- the month RPC is security invoker: enrollments are core data → still visible
  if (select count(*) from public.birthdays_in_month(2026, 3)) <> 2 then
    raise exception 'servant A should see 2 March birthdays (own class), sees %', (select count(*) from public.birthdays_in_month(2026, 3));
  end if;
end $$;
reset role;

-- ---------- 2. owner grants the module ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.module_access (module_key, church_id) values ('birthdays', null);
do $$
declare r record; n int := 0; prev_day int := 0;
begin
  for r in select * from public.birthdays_in_month(2026, 3) loop
    n := n + 1;
    if r.birth_day < prev_day then raise exception 'not ordered by day'; end if;
    prev_day := r.birth_day;
    if r.name = 'مينا' then
      if r.turns_age <> 11 then raise exception 'مينا turns 11 in 2026, got %', r.turns_age; end if;
      if r.enrollments_count <> 2 then raise exception 'مينا has 2 enrollments, got %', r.enrollments_count; end if;
      if r.class_id <> '30000000-0000-0000-0000-000000000001' then raise exception 'first enrollment expected (class A)'; end if;
    end if;
    if r.gift_points is not null then raise exception 'no gift yet'; end if;
    if r.greetings <> '[]'::jsonb then raise exception 'no greetings yet'; end if;
  end loop;
  if n <> 3 then raise exception 'owner should see 3 March birthdays, saw %', n; end if;
  if (select count(*) from public.birthdays_in_month(2026, 3, null, null, '30000000-0000-0000-0000-000000000002')) <> 2 then
    raise exception 'class B filter should give 2 (مينا + يوسف)';
  end if;
  if (select count(*) from public.birthdays_in_month(2026, 7)) <> 1 then raise exception 'July should have 1'; end if;
  if (select count(*) from public.birthdays_in_month(2026, 2)) <> 1 then raise exception 'February should have 1'; end if;
  if (select count(*) from public.birthdays_in_month(2026, 12)) <> 0 then raise exception 'December should have 0'; end if;
end $$;

-- upcoming: "today" = 2026-03-01 → مينا + مريم (day 5, 4 days left) within 7 days; يوسف (day 20) not
do $$ begin
  if (select count(*) from public.birthdays_upcoming(7, '2026-03-01')) <> 2 then
    raise exception 'upcoming 7 days from 2026-03-01 should be 2, got %', (select count(*) from public.birthdays_upcoming(7, '2026-03-01'));
  end if;
  if (select min(days_left) from public.birthdays_upcoming(7, '2026-03-01')) <> 4 then raise exception 'days_left should be 4'; end if;
  -- wrap across the year: 70 days from Dec 28 reach March 5 (+ Feb 28 for the leap-day child)
  if (select count(*) from public.birthdays_upcoming(70, '2026-12-28')) <> 3 then raise exception 'year wrap failed'; end if;
  if (select turns_age from public.birthdays_upcoming(70, '2026-12-28') where name = 'مينا') <> 12 then raise exception 'turns_age across year wrap should be 12'; end if;
  -- Feb 29 birthday on a non-leap year → Feb 28
  if (select next_birthday from public.birthdays_upcoming(70, '2026-12-28') where name = 'كبيسة') <> '2027-02-28' then raise exception 'leap day fallback failed'; end if;
  -- today is a birthday → days_left 0
  if (select count(*) from public.birthdays_upcoming(0, '2026-03-05')) <> 2 then raise exception 'today birthdays should be 2'; end if;
end $$;
reset role;

-- ---------- 3. servant A: greetings + gift within scope ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$
declare res jsonb;
begin
  insert into public.birthday_greetings (enrollment_id, year, kind, message)
  values ('50000000-0000-0000-0000-000000000001', 2026, 'whatsapp', 'كل سنة وأنت طيب');
  if (select class_id from public.birthday_greetings limit 1) <> '30000000-0000-0000-0000-000000000001' then raise exception 'trigger did not fill scope'; end if;
  if (select person_id from public.birthday_greetings limit 1) <> '40000000-0000-0000-0000-000000000001' then raise exception 'trigger did not fill person'; end if;
  if (select recorded_by from public.birthday_greetings limit 1) <> '00000000-0000-0000-0000-000000000002' then raise exception 'recorded_by not defaulted'; end if;

  -- a greeting for an enrollment outside my scope is refused
  begin
    insert into public.birthday_greetings (enrollment_id, year, kind) values ('50000000-0000-0000-0000-000000000003', 2026, 'call');
    raise exception 'greeting outside scope allowed';
  exception when insufficient_privilege then null; end;

  -- a direct insert of kind gift is refused (RPC only)
  begin
    insert into public.birthday_greetings (enrollment_id, year, kind, points) values ('50000000-0000-0000-0000-000000000001', 2026, 'gift', 5);
    raise exception 'direct gift insert allowed';
  exception when insufficient_privilege then null; end;

  begin
    perform public.birthday_gift('50000000-0000-0000-0000-000000000001', 2026, 0);
    raise exception 'zero points accepted';
  exception when others then if sqlerrm not like '%invalid_points%' then raise; end if; end;

  begin
    perform public.birthday_gift('50000000-0000-0000-0000-000000000003', 2026, 10);
    raise exception 'gift outside scope allowed';
  exception when others then if sqlerrm not like '%forbidden%' then raise; end if; end;

  res := public.birthday_gift('50000000-0000-0000-0000-000000000001', 2026, 10, 'هدية');
  if (res->>'balance_after')::int <> 60 then raise exception 'balance after gift should be 60, got %', res->>'balance_after'; end if;
  if (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000001') <> 60 then raise exception 'enrollment points not updated'; end if;
  if (select count(*) from public.points_log where enrollment_id = '50000000-0000-0000-0000-000000000001' and delta = 10) <> 1 then raise exception 'points_log row missing'; end if;

  begin
    perform public.birthday_gift('50000000-0000-0000-0000-000000000001', 2026, 10);
    raise exception 'double gift allowed';
  exception when others then if sqlerrm not like '%already_gifted%' then raise; end if; end;

  if (select gift_points from public.birthdays_in_month(2026, 3) where name = 'مينا') <> 10 then raise exception 'gift_points not reported'; end if;
  if (select jsonb_array_length(greetings) from public.birthdays_in_month(2026, 3) where name = 'مينا') <> 2 then raise exception 'greetings should be 2'; end if;
  if (select gift_points from public.birthdays_in_month(2027, 3) where name = 'مينا') is not null then raise exception 'gift must be per year'; end if;

  delete from public.birthday_greetings where kind = 'whatsapp';
  if (select count(*) from public.birthday_greetings where kind = 'whatsapp') <> 0 then raise exception 'own greeting delete failed'; end if;
  delete from public.birthday_greetings where kind = 'gift';
  if (select count(*) from public.birthday_greetings where kind = 'gift') <> 1 then raise exception 'gift row deletable by servant'; end if;

  begin
    perform public.birthday_gift_cancel((select id from public.birthday_greetings where kind = 'gift'));
    raise exception 'servant cancelled a gift';
  exception when others then if sqlerrm not like '%forbidden%' then raise; end if; end;
end $$;
reset role;

-- ---------- 4. servant B: isolation + gift guard is per PERSON ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
do $$ begin
  if (select count(*) from public.birthdays_in_month(2026, 3)) <> 2 then raise exception 'servant B should see 2'; end if;
  if exists (select 1 from public.birthdays_in_month(2026, 3) where name = 'مريم') then raise exception 'servant B sees class A child'; end if;
  if (select count(*) from public.birthday_greetings) <> 0 then raise exception 'servant B should not read class A greeting rows'; end if;
  -- the gift guard lives in the SECURITY DEFINER RPC → still refused through the class-B enrollment
  begin
    perform public.birthday_gift('50000000-0000-0000-0000-000000000006', 2026, 10);
    raise exception 'double gift via class B allowed';
  exception when others then if sqlerrm not like '%already_gifted%' then raise; end if; end;
end $$;
reset role;

-- ---------- 5. service manager: cancel the gift → balance restored ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
do $$
declare res jsonb;
begin
  if (select count(*) from public.birthdays_in_month(2026, 3)) <> 3 then raise exception 'manager should see 3'; end if;
  res := public.birthday_gift_cancel((select id from public.birthday_greetings where kind = 'gift'));
  if (res->>'points')::int <> 10 then raise exception 'cancel should report 10'; end if;
  if (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000001') <> 50 then raise exception 'balance not restored after cancel'; end if;
  if (select count(*) from public.birthday_greetings where kind = 'gift') <> 0 then raise exception 'gift row not removed'; end if;
  res := public.birthday_gift('50000000-0000-0000-0000-000000000001', 2026, 7);
  if (res->>'balance_after')::int <> 57 then raise exception 're-gift failed'; end if;
end $$;
reset role;

-- ---------- 6. card templates: scope RLS + one default per scope ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  begin
    insert into public.birthday_card_templates (church_id, name) values ('10000000-0000-0000-0000-000000000001', 'x');
    raise exception 'class servant created church-wide template';
  exception when insufficient_privilege then null; end;
  insert into public.birthday_card_templates (church_id, service_id, class_id, name, is_default)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'كارت أ', true);
  insert into public.birthday_card_templates (church_id, service_id, class_id, name, is_default)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'كارت أ2', true);
  if (select count(*) from public.birthday_card_templates where is_default) <> 1 then raise exception 'two defaults in one scope'; end if;
  if (select name from public.birthday_card_templates where is_default) <> 'كارت أ2' then raise exception 'latest default should win'; end if;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.birthday_card_templates (id, church_id, name, is_default) values ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'كارت الكنيسة', true);
do $$ begin
  if (select count(*) from public.birthday_card_templates where is_default) <> 2 then raise exception 'church default reset class default'; end if;
  begin
    insert into public.birthday_card_templates (church_id, class_id, name) values ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'x');
    raise exception 'class without service accepted';
  exception when others then
    if sqlerrm not like '%class does not belong%' and sqlstate <> '23514' then raise; end if;
  end;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
do $$ begin
  if (select count(*) from public.birthday_card_templates) <> 1 then raise exception 'servant B should see 1 template, sees %', (select count(*) from public.birthday_card_templates); end if;
end $$;
reset role;

-- ---------- 7. settings ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
do $$ begin
  begin
    insert into public.birthday_settings (church_id, gift_points) values ('10000000-0000-0000-0000-000000000001', 20);
    raise exception 'service manager wrote settings';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.birthday_settings (church_id, gift_points) values ('10000000-0000-0000-0000-000000000001', 20);
insert into public.birthday_settings (church_id, gift_points) values (null, 5);
do $$ begin
  begin
    insert into public.birthday_settings (church_id, gift_points) values (null, 6);
    raise exception 'two global rows';
  exception when unique_violation then null; end;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  if (select count(*) from public.birthday_settings) <> 2 then raise exception 'servant should read church + global settings'; end if;
end $$;
reset role;

-- ---------- 8. child portal (anon) ----------
select pg_temp.as_anon();
do $$
declare j jsonb;
begin
  j := public.child_portal_birthday('29901010000001');
  if (j->>'module_granted')::boolean is not true then raise exception 'portal: module should be granted'; end if;
  if (j->'card'->>'name') <> 'كارت أ2' then raise exception 'portal: class default card expected, got %', j->'card'->>'name'; end if;
  if (j->'gift'->>'points')::int <> 7 then raise exception 'portal: gift 7 expected'; end if;
  if (j->'constants'->>'class_name') <> 'فصل أ' then raise exception 'portal: constants missing'; end if;
  if (j->>'days_left')::int < 0 or (j->>'days_left')::int > 366 then raise exception 'portal: days_left out of range'; end if;
  j := public.child_portal_birthday('29901010000003');
  if (j->'card'->>'name') <> 'كارت الكنيسة' then raise exception 'portal: church card fallback expected'; end if;
  j := public.child_portal_birthday('29901010000005');
  if (j->>'is_birthday')::boolean then raise exception 'portal: no birthdate should not be birthday'; end if;
  if (select count(*) from public.child_portal_points('29901010000001') where source = 'birthday' and delta = 7) <> 1 then
    raise exception 'portal points: birthday gift row missing';
  end if;
end $$;
reset role;

-- ---------- 9. realtime ----------
do $$ begin
  -- 20261016: broadcast bus triggers instead of the publication
  if (select count(*) from pg_trigger where tgname = 'zzz_rt_ins'
        and tgrelid in ('public.birthday_greetings'::regclass, 'public.birthday_card_templates'::regclass, 'public.birthday_settings'::regclass)) <> 3 then
    raise exception 'birthday broadcast triggers missing';
  end if;
end $$;

select 'BIRTHDAY TESTS PASSED' as result;
rollback;
