-- =====================================================================
-- DELETE DATABASE — حذف قاعدة البيانات بالكامل (جداول + بيانات + كل شيء)
-- =====================================================================
-- NOT a migration. This file lives OUTSIDE supabase/migrations on purpose:
-- the Supabase CLI / dashboard integration never sees or runs it. You run
-- it yourself, by hand, when you want the project's database to become
-- completely EMPTY — as if the app had never been installed.
--
-- What it removes
--   · every table, view, function, trigger, type, sequence and RLS policy
--     in the `public` schema (the whole app schema)
--   · every login account (auth.users, identities, sessions, refresh tokens)
--   · every uploaded file AND the buckets themselves (photos, church-logos,
--     backups) + the app's storage.objects policies
--   · the app's realtime policy on realtime.messages
--   · the pg_cron job `notif_tick`
--   · the migration history (supabase_migrations.schema_migrations) so the
--     CLI treats the project as brand new — `supabase db push` will re-apply
--     every migration from 0001 afterwards
--
-- What it keeps (Supabase system objects — must not be dropped)
--   the schemas auth / storage / realtime / extensions / graphql_public /
--   supabase_functions themselves, the extensions, and the roles.
--
-- ⚠️  IRREVERSIBLE. There is no undo. Take a backup first:
--     الإعدادات → النشاط → النسخ الاحتياطي والاسترجاع → «نسخة احتياطية» → الكل
--     (or Supabase → Database → Backups)
--
-- HOW TO RUN
--   Supabase → SQL Editor → paste the WHOLE file → Run.
--   Local:  psql -d postgres -v ON_ERROR_STOP=1 -f delete_database.sql
--
-- AFTER RUNNING
--   To install the app again: `supabase db push` (or run the migrations in
--   order in the SQL Editor), then create the owner
--   (supabase/migrations/0002_bootstrap_owner.sql).
-- =====================================================================
begin;
set local client_min_messages = warning;

-- ---------------------------------------------------------------------
-- 1. Drop EVERYTHING in the public schema in one shot.
--    Dropping the schema removes all tables (and their data), views,
--    functions, triggers, enums, sequences, indexes and RLS policies
--    without caring about dependency order. Then re-create it empty with
--    the grants Supabase expects, so the API roles still work.
-- ---------------------------------------------------------------------
drop schema if exists public cascade;
create schema public;
grant usage  on schema public to postgres, anon, authenticated, service_role;
grant all    on schema public to postgres, service_role;
grant create on schema public to postgres;
alter default privileges in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
comment on schema public is 'standard public schema';

-- ---------------------------------------------------------------------
-- 2. Remove every login account (auth is a Supabase system schema — we
--    empty its data, we do not drop it). CASCADE follows the FKs to
--    identities / sessions / refresh_tokens / mfa_* automatically.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('auth.users') is not null then
    execute 'truncate table auth.users cascade';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Storage: delete every file, then the buckets the app created,
--    then the app's policies on storage.objects.
--
--    Supabase guards storage.objects / storage.buckets with the trigger
--    `protect_delete` ("Direct deletion from storage tables is not
--    allowed. Use the Storage API instead.", SQLSTATE 42501). It is a
--    deliberate escape hatch for one-off ops: the trigger lets the DELETE
--    through when the session setting `storage.allow_delete_query` is
--    'true'. We set it LOCAL (this transaction only) so nothing else is
--    affected. Rows deleted this way are metadata only — the files stay in
--    the S3 backend until Supabase's orphan cleanup collects them (they are
--    unreachable and no longer count in the dashboard's object list).
-- ---------------------------------------------------------------------
set local storage.allow_delete_query = 'true';
do $$
declare p record;
begin
  if to_regclass('storage.objects') is not null then
    -- multipart uploads in flight reference buckets → clear them first
    if to_regclass('storage.s3_multipart_uploads_parts') is not null then
      execute 'delete from storage.s3_multipart_uploads_parts';
    end if;
    if to_regclass('storage.s3_multipart_uploads') is not null then
      execute 'delete from storage.s3_multipart_uploads';
    end if;
    delete from storage.objects;
    delete from storage.buckets;
    for p in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' loop
      execute format('drop policy if exists %I on storage.objects', p.policyname);
    end loop;
  end if;
end $$;
set local storage.allow_delete_query = 'false';

-- ---------------------------------------------------------------------
-- 4. Realtime: the app's topic policy + any leftover messages.
-- ---------------------------------------------------------------------
do $$
declare p record;
begin
  if to_regclass('realtime.messages') is not null then
    for p in select policyname from pg_policies where schemaname = 'realtime' and tablename = 'messages' loop
      execute format('drop policy if exists %I on realtime.messages', p.policyname);
    end loop;
    begin
      execute 'truncate table realtime.messages';
    exception when others then null;   -- partitioned / permission — ignore
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. pg_cron jobs scheduled by the app (only if the extension exists).
-- ---------------------------------------------------------------------
do $$
declare j record;
begin
  if to_regclass('cron.job') is not null then
    for j in select jobid from cron.job loop
      perform cron.unschedule(j.jobid);
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. Forget the migration history → the CLI sees a fresh project and
--    `supabase db push` re-applies everything from 0001.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'truncate table supabase_migrations.schema_migrations';
  end if;
  if to_regclass('supabase_migrations.seed_files') is not null then
    execute 'truncate table supabase_migrations.seed_files';
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------
-- 7. Report — everything should read 0.
-- ---------------------------------------------------------------------
select 'public tables'    as what, count(*) from pg_tables    where schemaname = 'public'
union all
select 'public views',              count(*) from pg_views     where schemaname = 'public'
union all
select 'public functions',          count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
union all
select 'public types',              count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typtype = 'e'
union all
select 'auth users',                count(*) from auth.users
union all
select 'storage buckets',           count(*) from storage.buckets
union all
select 'storage objects',           count(*) from storage.objects
union all
select 'migration history rows',    coalesce((select count(*) from supabase_migrations.schema_migrations), 0);
