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

/**
 * 20261004120000: ONE ROW PER ENROLLMENT — a servant appears once per place he
 * serves in, a child once per class, a priest once. `enrollment_id` is the
 * row to switch to (servant: the account id; the place is in church/service/class).
 */
export interface PersonAccount {
  kind: AccountKind;
  id: string;
  enrollment_id: string;
  /** servant: pending · approved · rejected · suspended — child: active · stopped — priest: pending · approved · rejected · suspended */
  status: string;
  label: string;
  /** «كنيسة ← خدمة ← فصل» of this row */
  label2?: string;
  role?: string;
  title?: string | null;
  church_id?: string | null;
  service_id?: string | null;
  class_id?: string | null;
  is_primary?: boolean;
  places: AccountPlace[];
}

export interface MyAccounts {
  person: { id: string; name: string; code: string; image_url: string | null };
  current: AccountKind;
  /** child: the enrollment of this session (null = legacy «all») · servant: the account id · priest: the priest id */
  current_enrollment_id: string | null;
  /** servant only: the place chosen for this login (null = all his places) */
  current_place: { church_id: string | null; service_id: string | null; class_id: string | null } | null;
  accounts: PersonAccount[];
}

/** stable key of an account row (servant rows share the id — the place tells them apart) */
export const accountRowKey = (a: PersonAccount) =>
  `${a.kind}:${a.enrollment_id}:${a.church_id ?? ''}:${a.service_id ?? ''}:${a.class_id ?? ''}`;

/** is this row the one the current session is on? */
export function isCurrentRow(a: PersonAccount, me: MyAccounts): boolean {
  if (a.kind !== me.current) return false;
  if (a.kind === 'priest') return true;
  if (a.kind === 'child') return me.current_enrollment_id == null || a.enrollment_id === me.current_enrollment_id;
  // servant: same place as the active one (no active place = «all» → every row is partly current)
  const p = me.current_place;
  if (!p || !p.church_id) return !a.church_id || true;
  return a.church_id === p.church_id && (a.service_id ?? null) === (p.service_id ?? null) && (a.class_id ?? null) === (p.class_id ?? null);
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
export interface SwitchTarget {
  kind: AccountKind;
  /** child: the enrollment (class) · servant / priest: ignored */
  enrollment_id?: string | null;
  /** servant: the place of the new login (null = all his places) */
  church_id?: string | null;
  service_id?: string | null;
  class_id?: string | null;
}

export async function switchAccount(
  supabase: SupabaseClient,
  from: AccountKind,
  target: AccountKind | SwitchTarget,
  opts: { remember?: boolean } = {},
): Promise<string> {
  const t: SwitchTarget = typeof target === 'string' ? { kind: target } : target;
  const remember = opts.remember ?? true;
  // servant → another of HIS places: same Auth session, only the active place changes
  if (from === 'servant' && t.kind === 'servant') {
    await setServantActivePlace(supabase, t.church_id ? { church_id: t.church_id, service_id: t.service_id ?? null, class_id: t.class_id ?? null } : null);
    return ACCOUNT_HOME.servant;
  }
  const fromToken = currentSessionToken(from);
  const { data, error } = await supabase.rpc('account_switch', {
    p_from_kind: from,
    p_from_token: fromToken,
    p_to_kind: t.kind,
    p_remember: remember,
    p_enrollment: t.kind === 'child' ? t.enrollment_id ?? null : null,
    p_church: t.kind === 'servant' ? t.church_id ?? null : null,
    p_service: t.kind === 'servant' ? t.service_id ?? null : null,
    p_class: t.kind === 'servant' ? t.class_id ?? null : null,
  });
  if (error) throw error;
  const r = data as SwitchResult;

  // the old session of THIS tab is closed (server + storage) — the person
  // stays signed in only as the account he switched to
  await closeCurrentSession(supabase, from, { keepServantIfTarget: t.kind === 'servant' });
  return finishMint(supabase, r, remember);
}

/** store the minted session and return where to go (shared by login + switch) */
export async function finishMint(supabase: SupabaseClient, r: SwitchResult, remember: boolean): Promise<string> {
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

// ---------- ONE login (20261004120000) ----------
export interface LoginResult {
  grant: string;
  person: { id: string; name: string; code: string; image_url: string | null };
  accounts: PersonAccount[];
}

/** code + the ONE password → a 5-minute grant + every account of the person */
export async function accountLogin(supabase: SupabaseClient, code: string, password: string, remember: boolean): Promise<LoginResult> {
  const { data, error } = await supabase.rpc('account_login', { p_code: code.trim(), p_password: password, p_remember: remember });
  if (error) throw error;
  return data as LoginResult;
}

/** the chosen account → its session is minted and stored; returns the URL to go to */
export async function sessionFromLogin(supabase: SupabaseClient, grant: string, a: PersonAccount, remember: boolean): Promise<string> {
  const ua = typeof navigator === 'undefined' ? null : navigator.userAgent.slice(0, 300);
  const { data, error } = await supabase.rpc('account_session_from_login', {
    p_grant: grant,
    p_kind: a.kind,
    p_enrollment: a.kind === 'child' ? a.enrollment_id : null,
    p_church: a.kind === 'servant' ? a.church_id ?? null : null,
    p_service: a.kind === 'servant' ? a.service_id ?? null : null,
    p_class: a.kind === 'servant' ? a.class_id ?? null : null,
    p_user_agent: ua,
  });
  if (error) throw error;
  return finishMint(supabase, data as SwitchResult, remember);
}

/** the servant changes the place of his CURRENT login (null = all his places) */
export async function setServantActivePlace(supabase: SupabaseClient, place: { church_id: string | null; service_id?: string | null; class_id?: string | null } | null) {
  const { error } = await supabase.rpc('servant_set_active_place', {
    p_church: place?.church_id ?? null, p_service: place?.service_id ?? null, p_class: place?.class_id ?? null,
  });
  if (error) throw error;
}

// ---------- invites (20261004120000) ----------
export interface SignupInvite {
  id: string; kind: AccountKind; church_id: string | null; service_id: string | null; class_id: string | null;
  created_by: string | null; created_at: string; expires_at: string; max_uses: number | null; uses: number; revoked_at: string | null; note: string | null;
  /** الرمز الخام (20261007120000) — يقرأه منشئ الدعوة / المالك فقط لإعادة عرض الرابط. null للدعوات الأقدم من الـ migration. */
  token?: string | null;
  updated_at?: string | null;
}
export interface InviteCheck {
  valid: boolean; kind?: AccountKind; church_id?: string | null; service_id?: string | null; class_id?: string | null;
  church_name?: string | null; service_name?: string | null; class_name?: string | null; expires_at?: string;
}
export const SIGNUP_PATH: Record<AccountKind, string> = { servant: '/signup', child: '/child/signup', priest: '/priest/signup' };

export async function createSignupInvite(
  supabase: SupabaseClient,
  kind: AccountKind,
  scope: { church_id?: string | null; service_id?: string | null; class_id?: string | null },
  opts: { days?: number; max_uses?: number | null; note?: string | null } = {},
): Promise<{ id: string; token: string; expires_at: string; url: string }> {
  const { data, error } = await supabase.rpc('signup_invite_create', {
    p_kind: kind, p_church: scope.church_id ?? null, p_service: scope.service_id ?? null, p_class: scope.class_id ?? null,
    p_days: opts.days ?? 7, p_max_uses: opts.max_uses ?? null, p_note: opts.note ?? null,
  });
  if (error) throw error;
  const r = data as { id: string; token: string; expires_at: string };
  return { ...r, url: inviteUrlFor(kind, r.token) };
}

export async function checkSignupInvite(supabase: SupabaseClient, token: string | null, kind: AccountKind): Promise<InviteCheck> {
  if (!token) return { valid: false };
  const { data, error } = await supabase.rpc('signup_invite_check', { p_token: token, p_kind: kind });
  if (error) return { valid: false };
  return (data ?? { valid: false }) as InviteCheck;
}

/** رابط التسجيل الكامل لرمز دعوة */
export function inviteUrlFor(kind: AccountKind, token: string): string {
  const url = new URL(SIGNUP_PATH[kind], window.location.origin);
  url.searchParams.set('invite', token);
  return url.toString();
}

const INVITE_COLUMNS = 'id, kind, church_id, service_id, class_id, created_by, created_at, expires_at, max_uses, uses, revoked_at, note, token, updated_at';
const INVITE_COLUMNS_LEGACY = 'id, kind, church_id, service_id, class_id, created_by, created_at, expires_at, max_uses, uses, revoked_at, note';

export async function fetchMyInvites(supabase: SupabaseClient, kind?: AccountKind): Promise<SignupInvite[]> {
  const run = async (cols: string) => {
    let q = supabase.from('signup_invites').select(cols).order('created_at', { ascending: false }).limit(50);
    if (kind) q = q.eq('kind', kind);
    return q;
  };
  let { data, error } = await run(INVITE_COLUMNS);
  // the DB may not have 20261007120000 yet (no `token` column) → fall back
  if (error && (error.code === '42703' || /token|updated_at/.test(error.message ?? ''))) ({ data, error } = await run(INVITE_COLUMNS_LEGACY));
  if (error) throw error;
  return (data ?? []) as unknown as SignupInvite[];
}

export async function revokeSignupInvite(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from('signup_invites').update({ revoked_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

/** تعديل دعوة: الصلاحية (أيام من الآن) · عدد الاستخدامات · الملاحظة · إعادة التفعيل (20261007120000) */
export async function updateSignupInvite(
  supabase: SupabaseClient, id: string,
  patch: { days?: number | null; max_uses?: number | null; clear_max_uses?: boolean; note?: string | null; reactivate?: boolean },
): Promise<SignupInvite> {
  const { data, error } = await supabase.rpc('signup_invite_update', {
    p_id: id, p_days: patch.days ?? null, p_max_uses: patch.max_uses ?? null, p_clear_max_uses: patch.clear_max_uses ?? false,
    p_note: patch.note ?? null, p_reactivate: patch.reactivate ?? false,
  });
  if (error) throw error;
  return data as SignupInvite;
}

/** حذف دعوة نهائياً (منشئها أو المالك) */
export async function deleteSignupInvite(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.rpc('signup_invite_delete', { p_id: id });
  if (error) throw error;
}

export const inviteUsable = (i: SignupInvite) =>
  !i.revoked_at && new Date(i.expires_at).getTime() > Date.now() && (i.max_uses == null || i.uses < i.max_uses);

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
  unknown_code: 'هذا الكود غير مسجل',
  invalid_code: 'الكود غير صالح',
  no_account: 'لا يوجد حساب لهذا الكود — التسجيل يتم من رابط الدعوة الذي يرسله المسؤول',
  password_unknown: 'password_unknown',
  scope_not_allowed: 'هذا المكان ليس من أماكن خدمتك',
  invite_required: 'التسجيل متاح من رابط الدعوة فقط — اطلب الرابط من المسؤول',
  invite_invalid: 'رابط الدعوة غير صالح أو انتهت صلاحيته — اطلب رابطًا جديدًا من المسؤول',
  forbidden: 'ليس لديك صلاحية لهذا الإجراء',
  invite_not_found: 'هذه الدعوة لم تعد موجودة',
  signup_invite_update: 'شغّل migration 20261007120000 أولاً لتعديل الدعوات',
  signup_invite_delete: 'شغّل migration 20261007120000 أولاً لحذف الدعوات',
  scope_required: 'اختر الكنيسة والخدمة والفصل',
};
export function accountErrorMessage(err: unknown, fallback = 'تعذّر تبديل الحساب، حاول مجدداً'): string {
  const msg = (err as { message?: string } | null)?.message ?? String(err ?? '');
  for (const k of Object.keys(ERRORS)) if (msg.includes(k)) return ERRORS[k];
  return fallback;
}
