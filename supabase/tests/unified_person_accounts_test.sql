-- =====================================================================
-- Functional test for 20261003120000 (one person · one password · many
-- accounts · switch account without signing out).
--   psql -d app -f supabase/tests/unified_person_accounts_test.sql
-- Ends with «UNIFIED PERSON ACCOUNTS TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;
\i supabase/tests/_test_invites.sql

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000006');  -- class servant (will ALSO be a child + a priest)
insert into public.churches (id, name) values ('10000000-0000-0000-0000-000000000001', 'كنيسة أ');
insert into public.services (id, church_id, name) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل ب');
insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000006', 'مينا الخادم', 'srv-1', '0106', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now());
-- the servant's person row carries the code SRV-1
update public.persons set national_id = 'SRV-1' where id = (select person_id from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000006');

-- a plain child with a portal password (added by the servant)
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';
select public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001', 'كيرلس', 'KID-1', 'male', null, '+201000000001', null, null, null, 0, 'kidpass1');
reset role;

-- ---------- A. the servant mirrors his password → person_credentials ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';
do $$
declare acc jsonb; pid uuid;
begin
  perform public.servant_mirror_own_password('srvpass1');
  select person_id into pid from public.servant_enrollments where id = auth.uid();
  if not public.person_has_password(pid) then raise exception 'servant password must be mirrored'; end if;
  acc := public.my_accounts('servant', null);
  if acc->'person'->>'code' <> 'SRV-1' then raise exception 'my_accounts code wrong: %', acc; end if;
  if jsonb_array_length(acc->'accounts') <> 1 then raise exception 'servant must have exactly 1 account: %', acc; end if;
  if acc->'accounts'->0->>'kind' <> 'servant' then raise exception 'first account must be servant'; end if;
end $$;
reset role;

-- ---------- B. the SAME code signs up as a CHILD: wrong password refused, right one accepted ----------
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare l jsonb; r jsonb; ok boolean := false;
begin
  l := public.account_code_lookup('SRV-1');
  if not (l->>'is_servant')::boolean or (l->>'is_child')::boolean or not (l->>'has_password')::boolean then
    raise exception 'lookup wrong: %', l;
  end if;
  if public.person_verify_password('SRV-1', 'nope') then raise exception 'verify must fail on wrong pw'; end if;
  if not public.person_verify_password('SRV-1', 'srvpass1') then raise exception 'verify must pass on right pw'; end if;
  begin
    perform public.child_signup('SRV-1', 'مينا', 'otherpass', 'male', null, null, null, null, null,
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', current_setting('test.inv_child'));
  exception when others then ok := sqlerrm like '%wrong_password%'; end;
  if not ok then raise exception 'child signup with a different password must be refused'; end if;
  r := public.child_signup('SRV-1', 'مينا', 'srvpass1', 'male', null, null, null, null, null,
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', current_setting('test.inv_child'));
  if not (r->>'linked')::boolean then raise exception 'signup must be linked to the existing person'; end if;
  -- a brand-new child code still works the old way
  r := public.child_signup('KID-NEW', 'يوسف', 'newpass1', 'male', null, null, null, null, null,
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', current_setting('test.inv_child'));
  if (r->>'linked')::boolean then raise exception 'new code must not be linked'; end if;
  -- an existing CHILD in the SAME class → «already_registered» (20261004120000:
  -- another class may be added with the same password)
  ok := false;
  begin
    perform public.child_signup('KID-1', 'x', 'kidpass1', null, null, null, null, null, null,
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', current_setting('test.inv_child'));
  exception when others then ok := sqlerrm like '%already_registered%'; end;
  if not ok then raise exception 'existing child must be refused'; end if;
end $$;

-- approve both requests (as the owner) → the servant's password is NOT overwritten
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local request.jwt.claim.role = 'authenticated';
do $$
declare r jsonb; acc jsonb;
begin
  r := public.review_child_join_request((select id from public.child_join_requests where code = 'SRV-1'), true);
  if r->>'status' <> 'approved' then raise exception 'approve failed'; end if;
  r := public.review_child_join_request((select id from public.child_join_requests where code = 'KID-NEW'), true);
end $$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
do $$
declare acc jsonb;
begin
  acc := public.my_accounts('servant', null);
  if jsonb_array_length(acc->'accounts') <> 2 then raise exception 'servant must now have 2 accounts: %', acc; end if;
  if acc->'accounts'->1->>'kind' <> 'child' then raise exception 'second must be child'; end if;
  if jsonb_array_length(acc->'accounts'->1->'places') <> 1 then raise exception 'child must list 1 class'; end if;
end $$;
reset role;

-- ---------- C. child login with the ONE password; the new child too ----------
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare r jsonb; ok boolean := false;
begin
  r := public.child_login('SRV-1', 'srvpass1', true, 'test');
  if r->>'token' is null then raise exception 'child login with the servant password must work'; end if;
  begin perform public.child_login('SRV-1', 'otherpass', true, 'test');
  exception when others then ok := sqlerrm like '%wrong_password%'; end;
  if not ok then raise exception 'other password must fail'; end if;
  r := public.child_login('KID-NEW', 'newpass1', true, 'test');
  if r->>'token' is null then raise exception 'new child login must work'; end if;
end $$;

-- ---------- D. the same code signs up as a PRIEST with the one password ----------
do $$
declare r jsonb; ok boolean := false;
begin
  begin
    perform public.priest_signup('SRV-1', 'أبونا مينا', 'badpass1', '10000000-0000-0000-0000-000000000001', 'القس', null, null, null, null, null, null, current_setting('test.inv_priest'));
  exception when others then ok := sqlerrm like '%wrong_password%'; end;
  if not ok then raise exception 'priest signup with another password must be refused'; end if;
  r := public.priest_signup('SRV-1', 'أبونا مينا', 'srvpass1', '10000000-0000-0000-0000-000000000001', 'القس', null, null, null, null, null, null, current_setting('test.inv_priest'));
  if not (r->>'linked')::boolean then raise exception 'priest signup must be linked'; end if;
end $$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local request.jwt.claim.role = 'authenticated';
do $$
declare r jsonb; h1 text; h2 text;
begin
  r := public.owner_review_priest_request((select id from public.priest_requests where code = 'SRV-1'), true, null, null, null);
  if r->>'status' <> 'approved' then raise exception 'priest approve failed'; end if;
  -- owner adds a priest for a NEW code → seeds the person password
  r := public.owner_add_priest('PR-NEW', 'أبونا بولس', 'pr-pass1', '10000000-0000-0000-0000-000000000001', 'القس');
  if r->>'priest_id' is null then raise exception 'owner_add_priest failed'; end if;
end $$;
reset role;
-- one hash everywhere (checked as postgres — the column is never readable by the app roles)
do $$
declare h1 text; h2 text;
begin
  select pr.password_hash, c.password_hash into h1, h2
    from public.priests pr join public.person_credentials c on c.person_id = pr.person_id
   where pr.person_id = (select person_id from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000006');
  if h1 is distinct from h2 then raise exception 'priest hash must equal the person hash'; end if;
  if not exists (select 1 from public.person_credentials c join public.persons p on p.id = c.person_id where p.national_id = 'PR-NEW') then
    raise exception 'owner_add_priest must seed person_credentials';
  end if;
end $$;

-- ---------- E. switching: child → priest → servant ticket, and the accounts list ----------
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare r jsonb; ctok text; ptok text; acc jsonb; sw jsonb; ok boolean := false;
begin
  r := public.child_login('SRV-1', 'srvpass1', true, 'test');
  ctok := r->>'token';
  acc := public.my_accounts('child', ctok);
  if jsonb_array_length(acc->'accounts') <> 3 then raise exception 'must list 3 accounts: %', acc; end if;
  if acc->>'current' <> 'child' then raise exception 'current must be child'; end if;
  -- child → priest (no password)
  sw := public.account_switch('child', ctok, 'priest', true);
  ptok := sw->>'token';
  if ptok is null then raise exception 'switch to priest must return a token'; end if;
  if (public.priest_portal_profile(ptok))->'person'->>'name' is null then raise exception 'priest token must work'; end if;
  -- priest → child
  sw := public.account_switch('priest', ptok, 'child', false);
  if sw->>'token' is null then raise exception 'switch to child must return a token'; end if;
  if (public.child_portal_profile(sw->>'token'))->'person'->>'national_id' <> 'SRV-1' then raise exception 'child token must resolve'; end if;
  -- priest → servant: a one-time ticket
  sw := public.account_switch('priest', ptok, 'servant', true);
  if sw->>'ticket' is null or sw->>'servant_id' <> '00000000-0000-0000-0000-000000000006' then raise exception 'servant ticket wrong: %', sw; end if;
  -- anon cannot redeem
  begin perform public.account_switch_redeem(sw->>'ticket');
  exception when others then ok := true; end;
  if not ok then raise exception 'anon must not redeem a ticket'; end if;
  -- a plain child (no other account) cannot switch anywhere
  r := public.child_login('KID-NEW', 'newpass1', true, 'test');
  ok := false;
  begin perform public.account_switch('child', r->>'token', 'servant', true);
  exception when others then ok := sqlerrm like '%no_such_account%'; end;
  if not ok then raise exception 'child without a servant account must get no_such_account'; end if;
  -- priest login with the one password
  r := public.priest_login('SRV-1', 'srvpass1', false, null);
  if r->>'token' is null then raise exception 'priest login must work with the one password'; end if;
end $$;

-- the service role redeems the ticket once
reset role;
do $$
declare sw jsonb; r jsonb; ok boolean := false; ptok text;
begin
  ptok := (public.priest_login('SRV-1', 'srvpass1', false, null))->>'token';
  sw := public.account_switch('priest', ptok, 'servant', true);
  r := public.account_switch_redeem(sw->>'ticket');
  if r->>'user_id' <> 'srv-1' then raise exception 'redeem must return the login name: %', r; end if;
  begin perform public.account_switch_redeem(sw->>'ticket');
  exception when others then ok := sqlerrm like '%invalid_ticket%'; end;
  if not ok then raise exception 'ticket must be single-use'; end if;
end $$;

-- ---------- F. changing the password from ANY portal changes it everywhere ----------
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare r jsonb; ptok text; ok boolean := false;
begin
  ptok := (public.priest_login('SRV-1', 'srvpass1', false, null))->>'token';
  perform public.priest_change_password(ptok, 'srvpass1', 'srvpass2');
  r := public.child_login('SRV-1', 'srvpass2', false, null);
  if r->>'token' is null then raise exception 'child login must use the NEW password'; end if;
  begin perform public.child_login('SRV-1', 'srvpass1', false, null);
  exception when others then ok := sqlerrm like '%wrong_password%'; end;
  if not ok then raise exception 'old password must be dead'; end if;
  perform public.child_change_password(r->>'token', 'srvpass2', 'srvpass3');
  if (public.priest_login('SRV-1', 'srvpass3', false, null))->>'token' is null then raise exception 'priest must use the newest password'; end if;
end $$;
reset role;

rollback;
\echo UNIFIED PERSON ACCOUNTS TESTS PASSED
