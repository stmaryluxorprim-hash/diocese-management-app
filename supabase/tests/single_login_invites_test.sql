-- =====================================================================
-- Functional test for 20261004120000 (one login · one enrollment per
-- session · invite-only signup · one priest account).
--   psql -d app -f supabase/tests/single_login_invites_test.sql
-- Ends with «SINGLE LOGIN / INVITES TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000006');  -- servant in TWO classes
insert into public.churches (id, name) values ('10000000-0000-0000-0000-000000000001', 'كنيسة أ');
insert into public.services (id, church_id, name) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل ب');
insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000006', 'مينا', 'srv-1', '0106', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now());
insert into public.servant_scopes (servant_id, church_id, service_id, class_id) values
  ('00000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
update public.persons set national_id = 'SRV-1' where id = (select person_id from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000006');

-- two children, one in each class; KID-1 also in class B (two enrollments)
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local request.jwt.claim.role = 'authenticated';
select public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001', 'كيرلس', 'KID-1', 'male', null, '+201000000001', null, null, null, 0, 'kidpass1');
select public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000002', 'كيرلس', 'KID-1', 'male', null, '+201000000001', null, null, null, 0, null);
select public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000002', 'مريم', 'KID-2', 'female', null, '+201000000002', null, null, null, 0, 'kidpass2');
reset role;

-- ---------- A. servant active place narrows my_scopes / RLS ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';
do $$
declare n int; ok boolean := false;
begin
  perform public.servant_mirror_own_password('srvpass1');
  if (select count(*) from public.my_scopes()) <> 2 then raise exception 'two places expected'; end if;
  select count(*) into n from public.enrollments where kind = 'child';
  if n <> 3 then raise exception 'all places: 3 child enrollments visible, got %', n; end if;
  -- choose class B only
  perform public.servant_set_active_place('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
  if (select count(*) from public.my_scopes()) <> 1 then raise exception 'one active place expected'; end if;
  select count(*) into n from public.enrollments where kind = 'child';
  if n <> 2 then raise exception 'class B only: 2 enrollments visible, got %', n; end if;
  if exists (select 1 from public.enrollments where kind = 'child' and class_id = '30000000-0000-0000-0000-000000000001') then
    raise exception 'class A must be hidden while class B is active';
  end if;
  -- a place he does not have → refused
  begin perform public.servant_set_active_place('10000000-0000-0000-0000-000000000001', null, null);
  exception when others then ok := sqlerrm like '%scope_not_allowed%'; end;
  if not ok then raise exception 'foreign place must be refused'; end if;
  -- back to all
  perform public.servant_set_active_place(null);
  select count(*) into n from public.enrollments where kind = 'child';
  if n <> 3 then raise exception 'all places again: 3, got %', n; end if;
  -- accounts: ONE row per place
  if (select count(*) from jsonb_array_elements(public.my_accounts('servant', null)->'accounts') a where a->>'kind' = 'servant') <> 2 then
    raise exception 'servant must list 2 enrollment rows';
  end if;
end $$;
reset role;

-- ---------- B. ONE login → accounts → pick one enrollment ----------
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare r jsonb; s jsonb; prof jsonb; e1 uuid; e2 uuid; ok boolean := false; tok text;
begin
  -- wrong password
  begin perform public.account_login('KID-1', 'nope', false);
  exception when others then ok := sqlerrm like '%wrong_password%'; end;
  if not ok then raise exception 'wrong password must fail'; end if;
  -- KID-1 has 2 child enrollments → 2 accounts
  r := public.account_login('KID-1', 'kidpass1', true);
  if jsonb_array_length(r->'accounts') <> 2 then raise exception 'KID-1 must have 2 accounts: %', r; end if;
  e1 := (r->'accounts'->0->>'enrollment_id')::uuid; e2 := (r->'accounts'->1->>'enrollment_id')::uuid;
  -- pick the first → the profile shows ONLY that class
  s := public.account_session_from_login(r->>'grant', 'child', e1);
  tok := s->>'token';
  prof := public.child_portal_profile(tok);
  if jsonb_array_length(prof->'enrollments') <> 1 then raise exception 'session must show 1 enrollment: %', prof; end if;
  if (prof->'enrollments'->0->>'id')::uuid <> e1 then raise exception 'wrong enrollment in session'; end if;
  if (prof->>'other_enrollments')::int <> 1 then raise exception 'other_enrollments must be 1'; end if;
  -- the grant is single-use
  ok := false;
  begin perform public.account_session_from_login(r->>'grant', 'child', e2);
  exception when others then ok := sqlerrm like '%session_expired%'; end;
  if not ok then raise exception 'grant must be single-use'; end if;
  -- switch from this child session to the OTHER class
  s := public.account_switch('child', tok, 'child', true, e2);
  prof := public.child_portal_profile(s->>'token');
  if (prof->'enrollments'->0->>'id')::uuid <> e2 then raise exception 'switch must land on e2'; end if;
  -- KID-2: single account → the client goes straight in (still 1 row here)
  r := public.account_login('KID-2', 'kidpass2', false);
  if jsonb_array_length(r->'accounts') <> 1 then raise exception 'KID-2 must have 1 account'; end if;
  -- the servant: one login lists his 2 places; picking one issues a ticket with the place
  r := public.account_login('SRV-1', 'srvpass1', true);
  if jsonb_array_length(r->'accounts') <> 2 then raise exception 'SRV-1 must list 2 places: %', r; end if;
  s := public.account_session_from_login(r->>'grant', 'servant', null,
         '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
  if s->>'ticket' is null then raise exception 'servant ticket expected'; end if;
  -- unknown code / no account
  ok := false;
  begin perform public.account_login('NOPE', 'x', false);
  exception when others then ok := sqlerrm like '%unknown_code%'; end;
  if not ok then raise exception 'unknown code must fail'; end if;
end $$;

-- the ticket, redeemed by the server, sets the active place of the servant
reset role;
do $$
declare r jsonb; s jsonb; red jsonb;
begin
  r := public.account_login('SRV-1', 'srvpass1', true);
  s := public.account_session_from_login(r->>'grant', 'servant', null,
         '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
  red := public.account_switch_redeem(s->>'ticket');
  if red->>'user_id' <> 'srv-1' then raise exception 'redeem failed'; end if;
  if not exists (select 1 from public.servant_active_places where servant_id = '00000000-0000-0000-0000-000000000006'
                   and class_id = '30000000-0000-0000-0000-000000000002') then
    raise exception 'redeem must set the active place';
  end if;
end $$;

-- ---------- C. invite-only signup ----------
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare ok boolean := false;
begin
  begin
    perform public.child_signup('NEW-1', 'يوسف', 'newpass1', 'male', null, null, null, null, null,
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', null);
  exception when others then ok := sqlerrm like '%invite_required%'; end;
  if not ok then raise exception 'child signup without invite must be refused'; end if;
  ok := false;
  begin
    perform public.priest_signup('NEW-2', 'أبونا', 'newpass1', '10000000-0000-0000-0000-000000000001', 'القس', null, null, null, null, null, null, 'bogus');
  exception when others then ok := sqlerrm like '%invite_invalid%'; end;
  if not ok then raise exception 'priest signup with a bogus invite must be refused'; end if;
  if (public.signup_invite_check('bogus', 'child')->>'valid')::boolean then raise exception 'bogus invite must be invalid'; end if;
end $$;

-- the class servant invites children; only the owner invites priests; servant invites need a manager
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';
do $$
declare inv jsonb; ok boolean := false;
begin
  perform public.servant_set_active_place(null);
  inv := public.signup_invite_create('child', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 7, 2, null);
  if inv->>'token' is null then raise exception 'child invite expected'; end if;
  perform set_config('test.child_invite', inv->>'token', false);
  begin perform public.signup_invite_create('priest', '10000000-0000-0000-0000-000000000001');
  exception when others then ok := sqlerrm like '%forbidden%'; end;
  if not ok then raise exception 'class servant must not invite priests'; end if;
  ok := false;
  begin perform public.signup_invite_create('servant', '10000000-0000-0000-0000-000000000001');
  exception when others then ok := sqlerrm like '%forbidden%'; end;
  if not ok then raise exception 'class servant must not invite servants'; end if;
end $$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare inv jsonb;
begin
  inv := public.signup_invite_create('priest', '10000000-0000-0000-0000-000000000001', null, null, 3, 1, 'أبونا');
  perform set_config('test.priest_invite', inv->>'token', false);
  inv := public.signup_invite_create('servant', null, null, null, 7, null, null);
  perform set_config('test.servant_invite', inv->>'token', false);
  if (select count(*) from public.signup_invites) <> 3 then raise exception 'owner must see the 3 invites'; end if;
end $$;
reset role;

-- the invites work (and respect max_uses); the priest account is unique
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare r jsonb; chk jsonb; ok boolean := false;
begin
  chk := public.signup_invite_check(current_setting('test.child_invite'), 'child');
  if not (chk->>'valid')::boolean or chk->>'class_name' <> 'فصل ب' then raise exception 'child invite check wrong: %', chk; end if;
  -- the invite's scope wins even when the wizard sends nothing
  r := public.child_signup('NEW-1', 'يوسف', 'newpass1', 'male', null, null, null, null, null, null, null, null, current_setting('test.child_invite'));
  if r->>'request_id' is null then raise exception 'child signup with invite must work'; end if;
  -- KID-2 (child in class B, has password) adds class A? No — the invite is for class B where she already is → already_registered
  begin
    perform public.child_signup('KID-2', 'مريم', 'kidpass2', null, null, null, null, null, null, null, null, null, current_setting('test.child_invite'));
  exception when others then ok := sqlerrm like '%already_registered%'; end;
  if not ok then raise exception 'same class must be refused'; end if;
  -- a refused signup rolls its use back: 1 of 2 used → still valid; a second
  -- real signup exhausts it
  if not (public.signup_invite_check(current_setting('test.child_invite'), 'child')->>'valid')::boolean then raise exception 'invite must still be valid'; end if;
  r := public.child_signup('NEW-3', 'مرقس', 'newpass1', 'male', null, null, null, null, null, null, null, null, current_setting('test.child_invite'));
  if (public.signup_invite_check(current_setting('test.child_invite'), 'child')->>'valid')::boolean then raise exception 'invite must be exhausted'; end if;
  -- priest invite (max 1): first ok, second invalid
  r := public.priest_signup('PR-1', 'أبونا يوحنا', 'prpass1', null, 'القس', null, null, null, null, null, null, current_setting('test.priest_invite'));
  if r->>'request_id' is null then raise exception 'priest signup with invite must work'; end if;
  ok := false;
  begin
    perform public.priest_signup('PR-2', 'x', 'prpass1', null, null, null, null, null, null, null, null, current_setting('test.priest_invite'));
  exception when others then ok := sqlerrm like '%invite_invalid%'; end;
  if not ok then raise exception 'single-use priest invite must be exhausted'; end if;
end $$;

-- approve the priest, then a second priest request for the same code is refused (ONE priest account)
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local request.jwt.claim.role = 'authenticated';
do $$
declare r jsonb; inv jsonb; ok boolean := false;
begin
  r := public.owner_review_priest_request((select id from public.priest_requests where code = 'PR-1'), true, null, null, null);
  if r->>'status' <> 'approved' then raise exception 'priest approve failed'; end if;
  inv := public.signup_invite_create('priest', '10000000-0000-0000-0000-000000000001');
  perform set_config('test.priest_invite2', inv->>'token', false);
end $$;
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare ok boolean := false; r jsonb;
begin
  begin
    perform public.priest_signup('PR-1', 'أبونا يوحنا', 'prpass1', null, 'القس', null, null, null, null, null, null, current_setting('test.priest_invite2'));
  exception when others then ok := sqlerrm like '%already_registered%'; end;
  if not ok then raise exception 'a second priest account for the same person must be refused'; end if;
  -- …but the priest may log in through the ONE login and sees his priest account
  r := public.account_login('PR-1', 'prpass1', false);
  if r->'accounts'->0->>'kind' <> 'priest' then raise exception 'priest account expected: %', r; end if;
end $$;
reset role;

rollback;
\echo SINGLE LOGIN / INVITES TESTS PASSED
