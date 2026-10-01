-- =====================================================================
-- Functional test for 20261005120000_person_enrollment_kinds_merge.sql
-- (إدارة الأفراد — enrollment kinds · add priest for person · MERGE).
--   psql -d app -f supabase/tests/person_kinds_merge_test.sql
-- Ends with «PERSON KINDS / MERGE TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000006');  -- class servant (registered under code SRV-1)
insert into public.churches (id, name) values ('10000000-0000-0000-0000-000000000001', 'كنيسة أ');
insert into public.services (id, church_id, name) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل ب');
insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000006', 'مينا الخادم', 'srv-1', '+201000000006', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now());
update public.persons set national_id = 'SRV-1' where id = (select person_id from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000006');

-- the SAME human registered a second time as a child under code KID-1 (two classes, points, a password)
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local request.jwt.claim.role = 'authenticated';
select public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001', 'مينا', 'KID-1', 'male', '2005-01-01', null, 'شارع ١', null, null, 7, 'kidpass1');
select public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000002', 'مينا', 'KID-1', 'male', null, null, null, null, null, 3, null);
-- an unrelated child
select public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000002', 'مريم', 'KID-2', 'female', null, '+201000000002', null, null, null, 0, 'kidpass2');

-- ---------- A. page: kinds + priest column + counts ----------
do $$
declare r record; c jsonb; n int;
begin
  select * into r from public.owner_persons_page(p_search => 'SRV-1');
  if r.servant is null then raise exception 'servant json expected'; end if;
  if r.priest is not null then raise exception 'no priest yet'; end if;
  -- the servant's mirror row is kind = servant
  if (select count(*) from jsonb_array_elements(r.enrollments) e where e->>'kind' = 'servant') <> 1 then
    raise exception 'one servant mirror row expected';
  end if;
  -- kind filter 'child' = has a child enrollment (the servant has none)
  select count(*) into n from public.owner_persons_page(p_kind => 'child');
  if n <> 2 then raise exception 'child filter: 2 expected, got %', n; end if;
  select count(*) into n from public.owner_persons_page(p_kind => 'priest');
  if n <> 0 then raise exception 'priest filter: 0 expected, got %', n; end if;
  c := public.owner_persons_counts();
  if (c->>'priests')::int <> 0 or (c->>'children')::int <> 2 or (c->>'servants')::int <> 2 then
    raise exception 'counts wrong: %', c;
  end if;
end $$;

-- ---------- B. add a priest account to an existing person (KID-2) ----------
do $$
declare pid uuid; r jsonb; ok boolean := false; n int;
begin
  select id into pid from public.persons where national_id = 'KID-2';
  r := public.owner_add_priest_for_person(pid, '10000000-0000-0000-0000-000000000001', 'القس', null);
  if (r->>'priest_id') is null then raise exception 'priest id expected'; end if;
  -- the trigger adopted the person's EXISTING password (kidpass2)
  if not public.person_password_ok(pid, 'kidpass2') then raise exception 'person password must stay'; end if;
  if not exists (select 1 from public.priests pr join public.person_credentials c on c.person_id = pr.person_id
                  where pr.person_id = pid and pr.password_hash = c.password_hash) then
    raise exception 'priest mirror hash must equal the person hash';
  end if;
  -- the page shows the priest + kind filter
  select count(*) into n from public.owner_persons_page(p_kind => 'priest');
  if n <> 1 then raise exception 'priest filter: 1 expected, got %', n; end if;
  if (select (p.priest->>'title') from public.owner_persons_page(p_search => 'KID-2') p) <> 'القس' then
    raise exception 'priest title expected in the page';
  end if;
  -- twice → refused
  begin perform public.owner_add_priest_for_person(pid, '10000000-0000-0000-0000-000000000001', null, null);
  exception when others then ok := sqlerrm like '%already_registered%'; end;
  if not ok then raise exception 'second priest must be refused'; end if;
end $$;

-- ---------- C. merge: servant row (SRV-1) + child row (KID-1) → ONE person ----------
do $$
declare keep uuid; rm uuid; r jsonb; e record; n int; ok boolean := false;
begin
  select id into keep from public.persons where national_id = 'SRV-1';
  select id into rm   from public.persons where national_id = 'KID-1';
  -- a log row under the child enrollment of class A (to prove it is moved, not lost)
  insert into public.points_log (enrollment_id, delta, recorded_by)
  select id, 5, '00000000-0000-0000-0000-000000000001' from public.enrollments where person_id = rm and class_id = '30000000-0000-0000-0000-000000000001';

  -- same person twice → refused
  begin perform public.owner_merge_persons(keep, keep, '{}');
  exception when others then ok := sqlerrm like '%two_persons_required%'; end;
  if not ok then raise exception 'same person must be refused'; end if;

  -- a code that is neither → refused
  ok := false;
  begin perform public.owner_merge_persons(keep, rm, '{"national_id":"XYZ"}');
  exception when others then ok := sqlerrm like '%invalid_code%'; end;
  if not ok then raise exception 'foreign code must be refused'; end if;

  -- keep the SERVANT row, take the child's code + birthdate + address, keep the servant's name
  r := public.owner_merge_persons(keep, rm, jsonb_build_object(
         'national_id', 'KID-1', 'birthdate', '2005-01-01', 'address', 'شارع ١', 'name', 'مينا الخادم'));
  if (r->>'person_id')::uuid <> keep then raise exception 'keep id must survive'; end if;
  if (r->>'code') <> 'KID-1' then raise exception 'chosen code expected, got %', r->>'code'; end if;
  if not (r->>'realign_servant')::boolean then raise exception 'servant login must be realigned (code + password changed)'; end if;

  -- the removed row is gone, the kept one carries the chosen values
  if exists (select 1 from public.persons where id = rm) then raise exception 'removed person must be deleted'; end if;
  select * into e from public.persons where id = keep;
  if e.national_id <> 'KID-1' or e.name <> 'مينا الخادم' or e.birthdate <> '2005-01-01' or e.address <> 'شارع ١' then
    raise exception 'identity values wrong: % % % %', e.national_id, e.name, e.birthdate, e.address;
  end if;
  -- class A: the servant mirror and the child row were the SAME class → folded into ONE row
  --          with the child's points (7 + 5 from the log) — kind stays servant (mirror)
  select count(*) into n from public.enrollments where person_id = keep and class_id = '30000000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'class A must have exactly one row, got %', n; end if;
  select * into e from public.enrollments where person_id = keep and class_id = '30000000-0000-0000-0000-000000000001';
  if e.points <> 12 then raise exception 'class A points 12 expected, got %', e.points; end if;
  if e.kind <> 'servant' or e.servant_id <> '00000000-0000-0000-0000-000000000006' then raise exception 'class A row must stay the servant mirror'; end if;
  if not exists (select 1 from public.points_log where enrollment_id = e.id and delta = 5) then raise exception 'points log must follow the merged enrollment'; end if;
  -- class B (child only) → moved
  if not exists (select 1 from public.enrollments where person_id = keep and class_id = '30000000-0000-0000-0000-000000000002' and kind = 'child' and points = 3) then
    raise exception 'class B child row must be moved with its points';
  end if;
  -- the servant account logs in with the new code
  if (select user_id from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000006') <> public.code_to_user_id('KID-1') then
    raise exception 'servant user_id must follow the code';
  end if;
  -- the password: the servant row had none → the child's was adopted
  if not public.person_password_ok(keep, 'kidpass1') then raise exception 'child password must be adopted'; end if;
  -- one login → the accounts list shows BOTH kinds for the one code
  if (select count(distinct a->>'kind') from jsonb_array_elements(public.person_accounts(keep)) a) <> 2 then
    raise exception 'merged person must own servant + child accounts';
  end if;
  -- page: one row, both kinds
  select count(*) into n from public.owner_persons_page(p_search => 'مينا');
  if n <> 1 then raise exception 'one مينا expected after the merge, got %', n; end if;
end $$;

-- ---------- D. both servants → refused ----------
do $$
declare ok boolean := false; a uuid; b uuid;
begin
  select person_id into a from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000001';
  select person_id into b from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000006';
  begin perform public.owner_merge_persons(a, b, '{}');
  exception when others then ok := sqlerrm like '%both_servants%'; end;
  if not ok then raise exception 'two servant accounts must be refused'; end if;
end $$;
reset role;

-- ---------- E. non-owner → forbidden ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';
do $$
declare ok boolean := false; a uuid; b uuid;
begin
  select id into a from public.persons where national_id = 'KID-1';
  select id into b from public.persons where national_id = 'KID-2';
  begin perform public.owner_merge_persons(a, b, '{}');
  exception when others then ok := sqlerrm like '%forbidden%'; end;
  if not ok then raise exception 'servant must not merge'; end if;
  ok := false;
  begin perform public.owner_add_priest_for_person(a, '10000000-0000-0000-0000-000000000001', null, null);
  exception when others then ok := sqlerrm like '%forbidden%'; end;
  if not ok then raise exception 'servant must not add priests'; end if;
end $$;
reset role;

select 'PERSON KINDS / MERGE TESTS PASSED' as result;
rollback;
