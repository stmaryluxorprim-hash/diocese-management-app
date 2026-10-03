// ---------- Backup helpers (SERVER ONLY, service role) — migration 0044 ----------
// Shared by /api/backup/* routes:
//   • adminClient()          service-role Supabase client (null when not configured)
//   • requireOwner(req)      the caller's session must be an APPROVED owner
//   • runScheduledBackups()  export every due schedule → private bucket `backups`
//   • restoreAuthUsers()     re-create servants' login accounts from a backup
//                            (id + email + bcrypt hash — passwords survive)

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import { createClient as createSessionClient } from '@/lib/supabase/server';
import { SERVANTS_TABLE } from '@/lib/types';
import {
  exportBackup, fetchBackupTables, serializeBackup, backupFileName, AUTH_USERS_KEY, scopeIds,
  type BackupSchedule, type BackupRun,
} from '@/lib/backup';

export const BACKUPS_BUCKET = 'backups';

export function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Resolve the calling owner. Returns { id } or an error code. */
export async function requireOwner(): Promise<{ ok: true; id: string; admin: SupabaseClient } | { ok: false; status: number; error: string }> {
  const session = createSessionClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return { ok: false, status: 401, error: 'unauthorized' };
  const admin = adminClient();
  if (!admin) return { ok: false, status: 503, error: 'not_configured' };
  const { data: actor } = await admin.from(SERVANTS_TABLE).select('id, role, status').eq('id', user.id).maybeSingle();
  if (!actor || actor.status !== 'approved' || actor.role !== 'owner') return { ok: false, status: 403, error: 'forbidden' };
  return { ok: true, id: user.id, admin };
}

// ---------------------------------------------------------------------
// Scheduled backups
// ---------------------------------------------------------------------
export interface ScheduledOutcome {
  schedule_id: string;
  name: string;
  status: 'done' | 'failed';
  run_id: string | null;
  path?: string;
  size?: number;
  error?: string;
  pruned?: number;
}

export async function runSchedule(admin: SupabaseClient, s: BackupSchedule, appVersion?: string): Promise<ScheduledOutcome> {
  const out: ScheduledOutcome = { schedule_id: s.id, name: s.name, status: 'failed', run_id: null };
  // 20261009: a schedule may cover one church / service / class
  const scope = scopeIds(s.scope);
  const { data: runRow } = await admin.from('backup_runs')
    .insert({ kind: 'scheduled', schedule_id: s.id, status: 'running', tables: s.tables ?? [], include_auth: s.include_auth, scope: s.scope ?? null, created_by: s.created_by })
    .select('id').maybeSingle();
  const runId = (runRow as { id: string } | null)?.id ?? null;
  out.run_id = runId;

  try {
    const cat = await fetchBackupTables(admin, scope);
    const tables = (s.tables && s.tables.length ? s.tables : cat.map((t) => t.name))
      .filter((t) => cat.some((c) => c.name === t));
    const file = await exportBackup(admin, { tables, includeAuth: s.include_auth, kind: 'scheduled', appVersion, scope, catalogue: cat });
    const body = serializeBackup(file);
    const name = backupFileName('scheduled', new Date(), file.scope);
    const path = `${s.id}/${name}`;
    const { error: upErr } = await admin.storage.from(BACKUPS_BUCKET)
      .upload(path, Buffer.from(body, 'utf8'), { contentType: 'application/json', upsert: true });
    if (upErr) throw new Error(upErr.message);

    const size = Buffer.byteLength(body, 'utf8');
    if (runId) {
      await admin.from('backup_runs').update({
        status: 'done', tables, row_counts: file.counts, size_bytes: size, file_name: name,
        storage_path: path, scope: file.scope ?? null, finished_at: new Date().toISOString(),
      }).eq('id', runId);
    }
    out.pruned = await pruneSchedule(admin, s);
    await admin.rpc('backup_schedule_ran', { p_schedule: s.id, p_status: 'done' });
    return { ...out, status: 'done', path, size };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (runId) {
      await admin.from('backup_runs').update({ status: 'failed', error: msg, finished_at: new Date().toISOString() }).eq('id', runId);
    }
    await admin.rpc('backup_schedule_ran', { p_schedule: s.id, p_status: 'failed' });
    return { ...out, error: msg };
  }
}

/** Keep only the newest `keep_last` files of the schedule. */
async function pruneSchedule(admin: SupabaseClient, s: BackupSchedule): Promise<number> {
  const { data } = await admin.from('backup_runs')
    .select('id, storage_path')
    .eq('schedule_id', s.id).eq('kind', 'scheduled').eq('status', 'done')
    .order('created_at', { ascending: false });
  const rows = (data as Pick<BackupRun, 'id' | 'storage_path'>[]) ?? [];
  const old = rows.slice(s.keep_last);
  if (old.length === 0) return 0;
  const paths = old.map((r) => r.storage_path).filter(Boolean) as string[];
  if (paths.length) await admin.storage.from(BACKUPS_BUCKET).remove(paths);
  await admin.from('backup_runs').update({ storage_path: null }).in('id', old.map((r) => r.id));
  return old.length;
}

export async function runDueSchedules(admin: SupabaseClient, appVersion?: string): Promise<ScheduledOutcome[]> {
  const { data, error } = await admin.rpc('backup_schedules_due');
  if (error) throw new Error(error.message);
  const due = (data as BackupSchedule[]) ?? [];
  const out: ScheduledOutcome[] = [];
  for (const s of due) out.push(await runSchedule(admin, s, appVersion));
  return out;
}

// ---------------------------------------------------------------------
// Auth accounts restore
// ---------------------------------------------------------------------
export interface AuthRestoreResult { created: number; updated: number; failed: number; errors: string[] }

interface BackupAuthUser {
  id: string;
  email?: string | null;
  phone?: string | null;
  encrypted_password?: string | null;
  email_confirmed_at?: string | null;
  raw_user_meta_data?: Record<string, unknown>;
  raw_app_meta_data?: Record<string, unknown>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function restoreAuthUsers(admin: SupabaseClient, users: unknown[]): Promise<AuthRestoreResult> {
  const res: AuthRestoreResult = { created: 0, updated: 0, failed: 0, errors: [] };
  for (const raw of users) {
    const u = raw as BackupAuthUser;
    if (!u || typeof u !== 'object' || !UUID_RE.test(u.id ?? '') || !u.email) { res.failed += 1; res.errors.push('سجل غير صالح'); continue; }
    const meta = (u.raw_user_meta_data && typeof u.raw_user_meta_data === 'object') ? u.raw_user_meta_data : {};
    // exists? → update (e-mail + metadata; hash only when we have one)
    const { data: existing } = await admin.auth.admin.getUserById(u.id);
    if (existing?.user) {
      const { error } = await admin.auth.admin.updateUserById(u.id, {
        email: u.email, email_confirm: true, user_metadata: meta,
        ...(u.encrypted_password ? { password_hash: u.encrypted_password } : {}),
      });
      if (error) { res.failed += 1; res.errors.push(`${u.email}: ${error.message}`); } else res.updated += 1;
      continue;
    }
    const { error } = await admin.auth.admin.createUser({
      id: u.id,
      email: u.email,
      email_confirm: true,
      user_metadata: meta,
      ...(u.encrypted_password ? { password_hash: u.encrypted_password } : { password: '000000' }),
    });
    if (error) {
      // e-mail taken by another id → cannot restore the same id; report it
      res.failed += 1; res.errors.push(`${u.email}: ${error.message}`);
    } else res.created += 1;
  }
  return res;
}

export { AUTH_USERS_KEY };
