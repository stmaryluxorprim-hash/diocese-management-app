-- =====================================================================
-- Functional test for 20260925130000_activity_permissions_and_person_modules.sql
--   psql -d app -f supabase/tests/activity_permissions_test.sql
-- Ends with «ACTIVITY PERMISSIONS TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000003'),  -- service manager
  ('00000000-0000-0000-0000-000000000006'),  -- class servant (no profile)
  ('00000000-0000-0000-0000-000000000007');  -- class servant (fine profile)
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة أ');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ');

insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000003', 'مسؤول الخدمة', 'sm', '0103', 'service_manager', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, now()),
  ('00000000-0000-0000-0000-000000000006', 'خادم بلا صلاحيات', 'cs-a', '0106', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now()),
  ('00000000-0000-0000-0000-000000000007', 'خادم بصلاحيات', 'cs-b', '0107', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now());

-- profile with FINE keys: add + edit events (no delete / set_default),
-- reorder feedbacks (no edit), approve data requests (no reject)
insert into public.permission_profiles (id, name, permissions) values
  ('a0000000-0000-0000-0000-000000000001', 'منسّق مناسبات',
   array['activity.events.add', 'activity.events.edit', 'activity.feedbacks.reorder', 'activity.data_requests.approve']),
  -- legacy coarse key ⇒ every fine key of causes
  ('a0000000-0000-0000-0000-000000000002', 'قديم — أسباب', array['activity.causes']);
insert into public.permissions (servant_id, permission_profile_id) values
  ('00000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000002');

-- seed data as postgres (no caller → guards skipped)
insert into public.events (id, church_id, service_id, class_id, name, recurrence, weekdays, points, is_default) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'حضور الفصل', 'weekly', '{5}', 5, true),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'اجتماع', 'weekly', '{3}', 2, false);
insert into public.causes (id, church_id, service_id, class_id, name, points, is_default) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'حفظ آية', 5, true);
insert into public.call_feedbacks (id, church_id, service_id, class_id, name, sort_order) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'سيأتي', 0),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'مريض', 1);
insert into public.persons (id, national_id, name, gender) values
  ('70000000-0000-0000-0000-000000000001', 'KID-1', 'مينا', 'male');
insert into public.enrollments (id, person_id, church_id, service_id, class_id) values
  ('80000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
insert into public.data_change_requests (id, person_id, kind, changes, previous) values
  ('90000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'data', '{"phone":"+201000000000"}', '{}'),
  ('90000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', 'data', '{"address":"الأقصر"}', '{}');

-- ---------- A. class servant WITHOUT a profile: view only ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';

do $$
declare p jsonb := public.activity_item_permissions(); n int;
begin
  if not (p #>> '{events,view}')::boolean then raise exception 'A1: view is default for a class servant'; end if;
  if (p #>> '{events,add}')::boolean then raise exception 'A2: add must need a profile'; end if;
  if (p #>> '{data_requests,approve}')::boolean then raise exception 'A3: approve must need a profile'; end if;

  select count(*) into n from public.events;
  if n <> 2 then raise exception 'A4: he must still SEE the events of his class (got %)', n; end if;

  begin
    insert into public.events (church_id, service_id, class_id, name, recurrence, weekdays, points)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'x', 'weekly', '{1}', 1);
    raise exception 'A5: insert without activity.events.add must be refused';
  exception when insufficient_privilege or check_violation then null;
  end;

  update public.events set name = 'y' where id = '40000000-0000-0000-0000-000000000002';
  if found then raise exception 'A6: update without activity.events.edit must touch 0 rows'; end if;

  delete from public.call_feedbacks where id = '60000000-0000-0000-0000-000000000002';
  if found then raise exception 'A7: delete without activity.feedbacks.delete must touch 0 rows'; end if;

  begin
    perform public.review_data_change_request('90000000-0000-0000-0000-000000000001', true, null);
    raise exception 'A8: approve without permission must be refused';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------- B. class servant WITH fine keys ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000007';

do $$
declare p jsonb := public.activity_item_permissions(); new_id uuid;
begin
  if not (p #>> '{events,add}')::boolean or not (p #>> '{events,edit}')::boolean then raise exception 'B1: add/edit expected'; end if;
  if (p #>> '{events,delete}')::boolean then raise exception 'B2: delete NOT expected'; end if;
  if (p #>> '{events,set_default}')::boolean then raise exception 'B3: set_default NOT expected'; end if;
  if not (p #>> '{causes,add}')::boolean or not (p #>> '{causes,delete}')::boolean or not (p #>> '{causes,set_default}')::boolean then
    raise exception 'B4: legacy activity.causes must imply the fine cause keys';
  end if;

  insert into public.events (church_id, service_id, class_id, name, recurrence, weekdays, points)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'رحلة', 'weekly', '{1}', 1)
  returning id into new_id;

  update public.events set name = 'رحلة الفصل' where id = new_id;
  if not found then raise exception 'B5: edit with activity.events.edit must work'; end if;

  begin
    update public.events set is_default = true where id = new_id;
    raise exception 'B6: set_default without the key must be refused';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.events (church_id, service_id, class_id, name, recurrence, weekdays, points, is_default)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'z', 'weekly', '{1}', 1, true);
    raise exception 'B7: insert as default without the key must be refused';
  exception when insufficient_privilege then null;
  end;

  delete from public.events where id = new_id;
  if found then raise exception 'B8: delete without the key must touch 0 rows'; end if;

  -- causes via the legacy key: set default → ok; the cascade switches the
  -- older default off without tripping the guard
  insert into public.causes (church_id, service_id, class_id, name, points, is_default)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'سلوك', 3, true);
  if (select is_default from public.causes where id = '50000000-0000-0000-0000-000000000001') then
    raise exception 'B9: the previous default cause must be switched off by the cascade';
  end if;

  -- feedbacks: reorder ok, renaming refused
  update public.call_feedbacks set sort_order = 5 where id = '60000000-0000-0000-0000-000000000001';
  if not found then raise exception 'B10: reorder with activity.feedbacks.reorder must work'; end if;
  begin
    update public.call_feedbacks set name = 'غيّرته' where id = '60000000-0000-0000-0000-000000000001';
    raise exception 'B11: renaming without activity.feedbacks.edit must be refused';
  exception when insufficient_privilege then null;
  end;

  -- data requests: approve ok, reject refused
  perform public.review_data_change_request('90000000-0000-0000-0000-000000000001', true, null);
  if (select phone from public.persons where id = '70000000-0000-0000-0000-000000000001') <> '+201000000000' then
    raise exception 'B12: approve must apply the change';
  end if;
  begin
    perform public.review_data_change_request('90000000-0000-0000-0000-000000000002', false, 'لا');
    raise exception 'B13: reject without activity.data_requests.reject must be refused';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------- C. service manager: everything, unchanged ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
do $$
declare p jsonb := public.activity_item_permissions();
begin
  if not (p #>> '{events,delete}')::boolean or not (p #>> '{data_requests,reject}')::boolean or not (p #>> '{feedbacks,edit}')::boolean then
    raise exception 'C1: managers hold every key';
  end if;
  update public.events set is_default = true where id = '40000000-0000-0000-0000-000000000002';
  if not found then raise exception 'C2: manager may set the default'; end if;
  if (select is_default from public.events where id = '40000000-0000-0000-0000-000000000001') then
    raise exception 'C3: cascade must switch off the previous default';
  end if;
  perform public.review_data_change_request('90000000-0000-0000-0000-000000000002', false, 'لا');
  delete from public.events where id = '40000000-0000-0000-0000-000000000002';
  if not found then raise exception 'C4: manager may delete'; end if;
end $$;

-- ---------- D. module visible for a specific PERSON ----------
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
do $$ begin
  if public.module_visible('store') then raise exception 'D1: store must be hidden without any grant'; end if;
end $$;

-- owner grants the module to servant 6 only
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into public.module_access (module_key, servant_id) values ('store', '00000000-0000-0000-0000-000000000006');
do $$ begin
  begin
    insert into public.module_access (module_key, servant_id, church_id) values ('store', '00000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001');
    raise exception 'D2: a person grant with a scope must be refused';
  exception when check_violation then null;
  end;
  begin
    insert into public.module_access (module_key, servant_id) values ('store', '00000000-0000-0000-0000-000000000006');
    raise exception 'D3: duplicate person grant must be refused';
  exception when unique_violation then null;
  end;
end $$;

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
do $$
declare n int;
begin
  if not public.module_visible('store') then raise exception 'D4: the named servant must see the module'; end if;
  select count(*) into n from public.module_access where module_key = 'store';
  if n <> 1 then raise exception 'D5: he must read his own person grant (got %)', n; end if;
end $$;

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000007';
do $$
declare n int;
begin
  if public.module_visible('store') then raise exception 'D6: another servant of the SAME class must NOT see it'; end if;
  select count(*) into n from public.module_access where module_key = 'store';
  if n <> 0 then raise exception 'D7: he must not read someone else''s person grant (got %)', n; end if;
end $$;

-- a person grant is not a global scope grant for the child-portal helpers
reset role;
do $$ begin
  if public.module_granted_for('store', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001') then
    raise exception 'D8: module_granted_for must ignore person grants';
  end if;
  if public.notif_module_covers('10000000-0000-0000-0000-000000000001', null, null) then
    raise exception 'D9: notif_module_covers must ignore person grants';
  end if;
end $$;

-- the scope-unique index still works and coexists with person grants
insert into public.module_access (module_key, church_id) values ('store', '10000000-0000-0000-0000-000000000001');
do $$ begin
  begin
    insert into public.module_access (module_key, church_id) values ('store', '10000000-0000-0000-0000-000000000001');
    raise exception 'D10: duplicate scope grant must be refused';
  exception when unique_violation then null;
  end;
end $$;

rollback;
\echo ACTIVITY PERMISSIONS TESTS PASSED
