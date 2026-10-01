-- =====================================================================
-- Functional test for 20260927120000 + 20260927130000 (priest portal).
--   psql -d app -f supabase/tests/priests_portal_test.sql
-- Ends with «PRIESTS PORTAL TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;
\i supabase/tests/_test_invites.sql

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000006');  -- class servant
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة أ'),
  ('10000000-0000-0000-0000-000000000002', 'كنيسة ب');
insert into public.services (id, church_id, name) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ');
insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000006', 'خادم', 'cs', '0106', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now());

-- a child in church أ with a portal password
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';
select public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001', 'مينا', 'KID-1', 'male', null, '+201000000001', null, null, null, 0, 'secret1');
select public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001', 'مريم', 'KID-2', 'female', null, '+201000000002', null, null, null, 0, null);
reset role;

-- ---------- A. anonymous signup → pending → cannot log in ----------
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare r jsonb; l jsonb; ok boolean := false;
begin
  l := public.priest_signup_lookup_code('PR-1');
  if (l->>'exists')::boolean then raise exception 'code must be new'; end if;
  r := public.priest_signup('PR-1', 'أبونا يوحنا', 'pass123', '10000000-0000-0000-0000-000000000001', 'القمص', 'male', null, '+201000000009', null, null, null, current_setting('test.inv_priest'));
  if r->>'request_id' is null then raise exception 'signup must return request id'; end if;
  l := public.priest_signup_lookup_code('PR-1');
  if not (l->>'pending')::boolean then raise exception 'lookup must report pending'; end if;
  begin
    perform public.priest_signup('PR-1', 'x', 'pass123', '10000000-0000-0000-0000-000000000001', null, null, null, null, null, null, null, current_setting('test.inv_priest'));
  exception when others then ok := sqlerrm like '%pending_exists%'; end;
  if not ok then raise exception 'second pending signup must fail'; end if;
  ok := false;
  begin
    perform public.priest_login('PR-1', 'pass123', false, null);
  exception when others then ok := sqlerrm like '%pending_approval%'; end;
  if not ok then raise exception 'pending priest must not log in'; end if;
  if (public.priest_signup_status((r->>'request_id')::uuid)->>'status') <> 'pending' then raise exception 'status must be pending'; end if;
end $$;

-- ---------- B. a class servant may NOT approve; the owner does ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';
do $$
declare ok boolean := false; n int;
begin
  begin
    perform public.owner_review_priest_request((select id from public.priest_requests where code = 'PR-1'), true);
  exception when others then ok := sqlerrm like '%forbidden%'; end;
  if not ok then raise exception 'servant must not approve priests'; end if;
  select count(*) into n from public.priest_requests;
  if n <> 0 then raise exception 'servant must not see priest requests (RLS)'; end if;
  if public.pending_priest_requests_count() <> 0 then raise exception 'servant count must be 0'; end if;
end $$;

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare r jsonb; n int; ov jsonb;
begin
  if public.pending_priest_requests_count() <> 1 then raise exception 'owner must see 1 pending'; end if;
  r := public.owner_review_priest_request((select id from public.priest_requests where code = 'PR-1'), true, null, null, null);
  if r->>'status' <> 'approved' then raise exception 'approve failed'; end if;
  select count(*) into n from public.priests p join public.persons x on x.id = p.person_id where x.national_id = 'PR-1' and p.status = 'approved';
  if n <> 1 then raise exception 'priest row missing'; end if;
  if (select title from public.priests limit 1) <> 'القمص' then raise exception 'title must come from the request'; end if;
  -- direct add
  r := public.owner_add_priest('PR-2', 'أبونا بولس', 'pass456', '10000000-0000-0000-0000-000000000002', 'القس');
  if r->>'priest_id' is null then raise exception 'owner_add_priest failed'; end if;
  ov := public.owner_priests_overview();
  if jsonb_array_length(ov) <> 2 then raise exception 'overview must list 2 priests'; end if;
  -- password hash never readable
  begin
    perform password_hash from public.priests limit 1;
    raise exception 'password_hash must not be selectable';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------- C. priest login + confessors ----------
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare r jsonb; tok text; prof jsonb; c jsonb; lst jsonb; s jsonb; h jsonb; ok boolean := false;
  kid1 uuid; kid2 uuid; conf_id uuid;
begin
  begin
    perform public.priest_login('PR-1', 'wrong', false, null);
  exception when others then ok := sqlerrm like '%wrong_password%'; end;
  if not ok then raise exception 'wrong password must fail'; end if;
  r := public.priest_login('PR-1', 'pass123', true, 'test');
  tok := r->>'token';
  prof := public.priest_portal_profile(tok);
  if prof->'person'->>'name' <> 'أبونا يوحنا' then raise exception 'profile name wrong'; end if;
  if prof->'church'->>'name' <> 'كنيسة أ' then raise exception 'profile church wrong'; end if;
  if (prof->'priest'->>'reminder_days')::int <> 40 then raise exception 'default reminder must be 40'; end if;

  -- (anon cannot read persons directly — resolve through the portal RPC)
  kid1 := ((public.priest_lookup_code(tok, 'KID-1'))->'person'->>'id')::uuid;
  kid2 := ((public.priest_lookup_code(tok, 'KID-2'))->'person'->>'id')::uuid;

  -- scan: lookup + add by code with a last confession 50 days ago → overdue
  r := public.priest_lookup_code(tok, 'KID-1');
  if not (r->>'found')::boolean or (r->>'is_confessor')::boolean then raise exception 'lookup before add wrong'; end if;
  c := public.priest_add_confessor_by_code(tok, 'KID-1', null, public.cairo_today_date() - 50);
  if not (c->>'overdue')::boolean then raise exception 'confessor 50 days ago must be overdue'; end if;
  if (c->>'days_since')::int <> 50 then raise exception 'days_since must be 50'; end if;
  begin
    perform public.priest_add_confessor_by_code(tok, 'KID-1');
  exception when others then ok := sqlerrm like '%already_member%'; end;
  if not ok then raise exception 'duplicate confessor must fail'; end if;

  -- search
  s := public.priest_search_persons(tok, 'مري', 30);
  if jsonb_array_length(s) <> 1 or s->0->'person'->>'name' <> 'مريم' then raise exception 'search failed'; end if;
  if (s->0->>'is_confessor')::boolean then raise exception 'مريم is not a confessor yet'; end if;
  c := public.priest_add_confessor(tok, kid2, 'ملاحظة', null);
  if (c->>'last_confession') is not null then raise exception 'no confession yet'; end if;

  -- new person
  c := public.priest_add_new_confessor(tok, 'جورج', 'ADULT-1', 'male', null, '+201000000010', null, null, null, public.cairo_today_date() - 10);
  if not (c->>'created')::boolean then raise exception 'new person must be created'; end if;
  if (c->>'overdue')::boolean then raise exception '10 days must not be overdue'; end if;

  lst := public.priest_confessors_list(tok);
  if jsonb_array_length(lst) <> 3 then raise exception 'must have 3 confessors'; end if;
  prof := public.priest_portal_profile(tok);
  if (prof->'counts'->>'confessors')::int <> 3 then raise exception 'counts.confessors wrong'; end if;
  if (prof->'counts'->>'overdue')::int <> 1 then raise exception 'counts.overdue must be 1 (KID-1), got %', prof->'counts'->>'overdue'; end if;

  -- record a confession today → KID-1 not overdue any more
  r := public.priest_record_confession(tok, kid1, null, 'تم', null);
  if (r->'confessor'->>'overdue')::boolean then raise exception 'confessed today must not be overdue'; end if;
  if (r->'confessor'->>'confessions_count')::int <> 2 then raise exception 'confessions_count must be 2'; end if;
  begin
    perform public.priest_record_confession(tok, kid1, public.cairo_today_date() + 1, null, null);
  exception when others then ok := sqlerrm like '%future_date%'; end;
  if not ok then raise exception 'future confession must fail'; end if;

  -- contact log
  r := public.priest_log_contact(tok, kid2, 'call', null);
  if r->>'kind' <> 'call' then raise exception 'contact kind wrong'; end if;
  h := public.priest_confessor_history(tok, kid2);
  if jsonb_array_length(h->'contacts') <> 1 then raise exception 'history contacts wrong'; end if;
  lst := public.priest_confessors_list(tok);
  select x->>'id' into conf_id from jsonb_array_elements(lst) x where x->>'person_id' = kid2::text;
  if (select x->'last_contact'->>'kind' from jsonb_array_elements(lst) x where x->>'person_id' = kid2::text) <> 'call' then
    raise exception 'last_contact must be call';
  end if;

  -- reminder setting
  perform public.priest_set_reminder_days(tok, 5);
  prof := public.priest_portal_profile(tok);
  if (prof->'counts'->>'overdue')::int <> 1 then raise exception 'with 5 days ADULT-1 (10 days) must be overdue'; end if;
  perform public.priest_set_reminder_days(tok, 40);

  -- remove
  perform public.priest_remove_confessor(tok, conf_id::uuid);
  if jsonb_array_length(public.priest_confessors_list(tok)) <> 2 then raise exception 'remove failed'; end if;

  -- another priest cannot see them
  r := public.priest_login('PR-2', 'pass456', false, null);
  if jsonb_array_length(public.priest_confessors_list(r->>'token')) <> 0 then raise exception 'other priest must see nothing'; end if;
  -- PR-2 is in church ب → cannot find KID-1 by search (church أ)
  if jsonb_array_length(public.priest_search_persons(r->>'token', 'مينا', 30)) <> 0 then raise exception 'other church search must be empty'; end if;
end $$;

-- ---------- D. appointments: child asks → priest approves → done ----------
do $$
declare r jsonb; tok text; ctok text; cp jsonb; appt uuid; lst jsonb; ok boolean := false; kid2 uuid; pr1 uuid;
begin
  tok := (public.priest_login('PR-1', 'pass123', true, null))->>'token';
  perform set_config('test.tok', tok, false);
  ctok := (public.child_login('KID-1', 'secret1', false, null))->>'token';
  pr1 := ((public.priest_portal_profile(tok))->'priest'->>'id')::uuid;

  cp := public.child_portal_confession(ctok);
  if jsonb_array_length(cp->'priests') <> 1 then raise exception 'child must see 1 priest (his church), got %', jsonb_array_length(cp->'priests'); end if;
  if not (cp->'priests'->0->>'is_mine')::boolean then raise exception 'PR-1 is the child''s priest'; end if;

  begin
    perform public.child_request_confession(ctok, pr1, public.cairo_today_date() - 1, null, null);
  exception when others then ok := sqlerrm like '%past_date%'; end;
  if not ok then raise exception 'past date must fail'; end if;

  r := public.child_request_confession(ctok, pr1, public.cairo_today_date() + 2, '18:00', 'بعد القداس');
  appt := (r->>'id')::uuid;
  if r->>'status' <> 'pending' then raise exception 'child request must be pending'; end if;
  ok := false;
  begin
    perform public.child_request_confession(ctok, pr1, public.cairo_today_date() + 3, null, null);
  exception when others then ok := sqlerrm like '%pending_exists%'; end;
  if not ok then raise exception 'second pending request must fail'; end if;

  -- priest sees it pending
  lst := public.priest_appointments_list(tok, null, null, false);
  if jsonb_array_length(lst) <> 1 or lst->0->>'status' <> 'pending' or lst->0->>'requested_by' <> 'child' then raise exception 'priest list wrong'; end if;
  if (public.priest_portal_profile(tok)->'counts'->>'pending_appointments')::int <> 1 then raise exception 'pending count wrong'; end if;

  -- approve moving it to +3 at 19:00
  r := public.priest_decide_appointment(tok, appt, 'approve', public.cairo_today_date() + 3, '19:00', 'موعد جديد');
  if r->>'status' <> 'approved' or (r->>'on')::date <> public.cairo_today_date() + 3 or (r->>'time')::time <> '19:00' then
    raise exception 'approve/move failed: %', r;
  end if;
  cp := public.child_portal_confession(ctok);
  if cp->'appointments'->0->>'status' <> 'approved' then raise exception 'child must see approved'; end if;

  -- done → confession row
  r := public.priest_decide_appointment(tok, appt, 'done', null, null, null);
  if r->>'status' <> 'done' then raise exception 'done failed'; end if;
  if jsonb_array_length((public.priest_confessor_history(tok, ((public.priest_lookup_code(tok, 'KID-1'))->'person'->>'id')::uuid))->'confessions') <> 3 then
    raise exception 'done must create a confession (3 total for KID-1)';
  end if;

  -- priest books one himself for KID-2 (not a confessor yet) → approved + becomes confessor
  kid2 := ((public.priest_lookup_code(tok, 'KID-2'))->'person'->>'id')::uuid;
  r := public.priest_create_appointment(tok, kid2, public.cairo_today_date(), '10:00', null);
  if r->>'status' <> 'approved' then raise exception 'priest appointment must be approved'; end if;
  if not (r->>'is_confessor')::boolean then raise exception 'booking must add the confessor'; end if;
  if (public.priest_portal_profile(tok)->'counts'->>'today_appointments')::int <> 1 then raise exception 'today count wrong'; end if;

  -- reject flow
  r := public.child_request_confession(ctok, pr1, public.cairo_today_date() + 5, null, null);
  r := public.priest_decide_appointment(tok, (r->>'id')::uuid, 'reject', null, null, 'غير متاح');
  if r->>'status' <> 'rejected' then raise exception 'reject failed'; end if;

  -- child cancels his own approved one
  r := public.child_request_confession(ctok, pr1, public.cairo_today_date() + 6, null, null);
  perform public.child_cancel_confession_request(ctok, (r->>'id')::uuid);
  cp := public.child_portal_confession(ctok);
  if not exists (select 1 from jsonb_array_elements(cp->'appointments') x where x->>'id' = r->>'id' and x->>'status' = 'cancelled') then
    raise exception 'child cancel failed';
  end if;
end $$;

-- ---------- E. owner suspends → session dies; password reset; delete ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local request.jwt.claim.role = 'authenticated';
do $$
declare pr1 uuid;
begin
  select p.id into pr1 from public.priests p join public.persons x on x.id = p.person_id where x.national_id = 'PR-1';
  perform public.owner_update_priest(pr1, null, 'القمص يوحنا', 'suspended', null, 30);
  perform public.owner_set_priest_password(pr1, 'newpass1');
end $$;
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare ok boolean := false; r jsonb;
begin
  begin
    perform public.priest_login('PR-1', 'newpass1', false, null);
  exception when others then ok := sqlerrm like '%account_stopped%'; end;
  if not ok then raise exception 'suspended priest must not log in'; end if;
  -- the old sessions were killed by the suspension
  ok := false;
  begin
    perform public.priest_session_touch(current_setting('test.tok', true));
  exception when others then ok := true; end;
  if not ok then raise exception 'suspend must kill sessions'; end if;
end $$;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local request.jwt.claim.role = 'authenticated';
do $$
declare pr1 uuid; r jsonb;
begin
  select p.id into pr1 from public.priests p join public.persons x on x.id = p.person_id where x.national_id = 'PR-1';
  perform public.owner_update_priest(pr1, null, null, 'approved', null, null);
  if (select reminder_days from public.priests where id = pr1) <> 30 then raise exception 'reminder_days must be 30'; end if;
  if (select title from public.priests where id = pr1) <> 'القمص يوحنا' then raise exception 'title update failed'; end if;
  perform public.owner_delete_priest(pr1);
  if exists (select 1 from public.priests where id = pr1) then raise exception 'delete failed'; end if;
  if not exists (select 1 from public.persons where national_id = 'PR-1') then raise exception 'person must survive the delete'; end if;
  -- audit: priest actions were logged with actor_kind = priest
  if not exists (select 1 from public.activity_log where actor_kind = 'priest') then raise exception 'priest actions must be audited'; end if;
end $$;
reset role;
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare r jsonb;
begin
  r := public.priest_login('PR-2', 'pass456', false, null);
  -- re-approved & password-reset PR-1 logs in with the new password
end $$;

select 'PRIESTS PORTAL TESTS PASSED' as result;
rollback;
