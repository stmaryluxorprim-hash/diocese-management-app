'use client';

// ---------- Priest portal (بوابة الكاهن) — client data layer ----------
// Migrations 20260927120000 + 20260927130000. The priest has no Supabase
// Auth account: code + password → `priest_login` → a session token kept in
// local/sessionStorage and passed to every `priest_*` RPC (SECURITY DEFINER,
// resolved by `priest_portal_self`). Only the OWNER approves / edits priests.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Gender } from '@/lib/types';

export const PRIEST_TOKEN_KEY = 'priest_portal_token';
export const PRIEST_SIGNUP_KEY = 'priest_signup_request';

// ---------- Types ----------
export interface PriestPerson {
  id: string;
  national_id: string;
  name: string;
  gender: Gender | null;
  birthdate: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  image_url: string | null;
  created_at: string;
}

export interface PriestPlace {
  enrollment_id: string;
  kind: 'child' | 'servant';
  status: 'active' | 'stopped';
  church_name: string;
  service_name: string;
  class_name: string;
}

export interface PriestProfile {
  priest: { id: string; title: string | null; status: PriestStatus; reminder_days: number; church_id: string; created_at: string };
  person: PriestPerson;
  church: { id: string; name: string; logo_url: string | null };
  counts: {
    confessors: number; overdue: number; pending_appointments: number; today_appointments: number;
    /** الافتقاد الأسري (migration 20260928120000) */
    areas: number; my_areas: number; families: number; never_visited: number; pending_visits: number; today_visits: number;
  };
  server_today: string;
}

export type PriestStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export const PRIEST_STATUS_LABELS: Record<PriestStatus, string> = {
  pending: 'قيد المراجعة',
  approved: 'مفعّل',
  rejected: 'مرفوض',
  suspended: 'موقوف',
};

export type ContactKind = 'call' | 'whatsapp' | 'sms' | 'note';
export const CONTACT_KIND_LABELS: Record<ContactKind, string> = {
  call: 'مكالمة',
  whatsapp: 'واتساب',
  sms: 'رسالة SMS',
  note: 'ملاحظة',
};

export interface Confessor {
  id: string;
  person_id: string;
  notes: string | null;
  created_at: string;
  person: PriestPerson;
  places: PriestPlace[];
  last_confession: string | null;      // YYYY-MM-DD
  confessions_count: number;
  days_since: number;                  // since last confession (or since added)
  overdue: boolean;
  last_contact: { kind: ContactKind; created_at: string } | null;
  next_appointment: { id: string; status: AppointmentStatus; on: string; time: string | null; requested_by: 'priest' | 'child' } | null;
  /** set by `priest_add_confessor` when the person was moved here from another priest (his name) — 20260928130000 */
  moved_from?: string | null;
}

export type AppointmentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'done';
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: 'بانتظار الموافقة',
  approved: 'مؤكَّد',
  rejected: 'مرفوض',
  cancelled: 'ملغي',
  done: 'تمّ الاعتراف',
};

export interface Appointment {
  id: string;
  person_id: string;
  requested_by: 'priest' | 'child';
  requested_on: string;
  requested_time: string | null;
  note: string | null;
  status: AppointmentStatus;
  scheduled_on: string | null;
  scheduled_time: string | null;
  on: string;                          // the effective day
  time: string | null;                 // the effective time (HH:MM:SS)
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  person: PriestPerson;
  is_confessor: boolean;
  last_confession: string | null;
}

export interface ConfessionRow { id: string; confessed_on: string; notes: string | null; created_at: string }
export interface ContactRow { id: string; kind: ContactKind; message: string | null; created_at: string }
export interface ConfessorHistory { confessions: ConfessionRow[]; contacts: ContactRow[]; appointments: Appointment[] }

export interface CodeLookup {
  found: boolean;
  code?: string;
  person?: PriestPerson;
  places?: PriestPlace[];
  is_confessor?: boolean;
  confessor?: Confessor | null;
  /** the priest he confesses at today, when it is another one (one confession father per person) */
  other_priest?: string | null;
}

export interface PersonHit {
  person: PriestPerson;
  places: PriestPlace[];
  is_confessor: boolean;
  other_priest: string | null;
}

// ---------- Token storage ----------
export function getPriestToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(PRIEST_TOKEN_KEY) ?? window.sessionStorage.getItem(PRIEST_TOKEN_KEY);
  } catch { return null; }
}
export function setPriestToken(token: string, remember = true) {
  try {
    if (remember) { window.localStorage.setItem(PRIEST_TOKEN_KEY, token); window.sessionStorage.removeItem(PRIEST_TOKEN_KEY); }
    else { window.sessionStorage.setItem(PRIEST_TOKEN_KEY, token); window.localStorage.removeItem(PRIEST_TOKEN_KEY); }
  } catch { /* private mode */ }
}
export function clearPriestToken() {
  try { window.localStorage.removeItem(PRIEST_TOKEN_KEY); window.sessionStorage.removeItem(PRIEST_TOKEN_KEY); } catch { /* ignore */ }
}
export function getPriestSignupRequest(): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(PRIEST_SIGNUP_KEY); } catch { return null; }
}
export function setPriestSignupRequest(id: string | null) {
  try { if (id) window.localStorage.setItem(PRIEST_SIGNUP_KEY, id); else window.localStorage.removeItem(PRIEST_SIGNUP_KEY); } catch { /* ignore */ }
}

// ---------- Errors ----------
const ERRORS: Record<string, string> = {
  session_expired: 'انتهت الجلسة — سجّل الدخول مجدداً',
  pending_approval: 'حسابك قيد مراجعة مالك التطبيق — انتظر الموافقة',
  account_rejected: 'تم رفض طلب حسابك — تواصل مع مالك التطبيق',
  account_stopped: 'هذا الحساب موقوف — تواصل مع مالك التطبيق',
  not_priest: 'هذا الكود ليس لحساب كاهن — أنشئ حساباً أولاً',
  unknown_code: 'هذا الكود غير مسجل',
  invalid_code: 'الكود غير صالح',
  wrong_password: 'كلمة المرور غير صحيحة',
  weak_password: 'كلمة المرور قصيرة — 6 أحرف على الأقل',
  already_registered: 'هذا الكود له حساب كاهن بالفعل — سجّل الدخول به (لكل كاهن حساب كاهن واحد فقط)',
  invite_required: 'التسجيل بالدعوة فقط — افتح رابط الدعوة الذي أرسله مالك التطبيق',
  invite_invalid: 'رابط الدعوة غير صالح أو انتهت صلاحيته — اطلب رابطًا جديدًا',
  pending_exists: 'يوجد طلب قيد المراجعة بالفعل',
  code_required: 'الكود مطلوب',
  name_required: 'الاسم مطلوب',
  church_required: 'اختر الكنيسة',
  invalid_gender: 'النوع غير صالح',
  person_not_found: 'لا يوجد شخص بهذا الكود',
  already_member: 'هذا الشخص من المعترفين لديك بالفعل',
  code_taken: 'هذا الكود مستخدم لعائلة — اختر كودًا آخر',
  code_is_family: 'هذا الكود كود عائلة — لا يمكن استخدامه لشخص',
  future_date: 'لا يمكن تسجيل اعتراف بتاريخ مستقبلي',
  past_date: 'اختر تاريخًا من اليوم فصاعدًا',
  date_required: 'اختر التاريخ',
  invalid_action: 'إجراء غير صالح',
  invalid_kind: 'نوع غير صالح',
  invalid_days: 'عدد الأيام يجب أن يكون بين 1 و365',
  not_pending: 'هذا الموعد لم يعد قابلاً للتعديل',
  not_found: 'غير موجود',
  forbidden: 'ليس لديك صلاحية لهذا الإجراء',
  invalid_status: 'حالة غير صالحة',
};
export function priestErrorMessage(err: unknown, fallback = 'حدث خطأ، حاول مجدداً'): string {
  const msg = (err as { message?: string } | null)?.message ?? '';
  for (const k of Object.keys(ERRORS)) if (msg.includes(k)) return ERRORS[k];
  return fallback;
}

// ---------- Auth ----------
export async function priestLogin(supabase: SupabaseClient, code: string, password: string, remember: boolean) {
  const ua = typeof navigator === 'undefined' ? null : navigator.userAgent.slice(0, 300);
  const { data, error } = await supabase.rpc('priest_login', { p_code: code.trim(), p_password: password, p_remember: remember, p_user_agent: ua });
  if (error) throw error;
  return data as { token: string; expires_at: string; priest_id: string; remember: boolean };
}
export async function priestLogout(supabase: SupabaseClient, token: string) {
  await supabase.rpc('priest_logout', { p_token: token });
}
export async function priestSessionTouch(supabase: SupabaseClient, token: string) {
  const { data, error } = await supabase.rpc('priest_session_touch', { p_token: token });
  if (error) throw error;
  return data as { priest_id: string; expires_at: string; remember: boolean };
}
export async function priestChangePassword(supabase: SupabaseClient, token: string, current: string, next: string) {
  const { error } = await supabase.rpc('priest_change_password', { p_token: token, p_current: current, p_new: next });
  if (error) throw error;
}

// ---------- Signup ----------
export interface PriestSignupLookup {
  exists: boolean; is_priest: boolean; pending: boolean; name: string | null;
  /** 20261003120000: the other accounts of the person behind the code */
  is_servant?: boolean; is_child?: boolean; has_password?: boolean; family?: boolean;
}
export async function priestSignupLookupCode(supabase: SupabaseClient, code: string): Promise<PriestSignupLookup> {
  const { data, error } = await supabase.rpc('priest_signup_lookup_code', { p_code: code.trim() });
  if (error) throw error;
  return data as PriestSignupLookup;
}
export interface PriestSignupInput {
  code: string; name: string; password: string; church_id: string; title: string | null;
  gender: Gender | null; birthdate: string | null; phone: string | null; address: string | null; notes: string | null; image_url: string | null;
}
/** 20261004120000: invite-only — the ?invite token that opened the wizard is consumed by the RPC */
export async function priestSignup(supabase: SupabaseClient, i: PriestSignupInput & { invite: string }) {
  const { data, error } = await supabase.rpc('priest_signup', {
    p_code: i.code.trim(), p_name: i.name.trim(), p_password: i.password, p_church: i.church_id, p_title: i.title,
    p_gender: i.gender, p_birthdate: i.birthdate, p_phone: i.phone, p_address: i.address, p_notes: i.notes, p_image_url: i.image_url,
    p_invite: i.invite,
  });
  if (error) throw error;
  return data as { request_id: string; code: string };
}
export async function priestSignupStatus(supabase: SupabaseClient, requestId: string) {
  const { data, error } = await supabase.rpc('priest_signup_status', { p_request: requestId });
  if (error) throw error;
  return (data ?? null) as { status: 'pending' | 'approved' | 'rejected'; decision_note: string | null; code: string } | null;
}

// ---------- Profile ----------
export async function fetchPriestProfile(supabase: SupabaseClient, token: string): Promise<PriestProfile> {
  const { data, error } = await supabase.rpc('priest_portal_profile', { p_token: token });
  if (error) throw error;
  return data as PriestProfile;
}
export async function setPriestReminderDays(supabase: SupabaseClient, token: string, days: number) {
  const { error } = await supabase.rpc('priest_set_reminder_days', { p_token: token, p_days: days });
  if (error) throw error;
}
export async function updatePriestSelf(supabase: SupabaseClient, token: string, changes: Record<string, string | null>) {
  const { data, error } = await supabase.rpc('priest_update_self', { p_token: token, p_changes: changes });
  if (error) throw error;
  return data as PriestPerson;
}

// ---------- Confessors ----------
export async function fetchConfessors(supabase: SupabaseClient, token: string): Promise<Confessor[]> {
  const { data, error } = await supabase.rpc('priest_confessors_list', { p_token: token });
  if (error) throw error;
  return (data ?? []) as Confessor[];
}
export async function priestLookupCode(supabase: SupabaseClient, token: string, code: string): Promise<CodeLookup> {
  const { data, error } = await supabase.rpc('priest_lookup_code', { p_token: token, p_code: code.trim() });
  if (error) throw error;
  return data as CodeLookup;
}
export async function priestSearchPersons(supabase: SupabaseClient, token: string, q: string, limit = 30): Promise<PersonHit[]> {
  const { data, error } = await supabase.rpc('priest_search_persons', { p_token: token, p_query: q, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as PersonHit[];
}
export async function addConfessor(supabase: SupabaseClient, token: string, personId: string, notes?: string | null, lastConfession?: string | null): Promise<Confessor> {
  const { data, error } = await supabase.rpc('priest_add_confessor', { p_token: token, p_person: personId, p_notes: notes ?? null, p_last_confession: lastConfession ?? null });
  if (error) throw error;
  return data as Confessor;
}
export async function addConfessorByCode(supabase: SupabaseClient, token: string, code: string, notes?: string | null, lastConfession?: string | null): Promise<Confessor> {
  const { data, error } = await supabase.rpc('priest_add_confessor_by_code', { p_token: token, p_code: code.trim(), p_notes: notes ?? null, p_last_confession: lastConfession ?? null });
  if (error) throw error;
  return data as Confessor;
}
export interface NewConfessorInput {
  name: string; code: string | null; gender: Gender | null; birthdate: string | null; phone: string | null;
  address: string | null; notes: string | null; image_url: string | null; last_confession: string | null;
}
export async function addNewConfessor(supabase: SupabaseClient, token: string, i: NewConfessorInput): Promise<Confessor & { created: boolean }> {
  const { data, error } = await supabase.rpc('priest_add_new_confessor', {
    p_token: token, p_name: i.name.trim(), p_code: i.code, p_gender: i.gender, p_birthdate: i.birthdate, p_phone: i.phone,
    p_address: i.address, p_notes: i.notes, p_image_url: i.image_url, p_last_confession: i.last_confession,
  });
  if (error) throw error;
  return data as Confessor & { created: boolean };
}
export async function updateConfessorNotes(supabase: SupabaseClient, token: string, confessorId: string, notes: string) {
  const { error } = await supabase.rpc('priest_update_confessor', { p_token: token, p_confessor: confessorId, p_notes: notes });
  if (error) throw error;
}
export async function removeConfessor(supabase: SupabaseClient, token: string, confessorId: string) {
  const { error } = await supabase.rpc('priest_remove_confessor', { p_token: token, p_confessor: confessorId });
  if (error) throw error;
}

// ---------- Confessions · contacts · history ----------
export async function recordConfession(supabase: SupabaseClient, token: string, personId: string, on?: string | null, notes?: string | null, appointmentId?: string | null) {
  const { data, error } = await supabase.rpc('priest_record_confession', { p_token: token, p_person: personId, p_on: on ?? null, p_notes: notes ?? null, p_appointment: appointmentId ?? null });
  if (error) throw error;
  return data as { id: string; confessed_on: string; confessor: Confessor };
}
export async function deleteConfession(supabase: SupabaseClient, token: string, id: string) {
  const { error } = await supabase.rpc('priest_delete_confession', { p_token: token, p_confession: id });
  if (error) throw error;
}
export async function logContact(supabase: SupabaseClient, token: string, personId: string, kind: ContactKind, message?: string | null): Promise<ContactRow> {
  const { data, error } = await supabase.rpc('priest_log_contact', { p_token: token, p_person: personId, p_kind: kind, p_message: message ?? null });
  if (error) throw error;
  return data as ContactRow;
}
export async function deleteContact(supabase: SupabaseClient, token: string, id: string) {
  const { error } = await supabase.rpc('priest_delete_contact', { p_token: token, p_contact: id });
  if (error) throw error;
}
export async function fetchConfessorHistory(supabase: SupabaseClient, token: string, personId: string): Promise<ConfessorHistory> {
  const { data, error } = await supabase.rpc('priest_confessor_history', { p_token: token, p_person: personId });
  if (error) throw error;
  return data as ConfessorHistory;
}

// ---------- Appointments ----------
export async function fetchAppointments(supabase: SupabaseClient, token: string, opts: { from?: string | null; to?: string | null; includePast?: boolean } = {}): Promise<Appointment[]> {
  const { data, error } = await supabase.rpc('priest_appointments_list', { p_token: token, p_from: opts.from ?? null, p_to: opts.to ?? null, p_include_past: !!opts.includePast });
  if (error) throw error;
  return (data ?? []) as Appointment[];
}
export async function createAppointment(supabase: SupabaseClient, token: string, personId: string, on: string, time?: string | null, note?: string | null): Promise<Appointment> {
  const { data, error } = await supabase.rpc('priest_create_appointment', { p_token: token, p_person: personId, p_on: on, p_time: time ?? null, p_note: note ?? null });
  if (error) throw error;
  return data as Appointment;
}
export type AppointmentAction = 'approve' | 'reject' | 'cancel' | 'done';
export async function decideAppointment(supabase: SupabaseClient, token: string, id: string, action: AppointmentAction, opts: { on?: string | null; time?: string | null; note?: string | null } = {}): Promise<Appointment> {
  const { data, error } = await supabase.rpc('priest_decide_appointment', { p_token: token, p_appointment: id, p_action: action, p_on: opts.on ?? null, p_time: opts.time ?? null, p_note: opts.note ?? null });
  if (error) throw error;
  return data as Appointment;
}

// ---------- Child side (بوابة المخدوم → الاعتراف) ----------
export interface ChildConfessionPriest {
  id: string; name: string; title: string | null; image_url: string | null; church_id: string; church_name: string;
  is_mine: boolean; last_confession: string | null;
}
export interface ChildConfessionAppointment {
  id: string; priest_id: string; priest_name: string; priest_title: string | null;
  requested_on: string; requested_time: string | null; note: string | null;
  status: AppointmentStatus; on: string; time: string | null; decision_note: string | null; decided_at: string | null; created_at: string;
}
export interface ChildConfession { priests: ChildConfessionPriest[]; appointments: ChildConfessionAppointment[]; server_today: string }
export async function fetchChildConfession(supabase: SupabaseClient, token: string): Promise<ChildConfession> {
  const { data, error } = await supabase.rpc('child_portal_confession', { p_token: token });
  if (error) throw error;
  return data as ChildConfession;
}
export async function childRequestConfession(supabase: SupabaseClient, token: string, priestId: string, on: string, time?: string | null, note?: string | null) {
  const { data, error } = await supabase.rpc('child_request_confession', { p_token: token, p_priest: priestId, p_on: on, p_time: time ?? null, p_note: note ?? null });
  if (error) throw error;
  return data as { id: string; status: AppointmentStatus; on: string; time: string | null };
}
export async function childCancelConfession(supabase: SupabaseClient, token: string, id: string) {
  const { error } = await supabase.rpc('child_cancel_confession_request', { p_token: token, p_appointment: id });
  if (error) throw error;
}

// ---------- Owner side ----------
export interface OwnerPriest {
  id: string; person_id: string; church_id: string; church_name: string; title: string | null; status: PriestStatus;
  reminder_days: number; notes: string | null; approved_at: string | null; created_at: string; person: PriestPerson;
  confessors_count: number; confessions_count: number; pending_appointments: number; last_seen_at: string | null;
}
export interface PriestRequest {
  id: string; code: string; name: string; title: string | null; gender: Gender | null; birthdate: string | null; phone: string | null;
  address: string | null; notes: string | null; image_url: string | null; church_id: string | null;
  status: 'pending' | 'approved' | 'rejected'; decision_note: string | null; decided_by: string | null; decided_at: string | null;
  priest_id: string | null; created_at: string;
}
export async function fetchOwnerPriests(supabase: SupabaseClient): Promise<OwnerPriest[]> {
  const { data, error } = await supabase.rpc('owner_priests_overview');
  if (error) throw error;
  return (data ?? []) as OwnerPriest[];
}
/** the columns the owner may read — `password_hash` is NOT granted, so a
 *  `select('*')` fails with «permission denied» and the list looked empty */
export const PRIEST_REQUEST_COLUMNS =
  'id, code, name, title, gender, birthdate, phone, address, notes, image_url, church_id, status, decision_note, decided_by, decided_at, priest_id, created_at';
export async function fetchPriestRequests(supabase: SupabaseClient): Promise<PriestRequest[]> {
  const { data, error } = await supabase.from('priest_requests').select(PRIEST_REQUEST_COLUMNS).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PriestRequest[];
}
export async function reviewPriestRequest(supabase: SupabaseClient, id: string, approve: boolean, opts: { note?: string | null; church?: string | null; title?: string | null } = {}) {
  const { data, error } = await supabase.rpc('owner_review_priest_request', { p_request: id, p_approve: approve, p_note: opts.note ?? null, p_church: opts.church ?? null, p_title: opts.title ?? null });
  if (error) throw error;
  return data as { status: string; priest_id?: string };
}
export async function ownerAddPriest(supabase: SupabaseClient, i: PriestSignupInput) {
  const { data, error } = await supabase.rpc('owner_add_priest', {
    p_code: i.code.trim(), p_name: i.name.trim(), p_password: i.password, p_church: i.church_id, p_title: i.title,
    p_gender: i.gender, p_birthdate: i.birthdate, p_phone: i.phone, p_address: i.address, p_notes: i.notes, p_image_url: i.image_url,
  });
  if (error) throw error;
  return data as { priest_id: string; person_id: string; code: string };
}
export async function ownerUpdatePriest(supabase: SupabaseClient, id: string, patch: { church?: string | null; title?: string | null; status?: 'approved' | 'suspended' | null; notes?: string | null; reminder_days?: number | null }) {
  const { error } = await supabase.rpc('owner_update_priest', {
    p_priest: id, p_church: patch.church ?? null, p_title: patch.title ?? null, p_status: patch.status ?? null, p_notes: patch.notes ?? null, p_reminder_days: patch.reminder_days ?? null,
  });
  if (error) throw error;
}
export async function ownerSetPriestPassword(supabase: SupabaseClient, id: string, password: string) {
  const { error } = await supabase.rpc('owner_set_priest_password', { p_priest: id, p_password: password });
  if (error) throw error;
}
export async function ownerDeletePriest(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.rpc('owner_delete_priest', { p_priest: id });
  if (error) throw error;
}

// ---------- Small helpers ----------
/** Egyptian phone → wa.me number */
export const waNumber = (phone: string) => { const d = phone.replace(/\D/g, ''); return d.startsWith('0') ? `2${d}` : d; };
/** 'HH:MM:SS' → 'HH:MM' */
export const shortTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');
export const todayYmd = () => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
};
export const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
};
export const daysLabel = (n: number) => (n === 0 ? 'اليوم' : n === 1 ? 'منذ يوم' : n === 2 ? 'منذ يومين' : n <= 10 ? `منذ ${n} أيام` : `منذ ${n} يومًا`);
