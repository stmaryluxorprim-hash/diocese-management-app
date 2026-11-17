'use client';

// ---------- Achievements module (الإنجازات) — client data layer ----------
// Achievements CRUD goes straight to `achievements` (RLS scoped + module
// gated). Awarding / revoking are RPCs that re-validate every rule inside
// the database (once / multiple / max / interval / scope / permissions) and
// write the +points row through the existing points system. Attendance
// achievements are awarded automatically by a DB trigger — the client only
// displays progress.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ALL, type ScopeSelection } from '@/lib/queries';
import { classIdsOf } from '@/lib/class-multi';

// ---------- Types (mirror of migration 0031) ----------
export type AchievementKind = 'normal' | 'attendance';
export type AwardMode = 'once' | 'multiple';
export type AttendanceRule = 'count' | 'streak';
export type AwardSource = 'manual' | 'attendance';

export interface Achievement {
  id: string;
  /** rows sharing a group_id are ONE achievement covering several classes */
  group_id?: string | null;
  church_id: string;
  service_id: string | null;   // null = all services
  class_id: string | null;     // null = all classes
  event_id: string | null;     // null = any event
  name: string;
  description: string | null;
  image_url: string | null;
  points: number;
  is_active: boolean;
  kind: AchievementKind;
  award_mode: AwardMode;
  max_awards: number | null;          // multiple: null = unlimited
  min_interval_days: number | null;   // multiple: null = no minimum
  attendance_rule: AttendanceRule | null;
  attendance_target: number | null;
  sort_order: number;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

export interface UserAchievement {
  id: string;
  achievement_id: string;
  enrollment_id: string;
  person_id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  points_awarded: number;
  awarded_at: string;
  awarded_by: string | null;   // null = automatic
  source: AwardSource;
  attendance_log_id: string | null;
  event_id: string | null;
  points_log_id: string | null;
  note: string | null;
}

/** `achievement_earners` RPC row */
export interface AchievementEarner {
  id: string;
  enrollment_id: string;
  person_id: string;
  person_name: string;
  person_image: string | null;
  national_id: string;
  class_name: string;
  service_name: string;
  church_name: string;
  points_awarded: number;
  awarded_at: string;
  awarded_by: string | null;
  awarded_by_name: string | null;
  source: AwardSource;
  event_name: string | null;
  note: string | null;
}

/** `achievement_enrollment_progress` RPC row */
export interface EnrollmentProgress {
  achievement_id: string;
  current_value: number;
  target_value: number;
  awards_count: number;
  last_awarded_at: string | null;
  eligible: boolean;
  block: ProgressBlock | null;
}

export type ProgressBlock = 'inactive' | 'out_of_scope' | 'already_awarded' | 'max_reached' | 'too_soon' | 'not_found';

export interface AchievementPermissions {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  award: boolean;
}

export const NO_PERMISSIONS: AchievementPermissions = { view: false, create: false, edit: false, delete: false, award: false };

// ---------- Labels ----------
export const KIND_LABELS: Record<AchievementKind, string> = {
  normal: 'عادي',
  attendance: 'حضور',
};
export const AWARD_MODE_LABELS: Record<AwardMode, string> = {
  once: 'مرة واحدة',
  multiple: 'عدة مرات',
};
export const RULE_LABELS: Record<AttendanceRule, string> = {
  count: 'عدد حضور',
  streak: 'حضور متتالٍ',
};
export const BLOCK_LABELS: Record<ProgressBlock, string> = {
  inactive: 'الإنجاز غير مفعّل',
  out_of_scope: 'لا ينطبق على فصل هذا المخدوم',
  already_awarded: 'مُنح بالفعل (مرة واحدة)',
  max_reached: 'وصل للحد الأقصى من المرات',
  too_soon: 'لم تمرّ المدة الأدنى منذ آخر مرة',
  not_found: 'غير موجود',
};

/** «5 حضورات» / «4 مرات متتالية» */
export function ruleLabel(a: Pick<Achievement, 'attendance_rule' | 'attendance_target'>): string {
  const n = a.attendance_target ?? 0;
  if (a.attendance_rule === 'streak') return `${n} ${n === 1 ? 'مرة' : n === 2 ? 'مرتان' : n <= 10 ? 'مرات' : 'مرة'} متتالية`;
  return `${n} ${n === 1 ? 'حضور' : n === 2 ? 'حضوران' : n <= 10 ? 'حضورات' : 'حضور'}`;
}

/** «مرة واحدة» / «عدة مرات · حد أقصى 3 · كل 7 أيام» */
export function awardModeLabel(a: Pick<Achievement, 'award_mode' | 'max_awards' | 'min_interval_days'>): string {
  if (a.award_mode === 'once') return AWARD_MODE_LABELS.once;
  const parts = [AWARD_MODE_LABELS.multiple];
  if (a.max_awards) parts.push(`حد أقصى ${a.max_awards}`);
  if (a.min_interval_days) parts.push(`كل ${a.min_interval_days} ${a.min_interval_days === 1 ? 'يوم' : a.min_interval_days <= 10 ? 'أيام' : 'يوماً'}`);
  return parts.join(' · ');
}

/** Does the achievement apply to a child's enrollment scope? */
export const achievementAppliesTo = (
  a: Pick<Achievement, 'church_id' | 'service_id' | 'class_id'>,
  e: { church_id: string; service_id: string; class_id: string }
) =>
  a.church_id === e.church_id &&
  (a.service_id === null || a.service_id === e.service_id) &&
  (a.class_id === null || a.class_id === e.class_id);

// ---------- Error mapping (RPC raise → Arabic) ----------
const ERRORS: [string, string][] = [
  ['module_not_visible', 'وحدة الإنجازات غير مفعّلة لنطاقك'],
  ['enrollment_not_found', 'المخدوم غير موجود'],
  ['achievement_not_found', 'الإنجاز غير موجود'],
  ['already_awarded', 'هذا الإنجاز يُمنح مرة واحدة فقط — وقد مُنح لهذا المخدوم بالفعل'],
  ['max_reached', 'وصل هذا المخدوم للحد الأقصى من مرات هذا الإنجاز'],
  ['too_soon', 'لم تمرّ المدة الأدنى منذ آخر مرة مُنح فيها هذا الإنجاز'],
  ['out_of_scope', 'هذا الإنجاز لا ينطبق على فصل هذا المخدوم'],
  ['event_out_of_scope', 'المناسبة المختارة خارج نطاق هذا الإنجاز'],
  ['inactive', 'هذا الإنجاز غير مفعّل'],
  ['not_found', 'غير موجود'],
  ['forbidden', 'ليس لديك صلاحية على هذه العملية'],
];

export const MIGRATION_HINT = 'تحتاج تشغيل تحديث قاعدة البيانات 0031_achievements.sql في Supabase أولاً';

export function isMigrationMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /achievements|user_achievements|achievement_/.test(msg) &&
    /does not exist|not find|schema cache|relation/i.test(msg);
}

export function achievementErrorMessage(err: unknown, fallback = 'حدث خطأ، حاول مجدداً'): string {
  const msg = (err as { message?: string } | null)?.message ?? '';
  if (!msg) return fallback;
  if (isMigrationMissing(err)) return MIGRATION_HINT;
  if (/row-level security|permission denied/i.test(msg)) return 'ليس لديك صلاحية على هذه العملية';
  if (/service does not belong|class does not belong/i.test(msg)) return 'الخدمة أو الفصل لا يتبعان الكنيسة المختارة';
  if (/achievements_attendance_cfg/.test(msg)) return 'إنجاز الحضور يحتاج نوع الشرط والعدد المطلوب';
  for (const [key, label] of ERRORS) {
    if (msg.includes(key)) return label;
  }
  return fallback;
}

// ---------- Permissions ----------
export async function fetchAchievementPermissions(supabase: SupabaseClient): Promise<AchievementPermissions> {
  const { data, error } = await supabase.rpc('achievement_permissions');
  if (error || !data) return NO_PERMISSIONS;
  return data as AchievementPermissions;
}

// ---------- CRUD ----------
export async function fetchAchievements(
  supabase: SupabaseClient,
  scope: ScopeSelection = {},
  opts: { activeOnly?: boolean } = {}
): Promise<Achievement[]> {
  let q = supabase.from('achievements').select('*');
  if (scope.church && scope.church !== ALL) q = q.eq('church_id', scope.church);
  if (opts.activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q.order('sort_order').order('name');
  if (error) throw error;
  let rows = (data ?? []) as Achievement[];
  // service / class narrowing keeps "all" rows (null) that still apply
  if (scope.service && scope.service !== ALL) rows = rows.filter((r) => r.service_id === null || r.service_id === scope.service);
  { const ids = classIdsOf(scope); if (ids.length > 0) rows = rows.filter((r) => r.class_id === null || ids.includes(r.class_id)); }
  return rows;
}

export type AchievementInput = Omit<Achievement, 'id' | 'group_id' | 'created_at' | 'created_by' | 'edited_at' | 'edited_by' | 'sort_order'>;

export async function saveAchievement(
  supabase: SupabaseClient, id: string | null, payload: AchievementInput, createdBy?: string, groupId?: string | null
): Promise<Achievement> {
  const body = groupId === undefined ? payload : { ...payload, group_id: groupId };
  const res = id
    ? await supabase.from('achievements').update(body).eq('id', id).select('*').single()
    : await supabase.from('achievements').insert({ ...body, created_by: createdBy }).select('*').single();
  if (res.error) throw res.error;
  return res.data as Achievement;
}

export async function setAchievementActive(supabase: SupabaseClient, id: string, active: boolean, groupId?: string | null): Promise<void> {
  const q = supabase.from('achievements').update({ is_active: active });
  const { error } = groupId ? await q.eq('group_id', groupId) : await q.eq('id', id);
  if (error) throw error;
}

export async function deleteAchievement(supabase: SupabaseClient, id: string, groupId?: string | null): Promise<void> {
  const q = supabase.from('achievements').delete({ count: 'exact' });
  const { error, count } = groupId ? await q.eq('group_id', groupId) : await q.eq('id', id);
  if (error) throw error;
  if (count === 0) throw new Error('forbidden');
}

// ---------- Awards ----------
export async function fetchEarners(supabase: SupabaseClient, achievementId: string): Promise<AchievementEarner[]> {
  const { data, error } = await supabase.rpc('achievement_earners', { p_achievement: achievementId });
  if (error) throw error;
  return (data ?? []) as AchievementEarner[];
}

/** Count of awards per achievement (for the list badges). RLS-scoped. */
export async function fetchAwardCounts(supabase: SupabaseClient, ids: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (ids.length === 0) return m;
  const { data, error } = await supabase.from('user_achievements').select('achievement_id').in('achievement_id', ids).limit(5000);
  if (error) return m;
  ((data ?? []) as { achievement_id: string }[]).forEach((r) => m.set(r.achievement_id, (m.get(r.achievement_id) ?? 0) + 1));
  return m;
}

export async function fetchEnrollmentProgress(supabase: SupabaseClient, enrollmentId: string): Promise<EnrollmentProgress[]> {
  const { data, error } = await supabase.rpc('achievement_enrollment_progress', { p_enrollment: enrollmentId });
  if (error) throw error;
  return (data ?? []) as EnrollmentProgress[];
}

export async function fetchEnrollmentAwards(supabase: SupabaseClient, enrollmentId: string): Promise<UserAchievement[]> {
  const { data, error } = await supabase
    .from('user_achievements').select('*').eq('enrollment_id', enrollmentId).order('awarded_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as UserAchievement[];
}

export async function awardAchievement(
  supabase: SupabaseClient, achievementId: string, enrollmentId: string, note?: string
): Promise<{ award_id: string; points: number; balance_after: number }> {
  const { data, error } = await supabase.rpc('achievement_award', {
    p_achievement: achievementId, p_enrollment: enrollmentId, p_note: note?.trim() || null,
  });
  if (error) throw error;
  return data as { award_id: string; points: number; balance_after: number };
}

export async function revokeAchievement(
  supabase: SupabaseClient, awardId: string, note?: string
): Promise<{ award_id: string; refunded: number; balance_after: number }> {
  const { data, error } = await supabase.rpc('achievement_revoke', { p_award: awardId, p_note: note?.trim() || null });
  if (error) throw error;
  return data as { award_id: string; refunded: number; balance_after: number };
}

// ---------- Child portal (anon, token = national id) ----------
export interface ChildEarnedAchievement {
  id: string;
  achievement_id: string;
  enrollment_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  kind: AchievementKind;
  points: number;
  awarded_at: string;
  source: AwardSource;
  event_name: string | null;
  class_name: string;
  service_name: string;
  church_name: string;
}

export interface ChildAchievementProgress {
  achievement_id: string;
  enrollment_id: string;
  class_name: string;
  name: string;
  description: string | null;
  image_url: string | null;
  points: number;
  rule: AttendanceRule;
  current: number;
  target: number;
  awards_count: number;
  event_name: string | null;
}

/** One ACTIVE achievement that applies to one of the child's enrollments (migration 20261020120000). */
export interface ChildCatalogItem {
  achievement_id: string;
  enrollment_id: string;
  class_name: string;
  name: string;
  description: string | null;
  image_url: string | null;
  points: number;
  kind: AchievementKind;
  award_mode: AwardMode;
  max_awards: number | null;
  min_interval_days: number | null;
  rule: AttendanceRule | null;
  /** attendance achievements only (null for normal ones) */
  target: number | null;
  current: number | null;
  /** how many times HE got it (0 = not achieved yet) */
  awards_count: number;
  last_awarded_at: string | null;
  block: ProgressBlock | null;
  event_name: string | null;
}

export interface ChildAchievements {
  earned: ChildEarnedAchievement[];
  progress: ChildAchievementProgress[];
  /** every available achievement of his scope — absent until migration 20261020120000 is applied */
  catalog?: ChildCatalogItem[];
}

export async function fetchChildAchievements(supabase: SupabaseClient, token: string): Promise<ChildAchievements> {
  const { data, error } = await supabase.rpc('child_portal_achievements', { p_national_id: token });
  if (error) throw error;
  const d = (data ?? {}) as Partial<ChildAchievements>;
  return { earned: d.earned ?? [], progress: d.progress ?? [], ...(Array.isArray(d.catalog) ? { catalog: d.catalog } : {}) };
}
