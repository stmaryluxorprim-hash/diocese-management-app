-- =====================================================================
-- Functional test for 20261006120000_servant_scope_requests_unenrolled_fix.sql
--   1. a servant bound to a WHOLE service («كل الفصول») is NOT «بدون تسجيلات»
--   2. servant_request_scopes / review_servant_scope_request / pending count
--   3. owner_add_servant_places appends places to an existing servant
--   psql -d app -f supabase/tests/servant_scope_requests_test.sql
-- Ends with «SERVANT SCOPE REQUESTS TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000002'),  -- service manager of مدارس الأحد
  ('00000000-0000-0000-0000-000000000006');  -- servant bound to the WHOLE service (no class)
insert into public.churches (id, name) values ('10000000-0000-0000-0000-000000000001', 'كنيسة أ');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'الشباب');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'شباب أ');
insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000002', 'مدير الخدمة', 'mgr-1', '0102', 'service_manager', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, now()),
  ('00000000-0000-0000-0000-000000000006', 'مينا الخادم', 'srv-1', '+201000000006', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, now());
update public.persons set national_id = 'SRV-1' where id = (select person_id from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000006');

-- ---------- 1. whole-service servant is NOT unenrolled ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local request.jwt.claim.role = 'authenticated';
do $$
declare r record; n int; c jsonb;
begin
  select * into r from public.owner_persons_page(p_search => 'SRV-1');
  if r.id is null then raise exception 'servant row expected'; end if;
  if jsonb_array_length(r.enrollments) <> 0 then raise exception 'no mirror rows for a whole-service place'; end if;
  if not public.person_has_any_place(r.id) then raise exception 'whole-service servant HAS a place'; end if;
  select count(*) into n from public.owner_persons_page(p_scope_mode => 'none');
  if n <> 0 then raise exception 'unenrolled filter: 0 expected, got % (whole-service servant counted)', n; end if;
  -- the scope filter finds him by his service
  select count(*) into n from public.owner_persons_page(p_scope_mode => 'scope', p_church => '10000000-0000-0000-0000-000000000001', p_service => '20000000-0000-0000-0000-000000000001');
  if n <> 1 then raise exception 'scope filter should match the whole-service servant, got %', n; end if;
  c := public.owner_persons_counts();
  if (c->>'unenrolled')::int <> 0 then raise exception 'unenrolled count should be 0: %', c; end if;
end $$;

-- ---------- 2. existing servant asks for another place (الشباب / شباب أ) ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
do $$
declare r jsonb;
begin
  r := public.servant_request_scopes(jsonb_build_array(
         jsonb_build_object('church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000002', 'class_id', '30000000-0000-0000-0000-000000000002'),
         -- already his → skipped
         jsonb_build_object('church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000001', 'class_id', null)), null);
  if (r->>'requested')::int <> 1 or (r->>'skipped')::int <> 1 then raise exception 'requested 1 / skipped 1 expected: %', r; end if;
  -- the same request again → skipped (already pending)
  r := public.servant_request_scopes(jsonb_build_array(
         jsonb_build_object('church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000002', 'class_id', '30000000-0000-0000-0000-000000000002')), null);
  if (r->>'requested')::int <> 0 then raise exception 'duplicate pending must be skipped: %', r; end if;
  -- he can see his own request
  if (select count(*) from public.servant_scope_requests where status = 'pending') <> 1 then raise exception 'servant should see his pending request'; end if;
end $$;

-- the manager of مدارس الأحد may NOT decide a request for الشباب
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$
declare req uuid; ok boolean := false;
begin
  if public.pending_servant_requests_count() <> 0 then raise exception 'request outside the manager area must not be counted'; end if;
  select id into req from public.servant_scope_requests where servant_id = '00000000-0000-0000-0000-000000000006' limit 1;
  if req is not null then
    begin
      perform public.review_servant_scope_request(req, true, null);
    exception when insufficient_privilege then ok := true; end;
    if not ok then raise exception 'manager outside the area must be refused'; end if;
  end if;
end $$;

-- the owner approves → the place is appended, the count drops to 0
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare req uuid; r jsonb; n int;
begin
  if public.pending_servant_requests_count() <> 1 then raise exception 'owner should count 1 pending request'; end if;
  select id into req from public.servant_scope_requests where status = 'pending';
  r := public.review_servant_scope_request(req, true, 'أهلًا');
  if r->>'status' <> 'approved' then raise exception 'approved expected: %', r; end if;
  select count(*) into n from public.servant_all_scopes('00000000-0000-0000-0000-000000000006') t
   where t.class_id = '30000000-0000-0000-0000-000000000002';
  if n <> 1 then raise exception 'the new class must be among his places'; end if;
  -- the original whole-service place is kept
  select count(*) into n from public.servant_all_scopes('00000000-0000-0000-0000-000000000006') t
   where t.service_id = '20000000-0000-0000-0000-000000000001' and t.class_id is null;
  if n <> 1 then raise exception 'the original place must be kept'; end if;
  if public.pending_servant_requests_count() <> 0 then raise exception 'count should be 0 after review'; end if;
  -- reviewing twice → not_pending
  begin
    perform public.review_servant_scope_request(req, false, null);
    raise exception 'second review must fail';
  exception when raise_exception then
    if sqlerrm not like '%not_pending%' then raise; end if;
  end;
end $$;

-- ---------- 3. owner appends a place from إدارة الأفراد → تسجيل كخادم ----------
do $$
declare r jsonb; n int;
begin
  r := public.owner_add_servant_places('00000000-0000-0000-0000-000000000006',
         jsonb_build_array(jsonb_build_object('church_id', '10000000-0000-0000-0000-000000000001', 'service_id', '20000000-0000-0000-0000-000000000001', 'class_id', '30000000-0000-0000-0000-000000000001')));
  select count(*) into n from public.servant_all_scopes('00000000-0000-0000-0000-000000000006');
  if n < 3 then raise exception '3 places expected after append, got % (%)', n, r; end if;
  -- the mirror enrollments row for the class now exists → still not unenrolled, kinds = servant
  if (select count(*) from public.enrollments e where e.kind = 'servant' and e.class_id = '30000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'servant mirror row for the class expected';
  end if;
  begin
    perform public.owner_add_servant_places('00000000-0000-0000-0000-000000000006', '[]'::jsonb);
    raise exception 'empty places must fail';
  exception when invalid_parameter_value then null; end;
end $$;

-- a plain servant may not call it
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
do $$
declare ok boolean := false;
begin
  begin
    perform public.owner_add_servant_places('00000000-0000-0000-0000-000000000006',
      jsonb_build_array(jsonb_build_object('church_id', '10000000-0000-0000-0000-000000000001', 'service_id', null, 'class_id', null)));
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'a servant must not append his own places'; end if;
end $$;
reset role;

select 'SERVANT SCOPE REQUESTS TESTS PASSED' as result;
rollback;
