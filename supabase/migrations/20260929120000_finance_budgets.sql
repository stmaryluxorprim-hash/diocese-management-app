-- =====================================================================
-- FINANCE v2 — BUDGETS (الميزانيات)
--
-- The scenario:
--   1. Someone creates a BUDGET (ميزانية) — a name + a place: a church,
--      a service, a class — or «الكل» (no place at all).
--   2. ONLY THE PEOPLE ALLOWED see that budget: the creator (as manager)
--      and the servants he adds as members with a role
--        viewer  (يرى)   — sees the overview and the entries
--        editor  (يسجّل) — + records income / expense
--        manager (يدير)  — + edits / deletes entries, manages causes,
--                           members and the budget itself
--      The app owner sees every budget (manager everywhere).
--   3. Inside the budget everything stays as in v1: entries with a static
--      or typed cause, balance, per-period / per-cause summaries.
--
-- The place of a budget is INFORMATIONAL (where the money belongs, and it
-- is the only thing that decides WHO MAY CREATE it — can_access). It does
-- not grant visibility: a servant of that class does NOT see the budget
-- unless he is a member.
--
-- Migration of v1 data: every distinct (church, service, class) that has
-- entries / causes becomes one budget named after the place; the servants
-- who recorded there become members (creators → manager).
--
-- Access
--   module_visible('finance')             — the module must be granted
--   finance.create   (permission key)     — create a budget (managers by role,
--                                           class servants via a profile)
--   finance_budget_role(budget)           — the caller's role in a budget
--   RLS: read when member (or owner); write by role.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Budgets + members
-- ---------------------------------------------------------------------
create table if not exists public.finance_budgets (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  church_id   uuid references public.churches(id) on delete cascade,   -- null = «الكل»
  service_id  uuid references public.services(id) on delete cascade,
  class_id    uuid references public.classes(id)  on delete cascade,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.servant_enrollments(id) on delete set null,
  edited_at   timestamptz not null default now(),
  edited_by   uuid references public.servant_enrollments(id) on delete set null,
  constraint finance_budgets_name_chk check (length(trim(name)) between 1 and 120),
  constraint finance_budgets_service_needs_church check (service_id is null or church_id is not null),
  constraint finance_budgets_class_needs_service check (class_id is null or service_id is not null)
);
comment on table public.finance_budgets is
  'الميزانيات — ميزانية باسم ومكان (كنيسة ← خدمة ← فصل أو الكل)؛ لا يراها إلا أعضاؤها';

create table if not exists public.finance_budget_members (
  id          uuid primary key default gen_random_uuid(),
  budget_id   uuid not null references public.finance_budgets(id) on delete cascade,
  servant_id  uuid not null references public.servant_enrollments(id) on delete cascade,
  role        text not null default 'viewer' check (role in ('viewer', 'editor', 'manager')),
  created_at  timestamptz not null default now(),
  created_by  uuid references public.servant_enrollments(id) on delete set null,
  unique (budget_id, servant_id)
);
comment on table public.finance_budget_members is
  'أعضاء الميزانية — من يرى الميزانية ودوره فيها: viewer يرى · editor يسجّل · manager يدير';

create index if not exists idx_finance_budget_members_servant on public.finance_budget_members(servant_id, budget_id);
create index if not exists idx_finance_budgets_scope on public.finance_budgets(church_id, service_id, class_id);

-- audit
drop trigger if exists trg_finance_budgets_audit on public.finance_budgets;
create trigger trg_finance_budgets_audit before insert on public.finance_budgets
for each row execute function public.finance_fill_audit();
drop trigger if exists trg_finance_budgets_touch on public.finance_budgets;
create trigger trg_finance_budgets_touch before update on public.finance_budgets
for each row execute function public.touch_edited();

create or replace function public.finance_budget_members_fill()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.created_by is null then new.created_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists trg_finance_budget_members_fill on public.finance_budget_members;
create trigger trg_finance_budget_members_fill before insert on public.finance_budget_members
for each row execute function public.finance_budget_members_fill();

-- the creator becomes a manager automatically
create or replace function public.finance_budget_add_creator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null then
    insert into public.finance_budget_members (budget_id, servant_id, role, created_by)
    values (new.id, new.created_by, 'manager', new.created_by)
    on conflict (budget_id, servant_id) do update set role = 'manager';
  end if;
  return new;
end $$;
drop trigger if exists trg_finance_budget_add_creator on public.finance_budgets;
create trigger trg_finance_budget_add_creator after insert on public.finance_budgets
for each row execute function public.finance_budget_add_creator();

-- ---------------------------------------------------------------------
-- 2. budget_id on causes + entries
-- ---------------------------------------------------------------------
alter table public.finance_causes  add column if not exists budget_id uuid references public.finance_budgets(id) on delete cascade;
alter table public.finance_entries add column if not exists budget_id uuid references public.finance_budgets(id) on delete cascade;

-- ---- migrate v1 rows: one budget per distinct place ----
do $$
declare r record; v_id uuid; v_name text;
begin
  for r in (
    select church_id, service_id, class_id from public.finance_entries where budget_id is null
    union
    select church_id, service_id, class_id from public.finance_causes where budget_id is null
  ) loop
    select coalesce(
      (select k.name from public.classes k where k.id = r.class_id),
      (select s.name from public.services s where s.id = r.service_id),
      (select c.name from public.churches c where c.id = r.church_id),
      'الميزانية العامة') into v_name;
    insert into public.finance_budgets (name, church_id, service_id, class_id, created_by)
    values ('ميزانية ' || v_name, r.church_id, r.service_id, r.class_id,
            (select e.created_by from public.finance_entries e
              where e.church_id = r.church_id and e.service_id is not distinct from r.service_id and e.class_id is not distinct from r.class_id
                and e.created_by is not null order by e.created_at limit 1))
    returning id into v_id;
    update public.finance_entries set budget_id = v_id
     where budget_id is null and church_id = r.church_id and service_id is not distinct from r.service_id and class_id is not distinct from r.class_id;
    update public.finance_causes set budget_id = v_id
     where budget_id is null and church_id = r.church_id and service_id is not distinct from r.service_id and class_id is not distinct from r.class_id;
    -- everyone who recorded there keeps access as an editor
    insert into public.finance_budget_members (budget_id, servant_id, role)
    select distinct v_id, e.created_by, 'editor' from public.finance_entries e
     where e.budget_id = v_id and e.created_by is not null
    on conflict (budget_id, servant_id) do nothing;
  end loop;
end $$;

alter table public.finance_causes  alter column budget_id set not null;
alter table public.finance_entries alter column budget_id set not null;

-- the place is now carried by the budget; the row columns become optional
-- mirrors (kept for the reports / activity log) filled by trigger
alter table public.finance_causes  alter column church_id drop not null;
alter table public.finance_entries alter column church_id drop not null;

create or replace function public.finance_mirror_budget_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare b public.finance_budgets;
begin
  select * into b from public.finance_budgets where id = new.budget_id;
  if not found then raise exception 'budget_not_found' using errcode = '23503'; end if;
  new.church_id  := b.church_id;
  new.service_id := b.service_id;
  new.class_id   := b.class_id;
  return new;
end $$;
drop trigger if exists trg_finance_causes_scope on public.finance_causes;
create trigger trg_finance_causes_scope before insert or update of budget_id on public.finance_causes
for each row execute function public.finance_mirror_budget_scope();
drop trigger if exists trg_finance_entries_scope on public.finance_entries;
create trigger trg_finance_entries_scope before insert or update of budget_id on public.finance_entries
for each row execute function public.finance_mirror_budget_scope();

-- causes: unique per budget + name (replaces the per-scope index)
drop index if exists public.uq_finance_causes_scope_name;
create unique index if not exists uq_finance_causes_budget_name on public.finance_causes(budget_id, lower(trim(name)));
create index if not exists idx_finance_causes_budget  on public.finance_causes(budget_id, kind, sort_order);
create index if not exists idx_finance_entries_budget on public.finance_entries(budget_id, entry_date desc, created_at desc);

-- the entry's static cause must belong to the SAME budget + fit the kind
create or replace function public.finance_check_entry_cause()
returns trigger language plpgsql set search_path = public as $$
declare c public.finance_causes;
begin
  if new.cause_id is null then
    new.cause_text := nullif(trim(coalesce(new.cause_text, '')), '');
    return new;
  end if;
  select * into c from public.finance_causes where id = new.cause_id;
  if not found then raise exception 'cause_not_found' using errcode = '23503'; end if;
  if c.budget_id <> new.budget_id then
    raise exception 'cause_out_of_scope' using errcode = '23514';
  end if;
  if c.kind <> 'both' and c.kind <> new.kind then
    raise exception 'cause_kind_mismatch' using errcode = '23514';
  end if;
  new.cause_text := c.name;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3. Permission helpers
-- ---------------------------------------------------------------------
-- may the caller CREATE budgets? owner / church manager / service manager
-- by role, class servants with the key
create or replace function public.finance_can_create()
returns boolean language sql stable security definer set search_path = public as $$
  select public.module_visible('finance')
     and (
       (select role from public.my_scope()) in ('owner', 'church_manager', 'service_manager')
       or public.has_permission('finance.create')
     )
$$;
grant execute on function public.finance_can_create() to authenticated;

-- the caller's role in a budget: 'manager' | 'editor' | 'viewer' | null
create or replace function public.finance_budget_role(p_budget uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when not public.module_visible('finance') then null
    when (select public.is_owner()) then 'manager'
    else (select m.role from public.finance_budget_members m where m.budget_id = p_budget and m.servant_id = auth.uid())
  end
$$;
grant execute on function public.finance_budget_role(uuid) to authenticated;

create or replace function public.finance_budget_can(p_budget uuid, p_min text)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.finance_budget_role(p_budget)
    when 'manager' then true
    when 'editor'  then p_min in ('editor', 'viewer')
    when 'viewer'  then p_min = 'viewer'
    else false
  end
$$;
grant execute on function public.finance_budget_can(uuid, text) to authenticated;

-- module-level answer for the UI
create or replace function public.finance_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'view',   public.module_visible('finance'),
    'create', public.finance_can_create(),
    -- kept for compatibility with v1 clients
    'add',    public.finance_can_create(),
    'manage', public.finance_can_create()
  )
$$;

-- ---------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------
alter table public.finance_budgets        enable row level security;
alter table public.finance_budget_members enable row level security;

drop policy if exists finance_budgets_select on public.finance_budgets;
create policy finance_budgets_select on public.finance_budgets for select using (
  public.finance_budget_role(id) is not null
);
drop policy if exists finance_budgets_insert on public.finance_budgets;
create policy finance_budgets_insert on public.finance_budgets for insert with check (
  (select public.finance_can_create())
  and (church_id is null and (select public.is_owner())
       or church_id is not null and public.can_access(church_id, service_id, class_id))
);
drop policy if exists finance_budgets_update on public.finance_budgets;
create policy finance_budgets_update on public.finance_budgets for update using (
  public.finance_budget_can(id, 'manager')
) with check (
  public.finance_budget_can(id, 'manager')
);
drop policy if exists finance_budgets_delete on public.finance_budgets;
create policy finance_budgets_delete on public.finance_budgets for delete using (
  public.finance_budget_can(id, 'manager')
);

drop policy if exists finance_budget_members_select on public.finance_budget_members;
create policy finance_budget_members_select on public.finance_budget_members for select using (
  public.finance_budget_can(budget_id, 'viewer')
);
drop policy if exists finance_budget_members_insert on public.finance_budget_members;
create policy finance_budget_members_insert on public.finance_budget_members for insert with check (
  public.finance_budget_can(budget_id, 'manager')
);
drop policy if exists finance_budget_members_update on public.finance_budget_members;
create policy finance_budget_members_update on public.finance_budget_members for update using (
  public.finance_budget_can(budget_id, 'manager')
) with check (
  public.finance_budget_can(budget_id, 'manager')
);
drop policy if exists finance_budget_members_delete on public.finance_budget_members;
create policy finance_budget_members_delete on public.finance_budget_members for delete using (
  public.finance_budget_can(budget_id, 'manager')
);

-- causes: viewer reads · manager writes
drop policy if exists finance_causes_select on public.finance_causes;
create policy finance_causes_select on public.finance_causes for select using (public.finance_budget_can(budget_id, 'viewer'));
drop policy if exists finance_causes_insert on public.finance_causes;
create policy finance_causes_insert on public.finance_causes for insert with check (public.finance_budget_can(budget_id, 'manager'));
drop policy if exists finance_causes_update on public.finance_causes;
create policy finance_causes_update on public.finance_causes for update using (public.finance_budget_can(budget_id, 'manager')) with check (public.finance_budget_can(budget_id, 'manager'));
drop policy if exists finance_causes_delete on public.finance_causes;
create policy finance_causes_delete on public.finance_causes for delete using (public.finance_budget_can(budget_id, 'manager'));

-- entries: viewer reads · editor adds · manager edits / deletes
drop policy if exists finance_entries_select on public.finance_entries;
create policy finance_entries_select on public.finance_entries for select using (public.finance_budget_can(budget_id, 'viewer'));
drop policy if exists finance_entries_insert on public.finance_entries;
create policy finance_entries_insert on public.finance_entries for insert with check (public.finance_budget_can(budget_id, 'editor'));
drop policy if exists finance_entries_update on public.finance_entries;
create policy finance_entries_update on public.finance_entries for update using (public.finance_budget_can(budget_id, 'manager')) with check (public.finance_budget_can(budget_id, 'manager'));
drop policy if exists finance_entries_delete on public.finance_entries;
create policy finance_entries_delete on public.finance_entries for delete using (public.finance_budget_can(budget_id, 'manager'));

-- ---------------------------------------------------------------------
-- 5. RPCs
-- ---------------------------------------------------------------------
-- my budgets with role + balance (the list page)
create or replace function public.finance_my_budgets()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'name', b.name, 'description', b.description,
    'church_id', b.church_id, 'service_id', b.service_id, 'class_id', b.class_id,
    'is_active', b.is_active, 'created_at', b.created_at, 'created_by', b.created_by,
    'role', public.finance_budget_role(b.id),
    'members', (select count(*) from public.finance_budget_members m where m.budget_id = b.id),
    'income',  coalesce((select sum(e.amount) from public.finance_entries e where e.budget_id = b.id and e.kind = 'income'), 0),
    'expense', coalesce((select sum(e.amount) from public.finance_entries e where e.budget_id = b.id and e.kind = 'expense'), 0),
    'last_entry', (select max(e.entry_date) from public.finance_entries e where e.budget_id = b.id)
  ) order by b.is_active desc, b.created_at desc), '[]'::jsonb)
  from public.finance_budgets b
  where public.finance_budget_role(b.id) is not null
$$;
revoke all on function public.finance_my_budgets() from public, anon;
grant execute on function public.finance_my_budgets() to authenticated;

-- members with names (the members panel)
create or replace function public.finance_budget_members_list(p_budget uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.finance_budget_can(p_budget, 'viewer') then coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'budget_id', m.budget_id, 'servant_id', m.servant_id, 'role', m.role, 'created_at', m.created_at,
    'full_name', s.full_name, 'user_id', s.user_id, 'photo_url', s.photo_url, 'servant_role', s.role,
    'church_id', s.church_id, 'service_id', s.service_id, 'class_id', s.class_id
  ) order by case m.role when 'manager' then 0 when 'editor' then 1 else 2 end, s.full_name collate "C"), '[]'::jsonb) else '[]'::jsonb end
  from public.finance_budget_members m
  join public.servant_enrollments s on s.id = m.servant_id
  where m.budget_id = p_budget
$$;
revoke all on function public.finance_budget_members_list(uuid) from public, anon;
grant execute on function public.finance_budget_members_list(uuid) to authenticated;

-- servants a manager may add: every approved servant he can reach (or all, for the owner)
create or replace function public.finance_budget_candidates(p_budget uuid, p_q text default '')
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.finance_budget_can(p_budget, 'manager') then coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'full_name', s.full_name, 'user_id', s.user_id, 'photo_url', s.photo_url, 'role', s.role,
      'church_id', s.church_id, 'service_id', s.service_id, 'class_id', s.class_id
    ) order by s.full_name collate "C")
    from (
      select s.* from public.servant_enrollments s
       where s.status = 'approved'
         and s.id <> auth.uid()
         and ((select public.is_owner()) or public.servant_in_my_scope(s.id))
         and not exists (select 1 from public.finance_budget_members m where m.budget_id = p_budget and m.servant_id = s.id)
         and (coalesce(trim(p_q), '') = '' or s.full_name ilike '%' || trim(p_q) || '%' or s.user_id ilike '%' || trim(p_q) || '%')
       limit 80
    ) s), '[]'::jsonb) else '[]'::jsonb end
$$;
revoke all on function public.finance_budget_candidates(uuid, text) from public, anon;
grant execute on function public.finance_budget_candidates(uuid, text) to authenticated;

-- summary — now per BUDGET (same payload as v1)
drop function if exists public.finance_summary(uuid, uuid, uuid, date, date, text);
create or replace function public.finance_summary(
  p_budget  uuid,
  p_from    date default null,
  p_to      date default null,
  p_bucket  text default 'month'
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_bucket text := case when p_bucket in ('day', 'week', 'month', 'year') then p_bucket else 'month' end;
  v_from   date := coalesce(p_from, (now() at time zone 'Africa/Cairo')::date - 29);
  v_to     date := coalesce(p_to,   (now() at time zone 'Africa/Cairo')::date);
  v_out    jsonb;
begin
  if not public.finance_budget_can(p_budget, 'viewer') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  with scoped as (
    select e.* from public.finance_entries e where e.budget_id = p_budget
  ),
  in_period as (select * from scoped where entry_date between v_from and v_to),
  balance as (
    select coalesce(sum(amount) filter (where kind = 'income'),  0) as income,
           coalesce(sum(amount) filter (where kind = 'expense'), 0) as expense
      from scoped
  ),
  period as (
    select coalesce(sum(amount) filter (where kind = 'income'),  0) as income,
           coalesce(sum(amount) filter (where kind = 'expense'), 0) as expense,
           count(*) as cnt
      from in_period
  ),
  series as (
    select date_trunc(v_bucket, entry_date)::date as k,
           coalesce(sum(amount) filter (where kind = 'income'),  0) as income,
           coalesce(sum(amount) filter (where kind = 'expense'), 0) as expense
      from in_period group by 1 order by 1
  ),
  by_cause as (
    select kind, cause_id, coalesce(cause_text, '—') as cause, sum(amount) as total, count(*) as cnt
      from in_period group by kind, cause_id, coalesce(cause_text, '—') order by sum(amount) desc
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'bucket', v_bucket,
    'balance', (select jsonb_build_object('income', income, 'expense', expense, 'net', income - expense) from balance),
    'period',  (select jsonb_build_object('income', income, 'expense', expense, 'net', income - expense, 'count', cnt) from period),
    'series',  coalesce((select jsonb_agg(jsonb_build_object('key', k, 'income', income, 'expense', expense) order by k) from series), '[]'::jsonb),
    'by_cause', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'cause_id', cause_id, 'cause', cause, 'total', total, 'count', cnt)) from by_cause), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.finance_summary(uuid, date, date, text) from public, anon;
grant execute on function public.finance_summary(uuid, date, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Realtime · activity log
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['finance_budgets', 'finance_budget_members'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when undefined_object then null;
end $$;

create or replace function public.activity_audited_tables()
returns text[] language sql immutable as $$
  select array[
    'persons', 'enrollments', 'servant_enrollments', 'servant_scopes', 'permissions', 'permission_profiles',
    'module_access', 'churches', 'services', 'classes', 'events', 'causes', 'call_feedbacks',
    'attendance_log', 'points_log', 'contact_log', 'card_print_requests', 'card_templates', 'card_print_profiles',
    'data_change_requests', 'child_join_requests', 'person_credentials', 'shepherd_groups',
    'store_items', 'store_orders', 'exams', 'exam_questions', 'exam_attempts',
    'birthday_greetings', 'birthday_settings', 'birthday_card_templates', 'chat_messages',
    'online_classes', 'online_class_participants', 'online_class_checks', 'online_class_questions', 'online_class_answers',
    'achievements', 'user_achievements', 'occasions', 'occasion_registrations',
    'occasion_checklist_items', 'occasion_checklist_marks', 'occasion_notifications',
    'notifications', 'notification_automations', 'app_settings',
    'result_exams', 'result_subjects', 'exam_results', 'grading_systems', 'grading_grades',
    'library_subjects', 'library_books', 'library_lectures', 'library_favorites',
    'backup_runs', 'backup_schedules', 'report_templates', 'families', 'family_members',
    'access_events', 'access_rule_groups', 'access_rules', 'access_allowed', 'access_log',
    'priests', 'priest_requests', 'priest_confessors', 'confessions', 'confession_appointments', 'priest_contacts',
    'areas', 'area_priests', 'streets', 'buildings', 'family_visits',
    'finance_causes', 'finance_entries', 'finance_budgets', 'finance_budget_members'
  ]
$$;
do $$ begin
  if to_regprocedure('public.activity_audit_attach(text)') is not null then
    perform public.activity_audit_attach('finance_budgets');
    perform public.activity_audit_attach('finance_budget_members');
  end if;
end $$;

commit;
