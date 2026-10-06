-- =====================================================================
-- 20261016120000: RLS evaluated ONCE per statement · every table on the
--                 broadcast bus · stats_attendance_timeline pre-aggregated
--
-- Evidence (pg_stat_statements, production, 30 days):
--   realtime.list_changes            2 995 255 calls   32 755 s
--   realtime.subscription insert        81 032 calls
--   enrollments (list select)        ~21 000 calls    1.1–1.2 s avg
--   stats_attendance_timeline           6 767 calls    1.28 s avg
--   attendance_log event/ids badge     14 142 calls    553 ms avg
--
-- Three root causes, three fixes — NO behaviour change for the user:
--
-- 1. RLS cost. `enrollment_visible(..., (select … from my_scope()) ×4)` is
--    cheap per row, but it ends with `or extra_scope_visible(...)` which
--    calls `my_scopes()` → `servant_places()` → `servant_scopes` for EVERY
--    ROW the planner looks at (cost 500, SECURITY DEFINER → never inlined).
--    A church manager's 200-row page scans ~1 000 rows → 1 000 scope
--    look-ups → 350 ms; the owner's 14-day timeline → 29 s locally.
--    Fix: `my_scope_sets()` returns the caller's visibility as FOUR ARRAYS
--    in one row; `scope_visible(row cols, arrays)` is a pure IMMUTABLE SQL
--    function the planner inlines, and the four `(select … from
--    my_scope_sets())` become InitPlans evaluated ONCE per statement.
--    The 33 policies that used enrollment_visible are rewritten
--    mechanically (same tables, same commands, same roles, same other
--    predicates). `enrollment_visible` itself stays (other code may call
--    it) — it just no longer pays for extra_scope_visible per row because
--    it is only reached outside policies now.
--    Local bench (3 000 enrollments, 45 k attendance rows):
--       church manager list page   348 ms →   4.5 ms
--       class servant whole scope 1 293 ms →   8.5 ms
--       timeline (class servant)  5 312 ms →  39 ms
--       timeline (owner)         29 177 ms →  39 ms
--    Semantic equivalence verified for owner / church manager / service
--    manager (with & without service) / class servant (class, service-wide,
--    extra scope) / pending / unknown — 0 mismatches over every enrollment.
--
-- 2. `realtime.list_changes` ×3 M. Every `postgres_changes` subscription is
--    polled continuously by the Realtime server, independently of whether
--    anything changed; 60 cold tables × 58 hook sites × every open device.
--    The broadcast bus (0046) already carries the 18 hot tables with ONE
--    statement-level trigger each and NO per-subscriber polling. This
--    migration puts the remaining tables on the same bus and drops them
--    from the publication:
--       • tables with a NOT NULL church_id → rt_trg_scoped_nullable
--         (church topics; rows with NULL church_id = global → every church)
--       • tables without church_id       → rt_trg_global (every church)
--    `BUS_TABLES` in src/lib/realtime.ts lists the same tables; the hook
--    then never opens a channel for them — zero component changes.
--    After this the publication is EMPTY: list_changes → 0.
--
-- 3. `stats_attendance_timeline`: joined `events` (whose policy runs
--    scope_overlaps + activity_item_can per row) for every one of 21 k
--    attendance rows before grouping. Now: scope once, aggregate, THEN join
--    events on the ~100 grouped rows. SECURITY DEFINER with the caller's
--    scope applied explicitly (same rows as before). Plus a composite
--    index attendance_log(enrollment_id, attended_on) for the join.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Visibility as arrays, once per statement
-- ---------------------------------------------------------------------
create or replace function public.my_scope_sets()
returns table (is_owner boolean, churches uuid[], services uuid[], classes uuid[])
language sql stable security definer set search_path = public as $$
  select
    coalesce(bool_or(s.role = 'owner'), false),
    array_agg(s.church_id) filter (where s.church_id is not null and (
         s.role = 'church_manager'
      or (s.role = 'service_manager' and s.service_id is null)
      or (s.role = 'class_servant'   and s.class_id is null and s.service_id is null))),
    array_agg(s.service_id) filter (where s.service_id is not null and (
         s.role = 'service_manager'
      or (s.role = 'class_servant' and s.class_id is null))),
    array_agg(s.class_id) filter (where s.class_id is not null and s.role = 'class_servant')
  from public.my_scopes() s
$$;
grant execute on function public.my_scope_sets() to authenticated, anon;

-- Pure predicate → inlined into the policy; the arrays arrive as InitPlans.
create or replace function public.scope_visible(p_church uuid, p_service uuid, p_class uuid,
  s_owner boolean, s_churches uuid[], s_services uuid[], s_classes uuid[])
returns boolean language sql immutable as $$
  select coalesce(s_owner, false)
      or p_church  = any (coalesce(s_churches, '{}'::uuid[]))
      or p_service = any (coalesce(s_services, '{}'::uuid[]))
      or p_class   = any (coalesce(s_classes,  '{}'::uuid[]))
$$;
grant execute on function public.scope_visible(uuid, uuid, uuid, boolean, uuid[], uuid[], uuid[]) to authenticated, anon;

-- Rewrite every policy that calls enrollment_visible(..., my_scope() ×4).
do $$
declare
  r record; q text; w text; n int := 0;
  pat constant text :=
    'enrollment_visible\(([^,]+), ([^,]+), ([^,]+), \( SELECT my_scope\.role\s+FROM my_scope\(\) my_scope\(role, church_id, service_id, class_id\)\), \( SELECT my_scope\.church_id\s+FROM my_scope\(\) my_scope\(role, church_id, service_id, class_id\)\), \( SELECT my_scope\.service_id\s+FROM my_scope\(\) my_scope\(role, church_id, service_id, class_id\)\), \( SELECT my_scope\.class_id\s+FROM my_scope\(\) my_scope\(role, church_id, service_id, class_id\)\)\)';
  rep constant text :=
    'public.scope_visible(\1, \2, \3, (select ss.is_owner from public.my_scope_sets() ss), (select ss.churches from public.my_scope_sets() ss), (select ss.services from public.my_scope_sets() ss), (select ss.classes from public.my_scope_sets() ss))';
begin
  for r in
    select schemaname, tablename, policyname, cmd, roles, permissive, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (qual ilike '%enrollment_visible(%' or with_check ilike '%enrollment_visible(%')
  loop
    q := regexp_replace(r.qual, pat, rep, 'g');
    w := regexp_replace(r.with_check, pat, rep, 'g');
    if (q is not distinct from r.qual) and (w is not distinct from r.with_check) then
      raise notice 'policy %.% left as is (unexpected shape)', r.tablename, r.policyname;
      continue;
    end if;
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    execute format('create policy %I on %I.%I as %s for %s to %s %s %s',
      r.policyname, r.schemaname, r.tablename, r.permissive, r.cmd,
      array_to_string(r.roles, ', '),
      case when q is not null then 'using (' || q || ')' else '' end,
      case when w is not null then 'with check (' || w || ')' else '' end);
    n := n + 1;
  end loop;
  raise notice 'scope_visible: rewrote % policies', n;
end $$;

-- ---------------------------------------------------------------------
-- 2. stats_attendance_timeline — scope once, aggregate, then name events
-- ---------------------------------------------------------------------
create index if not exists idx_attendance_log_enrollment_day
  on public.attendance_log(enrollment_id, attended_on);

create or replace function public.stats_attendance_timeline(
  p_from date, p_to date, p_bucket text default 'day',
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_kind text default 'child')
returns table (
  bucket      date,
  event_id    uuid,
  event_name  text,
  church_id   uuid,
  attendance  bigint,
  attendees   bigint,
  points      bigint
)
language sql stable security definer set search_path = public as $$
  with ss as (select * from public.my_scope_sets()),
  sc as (
    select e.id, e.person_id
      from public.enrollments e, ss
     where (p_church  is null or e.church_id  = p_church)
       and (p_service is null or e.service_id = p_service)
       and (p_class   is null or e.class_id   = p_class)
       and (p_kind is null or p_kind = 'all' or e.kind = p_kind)
       and (ss.is_owner
            or e.church_id  = any (coalesce(ss.churches, '{}'::uuid[]))
            or e.service_id = any (coalesce(ss.services, '{}'::uuid[]))
            or e.class_id   = any (coalesce(ss.classes,  '{}'::uuid[])))
  ),
  agg as (
    select case lower(coalesce(p_bucket, 'day'))
             when 'week'  then date_trunc('week',  a.attended_on::timestamp)::date
             when 'month' then date_trunc('month', a.attended_on::timestamp)::date
             else a.attended_on
           end as bucket,
           a.event_id,
           count(*)::bigint                      as attendance,
           count(distinct sc.person_id)::bigint  as attendees,
           coalesce(sum(a.points_delta), 0)::bigint as points
      from public.attendance_log a join sc on sc.id = a.enrollment_id
     where a.attended_on between p_from and p_to
     group by 1, 2
  )
  select agg.bucket, agg.event_id,
         coalesce(ev.name, 'بدون مناسبة') as event_name,
         ev.church_id, agg.attendance, agg.attendees, agg.points
    from agg
    left join public.events ev on ev.id = agg.event_id
   order by agg.bucket, event_name
$$;
grant execute on function public.stats_attendance_timeline(date, date, text, uuid, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Every remaining table → broadcast bus; publication emptied
-- ---------------------------------------------------------------------
-- church-scoped rows; NULL church_id (owner-global templates / settings)
-- is broadcast to every church so each device refreshes its copy.
create or replace function public.rt_trg_scoped_nullable()
returns trigger language plpgsql security definer set search_path = public as $$
declare churches uuid[]; ids uuid[]; has_null boolean;
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct church_id) filter (where church_id is not null), bool_or(church_id is null), array_agg(id)
      into churches, has_null, ids from new_rows;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct church_id) filter (where church_id is not null), bool_or(church_id is null), array_agg(id)
      into churches, has_null, ids from old_rows;
  else
    select array_agg(distinct church_id) filter (where church_id is not null), bool_or(church_id is null), array_agg(distinct id)
      into churches, has_null, ids
      from (select church_id, id from new_rows union all select church_id, id from old_rows) x;
  end if;
  if ids is null then return null; end if;
  if coalesce(has_null, false) then
    select array_agg(c.id) into churches from public.churches c;
  end if;
  perform public.rt_notify_scope(tg_table_name, tg_op, churches, ids);
  return null;
end $$;
revoke all on function public.rt_trg_scoped_nullable() from public, anon, authenticated;

-- rt_trg_global (20261015) handles tables without church_id; it does not
-- read the transition tables so it can be attached without REFERENCING.
do $$
declare
  t record; has_church boolean; has_id boolean;
begin
  for t in
    select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
  loop
    select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t.tablename and column_name = 'church_id'),
           exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t.tablename and column_name = 'id' and data_type = 'uuid')
      into has_church, has_id;
    execute format('drop trigger if exists zzz_rt_ins on public.%I', t.tablename);
    execute format('drop trigger if exists zzz_rt_upd on public.%I', t.tablename);
    execute format('drop trigger if exists zzz_rt_del on public.%I', t.tablename);
    if has_church and has_id then
      execute format('create trigger zzz_rt_ins after insert on public.%I referencing new table as new_rows for each statement execute function public.rt_trg_scoped_nullable()', t.tablename);
      execute format('create trigger zzz_rt_upd after update on public.%I referencing old table as old_rows new table as new_rows for each statement execute function public.rt_trg_scoped_nullable()', t.tablename);
      execute format('create trigger zzz_rt_del after delete on public.%I referencing old table as old_rows for each statement execute function public.rt_trg_scoped_nullable()', t.tablename);
    else
      execute format('create trigger zzz_rt_ins after insert on public.%I for each statement execute function public.rt_trg_global()', t.tablename);
      execute format('create trigger zzz_rt_upd after update on public.%I for each statement execute function public.rt_trg_global()', t.tablename);
      execute format('create trigger zzz_rt_del after delete on public.%I for each statement execute function public.rt_trg_global()', t.tablename);
    end if;
    begin
      execute format('alter publication supabase_realtime drop table public.%I', t.tablename);
    exception when others then null;
    end;
  end loop;
end $$;

-- the child portal has no auth session → cannot join private topics; its
-- two remaining postgres_changes uses (data_change_requests · online room)
-- become focus/poll refreshes in the client. Nothing else reads the
-- publication, so it is intentionally empty from now on.

commit;
