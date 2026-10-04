-- =====================================================================
-- 20261010120000: REDUCE SUPABASE «LOGS INGEST» — خفض سجلات المنصة
--
-- PROBLEM. The Supabase usage page showed a very high «Logs Ingest» (and a
-- high «Logs Query») figure. Logs Ingest is the volume of PLATFORM logs
-- (Postgres server log · PostgREST API gateway · Auth · Realtime · Storage)
-- that Supabase collects — it is NOT our own سجل النشاط (`activity_log`),
-- which is an ordinary table and costs nothing on that meter. So the fix is
-- to make the database and the app emit fewer platform log lines, without
-- touching what the activity module records or shows.
--
-- WHAT WRITES TO THE POSTGRES SERVER LOG IN THIS SCHEMA
--   1. `raise notice / warning` inside functions that run on EVERY hot
--      operation. Each RAISE is one server-log line regardless of
--      `log_statement` — Supabase documents this as a classic source of
--      «large, otherwise-unexplained» ingest. The culprits here were the
--      `exception when others then raise notice …` safety nets inside the
--      per-row triggers on attendance_log · points_log · user_achievements
--      (notif_on_* / achievements_on_attendance) and inside rt_send(), the
--      broadcast helper called 2–3× per statement on every hot table. When
--      the notifications module is not granted, or realtime is briefly
--      unavailable, these fire on EVERY scan — thousands of lines a day.
--      → the safety nets stay (an error must never block the attendance)
--        but they no longer RAISE. The failure is still visible: the
--        notification simply does not appear, and the activity log keeps
--        the real operation.
--   2. pg_cron `notif_tick` every minute = 1 440 cron runs a day, each one
--      logged by `cron.log_statement` and `cron.log_run` (+ its own
--      statements). The job only releases scheduled sends / reminders whose
--      time has come; a 5-minute granularity is more than enough (the
--      header bells also kick the dispatcher every ~5–7 min).
--      → `*/5 * * * *` (cron.log_run / cron.log_statement are server-level
--        settings → the CLI script below turns them off).
--   3. Postgres GUCs that can be changed with plain SQL at the database
--      level (`alter database … set …`): `log_min_messages`,
--      `log_min_error_statement`, `log_statement`, `log_lock_waits`,
--      `log_temp_files`, `log_min_duration_statement`. We raise them to
--      quiet-but-useful values: ERRORs are still logged (with the failing
--      statement), DDL is still logged, slow queries ≥ 5 s are still logged.
--      Superuser-only / `postmaster` settings (log_connections …) cannot be
--      set from SQL — see supabase/scripts/supabase_log_settings.sh and
--      README → «Supabase log ingest».
--
-- The app side (same PR) reduces the API-gateway log volume: fewer polling
-- requests from the child / priest portals and the realtime fallback, a
-- longer lookup cache, fewer dispatcher kicks.
--
-- Idempotent — safe to re-run. Nothing here changes behaviour visible to
-- users except that scheduled notifications may leave up to 5 minutes later
-- than their `scheduled_at` (was: up to 1 minute).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Silent safety nets — same bodies as 0046 / 0034 / 0031, minus RAISE
-- ---------------------------------------------------------------------

-- 0046 §1: broadcast helper. Called by rt_notify_scope / rt_notify_users on
-- every statement of every hot table (2–3 calls per scan). A realtime
-- hiccup used to produce one NOTICE per call.
create or replace function public.rt_send(p_topic text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  begin
    perform realtime.send(p_payload, 'change', p_topic, true);
  exception
    when others then
      null; -- realtime not installed / temporarily unavailable → nothing to do, nothing to log
  end;
end $$;
revoke all on function public.rt_send(text, jsonb) from public, anon, authenticated;

-- 0034: attendance → child notification (per row on attendance_log)
create or replace function public.notif_on_attendance()
returns trigger language plpgsql security definer set search_path = public as $$
declare ev text;
begin
  begin
    select name into ev from public.events where id = new.event_id;
    perform public.notif_fire_enrollment('attendance', new.enrollment_id,
      jsonb_build_object('المناسبة', coalesce(ev, 'الحضور'), 'النقاط', new.points_delta, '_delta', new.points_delta),
      '/child/attendance', 'att:' || coalesce(new.event_id::text, '-') || ':' || (now() at time zone 'Africa/Cairo')::date);
  exception when others then
    null; -- best effort: a notification failure must never block (or log) the attendance
  end;
  return new;
end $$;

-- 0034: points added / deducted (per row on points_log)
create or replace function public.notif_on_points()
returns trigger language plpgsql security definer set search_path = public as $$
declare cause text; ev text;
begin
  if new.delta = 0 then return new; end if;
  begin
    select name into cause from public.causes where id = new.cause_id;
    select name into ev from public.events where id = new.event_id;
    perform public.notif_fire_enrollment(
      case when new.delta > 0 then 'points_added' else 'points_deducted' end, new.enrollment_id,
      jsonb_build_object('النقاط', abs(new.delta), 'السبب', coalesce(cause, ''), 'المناسبة', coalesce(ev, ''), '_delta', new.delta),
      '/child/points', null);
  exception when others then
    null;
  end;
  return new;
end $$;

-- 0034: achievement earned (per row on user_achievements)
create or replace function public.notif_on_achievement()
returns trigger language plpgsql security definer set search_path = public as $$
declare a_name text;
begin
  begin
    select name into a_name from public.achievements where id = new.achievement_id;
    perform public.notif_fire_enrollment('achievement_earned', new.enrollment_id,
      jsonb_build_object('الإنجاز', coalesce(a_name, ''), 'النقاط', new.points_awarded, '_delta', new.points_awarded),
      '/child/achievements', null);
  exception when others then
    null;
  end;
  return new;
end $$;

-- 0034: online class went live
create or replace function public.notif_on_online_live()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'live' and (tg_op = 'INSERT' or old.status is distinct from 'live') then
    begin
      perform public.notif_fire_scope('online_class_started', new.church_id, new.service_id, new.class_id,
        jsonb_build_object('العنوان', new.title, 'المنصة', new.platform,
                           'الوقت', to_char(new.starts_at at time zone 'Africa/Cairo', 'HH24:MI')),
        '/child/online/' || new.id, 'online:' || new.id || ':' || coalesce(new.started_at, now())::date);
    exception when others then
      null;
    end;
  end if;
  return new;
end $$;

-- 0034: exam published
create or replace function public.notif_on_exam_published()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and (new.opens_at is null or new.opens_at <= now()) then
    begin
      perform public.notif_fire_scope('exam_published', new.church_id, new.service_id, new.class_id,
        jsonb_build_object('العنوان', new.title,
                           'آخر موعد', coalesce(to_char(new.closes_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI'), '')),
        '/child/exams/' || new.id, 'exam:' || new.id);
    exception when others then
      null;
    end;
  end if;
  return new;
end $$;

-- 0031 §11: automatic achievements after every attendance_log insert.
-- `raise warning` is logged even at the default log_min_messages=warning.
create or replace function public.achievements_on_attendance()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  e public.enrollments;
  a record;
begin
  begin
    select * into e from public.enrollments where id = new.enrollment_id;
    if not found then return new; end if;
    if not public.module_granted_for('achievements', e.church_id, e.service_id, e.class_id) then
      return new;
    end if;
    for a in
      select x.id, x.event_id from public.achievements x
       where x.is_active and x.kind = 'attendance'
         and x.church_id = e.church_id
         and (x.service_id is null or x.service_id = e.service_id)
         and (x.class_id   is null or x.class_id   = e.class_id)
         and (x.event_id   is null or x.event_id   = new.event_id)
       order by x.sort_order, x.name
    loop
      perform public.achievement_grant(a.id, e.id, new.recorded_by, 'attendance',
                                       new.id, new.event_id, null, false);
    end loop;
  exception when others then
    null; -- best effort — never block the attendance, never spam the server log
  end;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. pg_cron: notif_tick every 5 minutes instead of every minute
--    (1 440 → 288 logged runs a day). Skipped silently where pg_cron is
--    not installed (local Postgres).
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'notif_tick';
    perform cron.schedule('notif_tick', '*/5 * * * *', 'select public.notif_tick()');
  end if;
exception when others then
  null;
end $$;

-- ---------------------------------------------------------------------
-- 3. Postgres log settings that CAN be set from SQL (database level).
--    Each one is tried on its own — on a plain local Postgres or a role
--    without the privilege the statement is skipped, not failed.
--
--    log_min_messages           warning → error    (NOTICE / WARNING lines dropped)
--    log_min_error_statement    error              (keep: the failing statement IS useful)
--    log_statement              ddl                (keep Supabase default; `all`/`mod` would be huge)
--    log_min_duration_statement 5 s                (only genuinely slow statements)
--    log_lock_waits             off                (no lock-contention symptoms)
--    log_temp_files             -1                 (off)
--    (`log_connections`, `cron.log_run`, `cron.log_statement` are server-
--     level: CLI only — supabase/scripts/supabase_log_settings.sh)
-- ---------------------------------------------------------------------
do $$
declare
  stmt text;
  db   text := current_database();
begin
  foreach stmt in array array[
    format('alter database %I set log_min_messages = error', db),
    format('alter database %I set log_min_error_statement = error', db),
    format('alter database %I set log_statement = ddl', db),
    format('alter database %I set log_min_duration_statement = ''5s''', db),
    format('alter database %I set log_lock_waits = off', db),
    format('alter database %I set log_temp_files = -1', db)
  ] loop
    begin
      execute stmt;
    exception when others then
      null; -- not permitted here / unknown parameter → leave the platform default
    end;
  end loop;
end $$;

-- Per-role too: PostgREST connects as `authenticator` and switches to
-- anon / authenticated / service_role; role-level settings win over the
-- database-level ones, so make sure none of them re-enables chatter.
do $$
declare
  r text; stmt text;
begin
  foreach r in array array['authenticator', 'anon', 'authenticated', 'service_role', 'postgres'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach stmt in array array[
        format('alter role %I set log_min_messages = error', r),
        format('alter role %I set log_min_error_statement = error', r),
        format('alter role %I set log_statement = ddl', r),
        format('alter role %I set log_min_duration_statement = ''5s''', r),
        format('alter role %I set log_lock_waits = off', r),
        format('alter role %I set log_temp_files = -1', r)
      ] loop
        begin
          execute stmt;
        exception when others then
          null;
        end;
      end loop;
    end if;
  end loop;
end $$;

commit;
