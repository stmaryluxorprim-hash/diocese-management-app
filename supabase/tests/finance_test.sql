-- =====================================================================
-- Functional test for the finance module (الخزينة → الميزانيات)
--   20260928140000_finance.sql + 20260929120000_finance_budgets.sql
--   psql -d app -f supabase/tests/finance_test.sql
-- Ends with «FINANCE TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000003'),  -- service manager (مدارس الأحد)
  ('00000000-0000-0000-0000-000000000006'),  -- class servant A (فصل أ)
  ('00000000-0000-0000-0000-000000000007'),  -- class servant B (فصل أ) — never a member
  ('00000000-0000-0000-0000-000000000009');  -- church manager of كنيسة ب
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة أ'),
  ('10000000-0000-0000-0000-000000000002', 'كنيسة ب');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ');

insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000003', 'مسؤول الخدمة', 'sm', '0103', 'service_manager', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, now()),
  ('00000000-0000-0000-0000-000000000006', 'خادم أ', 'cs-a', '0106', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now()),
  ('00000000-0000-0000-0000-000000000007', 'خادم ب', 'cs-b', '0107', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now()),
  ('00000000-0000-0000-0000-000000000009', 'مدير ب', 'cm-b', '0109', 'church_manager', 'approved',
   '10000000-0000-0000-0000-000000000002', null, null, now());

-- ---------- A. service manager creates a budget for his service ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
set local request.jwt.claim.role = 'authenticated';

do $$
declare p jsonb; b uuid; c_income uuid; c_exp uuid; s jsonb; n int;
begin
  p := public.finance_permissions();
  if not ((p ->> 'view')::boolean and (p ->> 'create')::boolean) then raise exception 'service manager must view/create: %', p; end if;

  insert into public.finance_budgets (id, name, church_id, service_id)
  values ('40000000-0000-0000-0000-000000000001', 'ميزانية مدارس الأحد', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
  b := '40000000-0000-0000-0000-000000000001';

  -- creator is a manager automatically
  if public.finance_budget_role(b) <> 'manager' then raise exception 'creator must be manager, got %', public.finance_budget_role(b); end if;
  select count(*) into n from public.finance_budget_members where budget_id = b; 
  if n <> 1 then raise exception 'expected 1 member (creator), got %', n; end if;

  -- a budget for «الكل» is owner-only
  begin
    insert into public.finance_budgets (name) values ('عامة');
    raise exception 'service manager must not create an all-scope budget';
  exception when insufficient_privilege then null; end;
  -- a budget for another church is refused
  begin
    insert into public.finance_budgets (name, church_id) values ('x', '10000000-0000-0000-0000-000000000002');
    raise exception 'service manager must not create a budget for church b';
  exception when insufficient_privilege then null; end;

  -- causes + entries inside the budget
  insert into public.finance_causes (budget_id, name, kind) values (b, 'تبرعات', 'income') returning id into c_income;
  insert into public.finance_causes (budget_id, name, kind) values (b, 'مطبوعات', 'expense') returning id into c_exp;
  insert into public.finance_entries (budget_id, kind, amount, cause_id, entry_date) values (b, 'income', 500, c_income, current_date - 40);
  insert into public.finance_entries (budget_id, kind, amount, cause_id, entry_date) values (b, 'income', 300, c_income, current_date - 2);
  insert into public.finance_entries (budget_id, kind, amount, cause_id, entry_date) values (b, 'expense', 120.5, c_exp, current_date - 1);
  insert into public.finance_entries (budget_id, kind, amount, cause_text, entry_date) values (b, 'expense', 80, 'شراء بالونات', current_date);

  -- the scope is mirrored from the budget
  if (select church_id from public.finance_entries where cause_text = 'شراء بالونات') <> '10000000-0000-0000-0000-000000000001' then
    raise exception 'entry scope must mirror the budget';
  end if;
  if (select cause_text from public.finance_entries where cause_id = c_income limit 1) <> 'تبرعات' then raise exception 'cause_text must mirror the static cause'; end if;

  begin
    insert into public.finance_entries (budget_id, kind, amount, cause_id) values (b, 'expense', 10, c_income);
    raise exception 'income cause on an expense must be refused';
  exception when check_violation then null; end;
  begin
    insert into public.finance_entries (budget_id, kind, amount) values (b, 'expense', 10);
    raise exception 'entry without cause must be refused';
  exception when check_violation then null; end;

  s := public.finance_summary(b, current_date - 29, current_date, 'day');
  if (s -> 'balance' ->> 'net')::numeric <> 599.5 then raise exception 'balance.net expected 599.5: %', s -> 'balance'; end if;
  if (s -> 'period' ->> 'income')::numeric <> 300 then raise exception 'period.income expected 300: %', s -> 'period'; end if;
  if (s -> 'period' ->> 'count')::int <> 3 then raise exception 'period.count expected 3'; end if;
  if jsonb_array_length(s -> 'by_cause') <> 3 then raise exception 'by_cause expected 3 rows'; end if;

  -- my budgets list
  s := public.finance_my_budgets();
  if jsonb_array_length(s) <> 1 or (s -> 0 ->> 'role') <> 'manager' or (s -> 0 ->> 'income')::numeric <> 800 then
    raise exception 'finance_my_budgets wrong: %', s;
  end if;

  -- candidates: class servants of his scope, not himself
  s := public.finance_budget_candidates(b, '');
  if jsonb_array_length(s) <> 2 then raise exception 'expected 2 candidates (cs-a, cs-b), got %', s; end if;

  -- add خادم أ as EDITOR
  insert into public.finance_budget_members (budget_id, servant_id, role) values (b, '00000000-0000-0000-0000-000000000006', 'editor');
end $$;

-- ---------- B. class servant A (editor): sees, adds, cannot delete / manage ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
do $$
declare b uuid := '40000000-0000-0000-0000-000000000001'; n int; s jsonb;
begin
  if public.finance_budget_role(b) <> 'editor' then raise exception 'cs-a must be editor'; end if;
  if (public.finance_permissions() ->> 'create')::boolean then raise exception 'class servant must not create budgets without the key'; end if;
  select count(*) into n from public.finance_entries where budget_id = b;
  if n <> 4 then raise exception 'editor should see 4 entries, saw %', n; end if;
  insert into public.finance_entries (budget_id, kind, amount, cause_text) values (b, 'income', 25, 'اشتراك رحلة');
  delete from public.finance_entries where cause_text = 'اشتراك رحلة';
  if not exists (select 1 from public.finance_entries where cause_text = 'اشتراك رحلة') then raise exception 'editor must not delete'; end if;
  begin
    insert into public.finance_causes (budget_id, name) values (b, 'x');
    raise exception 'editor must not create causes';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.finance_budget_members (budget_id, servant_id) values (b, '00000000-0000-0000-0000-000000000007');
    raise exception 'editor must not add members';
  exception when insufficient_privilege then null; end;
  -- he sees the members list (names) but candidates are empty
  s := public.finance_budget_members_list(b);
  if jsonb_array_length(s) <> 2 then raise exception 'members list expected 2, got %', s; end if;
  if jsonb_array_length(public.finance_budget_candidates(b, '')) <> 0 then raise exception 'editor gets no candidates'; end if;
end $$;

-- ---------- C. class servant B (NOT a member, same class): sees NOTHING ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000007';
do $$
declare b uuid := '40000000-0000-0000-0000-000000000001'; n int;
begin
  if public.finance_budget_role(b) is not null then raise exception 'non-member must have no role'; end if;
  select count(*) into n from public.finance_budgets; if n <> 0 then raise exception 'non-member sees % budgets', n; end if;
  select count(*) into n from public.finance_entries; if n <> 0 then raise exception 'non-member sees % entries', n; end if;
  if jsonb_array_length(public.finance_my_budgets()) <> 0 then raise exception 'non-member my_budgets must be empty'; end if;
  begin
    perform public.finance_summary(b, null, null, 'month');
    raise exception 'non-member summary must be refused';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.finance_entries (budget_id, kind, amount, cause_text) values (b, 'income', 1, 'x');
    raise exception 'non-member insert must be refused';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------- D. church manager of كنيسة ب: nothing of كنيسة أ; can create his own ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000009';
do $$
declare n int;
begin
  select count(*) into n from public.finance_budgets; if n <> 0 then raise exception 'church b manager sees % budgets', n; end if;
  insert into public.finance_budgets (name, church_id) values ('ميزانية كنيسة ب', '10000000-0000-0000-0000-000000000002');
  if jsonb_array_length(public.finance_my_budgets()) <> 1 then raise exception 'church b must see his own budget'; end if;
end $$;

-- ---------- E. owner sees everything as manager; «الكل» budget ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare n int;
begin
  select count(*) into n from public.finance_budgets; if n <> 2 then raise exception 'owner must see 2 budgets, saw %', n; end if;
  if public.finance_budget_role('40000000-0000-0000-0000-000000000001') <> 'manager' then raise exception 'owner is manager everywhere'; end if;
  insert into public.finance_budgets (name) values ('الميزانية العامة');
  if (select church_id from public.finance_budgets where name = 'الميزانية العامة') is not null then raise exception 'all-scope budget must have null church'; end if;
end $$;

-- ---------- F. class servant with finance.create key may create for his class ----------
reset role;
insert into public.permission_profiles (id, name, permissions) values ('80000000-0000-0000-0000-000000000001', 'إنشاء ميزانية', array['finance.create']);
insert into public.permissions (servant_id, permission_profile_id) values ('00000000-0000-0000-0000-000000000007', '80000000-0000-0000-0000-000000000001');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000007';
do $$
begin
  if not (public.finance_permissions() ->> 'create')::boolean then raise exception 'cs-b with the key must create'; end if;
  insert into public.finance_budgets (name, church_id, service_id, class_id)
  values ('ميزانية فصل أ', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
  if jsonb_array_length(public.finance_my_budgets()) <> 1 then raise exception 'cs-b must see only his own budget'; end if;
end $$;

-- ---------- G. hide the module → everything closes ----------
reset role;
delete from public.module_access where module_key = 'finance';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
do $$
declare n int;
begin
  if (public.finance_permissions() ->> 'view')::boolean then raise exception 'module hidden → no view'; end if;
  select count(*) into n from public.finance_budgets; if n <> 0 then raise exception 'module hidden → 0 budgets'; end if;
  select count(*) into n from public.finance_entries; if n <> 0 then raise exception 'module hidden → 0 entries'; end if;
end $$;

reset role;
select 'FINANCE TESTS PASSED' as result;
rollback;
