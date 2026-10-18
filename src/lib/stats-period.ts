'use client';

// =====================================================================
// 20261018120000 — the four-tab statistics page (data layer)
//
//   نظرة عامة  → lib/stats.ts (0020 / 0042 RPCs, unchanged)
//   الحضور · النقاط · الافتقاد → PERIOD analytics (p_from..p_to, Cairo days)
//   inside a scope (church / service / class) and optionally ONE event.
//
// Same conventions as lib/stats.ts: every function returns AGGREGATES
// only, ALL → null, the DB applies the caller's visibility.
// =====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { ALL, type ScopeSelection } from '@/lib/queries';
import { shiftDay, formatDay, type Bucket, type Period } from '@/lib/stats';

const nz = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

function throwIf(error: { message: string } | null, fn: string) {
  if (error) throw new Error(`${fn}: ${error.message}`);
}

/** Scope + optional event + kind — the common argument set of the period RPCs. */
export interface StatsFilter extends ScopeSelection {
  event?: string | null; // event id, or null / ALL = every event
  kind?: 'child' | 'servant' | 'all';
}

function filterArgs(f: StatsFilter) {
  return {
    p_church: f.church && f.church !== ALL ? f.church : null,
    p_service: f.service && f.service !== ALL ? f.service : null,
    p_class: f.class && f.class !== ALL ? f.class : null,
    p_event: f.event && f.event !== ALL ? f.event : null,
    p_kind: f.kind ?? 'child',
  };
}

// ---------- Calendar windows: اليوم · هذا الأسبوع · هذا الشهر · هذه السنة ----------

/** Monday-start week containing `ymd` (matches Postgres date_trunc('week')). */
export function weekOf(ymd: string): { from: string; to: string } {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const from = shiftDay(ymd, -((dow + 6) % 7));
  return { from, to: shiftDay(from, 6) };
}

export function monthOf(ymd: string): { from: string; to: string } {
  const [y, m] = ymd.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { from, to: shiftDay(next, -1) };
}

export function yearOf(ymd: string): { from: string; to: string } {
  return { from: `${ymd.slice(0, 4)}-01-01`, to: `${ymd.slice(0, 4)}-12-31` };
}

export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1;
}

/** Window presets of the detail tabs. */
export type WindowPreset = 'day' | 'week' | 'month' | '30d' | '90d' | 'year' | 'custom';

export const WINDOW_PRESETS: { value: WindowPreset; label: string }[] = [
  { value: 'day', label: 'اليوم' },
  { value: 'week', label: 'هذا الأسبوع' },
  { value: 'month', label: 'هذا الشهر' },
  { value: '30d', label: '30 يوم' },
  { value: '90d', label: '3 أشهر' },
  { value: 'year', label: 'هذه السنة' },
];

/**
 * Resolve a preset around the selected day. `to` is capped at the live
 * Cairo today so an open week / month never asks about the future.
 */
export function resolveWindow(
  preset: WindowPreset, day: string, custom: { from: string; to: string }, today: string
): Period {
  let from: string, to: string, bucket: Bucket = 'day';
  switch (preset) {
    case 'day': from = day; to = day; break;
    case 'week': ({ from, to } = weekOf(day)); break;
    case 'month': ({ from, to } = monthOf(day)); break;
    case '30d': from = shiftDay(day, -29); to = day; break;
    case '90d': from = shiftDay(day, -89); to = day; bucket = 'week'; break;
    case 'year': ({ from, to } = yearOf(day)); bucket = 'month'; break;
    default: {
      from = custom.from <= custom.to ? custom.from : custom.to;
      to = custom.from <= custom.to ? custom.to : custom.from;
      const span = daysBetween(from, to);
      bucket = span > 120 ? 'month' : span > 45 ? 'week' : 'day';
    }
  }
  if (to > today) to = today;
  if (from > to) from = to;
  return { from, to, bucket };
}

/** «١٢ أكتوبر ٢٠٢٦ ← ١٨ أكتوبر ٢٠٢٦» or the full day when from = to. */
export function windowLabel(p: { from: string; to: string }): string {
  if (p.from === p.to) return formatDay(p.from);
  const f = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Intl.DateTimeFormat('ar-EG', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)));
  };
  return `${f(p.from)} ← ${f(p.to)}`;
}

/** 'd MMM hh:mm' Cairo for the «آخر مكالمة» columns. */
export function formatDateTimeShort(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

/** Pivot single-metric timeline rows onto the bucket keys (zero-filled). */
export function alignToKeys<T extends { bucket: string }>(rows: T[], keys: string[], pick: (r: T) => number): number[] {
  const idx = new Map(keys.map((k, i) => [k, i]));
  const out = keys.map(() => 0);
  rows.forEach((r) => { const i = idx.get(r.bucket); if (i !== undefined) out[i] += pick(r); });
  return out;
}

export const ROLE_LABELS: Record<string, string> = {
  owner: 'مالك التطبيق',
  church_manager: 'مدير كنيسة',
  service_manager: 'مسؤول خدمة',
  class_servant: 'خادم فصل',
};

// =====================================================================
// A. الافتقاد — calls
// =====================================================================

export interface CallsSummary {
  calls: number; dials: number; feedbacks: number; other_feedbacks: number;
  persons_called: number; persons_feedback: number;
  messages: number; persons_messaged: number;
  servants: number; days_with_calls: number; scope_persons: number;
  absentees: number; absentees_called: number; attendees_called: number;
  first_call: string | null; last_call: string | null;
}

export interface CallsByServantRow {
  servant_id: string | null; servant_name: string; photo_url: string | null; role: string | null; class_name: string | null;
  calls: number; persons_called: number; feedbacks: number; other_feedbacks: number; messages: number;
  classes_touched: number; days_active: number; first_call: string | null; last_call: string | null;
}

export interface CallsByClassRow {
  class_id: string; class_name: string; service_name: string; church_name: string;
  enrolled: number; absentees: number; calls: number; persons_called: number; absentees_called: number;
  feedbacks: number; persons_feedback: number; messages: number; servants: number; last_call: string | null;
}

export interface CallsByFeedbackRow {
  feedback_id: string | null; feedback_kind: 'feedback' | 'other' | 'none';
  feedback_name: string; color: string; icon: string;
  entries: number; persons: number; servants: number; last_at: string | null;
}

export interface CallsTimelineRow { bucket: string; calls: number; persons: number; feedbacks: number; messages: number; servants: number }

export type CallsPersonsFilter = 'all' | 'called' | 'not_called' | 'absent' | 'absent_not_called';

export interface CallsPersonRow {
  enrollment_id: string; person_id: string; name: string; phone: string | null; image_url: string | null; class_name: string | null;
  attended: number; calls: number; feedbacks: number;
  last_call_at: string | null; last_caller: string | null; last_feedback: string | null; last_feedback_color: string | null;
}

export async function fetchCallsSummary(supabase: SupabaseClient, p: Period, f: StatsFilter): Promise<CallsSummary> {
  const { data, error } = await supabase.rpc('stats_calls_summary', { p_from: p.from, p_to: p.to, ...filterArgs(f) });
  throwIf(error, 'stats_calls_summary');
  const r = (data as Record<string, unknown>[] | null)?.[0] ?? {};
  return {
    calls: nz(r.calls), dials: nz(r.dials), feedbacks: nz(r.feedbacks), other_feedbacks: nz(r.other_feedbacks),
    persons_called: nz(r.persons_called), persons_feedback: nz(r.persons_feedback),
    messages: nz(r.messages), persons_messaged: nz(r.persons_messaged),
    servants: nz(r.servants), days_with_calls: nz(r.days_with_calls), scope_persons: nz(r.scope_persons),
    absentees: nz(r.absentees), absentees_called: nz(r.absentees_called), attendees_called: nz(r.attendees_called),
    first_call: str(r.first_call), last_call: str(r.last_call),
  };
}

export async function fetchCallsByServant(supabase: SupabaseClient, p: Period, f: StatsFilter): Promise<CallsByServantRow[]> {
  const { data, error } = await supabase.rpc('stats_calls_by_servant', { p_from: p.from, p_to: p.to, ...filterArgs(f) });
  throwIf(error, 'stats_calls_by_servant');
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    servant_id: str(r.servant_id), servant_name: String(r.servant_name ?? ''), photo_url: str(r.photo_url),
    role: str(r.role), class_name: str(r.class_name),
    calls: nz(r.calls), persons_called: nz(r.persons_called), feedbacks: nz(r.feedbacks), other_feedbacks: nz(r.other_feedbacks),
    messages: nz(r.messages), classes_touched: nz(r.classes_touched), days_active: nz(r.days_active),
    first_call: str(r.first_call), last_call: str(r.last_call),
  }));
}

export async function fetchCallsByClass(supabase: SupabaseClient, p: Period, f: StatsFilter): Promise<CallsByClassRow[]> {
  const { data, error } = await supabase.rpc('stats_calls_by_class', { p_from: p.from, p_to: p.to, ...filterArgs(f) });
  throwIf(error, 'stats_calls_by_class');
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    class_id: String(r.class_id), class_name: String(r.class_name ?? ''), service_name: String(r.service_name ?? ''), church_name: String(r.church_name ?? ''),
    enrolled: nz(r.enrolled), absentees: nz(r.absentees), calls: nz(r.calls), persons_called: nz(r.persons_called),
    absentees_called: nz(r.absentees_called), feedbacks: nz(r.feedbacks), persons_feedback: nz(r.persons_feedback),
    messages: nz(r.messages), servants: nz(r.servants), last_call: str(r.last_call),
  }));
}

export async function fetchCallsByFeedback(supabase: SupabaseClient, p: Period, f: StatsFilter): Promise<CallsByFeedbackRow[]> {
  const { data, error } = await supabase.rpc('stats_calls_by_feedback', { p_from: p.from, p_to: p.to, ...filterArgs(f) });
  throwIf(error, 'stats_calls_by_feedback');
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    feedback_id: str(r.feedback_id), feedback_kind: (r.feedback_kind as CallsByFeedbackRow['feedback_kind']) ?? 'none',
    feedback_name: String(r.feedback_name ?? ''), color: String(r.color ?? '#94a3b8'), icon: String(r.icon ?? 'phone'),
    entries: nz(r.entries), persons: nz(r.persons), servants: nz(r.servants), last_at: str(r.last_at),
  }));
}

export async function fetchCallsTimeline(supabase: SupabaseClient, p: Period, f: StatsFilter): Promise<CallsTimelineRow[]> {
  const { data, error } = await supabase.rpc('stats_calls_timeline', { p_from: p.from, p_to: p.to, p_bucket: p.bucket, ...filterArgs(f) });
  throwIf(error, 'stats_calls_timeline');
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    bucket: String(r.bucket), calls: nz(r.calls), persons: nz(r.persons), feedbacks: nz(r.feedbacks), messages: nz(r.messages), servants: nz(r.servants),
  }));
}

export async function fetchCallsPersons(
  supabase: SupabaseClient, p: Period, f: StatsFilter, only: CallsPersonsFilter, limit = 300
): Promise<CallsPersonRow[]> {
  const { data, error } = await supabase.rpc('stats_calls_persons', { p_from: p.from, p_to: p.to, ...filterArgs(f), p_only: only, p_limit: limit });
  throwIf(error, 'stats_calls_persons');
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    enrollment_id: String(r.enrollment_id), person_id: String(r.person_id), name: String(r.name ?? ''),
    phone: str(r.phone), image_url: str(r.image_url), class_name: str(r.class_name),
    attended: nz(r.attended), calls: nz(r.calls), feedbacks: nz(r.feedbacks),
    last_call_at: str(r.last_call_at), last_caller: str(r.last_caller), last_feedback: str(r.last_feedback), last_feedback_color: str(r.last_feedback_color),
  }));
}

// =====================================================================
// B. الحضور — attendance over a period
// =====================================================================

export interface AttendancePeriodSummary {
  attendance: number; attendees: number; scope_persons: number; never_attended: number;
  days_with_attendance: number; expected_occurrences: number; avg_per_day: number; avg_per_person: number;
  best_day: string | null; best_day_count: number; worst_day: string | null; worst_day_count: number;
  points: number; males_attended: number; females_attended: number; events_used: number; servants: number;
}

export interface DistributionRow { times: number; persons: number }
export interface HourRow { hour: number; attendance: number; days: number }

export interface ClassPeriodRow {
  class_id: string; class_name: string; service_name: string; church_name: string;
  enrolled: number; attendees: number; attendance: number; days: number; points: number; avg_per_day: number;
}

export interface AttendancePersonRow {
  enrollment_id: string; person_id: string; name: string; image_url: string | null; class_name: string | null;
  attendance: number; first_day: string | null; last_day: string | null; days_since_last: number | null;
  total_attendance: number; points: number;
}

export async function fetchAttendancePeriodSummary(supabase: SupabaseClient, p: Period, f: StatsFilter): Promise<AttendancePeriodSummary> {
  const { data, error } = await supabase.rpc('stats_attendance_period_summary', { p_from: p.from, p_to: p.to, ...filterArgs(f) });
  throwIf(error, 'stats_attendance_period_summary');
  const r = (data as Record<string, unknown>[] | null)?.[0] ?? {};
  return {
    attendance: nz(r.attendance), attendees: nz(r.attendees), scope_persons: nz(r.scope_persons), never_attended: nz(r.never_attended),
    days_with_attendance: nz(r.days_with_attendance), expected_occurrences: nz(r.expected_occurrences),
    avg_per_day: Number(r.avg_per_day ?? 0), avg_per_person: Number(r.avg_per_person ?? 0),
    best_day: str(r.best_day), best_day_count: nz(r.best_day_count), worst_day: str(r.worst_day), worst_day_count: nz(r.worst_day_count),
    points: nz(r.points), males_attended: nz(r.males_attended), females_attended: nz(r.females_attended),
    events_used: nz(r.events_used), servants: nz(r.servants),
  };
}

export async function fetchAttendanceDistribution(supabase: SupabaseClient, p: Period, f: StatsFilter): Promise<DistributionRow[]> {
  const { data, error } = await supabase.rpc('stats_attendance_distribution', { p_from: p.from, p_to: p.to, ...filterArgs(f) });
  throwIf(error, 'stats_attendance_distribution');
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({ times: nz(r.times), persons: nz(r.persons) }));
}

export async function fetchAttendanceHourProfile(supabase: SupabaseClient, p: Period, f: StatsFilter): Promise<HourRow[]> {
  const { data, error } = await supabase.rpc('stats_attendance_hour_profile', { p_from: p.from, p_to: p.to, ...filterArgs(f) });
  throwIf(error, 'stats_attendance_hour_profile');
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({ hour: nz(r.hour), attendance: nz(r.attendance), days: nz(r.days) }));
}

export async function fetchAttendanceByClassPeriod(supabase: SupabaseClient, p: Period, f: StatsFilter): Promise<ClassPeriodRow[]> {
  const { data, error } = await supabase.rpc('stats_attendance_by_class_period', { p_from: p.from, p_to: p.to, ...filterArgs(f) });
  throwIf(error, 'stats_attendance_by_class_period');
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    class_id: String(r.class_id), class_name: String(r.class_name ?? ''), service_name: String(r.service_name ?? ''), church_name: String(r.church_name ?? ''),
    enrolled: nz(r.enrolled), attendees: nz(r.attendees), attendance: nz(r.attendance), days: nz(r.days), points: nz(r.points),
    avg_per_day: Number(r.avg_per_day ?? 0),
  }));
}

export async function fetchAttendancePersons(
  supabase: SupabaseClient, p: Period, f: StatsFilter, order: 'most' | 'least', limit = 10
): Promise<AttendancePersonRow[]> {
  const { data, error } = await supabase.rpc('stats_attendance_persons', { p_from: p.from, p_to: p.to, ...filterArgs(f), p_order: order, p_limit: limit });
  throwIf(error, 'stats_attendance_persons');
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    enrollment_id: String(r.enrollment_id), person_id: String(r.person_id), name: String(r.name ?? ''),
    image_url: str(r.image_url), class_name: str(r.class_name),
    attendance: nz(r.attendance), first_day: str(r.first_day), last_day: str(r.last_day),
    days_since_last: r.days_since_last === null || r.days_since_last === undefined ? null : nz(r.days_since_last),
    total_attendance: nz(r.total_attendance), points: nz(r.points),
  }));
}

// =====================================================================
// C. النقاط — points over a period
// =====================================================================

export interface PointsPeriodSummary {
  attendance_points: number; cause_added: number; cause_removed: number; net: number; cause_entries: number;
  recipients: number; scope_persons: number; balance_total: number; balance_avg: number; balance_max: number;
  zero_balance: number; causes_used: number; servants: number; best_day: string | null; best_day_net: number;
}

export interface PointsBucketRow { bucket_from: number; bucket_to: number; persons: number }

export interface PointsClassPeriodRow {
  class_id: string; class_name: string; service_name: string; church_name: string;
  enrolled: number; attendance_points: number; cause_added: number; cause_removed: number; net: number;
  recipients: number; balance: number; avg_balance: number;
}

export interface PointsByServantRow {
  servant_id: string | null; servant_name: string; photo_url: string | null; role: string | null;
  entries: number; added: number; removed: number; net: number; recipients: number;
  attendance_scans: number; attendance_points: number; last_at: string | null;
}

export interface PointsPersonRow {
  enrollment_id: string; person_id: string; name: string; image_url: string | null; class_name: string | null;
  period_attendance_points: number; period_added: number; period_removed: number; period_net: number;
  balance: number; attendance_count: number;
}

export async function fetchPointsPeriodSummary(supabase: SupabaseClient, p: Period, f: StatsFilter): Promise<PointsPeriodSummary> {
  const { data, error } = await supabase.rpc('stats_points_period_summary', { p_from: p.from, p_to: p.to, ...filterArgs(f) });
  throwIf(error, 'stats_points_period_summary');
  const r = (data as Record<string, unknown>[] | null)?.[0] ?? {};
  return {
    attendance_points: nz(r.attendance_points), cause_added: nz(r.cause_added), cause_removed: nz(r.cause_removed), net: nz(r.net),
    cause_entries: nz(r.cause_entries), recipients: nz(r.recipients), scope_persons: nz(r.scope_persons),
    balance_total: nz(r.balance_total), balance_avg: Number(r.balance_avg ?? 0), balance_max: nz(r.balance_max),
    zero_balance: nz(r.zero_balance), causes_used: nz(r.causes_used), servants: nz(r.servants),
    best_day: str(r.best_day), best_day_net: nz(r.best_day_net),
  };
}

export async function fetchPointsDistribution(supabase: SupabaseClient, step: number, f: StatsFilter): Promise<PointsBucketRow[]> {
  const { data, error } = await supabase.rpc('stats_points_distribution', { p_step: step, ...filterArgs(f) });
  throwIf(error, 'stats_points_distribution');
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({ bucket_from: nz(r.bucket_from), bucket_to: nz(r.bucket_to), persons: nz(r.persons) }));
}

export async function fetchPointsByClassPeriod(supabase: SupabaseClient, p: Period, f: StatsFilter): Promise<PointsClassPeriodRow[]> {
  const { data, error } = await supabase.rpc('stats_points_by_class_period', { p_from: p.from, p_to: p.to, ...filterArgs(f) });
  throwIf(error, 'stats_points_by_class_period');
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    class_id: String(r.class_id), class_name: String(r.class_name ?? ''), service_name: String(r.service_name ?? ''), church_name: String(r.church_name ?? ''),
    enrolled: nz(r.enrolled), attendance_points: nz(r.attendance_points), cause_added: nz(r.cause_added), cause_removed: nz(r.cause_removed),
    net: nz(r.net), recipients: nz(r.recipients), balance: nz(r.balance), avg_balance: Number(r.avg_balance ?? 0),
  }));
}

export async function fetchPointsByServant(supabase: SupabaseClient, p: Period, f: StatsFilter): Promise<PointsByServantRow[]> {
  const { data, error } = await supabase.rpc('stats_points_by_servant', { p_from: p.from, p_to: p.to, ...filterArgs(f) });
  throwIf(error, 'stats_points_by_servant');
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    servant_id: str(r.servant_id), servant_name: String(r.servant_name ?? ''), photo_url: str(r.photo_url), role: str(r.role),
    entries: nz(r.entries), added: nz(r.added), removed: nz(r.removed), net: nz(r.net), recipients: nz(r.recipients),
    attendance_scans: nz(r.attendance_scans), attendance_points: nz(r.attendance_points), last_at: str(r.last_at),
  }));
}

export async function fetchPointsPersons(
  supabase: SupabaseClient, p: Period, f: StatsFilter, order: 'period' | 'balance' | 'removed', limit = 10
): Promise<PointsPersonRow[]> {
  const { data, error } = await supabase.rpc('stats_points_persons', { p_from: p.from, p_to: p.to, ...filterArgs(f), p_order: order, p_limit: limit });
  throwIf(error, 'stats_points_persons');
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    enrollment_id: String(r.enrollment_id), person_id: String(r.person_id), name: String(r.name ?? ''),
    image_url: str(r.image_url), class_name: str(r.class_name),
    period_attendance_points: nz(r.period_attendance_points), period_added: nz(r.period_added), period_removed: nz(r.period_removed),
    period_net: nz(r.period_net), balance: nz(r.balance), attendance_count: nz(r.attendance_count),
  }));
}
