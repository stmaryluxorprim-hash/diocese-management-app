'use client';

// ---------- One person · many accounts (migration 20261003120000) ----------
// A person (code = national_id = QR) has ONE password and may own up to
// three ACCOUNTS: servant (Supabase Auth), child (child_sessions token),
// priest (priest_sessions token). This module:
//   * lists the accounts of the signed-in person from ANY portal (my_accounts)
//   * switches to another account WITHOUT signing out / typing the password
//     (account_switch → child/priest token, or a one-time ticket that
//     /api/account/switch exchanges for a servant Auth session)
//   * helps the signup wizards detect an existing code and verify its password

import type { SupabaseClient } from '@supabase/supabase-js';
import { setChildToken, clearChildToken, getChildToken, childLogout } from '@/lib/child-portal';
import { setPriestToken, clearPriestToken, getPriestToken, priestLogout } from '@/lib/priest-portal';
import { SERVANT_NO_REMEMBER_KEY, SERVANT_TAB_ALIVE_KEY, clearServantRememberFlags } from '@/lib/session';

export type AccountKind = 'servant' | 'child' | 'priest';

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  servant: 'خادم',
  child: 'مخدوم',
  priest: 'كاهن',
};

/** where each account lives */
export const ACCOUNT_HOME: Record<AccountKind, string> = {
  servant: '/',
  child: '/child',
  priest: '/priest',
};

export interface AccountPlace { church: string | null; service: string | null; class: string | null }

export interface PersonAccount {
  kind: AccountKind;
  id: string;
  /** servant: pending · approved · rejected · suspended — child: active · stopped — priest: pending · approved · rejected · suspended */
  status: string;
  label: string;
  role?: string;
  title?: string | null;
  places: AccountPlace[];
}

export interface MyAccounts {
  person: { id: string; name: string; code: string; image_url: string | null };
  current: AccountKind;
  accounts: PersonAccount[];
}

export const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  approved: 'مفعّل',
  active: 'مفعّل',
  pending: 'قيد المراجعة',
  rejected: 'مرفوض',
  suspended: 'موقوف',
  stopped: 'موقوف',
};

export const accountUsable = (a: PersonAccount) => a.status === 'approved' || a.status === 'active';

export function placeLabel(p: AccountPlace): string {
  return [p.church, p.service, p.class].filter(Boolean).join(' ← ');
}

// ---------- which session is active in THIS tab ----------
/** the token the current portal uses (null for the servant app — it uses the Auth cookie) */
export function currentSessionToken(kind: AccountKind): string | null {
  if (kind === 'child') return getChildToken();
  if (kind === 'priest') return getPriestToken();
  return null;
}

// ---------- list ----------
export async function fetchMyAccounts(supabase: SupabaseClient, kind: AccountKind, token: string | null): Promise<MyAccounts> {
  const { data, error } = await supabase.rpc('my_accounts', { p_kind: kind, p_token: token });
  if (error) throw error;
  return data as MyAccounts;
}

// ---------- switch ----------
export interface SwitchChildResult { kind: 'child'; token: string; expires_at: string; person_id: string }
export interface SwitchPriestResult { kind: 'priest'; token: string; expires_at: string; priest_id: string }
export interface SwitchServantTicket { kind: 'servant'; ticket: string; servant_id: string; code: string }
export type SwitchResult = SwitchChildResult | SwitchPriestResult | SwitchServantTicket;

/**
 * Switch the current session to another account of the SAME person.
 * Resolves with the URL to navigate to (hard navigation recommended — every
 * portal boots its provider from storage).
 */
export async function switchAccount(
  supabase: SupabaseClient,
  from: AccountKind,
  to: AccountKind,
  opts: { remember?: boolean } = {},
): Promise<string> {
  const remember = opts.remember ?? true;
  const fromToken = currentSessionToken(from);
  const { data, error } = await supabase.rpc('account_switch', {
    p_from_kind: from,
    p_from_token: fromToken,
    p_to_kind: to,
    p_remember: remember,
  });
  if (error) throw error;
  const r = data as SwitchResult;

  // the old session of THIS tab is closed (server + storage) — the person
  // stays signed in only as the account he switched to
  await closeCurrentSession(supabase, from, { keepServantIfTarget: to === 'servant' });

  if (r.kind === 'child') {
    setChildToken(r.token, remember);
    return ACCOUNT_HOME.child;
  }
  if (r.kind === 'priest') {
    setPriestToken(r.token, remember);
    return ACCOUNT_HOME.priest;
  }
  // servant: the server exchanges the ticket for an Auth session
  const res = await fetch('/api/account/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket: r.ticket }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; token_hash?: string; type?: string };
  if (!res.ok || !body.token_hash) throw new Error(body.error ?? 'switch_failed');
  const { error: otpErr } = await supabase.auth.verifyOtp({ token_hash: body.token_hash, type: 'magiclink' });
  if (otpErr) throw otpErr;
  try {
    if (remember) window.localStorage.removeItem(SERVANT_NO_REMEMBER_KEY);
    else { window.localStorage.setItem(SERVANT_NO_REMEMBER_KEY, '1'); window.sessionStorage.setItem(SERVANT_TAB_ALIVE_KEY, '1'); }
  } catch { /* private mode */ }
  return ACCOUNT_HOME.servant;
}

/** close the session of `kind` in this tab (used by switch and by «sign out of everything») */
export async function closeCurrentSession(
  supabase: SupabaseClient,
  kind: AccountKind,
  opts: { keepServantIfTarget?: boolean } = {},
): Promise<void> {
  if (kind === 'child') {
    const t = getChildToken();
    if (t) await childLogout(supabase, t).catch(() => {});
    clearChildToken();
  } else if (kind === 'priest') {
    const t = getPriestToken();
    if (t) await priestLogout(supabase, t).catch(() => {});
    clearPriestToken();
  } else if (!opts.keepServantIfTarget) {
    clearServantRememberFlags();
    await supabase.auth.signOut().catch(() => {});
  }
}

// ---------- signup helpers ----------
export interface AccountCodeLookup {
  exists: boolean;
  family: boolean;
  name?: string | null;
  image_url?: string | null;
  has_password?: boolean;
  has_account?: boolean;
  is_servant?: boolean;
  servant_status?: string | null;
  is_child?: boolean;
  is_priest?: boolean;
  priest_status?: string | null;
  child_pending?: boolean;
  priest_pending?: boolean;
}

export async function accountCodeLookup(supabase: SupabaseClient, code: string): Promise<AccountCodeLookup | null> {
  const { data, error } = await supabase.rpc('account_code_lookup', { p_code: code.trim() });
  if (error) throw error;
  return (data ?? null) as AccountCodeLookup | null;
}

/** true when `password` is the existing password of the person behind `code` */
export async function verifyPersonPassword(supabase: SupabaseClient, code: string, password: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('person_verify_password', { p_code: code.trim(), p_password: password });
  if (error) throw error;
  return data === true;
}

/** the kinds a code already owns (for the «هذا الكود له حساب …» banners) */
export function existingKinds(l: AccountCodeLookup | null | undefined): AccountKind[] {
  if (!l) return [];
  const k: AccountKind[] = [];
  if (l.is_servant) k.push('servant');
  if (l.is_child) k.push('child');
  if (l.is_priest) k.push('priest');
  return k;
}

export function kindsLabel(kinds: AccountKind[]): string {
  return kinds.map((k) => ACCOUNT_KIND_LABELS[k]).join(' و');
}

// ---------- errors ----------
const ERRORS: Record<string, string> = {
  no_such_account: 'لا يوجد لك حساب من هذا النوع',
  pending_approval: 'هذا الحساب قيد المراجعة — انتظر الموافقة',
  account_stopped: 'هذا الحساب موقوف — تواصل مع المسؤول',
  session_expired: 'انتهت الجلسة — سجّل الدخول مجدداً',
  not_authenticated: 'سجّل الدخول أولاً',
  invalid_ticket: 'انتهت صلاحية طلب التبديل — حاول مجدداً',
  not_configured: 'تبديل الحساب إلى الخادم غير مُفعّل على الخادم (SUPABASE_SERVICE_ROLE_KEY)',
  wrong_password: 'كلمة المرور غير صحيحة',
  switch_failed: 'تعذّر تبديل الحساب، حاول مجدداً',
};
export function accountErrorMessage(err: unknown, fallback = 'تعذّر تبديل الحساب، حاول مجدداً'): string {
  const msg = (err as { message?: string } | null)?.message ?? String(err ?? '');
  for (const k of Object.keys(ERRORS)) if (msg.includes(k)) return ERRORS[k];
  return fallback;
}
