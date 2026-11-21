-- =====================================================================
-- 20261023120000 - Table privileges baseline + RLS safety net
--
-- WHY
--   Every earlier migration assumes Supabase hands out table privileges to
--   anon / authenticated / service_role automatically (the old default).
--   New Supabase projects no longer do that, so on a brand-new project the
--   API role could not read ANY table (permission denied 42501) - e.g. the
--   login read of servant_enrollments failed and a valid, approved servant
--   was shown as "not approved".
--
-- WHAT
--   1. RLS is ON for every table in public (idempotent safety net - RLS, not
--      grants, is what protects rows).
--   2. Restores the classic baseline: schema usage, table + sequence
--      privileges for the three API roles, and default privileges so tables
--      created by later migrations behave the same way.
--   3. RE-APPLIES, in their original order, every table-level GRANT / REVOKE
--      that the earlier migrations issue - so the sensitive tables stay
--      closed (person_credentials, child_sessions, login_throttle ...).
--      Without this step the blanket grant in (2) would re-open them.
--
-- SAFE ON EXISTING DATABASES
--   Idempotent. On a database that already works (production) it ends in the
--   exact same privilege state it had before. Verified on a fresh project:
--   anon / service_role access matches production for all 109 relations.
-- =====================================================================

-- 1) RLS everywhere (no-op where already enabled)
do $$
declare r record;
begin
  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end $$;

-- 2) Baseline privileges (what Supabase used to grant implicitly)
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to anon, authenticated, service_role;

-- 3) Re-apply the table-level grants / revokes of the earlier migrations
--    (closes the sensitive tables again; column-level grants included)
revoke all on public.notifications, public.notification_recipients, public.notification_automations, public.notification_automation_runs, public.push_subscriptions from anon;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;
revoke all on public.person_credentials from anon, authenticated;
revoke all on public.child_sessions from anon, authenticated;
revoke all on public.child_join_requests from anon;
revoke all on public.child_join_requests from authenticated;
grant select (id, code, name, gender, birthdate, phone, address, notes, image_url, church_id, service_id, class_id, status, decision_note, decided_by, decided_at, person_id, enrollment_id, created_at), delete on public.child_join_requests to authenticated;
grant select, insert, update, delete on public.backup_schedules, public.backup_runs to authenticated, service_role;
grant select on public.backup_restore_jobs to authenticated, service_role;
grant select on public.servant_scopes to authenticated;
grant all on public.servant_scopes to service_role;
revoke all on public.rt_gates from public, anon, authenticated;
revoke insert, update, delete on public.activity_log from anon, authenticated;
grant select on public.activity_log to authenticated;
revoke all on public.priest_sessions from anon, authenticated;
revoke all on public.priest_confessors from anon, authenticated;
revoke all on public.confessions from anon, authenticated;
revoke all on public.confession_appointments from anon, authenticated;
revoke all on public.priest_contacts from anon, authenticated;
revoke all on public.priests from anon, authenticated;
grant select (id, person_id, church_id, title, status, reminder_days, notes, approved_by, approved_at, created_at, updated_at) on public.priests to authenticated;
revoke all on public.priest_requests from anon, authenticated;
grant select (id, code, name, title, gender, birthdate, phone, address, notes, image_url, church_id, status, decision_note, decided_by, decided_at, priest_id, created_at), delete on public.priest_requests to authenticated;
revoke all on public.areas from anon, authenticated;
revoke all on public.area_priests from anon, authenticated;
revoke all on public.streets from anon, authenticated;
revoke all on public.buildings from anon, authenticated;
revoke all on public.family_visits from anon, authenticated;
grant select on public.areas to authenticated;
grant select on public.streets to authenticated;
grant select on public.buildings to authenticated;
grant select on public.area_priests to authenticated;
revoke all on public.account_switch_tickets from anon, authenticated;
revoke all on public.servant_active_places from anon, authenticated;
grant select on public.servant_active_places to authenticated;
revoke all on public.login_grants from anon, authenticated;
revoke all on public.signup_invites from anon, authenticated;
grant select (id, kind, church_id, service_id, class_id, created_by, created_at, expires_at, max_uses, uses, revoked_at, note), update (revoked_at) on public.signup_invites to authenticated;
revoke all on public.servant_scope_requests from anon, authenticated;
grant select on public.servant_scope_requests to authenticated;
grant all on public.servant_scope_requests to service_role;
grant select (token, updated_at) on public.signup_invites to authenticated;
grant delete on public.signup_invites to authenticated;
revoke all on public.login_throttle from anon, authenticated;
