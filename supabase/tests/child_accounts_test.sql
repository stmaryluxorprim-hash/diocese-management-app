-- =====================================================================
-- Functional test for migration 0042 (child accounts + servant mirror).
--   psql -d app -f supabase/tests/child_accounts_test.sql
-- Ends with «CHILD ACCOUNTS TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;
\i supabase/tests/_test_invites.sql

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000006');  -- class servant
insert into public.churches (id, name) values ('10000000-0000-0000-0000-000000000001', 'كنيسة أ');
insert into public.services (id, church_id, name) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل ب');

insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000006', 'خادم', 'cs', '0106', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now());

-- ---------- A. servant mirror ----------
do $$
declare n int; e public.enrollments;
begin
  select * into e from public.enrollments where servant_id = '00000000-0000-0000-0000-000000000006';
  if not found then raise exception 'mirror enrollment missing for class servant'; end if;
  if e.kind <> 'servant' then raise exception 'mirror kind must be servant'; end if;
  if e.class_id <> '30000000-0000-0000-0000-000000000001' then raise exception 'mirror class wrong'; end if;
  -- the owner has no scope → no mirror
  select count(*) into n from public.enrollments where servant_id = '00000000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'owner must not have a mirror'; end if;
  -- move the servant → mirror follows
  update public.servant_enrollments set class_id = '30000000-0000-0000-0000-000000000002' where id = '00000000-0000-0000-0000-000000000006';
  select * into e from public.enrollments where servant_id = '00000000-0000-0000-0000-000000000006';
  if e.class_id <> '30000000-0000-0000-0000-000000000002' then raise exception 'mirror did not follow the scope'; end if;
  -- suspend keeps it, reject removes it
  update public.servant_enrollments set status = 'rejected' where id = '00000000-0000-0000-0000-000000000006';
  select count(*) into n from public.enrollments where servant_id = '00000000-0000-0000-0000-000000000006';
  if n <> 0 then raise exception 'rejected servant must lose the mirror'; end if;
  update public.servant_enrollments set status = 'approved' where id = '00000000-0000-0000-0000-000000000006';
  select count(*) into n from public.enrollments where servant_id = '00000000-0000-0000-0000-000000000006';
  if n <> 1 then raise exception 're-approved servant must get the mirror back'; end if;
end $$;

-- ---------- B. add child with password + login ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';

do $$
declare r jsonb; tok text; p jsonb; pid uuid;
begin
  r := public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000002', 'مينا', 'KID-1', 'male', null, '+201000000001', null, null, null, 0, 'secret1');
  if not (r->>'has_password')::boolean then raise exception 'password must be set on add'; end if;
  pid := (r->>'person_id')::uuid;

  -- stats: the class has 1 child + 1 servant mirror
  if (select enrollments from public.stats_scope_summary(null, null, '30000000-0000-0000-0000-000000000002')) <> 1 then
    raise exception 'stats default must count children only';
  end if;
  if (select enrollments from public.stats_scope_summary(null, null, '30000000-0000-0000-0000-000000000002', 'servant')) <> 1 then
    raise exception 'stats servant kind must count the mirror';
  end if;
  if (select enrollments from public.stats_scope_summary(null, null, '30000000-0000-0000-0000-000000000002', 'all')) <> 2 then
    raise exception 'stats all must count both';
  end if;

  -- wrong password
  begin
    perform public.child_login('KID-1', 'nope', false);
    raise exception 'wrong password accepted';
  exception when others then
    if sqlerrm not like '%wrong_password%' then raise; end if;
  end;

  -- login → session token → profile
  r := public.child_login('KID-1', 'secret1', true, 'test');
  tok := r->>'token';
  if length(tok) < 40 then raise exception 'token too short'; end if;
  p := public.child_portal_profile(tok);
  if (p->'person'->>'national_id') <> 'KID-1' then raise exception 'profile via session failed'; end if;

  -- the raw code is NOT a token any more
  begin
    perform public.child_portal_profile('KID-1');
    raise exception 'raw code must not open the portal';
  exception when others then
    if sqlerrm not like '%invalid_code%' and sqlerrm not like '%session_expired%' then raise; end if;
  end;

  -- change password → other sessions die, this one lives
  perform public.child_change_password(tok, 'secret1', 'secret2');
  p := public.child_portal_profile(tok);
  r := public.child_login('KID-1', 'secret2', false);

  -- servant reset → all sessions die
  perform public.admin_set_child_password(pid, 'secret3');
  begin
    perform public.child_portal_profile(tok);
    raise exception 'session must be closed after admin reset';
  exception when others then
    if sqlerrm not like '%session_expired%' then raise; end if;
  end;
  r := public.child_login('KID-1', 'secret3', false);

  -- logout
  perform public.child_logout(r->>'token');
  begin
    perform public.child_portal_profile(r->>'token');
    raise exception 'logout did not close the session';
  exception when others then
    if sqlerrm not like '%session_expired%' then raise; end if;
  end;
end $$;

-- ---------- C. child signup → review ----------
reset role;
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare r jsonb;
begin
  r := public.child_signup_lookup_code('KID-1');
  if not (r->>'has_password')::boolean then raise exception 'lookup must flag the existing account'; end if;
  begin
    perform public.child_signup('KID-1', 'x', 'secret9', null, null, null, null, null, null,
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', current_setting('test.inv_child'));
    raise exception 'signup with an existing account must fail';
  exception when others then
    if sqlerrm not like '%already_registered%' then raise; end if;
  end;
  r := public.child_signup('KID-2', 'مريم', 'secret9', 'female', '2015-01-02', '+201000000002', null, null, null,
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', current_setting('test.inv_child'));
  perform set_config('test.req', r->>'request_id', true);
  if (public.child_signup_status((r->>'request_id')::uuid)->>'status') <> 'pending' then raise exception 'status must be pending'; end if;
  -- login before approval → no password yet
  begin
    perform public.child_login('KID-2', 'secret9', false);
    raise exception 'login before approval must fail';
  exception when others then
    if sqlerrm not like '%unknown_code%' then raise; end if;
  end;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';
do $$
declare r jsonb; n int;
begin
  -- the class servant of «فصل ب» sees it
  select count(*) into n from public.child_join_requests where status = 'pending';
  if n <> 1 then raise exception 'servant must see 1 pending request, saw %', n; end if;
  if public.pending_child_join_requests_count() <> 1 then raise exception 'pending count wrong'; end if;
  r := public.review_child_join_request(current_setting('test.req', true)::uuid, true, 'أهلاً');
  if (r->>'status') <> 'approved' then raise exception 'approve failed'; end if;
  if not (r->>'person_created')::boolean then raise exception 'person must be created'; end if;
end $$;

reset role;
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare r jsonb; p jsonb;
begin
  r := public.child_login('KID-2', 'secret9', false);
  p := public.child_portal_profile(r->>'token');
  if (p->'person'->>'name') <> 'مريم' then raise exception 'approved child cannot log in'; end if;
  if jsonb_array_length(p->'enrollments') <> 1 then raise exception 'approved child must have 1 enrollment'; end if;
  -- the hash column is not readable
  begin
    perform password_hash from public.child_join_requests limit 1;
    raise exception 'password_hash must not be readable';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
\echo CHILD ACCOUNTS TESTS PASSED
