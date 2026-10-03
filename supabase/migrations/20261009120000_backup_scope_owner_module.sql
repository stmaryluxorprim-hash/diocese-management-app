-- =====================================================================
-- 20261009120000: SCOPED BACKUPS — نسخة احتياطية لكنيسة / خدمة / فصل
--                 + the backup module moves into the OWNER module
--
-- The owner can now back up ONE church, ONE service or ONE class instead of
-- the whole database. A scope is a jsonb object:
--     {"church_id": uuid, "service_id": uuid | null, "class_id": uuid | null}
-- (null = everything, exactly as before).
--
-- Which rows belong to a scope is derived from the schema — nothing is
-- hard-coded, new tables are picked up automatically:
--   • churches / services / classes      → the selected branch of the tree
--     (the parents of the selected level are always included so the file
--     can be restored on its own).
--   • tables with scope columns          → church_id / service_id / class_id
--     (a column counts when it has no FK or an FK to churches / services /
--     classes — `online_class_answers.class_id → online_classes` does NOT).
--     A row is in the scope when every scope column it has is either NULL
--     (= church-wide / service-wide / global row, e.g. a default event, a
--     church-wide cause, the owner's servant row) or equal to the scope.
--   • persons                            → every person referenced (any FK
--     column) by a row of a scoped table that is in the scope: the children
--     enrolled there, the servants, the priests, the family members …
--   • every other table                  → follows its NOT NULL foreign keys
--     to the parent (attendance_log → enrollments, exam_answers →
--     exam_attempts → exams, buildings → streets → areas …), recursively,
--     with a cycle guard. A table with no scoped parent at all (app_settings,
--     permission_profiles, push_subscriptions …) is copied completely and
--     flagged `scoped = false` in the catalogue so the UI can say so.
--
-- New / changed functions (all owner-or-service-role, security definer):
--   backup_scope_check(scope)                 validates + fills the parents
--   backup_scope_describe(scope)              names + Arabic label
--   backup_scope_predicate(table, scope, alias) SQL predicate text (for tests)
--   backup_tables(scope default null)         catalogue with rows IN SCOPE
--                                             + `scoped` flag per table
--   backup_dump_table(t, offset, limit, scope default null)
--   backup_dump_auth_users(scope default null)
--   backup_restore_begin(...)                 refuses mode = replace when the
--                                             file is a scoped backup
--                                             (`scoped_replace`) — replace
--                                             would delete everything outside
--                                             the scope.
-- Tables: backup_runs.scope · backup_schedules.scope (jsonb, null = all).
-- Idempotent.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. scope columns on the history + schedules
-- ---------------------------------------------------------------------
alter table public.backup_schedules add column if not exists scope jsonb;
alter table public.backup_runs      add column if not exists scope jsonb;
comment on column public.backup_schedules.scope is 'نطاق النسخة: {church_id, service_id, class_id} — null = كل البيانات';
comment on column public.backup_runs.scope      is 'نطاق النسخة: {church_id, service_id, class_id} — null = كل البيانات';

-- ---------------------------------------------------------------------
-- 1. Scope validation + description
-- ---------------------------------------------------------------------
-- Returns the normalised scope (parents filled from the class / service) or
-- NULL when p_scope is null / empty. Raises `bad_scope` when an id is unknown
-- or the levels do not belong to each other.
create or replace function public.backup_scope_check(p_scope jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c uuid; s uuid; k uuid; r record;
begin
  if p_scope is null or jsonb_typeof(p_scope) <> 'object' then return null; end if;
  begin
    c := nullif(p_scope->>'church_id', '')::uuid;
    s := nullif(p_scope->>'service_id', '')::uuid;
    k := nullif(p_scope->>'class_id', '')::uuid;
  exception when others then
    raise exception 'bad_scope' using errcode = 'P0001';
  end;
  if c is null and s is null and k is null then return null; end if;

  if k is not null then
    select church_id, service_id into r from public.classes where id = k;
    if not found then raise exception 'bad_scope:class' using errcode = 'P0001'; end if;
    if s is not null and s <> r.service_id then raise exception 'bad_scope:class_service' using errcode = 'P0001'; end if;
    if c is not null and c <> r.church_id then raise exception 'bad_scope:class_church' using errcode = 'P0001'; end if;
    s := r.service_id; c := r.church_id;
  end if;
  if s is not null then
    select church_id into r from public.services where id = s;
    if not found then raise exception 'bad_scope:service' using errcode = 'P0001'; end if;
    if c is not null and c <> r.church_id then raise exception 'bad_scope:service_church' using errcode = 'P0001'; end if;
    c := r.church_id;
  end if;
  if not exists (select 1 from public.churches where id = c) then
    raise exception 'bad_scope:church' using errcode = 'P0001';
  end if;
  return jsonb_build_object('church_id', c, 'service_id', s, 'class_id', k);
end $$;
revoke all on function public.backup_scope_check(jsonb) from public;
grant execute on function public.backup_scope_check(jsonb) to authenticated, service_role;

-- {church_id, service_id, class_id, church_name, service_name, class_name,
--  level: 'church'|'service'|'class', label: 'كنيسة أ ← مدارس الأحد ← فصل ٣'}
create or replace function public.backup_scope_describe(p_scope jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  sc jsonb := public.backup_scope_check(p_scope);
  cn text; sn text; kn text; lvl text;
begin
  if sc is null then return null; end if;
  select name into cn from public.churches where id = (sc->>'church_id')::uuid;
  if sc->>'service_id' is not null then select name into sn from public.services where id = (sc->>'service_id')::uuid; end if;
  if sc->>'class_id' is not null then select name into kn from public.classes where id = (sc->>'class_id')::uuid; end if;
  lvl := case when kn is not null then 'class' when sn is not null then 'service' else 'church' end;
  return sc || jsonb_build_object(
    'church_name', cn, 'service_name', sn, 'class_name', kn, 'level', lvl,
    'label', concat_ws(' ← ', cn, sn, kn));
end $$;
revoke all on function public.backup_scope_describe(jsonb) from public;
grant execute on function public.backup_scope_describe(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Which columns of a table are scope columns?
--    {church: col|null, service: col|null, class: col|null}
--    A column named church_id / service_id / class_id with no FK, or with an
--    FK to churches / services / classes; otherwise any column with an FK to
--    that structure table (e.g. online_class_participants.room_class_id).
-- ---------------------------------------------------------------------
create or replace function public.backup_scope_columns(t text)
returns jsonb language plpgsql stable as $$
declare
  out jsonb := '{}'::jsonb;
  lvl record; col text;
begin
  for lvl in select * from (values ('church', 'church_id', 'churches'), ('service', 'service_id', 'services'), ('class', 'class_id', 'classes')) v(key, col, parent) loop
    select a.attname::text into col
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_constraint f on f.conrelid = c.oid and f.contype = 'f' and f.conkey = array[a.attnum]
      left join pg_class p on p.oid = f.confrelid
     where n.nspname = 'public' and c.relname = t and a.attnum > 0 and not a.attisdropped
       and (
         (a.attname = lvl.col and (f.oid is null or p.relname = lvl.parent))
         or (a.attname <> lvl.col and p.relname = lvl.parent)
       )
     order by (a.attname = lvl.col) desc, a.attnum
     limit 1;
    out := out || jsonb_build_object(lvl.key, col);
  end loop;
  return out;
end $$;

-- ---------------------------------------------------------------------
-- 3. The predicate — SQL text over alias `p_alias`, 'true' = unscoped table
-- ---------------------------------------------------------------------
create or replace function public.backup_scope_predicate(
  p_table text, p_scope jsonb, p_alias text default 't', p_visited text[] default '{}'
) returns text language plpgsql stable security definer set search_path = public as $$
declare
  sc jsonb; c text; s text; k text;
  cols jsonb; cc text; sc_col text; kc text;
  parts text[] := '{}';
  e record; sub text; depth int;
  alias2 text;
begin
  if not public.backup_allowed() then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  sc := public.backup_scope_check(p_scope);
  if sc is null then return 'true'; end if;
  if not public.backup_is_table(p_table) then raise exception 'unknown_table' using errcode = 'P0001'; end if;
  if p_table = any(p_visited) then return 'true'; end if;      -- cycle guard
  c := quote_literal(sc->>'church_id') || '::uuid';
  s := case when sc->>'service_id' is null then null else quote_literal(sc->>'service_id') || '::uuid' end;
  k := case when sc->>'class_id' is null then null else quote_literal(sc->>'class_id') || '::uuid' end;

  -- a) the structure itself — the selected branch (parents always included)
  if p_table = 'churches' then
    return format('%I.id = %s', p_alias, c);
  elsif p_table = 'services' then
    return format('%1$I.church_id = %2$s', p_alias, c)
      || case when s is null then '' else format(' and %1$I.id = %2$s', p_alias, s) end;
  elsif p_table = 'classes' then
    return format('%1$I.church_id = %2$s', p_alias, c)
      || case when s is null then '' else format(' and %1$I.service_id = %2$s', p_alias, s) end
      || case when k is null then '' else format(' and %1$I.id = %2$s', p_alias, k) end;
  end if;

  -- b) direct scope columns
  cols := public.backup_scope_columns(p_table);
  cc := cols->>'church'; sc_col := cols->>'service'; kc := cols->>'class';
  if cc is not null or sc_col is not null or kc is not null then
    -- church level
    if cc is not null then
      parts := parts || format('(%1$I.%2$I is null or %1$I.%2$I = %3$s)', p_alias, cc, c);
    elsif sc_col is not null then
      parts := parts || format('(%1$I.%2$I is null or %1$I.%2$I in (select id from public.services where church_id = %3$s))', p_alias, sc_col, c);
    else
      parts := parts || format('(%1$I.%2$I is null or %1$I.%2$I in (select id from public.classes where church_id = %3$s))', p_alias, kc, c);
    end if;
    -- service level
    if s is not null then
      if sc_col is not null then
        parts := parts || format('(%1$I.%2$I is null or %1$I.%2$I = %3$s)', p_alias, sc_col, s);
      elsif kc is not null then
        parts := parts || format('(%1$I.%2$I is null or %1$I.%2$I in (select id from public.classes where service_id = %3$s))', p_alias, kc, s);
      end if;
    end if;
    -- class level
    if k is not null and kc is not null then
      parts := parts || format('(%1$I.%2$I is null or %1$I.%2$I = %3$s)', p_alias, kc, k);
    end if;
    return array_to_string(parts, ' and ');
  end if;

  -- c) persons — referenced by a scoped row of a directly-scoped table
  if p_table = 'persons' then
    for e in
      select c2.relname::text as child, a.attname::text as col
        from pg_constraint f
        join pg_class c2 on c2.oid = f.conrelid
        join pg_namespace n on n.oid = c2.relnamespace
        join pg_class p on p.oid = f.confrelid
        join pg_attribute a on a.attrelid = c2.oid and a.attnum = f.conkey[1]
       where f.contype = 'f' and n.nspname = 'public' and p.relname = 'persons'
         and array_length(f.conkey, 1) = 1 and c2.relname <> 'persons'
         and c2.relname not like 'backup\_restore\_%'
       order by 1, 2
    loop
      cols := public.backup_scope_columns(e.child);
      if cols->>'church' is null and cols->>'service' is null and cols->>'class' is null then continue; end if;
      alias2 := 'x' || (cardinality(parts) + 1)::text;
      sub := public.backup_scope_predicate(e.child, sc, alias2, p_visited || p_table);
      parts := parts || format('exists (select 1 from public.%1$I %2$I where %2$I.%3$I = %4$I.id and %5$s)', e.child, alias2, e.col, p_alias, sub);
    end loop;
    return case when cardinality(parts) = 0 then 'true' else '(' || array_to_string(parts, ' or ') || ')' end;
  end if;

  -- d) everything else — NOT NULL foreign keys to scoped parents (AND)
  depth := 0;
  for e in
    select p.relname::text as parent, a.attname::text as col, pa.attname::text as pcol
      from pg_constraint f
      join pg_class c2 on c2.oid = f.conrelid
      join pg_namespace n on n.oid = c2.relnamespace
      join pg_class p on p.oid = f.confrelid
      join pg_namespace pn on pn.oid = p.relnamespace
      join pg_attribute a  on a.attrelid  = c2.oid and a.attnum  = f.conkey[1]
      join pg_attribute pa on pa.attrelid = p.oid  and pa.attnum = f.confkey[1]
     where f.contype = 'f' and n.nspname = 'public' and pn.nspname = 'public'
       and c2.relname = p_table and array_length(f.conkey, 1) = 1
       and a.attnotnull and p.relname <> p_table
       and not (p.relname = any(p_visited))
     order by 1, 2
  loop
    depth := depth + 1;
    alias2 := 'y' || cardinality(p_visited)::text || '_' || depth::text;
    sub := public.backup_scope_predicate(e.parent, sc, alias2, p_visited || p_table);
    if sub = 'true' then continue; end if;
    parts := parts || format('exists (select 1 from public.%1$I %2$I where %2$I.%3$I = %4$I.%5$I and %6$s)', e.parent, alias2, e.pcol, p_alias, e.col, sub);
  end loop;
  return case when cardinality(parts) = 0 then 'true' else array_to_string(parts, ' and ') end;
end $$;
revoke all on function public.backup_scope_predicate(text, jsonb, text, text[]) from public;
grant execute on function public.backup_scope_predicate(text, jsonb, text, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Catalogue + dump — now scope-aware
-- ---------------------------------------------------------------------
drop function if exists public.backup_tables();
create or replace function public.backup_tables(p_scope jsonb default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  out jsonb := '[]'::jsonb;
  sc jsonb; r record; n bigint; pred text;
begin
  if not public.backup_allowed() then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  sc := public.backup_scope_check(p_scope);
  for r in
    select c.relname::text as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and c.relname not like 'backup\_restore\_%'
     order by c.relname
  loop
    pred := case when sc is null then 'true' else public.backup_scope_predicate(r.name, sc, 't') end;
    execute format('select count(*) from public.%I t where %s', r.name, pred) into n;
    out := out || jsonb_build_object(
      'name', r.name,
      'rows', n,
      'pk', to_jsonb(public.backup_pk_columns(r.name)),
      'columns', to_jsonb(public.backup_columns(r.name)),
      'parents', to_jsonb(public.backup_parents(r.name)),
      'scoped', (sc is not null and pred <> 'true')
    );
  end loop;
  return out;
end $$;
revoke all on function public.backup_tables(jsonb) from public;
grant execute on function public.backup_tables(jsonb) to authenticated, service_role;

drop function if exists public.backup_dump_table(text, integer, integer);
create or replace function public.backup_dump_table(
  p_table text, p_offset integer default 0, p_limit integer default 1000, p_scope jsonb default null
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  pk text[]; ord text; out jsonb; sc jsonb; pred text;
begin
  if not public.backup_allowed() then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  if not public.backup_is_table(p_table) then raise exception 'unknown_table' using errcode = 'P0001'; end if;
  sc := public.backup_scope_check(p_scope);
  pred := case when sc is null then 'true' else public.backup_scope_predicate(p_table, sc, 't') end;
  pk := public.backup_pk_columns(p_table);
  select string_agg(format('%I', c), ', ') into ord from unnest(pk) c;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from public.%I t where %s order by %s offset %s limit %s) t',
    p_table, pred, coalesce(ord, '1'), greatest(p_offset, 0), least(greatest(p_limit, 1), 2000)
  ) into out;
  return out;
end $$;
revoke all on function public.backup_dump_table(text, integer, integer, jsonb) from public;
grant execute on function public.backup_dump_table(text, integer, integer, jsonb) to authenticated, service_role;

drop function if exists public.backup_dump_auth_users();
create or replace function public.backup_dump_auth_users(p_scope jsonb default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb; sc jsonb; pred text;
begin
  if not public.backup_allowed() then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  sc := public.backup_scope_check(p_scope);
  pred := case when sc is null then 'true' else public.backup_scope_predicate('servant_enrollments', sc, 's') end;
  execute format($q$
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'id', u.id,
               'email', j->>'email',
               'phone', j->>'phone',
               'encrypted_password', j->>'encrypted_password',
               'email_confirmed_at', j->>'email_confirmed_at',
               'raw_user_meta_data', coalesce(j->'raw_user_meta_data', '{}'::jsonb),
               'raw_app_meta_data', coalesce(j->'raw_app_meta_data', '{}'::jsonb),
               'created_at', j->>'created_at'
             ) order by j->>'created_at'), '[]'::jsonb)
      from auth.users u
      cross join lateral to_jsonb(u) j
     where exists (select 1 from public.servant_enrollments s where s.id = u.id and %s)
  $q$, pred) into out;
  return out;
end $$;
revoke all on function public.backup_dump_auth_users(jsonb) from public;
grant execute on function public.backup_dump_auth_users(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Restore — a scoped file may only be MERGED
--    (replace deletes every row the file does not contain → it would wipe
--    the other churches / services / classes).
-- ---------------------------------------------------------------------
create or replace function public.backup_restore_begin(p_mode text, p_tables text[], p_meta jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare jid uuid; t text; bad text[] := '{}';
begin
  if not public.backup_allowed() then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  if p_mode not in ('merge', 'replace') then raise exception 'bad_mode' using errcode = 'P0001'; end if;
  if p_tables is null or cardinality(p_tables) = 0 then raise exception 'no_tables' using errcode = 'P0001'; end if;
  if p_mode = 'replace' and coalesce(p_meta->'file'->'scope', 'null'::jsonb) <> 'null'::jsonb then
    raise exception 'scoped_replace' using errcode = 'P0001';
  end if;
  foreach t in array p_tables loop
    if not public.backup_is_table(t) then bad := bad || t; end if;
  end loop;
  if cardinality(bad) > 0 then
    raise exception 'unknown_table:%', array_to_string(bad, ',') using errcode = 'P0001';
  end if;
  -- forget stale jobs of the same caller (abandoned uploads)
  delete from public.backup_restore_jobs
   where status = 'staging' and created_at < now() - interval '6 hours';
  insert into public.backup_restore_jobs (mode, tables, meta, created_by)
  values (p_mode, public.backup_topo_order(p_tables), coalesce(p_meta, '{}'::jsonb), auth.uid())
  returning id into jid;
  return jid;
end $$;
revoke all on function public.backup_restore_begin(text, text[], jsonb) from public;
grant execute on function public.backup_restore_begin(text, text[], jsonb) to authenticated, service_role;

commit;
