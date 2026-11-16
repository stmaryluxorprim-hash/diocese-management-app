'use client';

// ---------- Occasions module (الفعاليات) — client data layer ----------
// Occasions CRUD + checklist items + announcements go straight to the tables
// (RLS scoped + module gated). Registrations / statuses / check-in /
// checklist marks are RPCs that re-validate every rule inside the database
// (capacity, scope, permissions, points). The child portal uses the anon
// `child_portal_occasion*` RPCs with the card QR as token (pattern of 0021).

import type { SupabaseClient } from '@supabase/supabase-js';
import { ALL, type ScopeSelection } from '@/lib/queries';
import { classIdsOf } from '@/lib/class-multi';

// ---------- Types (mirror of migration 0032) ----------
export type OccasionKind = 'trip' | 'conference' | 'celebration' | 'activity' | 'other';
export type OccasionStatus = 'draft' | 'published' | 'cancelled' | 'completed';
export type RegistrationStatus = 'pending' | 'confirmed' | 'checked_in' | 'cancelled';
export type RegistrationSource = 'self' | 'leader';
export type NotificationKind = 'announcement' | 'reminder' | 'status';

export interface Occasion {
  id: string;
  church_id: string;
  service_id: string | null;   // null = all services
  class_id: string | null;     // null = all classes
  title: string;
  description: string | null;
  image_url: string | null;
  kind: OccasionKind;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  location_url: string | null;
  organizer: string | null;
  organizer_phone: string | null;
  registration_deadline: string | null;
  capacity: number | null;     // null = unlimited
  auto_confirm: boolean;
  checkin_points: number;
  status: OccasionStatus;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

export type OccasionInput = Omit<Occasion, 'id' | 'created_at' | 'created_by' | 'edited_at' | 'edited_by'>;

export interface OccasionRegistration {
  id: string;
  occasion_id: string;
  enrollment_id: string;
  person_id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  status: RegistrationStatus;
  ticket_code: string;
  source: RegistrationSource;
  registered_at: string;
  registered_by: string | null;
  confirmed_at: string | null;
  checked_in_at: string | null;
  checked_in_by: string | null;
  cancelled_at: string | null;
  note: string | null;
  points_log_id: string | null;
  updated_at: string;
}

/** `occasion_participants` RPC row */
export interface Participant {
  id: string;
  enrollment_id: string;
  person_id: string;
  person_name: string;
  person_image: string | null;
  national_id: string;
  phone: string | null;
  class_id: string;
  class_name: string;
  service_name: string;
  status: RegistrationStatus;
  ticket_code: string;
  source: RegistrationSource;
  registered_at: string;
  registered_by_name: string | null;
  confirmed_at: string | null;
  checked_in_at: string | null;
  checked_in_by_name: string | null;
  cancelled_at: string | null;
  note: string | null;
  checklist_done: number;
  checklist_items: string[];
}

export interface ChecklistItem {
  id: string;
  occasion_id: string;
  label: string;
  required: boolean;
  sort_order: number;
  created_at: string;
  created_by: string | null;
}

export interface OccasionNotification {
  id: string;
  occasion_id: string;
  registration_id: string | null;
  kind: NotificationKind;
  body: string;
  created_at: string;
  created_by: string | null;
}

export interface OccasionCounts {
  occasion_id: string;
  pending: number;
  confirmed: number;
  checked_in: number;
  cancelled: number;
  active: number;
}

export const ZERO_COUNTS: Omit<OccasionCounts, 'occasion_id'> = { pending: 0, confirmed: 0, checked_in: 0, cancelled: 0, active: 0 };

export interface CheckinResult {
  result: 'checked_in' | 'already_checked_in';
  previous_status: RegistrationStatus;
  registration_id: string;
  enrollment_id: string;
  status: RegistrationStatus;
  ticket_code: string;
  checked_in_at: string | null;
  person_name: string;
  person_image: string | null;
  national_id: string;
  class_name: string;
  points: number;
}

export interface OccasionPermissions {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  manage: boolean;
}

export const NO_PERMISSIONS: OccasionPermissions = { view: false, create: false, edit: false, delete: false, manage: false };

// ---------- Labels ----------
export const KIND_LABELS: Record<OccasionKind, string> = {
  trip: 'رحلة',
  conference: 'مؤتمر',
  celebration: 'احتفال',
  activity: 'نشاط',
  other: 'أخرى',
};
export const KIND_EMOJI: Record<OccasionKind, string> = {
  trip: '🚌',
  conference: '🎤',
  celebration: '🎉',
  activity: '⚽',
  other: '📌',
};
export const OCCASION_STATUS_LABELS: Record<OccasionStatus, string> = {
  draft: 'مسودة',
  published: 'منشورة',
  cancelled: 'ملغاة',
  completed: 'انتهت',
};
export const REG_STATUS_LABELS: Record<RegistrationStatus, string> = {
  pending: 'قيد المراجعة',
  confirmed: 'مؤكد',
  checked_in: 'سجّل الدخول',
  cancelled: 'ملغي',
};
export const REG_STATUS_STYLE: Record<RegistrationStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-emerald-100 text-emerald-700',
  checked_in: 'bg-cyan-100 text-cyan-700',
  cancelled: 'bg-slate-200 text-slate-600',
};
export const NOTIF_KIND_LABELS: Record<NotificationKind, string> = {
  announcement: 'إعلان',
  reminder: 'تذكير',
  status: 'حالة',
};

/** The natural "next" statuses a leader may move a registration to. */
export const REG_STATUS_ORDER: RegistrationStatus[] = ['pending', 'confirmed', 'checked_in', 'cancelled'];

// ---------- Time helpers ----------
export type OccasionPhase = 'upcoming' | 'ongoing' | 'past';

export function occasionPhase(o: Pick<Occasion, 'starts_at' | 'ends_at'>, now: Date = new Date()): OccasionPhase {
  const s = new Date(o.starts_at).getTime();
  const e = o.ends_at ? new Date(o.ends_at).getTime() : s + 6 * 3600 * 1000;
  const t = now.getTime();
  if (t < s) return 'upcoming';
  if (t <= e) return 'ongoing';
  return 'past';
}

export const PHASE_LABELS: Record<OccasionPhase, string> = {
  upcoming: 'قادمة',
  ongoing: 'جارية الآن',
  past: 'انتهت',
};

/** Registration open for children? (published · before start · before deadline · seats left) */
export function registrationOpen(o: Pick<Occasion, 'status' | 'starts_at' | 'registration_deadline' | 'capacity'>, active: number, now: Date = new Date()): boolean {
  if (o.status !== 'published') return false;
  const t = now.getTime();
  if (t >= new Date(o.starts_at).getTime()) return false;
  if (o.registration_deadline && t > new Date(o.registration_deadline).getTime()) return false;
  if (o.capacity !== null && active >= o.capacity) return false;
  return true;
}

export function remainingSeats(o: Pick<Occasion, 'capacity'>, active: number): number | null {
  return o.capacity === null ? null : Math.max(o.capacity - active, 0);
}

/** «الخميس ١٢ سبتمبر ٢٠٢٦ · ٩:٠٠ ص» */
export function fmtWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ar-EG', {
      timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
}
export function fmtDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
}
export function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}
export function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}

/** «بعد ٣ أيام» / «اليوم» / «منذ يومين» */
export function relativeDay(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => Math.floor((x.getTime() + 2 * 3600 * 1000) / 86400000); // Cairo ≈ UTC+2/+3, good enough for labels
  const diff = day(d) - day(now);
  if (diff === 0) return 'اليوم';
  if (diff === 1) return 'غداً';
  if (diff === -1) return 'أمس';
  if (diff > 1) return `بعد ${diff} ${diff <= 10 ? 'أيام' : 'يوماً'}`;
  return `منذ ${-diff} ${-diff <= 10 ? 'أيام' : 'يوماً'}`;
}

/** <input type="datetime-local"> value (Cairo wall clock) ↔ ISO */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce<Record<string, string>>((a, x) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  // interpret the wall clock in Cairo: find the offset Cairo has at that instant
  const [date, time] = v.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (t: number) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(t)).reduce<Record<string, string>>((a, x) => { a[x.type] = x.value; return a; }, {});
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
    return asUtc - t;
  };
  const off = offsetAt(guess);
  return new Date(guess - off).toISOString();
}

// ---------- Error mapping (RPC raise → Arabic) ----------
const ERRORS: [string, string][] = [
  ['module_not_visible', 'وحدة الفعاليات غير مفعّلة لنطاقك'],
  ['occasion_not_found', 'الفعالية غير موجودة'],
  ['registration_not_found', 'التسجيل غير موجود'],
  ['enrollment_not_found', 'المخدوم غير موجود'],
  ['item_not_found', 'عنصر قائمة التحقق غير موجود'],
  ['already_registered', 'هذا المخدوم مسجّل بالفعل في هذه الفعالية'],
  ['occasion_full', 'اكتمل العدد — لا توجد أماكن متاحة'],
  ['registration_closed', 'التسجيل غير متاح لهذه الفعالية'],
  ['occasion_started', 'بدأت الفعالية بالفعل'],
  ['deadline_passed', 'انتهى آخر موعد للتسجيل'],
  ['already_checked_in', 'تم تسجيل الدخول بالفعل'],
  ['registration_cancelled', 'تسجيل هذا المخدوم ملغي — أعد تفعيله أولاً'],
  ['not_registered', 'هذا المخدوم غير مسجّل في هذه الفعالية'],
  ['unknown_code', 'كود غير معروف — ليس تذكرة ولا كارت مخدوم'],
  ['out_of_scope', 'هذا المخدوم خارج نطاق الفعالية'],
  ['invalid_status', 'حالة غير صالحة'],
  ['forbidden', 'ليس لديك صلاحية على هذه العملية'],
];

export const MIGRATION_HINT = 'تحتاج تشغيل تحديث قاعدة البيانات 0032_occasions.sql في Supabase أولاً';

export function isMigrationMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /occasion/.test(msg) && /does not exist|not find|schema cache|relation/i.test(msg);
}

export function occasionErrorMessage(err: unknown, fallback = 'حدث خطأ، حاول مجدداً'): string {
  const msg = (err as { message?: string } | null)?.message ?? '';
  if (!msg) return fallback;
  if (isMigrationMissing(err)) return MIGRATION_HINT;
  if (/row-level security|permission denied/i.test(msg)) return 'ليس لديك صلاحية على هذه العملية';
  if (/service does not belong|class does not belong/i.test(msg)) return 'الخدمة أو الفصل لا يتبعان الكنيسة المختارة';
  if (/occasions_ends_after/.test(msg)) return 'وقت الانتهاء يجب أن يكون بعد وقت البداية';
  for (const [key, label] of ERRORS) {
    if (msg.includes(key)) return label;
  }
  return fallback;
}

// ---------- Permissions ----------
export async function fetchOccasionPermissions(supabase: SupabaseClient): Promise<OccasionPermissions> {
  const { data, error } = await supabase.rpc('occasion_permissions');
  if (error || !data) return NO_PERMISSIONS;
  return data as OccasionPermissions;
}

// ---------- Occasions CRUD ----------
export async function fetchOccasions(supabase: SupabaseClient, scope: ScopeSelection = {}): Promise<Occasion[]> {
  let q = supabase.from('occasions').select('*');
  if (scope.church && scope.church !== ALL) q = q.eq('church_id', scope.church);
  const { data, error } = await q.order('starts_at', { ascending: false }).limit(500);
  if (error) throw error;
  let rows = (data ?? []) as Occasion[];
  if (scope.service && scope.service !== ALL) rows = rows.filter((r) => r.service_id === null || r.service_id === scope.service);
  { const ids = classIdsOf(scope); if (ids.length > 0) rows = rows.filter((r) => r.class_id === null || ids.includes(r.class_id)); }
  return rows;
}

export async function fetchOccasion(supabase: SupabaseClient, id: string): Promise<Occasion | null> {
  const { data, error } = await supabase.from('occasions').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as Occasion | null) ?? null;
}

export async function saveOccasion(
  supabase: SupabaseClient, id: string | null, payload: OccasionInput, createdBy?: string
): Promise<Occasion> {
  const res = id
    ? await supabase.from('occasions').update(payload).eq('id', id).select('*').single()
    : await supabase.from('occasions').insert({ ...payload, created_by: createdBy }).select('*').single();
  if (res.error) throw res.error;
  return res.data as Occasion;
}

export async function setOccasionStatus(supabase: SupabaseClient, id: string, status: OccasionStatus): Promise<void> {
  const { error } = await supabase.from('occasions').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function deleteOccasion(supabase: SupabaseClient, id: string): Promise<void> {
  const { error, count } = await supabase.from('occasions').delete({ count: 'exact' }).eq('id', id);
  if (error) throw error;
  if (count === 0) throw new Error('forbidden');
}

export async function fetchOccasionCounts(supabase: SupabaseClient, ids: string[]): Promise<Map<string, OccasionCounts>> {
  const m = new Map<string, OccasionCounts>();
  if (ids.length === 0) return m;
  const { data, error } = await supabase.rpc('occasion_counts', { p_occasions: ids });
  if (error) return m;
  ((data ?? []) as OccasionCounts[]).forEach((r) => m.set(r.occasion_id, r));
  return m;
}

// ---------- Participants ----------
export async function fetchParticipants(supabase: SupabaseClient, occasionId: string): Promise<Participant[]> {
  const { data, error } = await supabase.rpc('occasion_participants', { p_occasion: occasionId });
  if (error) throw error;
  return (data ?? []) as Participant[];
}

export async function registerParticipant(
  supabase: SupabaseClient, occasionId: string, enrollmentId: string, status: 'pending' | 'confirmed' = 'confirmed'
): Promise<OccasionRegistration> {
  const { data, error } = await supabase.rpc('occasion_register', { p_occasion: occasionId, p_enrollment: enrollmentId, p_status: status });
  if (error) throw error;
  return data as OccasionRegistration;
}

export async function setRegistrationStatus(
  supabase: SupabaseClient, registrationId: string, status: RegistrationStatus, note?: string
): Promise<OccasionRegistration> {
  const { data, error } = await supabase.rpc('occasion_set_status', { p_registration: registrationId, p_status: status, p_note: note?.trim() || null });
  if (error) throw error;
  return data as OccasionRegistration;
}

export async function removeRegistration(supabase: SupabaseClient, registrationId: string): Promise<void> {
  const { error, count } = await supabase.from('occasion_registrations').delete({ count: 'exact' }).eq('id', registrationId);
  if (error) throw error;
  if (count === 0) throw new Error('forbidden');
}

export async function checkinByCode(supabase: SupabaseClient, occasionId: string, code: string): Promise<CheckinResult> {
  const { data, error } = await supabase.rpc('occasion_checkin', { p_occasion: occasionId, p_code: code.trim() });
  if (error) throw error;
  return data as CheckinResult;
}

// ---------- Checklist ----------
export async function fetchChecklistItems(supabase: SupabaseClient, occasionId: string): Promise<ChecklistItem[]> {
  const { data, error } = await supabase.from('occasion_checklist_items').select('*').eq('occasion_id', occasionId).order('sort_order').order('created_at');
  if (error) throw error;
  return (data ?? []) as ChecklistItem[];
}

export async function addChecklistItem(
  supabase: SupabaseClient, occasionId: string, label: string, required: boolean, sortOrder: number, createdBy?: string
): Promise<ChecklistItem> {
  const { data, error } = await supabase.from('occasion_checklist_items')
    .insert({ occasion_id: occasionId, label: label.trim(), required, sort_order: sortOrder, created_by: createdBy }).select('*').single();
  if (error) throw error;
  return data as ChecklistItem;
}

export async function updateChecklistItem(supabase: SupabaseClient, id: string, patch: Partial<Pick<ChecklistItem, 'label' | 'required' | 'sort_order'>>): Promise<void> {
  const { error } = await supabase.from('occasion_checklist_items').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteChecklistItem(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('occasion_checklist_items').delete().eq('id', id);
  if (error) throw error;
}

export async function markChecklist(supabase: SupabaseClient, registrationId: string, itemId: string, done: boolean): Promise<void> {
  const { error } = await supabase.rpc('occasion_checklist_mark', { p_registration: registrationId, p_item: itemId, p_done: done });
  if (error) throw error;
}

/** Default checklist suggestions offered when creating an occasion. */
export const CHECKLIST_SUGGESTIONS = ['الدفع', 'إذن ولي الأمر', 'المواصلات', 'الأغراض المطلوبة', 'الحضور'];

// ---------- Notifications ----------
export async function fetchNotifications(supabase: SupabaseClient, occasionId: string, opts: { broadcastOnly?: boolean } = {}): Promise<OccasionNotification[]> {
  let q = supabase.from('occasion_notifications').select('*').eq('occasion_id', occasionId);
  if (opts.broadcastOnly) q = q.is('registration_id', null);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as OccasionNotification[];
}

export async function sendAnnouncement(
  supabase: SupabaseClient, occasionId: string, body: string, kind: 'announcement' | 'reminder', createdBy: string
): Promise<OccasionNotification> {
  const { data, error } = await supabase.from('occasion_notifications')
    .insert({ occasion_id: occasionId, kind, body: body.trim(), created_by: createdBy, registration_id: null }).select('*').single();
  if (error) throw error;
  return data as OccasionNotification;
}

export async function deleteNotification(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('occasion_notifications').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Child portal (anon, token = national id) ----------
export interface ChildRegistration {
  id: string;
  enrollment_id: string;
  status: RegistrationStatus;
  ticket_code: string;
  source: RegistrationSource;
  registered_at: string;
  confirmed_at: string | null;
  checked_in_at: string | null;
  cancelled_at: string | null;
  note: string | null;
  checklist_total: number;
  checklist_done: number;
}

export interface ChildOccasion {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  kind: OccasionKind;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  location_url: string | null;
  organizer: string | null;
  organizer_phone: string | null;
  registration_deadline: string | null;
  capacity: number | null;
  active_count: number;
  remaining: number | null;
  auto_confirm: boolean;
  checkin_points: number;
  status: OccasionStatus;
  church_name: string;
  service_name: string | null;
  class_name: string | null;
  enrollment_id: string | null;
  can_register: boolean;
  my_registration: ChildRegistration | null;
  last_notification: { body: string; kind: NotificationKind; created_at: string } | null;
  server_now: string;
}

export interface ChildChecklistItem {
  id: string;
  label: string;
  required: boolean;
  done: boolean;
  marked_at: string | null;
}

export interface ChildNotification {
  id: string;
  kind: NotificationKind;
  body: string;
  created_at: string;
  mine: boolean;
  by_name: string | null;
}

export interface ChildOccasionDetail extends ChildOccasion {
  checklist: ChildChecklistItem[];
  notifications: ChildNotification[];
}

export async function fetchChildOccasions(supabase: SupabaseClient, token: string): Promise<ChildOccasion[]> {
  const { data, error } = await supabase.rpc('child_portal_occasions', { p_national_id: token });
  if (error) throw error;
  return (data ?? []) as ChildOccasion[];
}

export async function fetchChildOccasion(supabase: SupabaseClient, token: string, id: string): Promise<ChildOccasionDetail> {
  const { data, error } = await supabase.rpc('child_portal_occasion', { p_national_id: token, p_occasion: id });
  if (error) throw error;
  return data as ChildOccasionDetail;
}

export async function childRegister(supabase: SupabaseClient, token: string, id: string): Promise<ChildOccasion> {
  const { data, error } = await supabase.rpc('child_portal_occasion_register', { p_national_id: token, p_occasion: id });
  if (error) throw error;
  return data as ChildOccasion;
}

export async function childCancel(supabase: SupabaseClient, token: string, id: string): Promise<ChildOccasion> {
  const { data, error } = await supabase.rpc('child_portal_occasion_cancel', { p_national_id: token, p_occasion: id });
  if (error) throw error;
  return data as ChildOccasion;
}

/** Unread-ish counter for the child: occasions with a fresh notification (last 7 days) or pending action. */
export function childOccasionHighlights(list: ChildOccasion[]): { upcoming: number; open: number; withTicket: number } {
  const now = new Date();
  return {
    upcoming: list.filter((o) => o.status === 'published' && occasionPhase(o, now) !== 'past').length,
    open: list.filter((o) => o.can_register).length,
    withTicket: list.filter((o) => o.my_registration && ['confirmed', 'checked_in'].includes(o.my_registration.status) && occasionPhase(o, now) !== 'past').length,
  };
}
