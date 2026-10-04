#!/usr/bin/env bash
# =====================================================================
# Supabase «Logs Ingest» — server-level Postgres log settings
#
# Migration 20261010120000 already sets everything that can be changed with
# plain SQL (log_min_messages, log_min_duration_statement, log_lock_waits,
# log_temp_files …). A few settings live at the SERVER level and can only be
# changed through the Supabase CLI / Management API — this script applies
# them. Run it ONCE per project (the values persist).
#
#   supabase login
#   supabase/scripts/supabase_log_settings.sh <project-ref>
#   supabase/scripts/supabase_log_settings.sh <project-ref> --dry-run   # print only
#
# What it sets and why (see README → «Supabase log ingest»):
#   log_connections=false / log_disconnections=false
#       one line per connection open + close. PostgREST / the pooler reuse
#       connections, but the Vercel server routes and pg_cron open fresh ones
#       all day long.
#   cron.log_statement=false
#       pg_cron logs the SQL of every scheduled run (288/day after the
#       migration, 1 440/day before).
#   log_autovacuum_min_duration=60s
#       keep autovacuum lines only when a vacuum is unusually long.
#   log_checkpoints=false
#       one line per checkpoint (every few minutes under write load).
#   log_lock_waits=false / log_temp_files=-1
#       mirrors the database-level values of the migration at server level.
#
# Needs Supabase CLI ≥ 1.69 and an owner / admin token (`supabase login`).
# `--no-restart`: the settings below are reload-only except
# cron.log_statement — that one is applied at the next restart (harmless to
# wait; or drop --no-restart to restart now, a few seconds of downtime).
# =====================================================================
set -euo pipefail

ref="${1:-}"
dry="${2:-}"
if [ -z "$ref" ]; then
  echo "usage: $0 <project-ref> [--dry-run]" >&2
  exit 1
fi

args=(
  --config log_connections=false
  --config log_disconnections=false
  --config cron.log_statement=false
  --config log_autovacuum_min_duration=60s
  --config log_checkpoints=false
  --config log_lock_waits=false
  --config log_temp_files=-1
)

cmd=(supabase postgres-config update --project-ref "$ref" --experimental --no-restart "${args[@]}")

echo "+ ${cmd[*]}"
if [ "$dry" = "--dry-run" ]; then exit 0; fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI not found — install it: https://supabase.com/docs/guides/local-development/cli/getting-started" >&2
  exit 1
fi

"${cmd[@]}"

echo
echo "Current overrides:"
supabase postgres-config get --project-ref "$ref" --experimental || true
echo
echo "Give it a day, then check Organization → Usage → Logs Ingest."
