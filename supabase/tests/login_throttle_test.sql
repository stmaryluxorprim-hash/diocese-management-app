-- =====================================================================
-- Functional test for 20261019120000 (login throttle · servant all-places row
-- · peek-before-redeem ticket).
--   psql -d app -f supabase/tests/login_throttle_test.sql
-- Ends with «LOGIN THROTTLE TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;
\i supabase/tests/_test_invites.sql

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000006');  -- servant with 2 places
insert into public.churches (id, name) values ('10000000-0000-0000-0000-000000000001', 'كنيسة أ');
insert into public.services (id, church_id, name) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل ب');
insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000006', 'مينا الخادم', 'srv-1', '0106', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now());
insert into public.servant_scopes (servant_id, church_id, service_id, class_id) values
  ('00000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
update public.persons set national_id = 'SRV-1' where id = (select person_id from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000006');

-- a child with a password
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';
select public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001', 'كيرلس', 'KID-1', 'male', null, '+201000000001', null, null, null, 0, 'kidpass1');
select public.servant_mirror_own_password('srvpass1');
reset role;

-- a fake client IP (PostgREST puts the headers in request.headers)
set local request.headers = '{"x-forwarded-for": "203.0.113.9, 10.0.0.1"}';

-- ---------- A. the limits + the IP ----------
do $$
begin
  if (public.login_limits()->>'code_max')::int <> 5 then raise exception 'default code_max must be 5: %', public.login_limits(); end if;
  if public.request_ip() <> '203.0.113.9' then raise exception 'request_ip must take the first x-forwarded-for hop, got %', public.request_ip(); end if;
end $$;

-- ---------- B. wrong password N times → lock · payload shape · no bcrypt while locked ----------
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare r jsonb; i int; t0 timestamptz; t1 timestamptz;
begin
  -- 4 wrong tries → wrong_password with a decreasing remaining counter
  for i in 1..4 loop
    r := public.account_login('KID-1', 'nope', false);
    if r->>'error' <> 'wrong_password' then raise exception 'try % must be wrong_password: %', i, r; end if;
    if (r->>'remaining')::int <> 5 - i then raise exception 'try % remaining must be %, got %', i, 5 - i, r; end if;
  end loop;
  -- the counter is persisted (the function RETURNED instead of raising)
  if (select fails from public.login_throttle where key = 'code:kid-1') <> 4 then raise exception 'fails must be 4'; end if;
  -- 5th wrong try → locked
  r := public.account_login('KID-1', 'nope', false);
  if r->>'error' <> 'too_many_attempts' then raise exception '5th try must lock: %', r; end if;
  if (r->>'retry_after')::int not between 14 * 60 and 15 * 60 then raise exception 'retry_after must be ~15 min: %', r; end if;
  if not exists (select 1 from public.login_throttle where key = 'code:kid-1' and locked_until > now() and lock_count = 1) then
    raise exception 'code row must be locked';
  end if;
  -- while locked even the RIGHT password is refused — and fast (no bcrypt)
  t0 := clock_timestamp();
  r := public.account_login('KID-1', 'kidpass1', false);
  t1 := clock_timestamp();
  if r->>'error' <> 'too_many_attempts' then raise exception 'locked code must refuse the right password: %', r; end if;
  if t1 - t0 > interval '150 milliseconds' then raise exception 'locked check must not hash / sleep (took %)', t1 - t0; end if;
  -- the other doors honour the same lock
  r := public.child_login('KID-1', 'kidpass1', false);
  if r->>'error' <> 'too_many_attempts' then raise exception 'child_login must honour the lock: %', r; end if;
  if public.person_verify_password('KID-1', 'kidpass1') then raise exception 'verify must be false while locked'; end if;
  -- another code from the same IP still works (IP limit is 40)
  r := public.account_login('SRV-1', 'srvpass1', false);
  if r->>'grant' is null then raise exception 'other code must still log in: %', r; end if;
  -- the IP row counted the 5 failures
  if (select fails from public.login_throttle where key = 'ip:203.0.113.9') <> 5 then raise exception 'ip fails must be 5'; end if;
end $$;
reset role;

-- ---------- C. owner: sees the lock · lifts it · a right password clears the counter ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local request.jwt.claim.role = 'authenticated';
do $$
declare l jsonb; n int;
begin
  l := public.login_locks();
  if (select count(*) from jsonb_array_elements(l) a where a->>'key' = 'code:kid-1' and (a->>'locked')::boolean) <> 1 then
    raise exception 'owner must see the locked code: %', l;
  end if;
  if (select a->>'person_name' from jsonb_array_elements(l) a where a->>'key' = 'code:kid-1') <> 'كيرلس' then
    raise exception 'lock row must carry the person name: %', l;
  end if;
  n := public.login_unlock('code:kid-1');
  if n <> 1 then raise exception 'unlock must delete 1 row, got %', n; end if;
end $$;
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';
do $$
declare ok boolean := false;
begin
  begin perform public.login_unlock('code:kid-1');
  exception when others then ok := sqlerrm like '%forbidden%'; end;
  if not ok then raise exception 'a non-owner must not unlock'; end if;
  if jsonb_array_length(public.login_locks()) <> 0 then raise exception 'a non-owner sees no locks'; end if;
end $$;
reset role;

set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare r jsonb;
begin
  -- unlocked → the right password works and clears the code counter
  r := public.account_login('KID-1', 'nope', false);
  if (r->>'remaining')::int <> 4 then raise exception 'after unlock the counter restarts: %', r; end if;
  r := public.account_login('KID-1', 'kidpass1', false);
  if r->>'grant' is null then raise exception 'right password must work after unlock: %', r; end if;
  if exists (select 1 from public.login_throttle where key = 'code:kid-1') then raise exception 'success must clear the code row'; end if;
end $$;
reset role;

-- ---------- D. owner-tuned limits (app_settings.login_limits) + doubling lock ----------
insert into public.app_settings (key, value) values ('login_limits', '{"code_max": 2, "code_lock_min": 1, "max_lock_min": 3}')
on conflict (key) do update set value = excluded.value;
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare r jsonb;
begin
  if (public.login_limits()->>'code_max')::int <> 2 or (public.login_limits()->>'ip_max')::int <> 40 then
    raise exception 'overrides must merge over the defaults: %', public.login_limits();
  end if;
  r := public.account_login('KID-1', 'nope', false);
  if (r->>'remaining')::int <> 1 then raise exception 'code_max 2 → remaining 1: %', r; end if;
  r := public.account_login('KID-1', 'nope', false);
  if r->>'error' <> 'too_many_attempts' or (r->>'retry_after')::int > 60 then raise exception '2nd try must lock for 1 min: %', r; end if;
  -- expire the lock by hand → the next lock doubles (2 min), capped by max_lock_min (3)
  update public.login_throttle set locked_until = now() - interval '1 second' where key = 'code:kid-1';
  perform public.account_login('KID-1', 'nope', false);
  r := public.account_login('KID-1', 'nope', false);
  if (r->>'retry_after')::int not between 100 and 120 then raise exception 'second lock must double to 2 min: %', r; end if;
  update public.login_throttle set locked_until = now() - interval '1 second' where key = 'code:kid-1';
  perform public.account_login('KID-1', 'nope', false);
  r := public.account_login('KID-1', 'nope', false);
  if (r->>'retry_after')::int > 180 then raise exception 'third lock must be capped at 3 min: %', r; end if;
end $$;
reset role;
delete from public.app_settings where key = 'login_limits';

-- ---------- E. IP lock (no code row involved) ----------
set local request.headers = '{"x-forwarded-for": "198.51.100.7"}';
insert into public.app_settings (key, value) values ('login_limits', '{"ip_max": 3, "code_max": 100}')
on conflict (key) do update set value = excluded.value;
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare r jsonb;
begin
  perform public.account_login('KID-1', 'x', false);
  perform public.account_login('SRV-1', 'x', false);
  r := public.account_login('KID-1', 'x', false);                 -- 3rd failure from this IP → IP locked
  if r->>'error' <> 'too_many_attempts' then raise exception 'IP must lock on the 3rd failure: %', r; end if;
  r := public.account_login('SRV-1', 'srvpass1', false);          -- a different code, right password, same IP
  if r->>'error' <> 'too_many_attempts' then raise exception 'a locked IP blocks every code: %', r; end if;
end $$;
reset role;
-- a different IP is not affected
set local request.headers = '{"x-forwarded-for": "192.0.2.1"}';
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare r jsonb;
begin
  r := public.account_login('SRV-1', 'srvpass1', false);
  if r->>'grant' is null then raise exception 'another IP must not be locked: %', r; end if;
end $$;
reset role;
delete from public.app_settings where key = 'login_limits';
delete from public.login_throttle;

-- ---------- F. servant all-places row · mint with church null · peek then redeem ----------
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare r jsonb; s jsonb; a jsonb;
begin
  r := public.account_login('SRV-1', 'srvpass1', true);
  -- 2 places → all-places row first + 2 per-place rows
  if jsonb_array_length(r->'accounts') <> 3 then raise exception 'SRV-1 must list 3 servant rows: %', r; end if;
  a := r->'accounts'->0;
  if not (a->>'all_places')::boolean or a->>'church_id' is not null or jsonb_array_length(a->'places') <> 2 then
    raise exception 'first row must be the all-places row with 2 places: %', a;
  end if;
  if (r->'accounts'->1->>'all_places') is not null or r->'accounts'->1->>'church_id' is null then
    raise exception 'per-place rows must follow: %', r;
  end if;
  -- minting the all-places row = church null → ticket without a place
  s := public.account_session_from_login(r->>'grant', 'servant', null, null, null, null);
  if s->>'ticket' is null then raise exception 'servant ticket expected: %', s; end if;
  perform set_config('test.ticket', s->>'ticket', false);
end $$;
reset role;

-- give the servant an active place first so we can see the all-places mint clear it
insert into public.servant_active_places (servant_id, church_id, service_id, class_id) values
  ('00000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
do $$
declare p jsonb; red jsonb; ok boolean := false;
begin
  -- peek does NOT consume
  p := public.account_switch_peek(current_setting('test.ticket'));
  if p->>'user_id' <> 'srv-1' then raise exception 'peek must identify the servant: %', p; end if;
  p := public.account_switch_peek(current_setting('test.ticket'));
  if p->>'user_id' <> 'srv-1' then raise exception 'peek must be repeatable'; end if;
  -- redeem consumes and CLEARS the active place (all-places session)
  red := public.account_switch_redeem(current_setting('test.ticket'));
  if red->>'user_id' <> 'srv-1' then raise exception 'redeem failed: %', red; end if;
  if exists (select 1 from public.servant_active_places where servant_id = '00000000-0000-0000-0000-000000000006') then
    raise exception 'all-places mint must clear the active place';
  end if;
  begin perform public.account_switch_peek(current_setting('test.ticket'));
  exception when others then ok := sqlerrm like '%invalid_ticket%'; end;
  if not ok then raise exception 'a redeemed ticket must not peek'; end if;
end $$;

-- the all-places session sees BOTH classes; my_accounts marks no active place
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';
do $$
declare n int; acc jsonb;
begin
  select count(*) into n from public.my_scopes();
  if n <> 2 then raise exception 'all-places session must expose 2 scopes, got %', n; end if;
  acc := public.my_accounts('servant', null);
  if acc->'current_place' is not null and jsonb_typeof(acc->'current_place') <> 'null' then raise exception 'current_place must be null: %', acc; end if;
  -- narrowing to one place still works from the switch modal
  perform public.servant_set_active_place('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
  select count(*) into n from public.my_scopes();
  if n <> 1 then raise exception 'narrowed session must expose 1 scope, got %', n; end if;
  -- and back to all
  perform public.servant_set_active_place(null);
  select count(*) into n from public.my_scopes();
  if n <> 2 then raise exception 'back to all: 2 scopes, got %', n; end if;
end $$;
reset role;

rollback;
\echo LOGIN THROTTLE TESTS PASSED
