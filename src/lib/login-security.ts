'use client';

// ---------- حماية الدخول — owner view of the login throttle (20261019120000) ----------
import type { SupabaseClient } from '@supabase/supabase-js';

export interface LoginLock {
  key: string;                 // 'code:<code>' | 'ip:<ip>'
  kind: 'code' | 'ip';
  subject: string;
  fails: number;
  lock_count: number;
  locked: boolean;
  locked_until: string | null;
  last_fail_at: string | null;
  last_code: string | null;
  person_name: string | null;
}

export interface LoginLimits {
  code_max: number; code_window_min: number; code_lock_min: number;
  ip_max: number; ip_window_min: number; ip_lock_min: number;
  max_lock_min: number;
}

/** mirrors login_limits() defaults in SQL */
export const DEFAULT_LOGIN_LIMITS: LoginLimits = {
  code_max: 5, code_window_min: 15, code_lock_min: 15,
  ip_max: 40, ip_window_min: 10, ip_lock_min: 10,
  max_lock_min: 240,
};

export async function fetchLoginLocks(supabase: SupabaseClient, limit = 200): Promise<LoginLock[]> {
  const { data, error } = await supabase.rpc('login_locks', { p_limit: limit });
  if (error) throw error;
  return ((data ?? []) as LoginLock[]).map((l) => ({ ...l, locked: !!l.locked }));
}

/** key = null → clear everything */
export async function unlockLogin(supabase: SupabaseClient, key: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('login_unlock', { p_key: key });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

export async function fetchLoginLimits(supabase: SupabaseClient): Promise<LoginLimits> {
  const { data, error } = await supabase.rpc('login_limits');
  if (error) throw error;
  return { ...DEFAULT_LOGIN_LIMITS, ...((data ?? {}) as Partial<LoginLimits>) };
}

export async function saveLoginLimits(supabase: SupabaseClient, v: LoginLimits, updatedBy: string | null): Promise<void> {
  const clean: LoginLimits = { ...DEFAULT_LOGIN_LIMITS };
  (Object.keys(DEFAULT_LOGIN_LIMITS) as (keyof LoginLimits)[]).forEach((k) => {
    const n = Math.round(Number(v[k]));
    clean[k] = Number.isFinite(n) && n > 0 ? n : DEFAULT_LOGIN_LIMITS[k];
  });
  const { error } = await supabase.from('app_settings').upsert({ key: 'login_limits', value: clean, updated_by: updatedBy }, { onConflict: 'key' });
  if (error) throw error;
}
