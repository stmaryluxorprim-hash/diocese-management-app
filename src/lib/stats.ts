'use client';

// ---------- Statistics data layer (migration 0020) ----------
// Typed wrappers around the stats_* RPCs plus the period / bucket helpers
// the الإحصائيات tab uses. Every function returns AGGREGATES only — the
// browser never downloads attendance_log / points_log rows.
//
// Scope: church / service / class, each either a uuid or ALL ('all').
// ALL is sent to the RPC as null (= no filter). RLS still narrows the
// result to what the caller may see.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ALL, type ScopeSelection } from '@/lib/queries';
import { cairoToday } from '@/lib/time';
import { reads, type ReadOpts } from '@/lib/cached-reads';
import { classRpcArgs } from '@/lib/class-multi';

// ---------- Row shapes returned by the RPCs ----------

export interface ScopeSummary {
  enrollments: number;
  persons: number;
  males: number;
  females: number;
  total_attendance: number;
  total_points: number;
  attendance_points: number;
  cause_points_added: number;
  cause_points_removed: number;
  events_count: number;
  causes_count: number;
  classes_count: number;
  first_attendance: string | null;
  last_attendance: string | null;
}

export interface DaySummary {
  attendance: number;
  attendees: number;
  events_attended: number;
  attendance_points: number;
  cause_points_added: number;
  cause_points_removed: number;
  cause_entries: number;
  causes_used: number;
  scope_persons: number;
}

export type ScopeLevel = 'church' | 'service' | 'class';

export interface EventDayRow {
  event_id: string | null;
  event_name: string;
  church_id: string | null;
  event_scope: ScopeLevel;
  attendance: number;
  attendees: number;
  points: number;
  eligible: number;
  first_at: string | null;
  last_at: string | null;
}

export interface CauseDayRow {
  cause_id: string | null;
  cause_name: string;
  church_id: string | null;
  cause_scope: ScopeLevel;
  entries: number;
  recipients: number;
  added: number;
  removed: number;
  net: number;
  first_at: string | null;
  last_at: string | null;
}

export interface AttendanceTimelineRow {
  bucket: string; // 'YYYY-MM-DD' first day of the bucket
  event_id: string | null;
  event_name: string;
  church_id: string | null;
  attendance: number;
  attendees: number;
  points: number;
}

export interface PointsTimelineRow {
  bucket: string;
  cause_id: string | null;
  cause_name: string;
  church_id: string | null;
  entries: number;
  added: number;
  removed: number;
  net: number;
}

export interface ClassDayRow {
  class_id: string;
  class_name: string;
  service_name: string;
  church_name: string;
  enrolled: number;
  attendees: number;
  attendance: number;
  points: number;
}

export interface LeaderRow {
  enrollment_id: string;
  person_id: string;
  name: string;
  image_url: string | null;
  class_name: string | null;
  points: number;
  attendance_count: number;
}

export interface WeekdayRow {
  weekday: number; // 0 = Sunday .. 6 = Saturday
  attendance: number;
  days_with_attendance: number;
}

// ---------- Period / bucket model ----------

export type Bucket = 'day' | 'week' | 'month';

export const BUCKET_LABELS: Record<Bucket, string> = {
  day: 'يومي',
  week: 'أسبوعي',
  month: 'شهري',
};

/** Preset periods, all ending at the selected day (inclusive). */
export type PeriodPreset = '7d' | '30d' | '90d' | '180d' | '365d' | 'custom';

export const PERIOD_PRESETS: { value: PeriodPreset; label: string; days: number; bucket: Bucket }[] = [
  { value: '7d', label: '7 أيام', days: 7, bucket: 'day' },
  { value: '30d', label: '30 يوم', days: 30, bucket: 'day' },
  { value: '90d', label: '3 أشهر', days: 90, bucket: 'week' },
  { value: '180d', label: '6 أشهر', days: 180, bucket: 'week' },
  { value: '365d', label: 'سنة', days: 365, bucket: 'month' },
];

export interface Period {
  from: string; // 'YYYY-MM-DD'
  to: string; // 'YYYY-MM-DD' inclusive
  bucket: Bucket;
}

/** Shift a 'YYYY-MM-DD' calendar day by N days (pure calendar math, UTC). */
export function shiftDay(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Period ending at `to` covering `days` days (inclusive). */
export function periodEndingAt(to: string, days: number, bucket: Bucket): Period {
  return { from: shiftDay(to, -(days - 1)), to, bucket };
}

/** Monday-start ISO week (matches Postgres date_trunc('week')). */
function startOfWeek(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 = Sun
  const back = (dow + 6) % 7; // Mon → 0, Sun → 6
  return shiftDay(ymd, -back);
}

function startOfMonth(ymd: string): string {
  return ymd.slice(0, 7) + '-01';
}

function addMonths(ymd: string, n: number): string {
  const [y, m] = ymd.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

/**
 * All bucket start days between from..to (inclusive), so charts show
 * zero-height bars for empty buckets instead of skipping them.
 */
export function bucketKeys(period: Period): string[] {
  const out: string[] = [];
  if (period.bucket === 'day') {
    for (let k = period.from; k <= period.to; k = shiftDay(k, 1)) out.push(k);
  } else if (period.bucket === 'week') {
    for (let k = startOfWeek(period.from); k <= period.to; k = shiftDay(k, 7)) out.push(k);
  } else {
    for (let k = startOfMonth(period.from); k <= period.to; k = addMonths(k, 1)) out.push(k);
  }
  return out;
}

/** Short Arabic label for a bucket start day. */
export function bucketLabel(key: string, bucket: Bucket): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (bucket === 'month') {
    return new Intl.DateTimeFormat('ar-EG', { timeZone: 'UTC', month: 'short', year: '2-digit' }).format(dt);
  }
  return new Intl.DateTimeFormat('ar-EG', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(dt);
}

/** Long Arabic label for a bucket (tooltip / detail line). */
export function bucketLongLabel(key: string, bucket: Bucket): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (bucket === 'month') {
    return new Intl.DateTimeFormat('ar-EG', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(dt);
  }
  if (bucket === 'week') {
    const end = shiftDay(key, 6);
    const [ey, em, ed] = end.split('-').map(Number);
    const f = new Intl.DateTimeFormat('ar-EG', { timeZone: 'UTC', day: 'numeric', month: 'short' });
    return `أسبوع ${f.format(dt)} → ${f.format(new Date(Date.UTC(ey, em - 1, ed)))}`;
  }
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(dt);
}

/** Full Arabic date for a 'YYYY-MM-DD' Cairo day. */
export function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** 'hh:mm ص/م' in Cairo for a timestamptz string. */
export function formatClock(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

// ---------- RPC wrappers ----------

const nz = (v: unknown) => Number(v ?? 0);

function scopeArgs(scope: ScopeSelection) {
  return {
    p_church: scope.church && scope.church !== ALL ? scope.church : null,
    p_service: scope.service && scope.service !== ALL ? scope.service : null,
    ...classRpcArgs(scope),
  };
}

export async function fetchScopeSummary(
  supabase: SupabaseClient, scope: ScopeSelection, opts: ReadOpts = {}
): Promise<ScopeSummary> {
  const data = await reads.rpc(supabase, 'stats_scope_summary', scopeArgs(scope), { ...opts, prefixErrors: true });
  const r = (data as Record<string, unknown>[] | null)?.[0] ?? {};
  return {
    enrollments: nz(r.enrollments),
    persons: nz(r.persons),
    males: nz(r.males),
    females: nz(r.females),
    total_attendance: nz(r.total_attendance),
    total_points: nz(r.total_points),
    attendance_points: nz(r.attendance_points),
    cause_points_added: nz(r.cause_points_added),
    cause_points_removed: nz(r.cause_points_removed),
    events_count: nz(r.events_count),
    causes_count: nz(r.causes_count),
    classes_count: nz(r.classes_count),
    first_attendance: (r.first_attendance as string | null) ?? null,
    last_attendance: (r.last_attendance as string | null) ?? null,
  };
}

export async function fetchDaySummary(
  supabase: SupabaseClient, day: string, scope: ScopeSelection, opts: ReadOpts = {}): Promise<DaySummary> {
  const data = await reads.rpc(supabase, 'stats_day_summary', { p_day: day, ...scopeArgs(scope) }, { ...opts, prefixErrors: true });
  const r = (data as Record<string, unknown>[] | null)?.[0] ?? {};
  return {
    attendance: nz(r.attendance),
    attendees: nz(r.attendees),
    events_attended: nz(r.events_attended),
    attendance_points: nz(r.attendance_points),
    cause_points_added: nz(r.cause_points_added),
    cause_points_removed: nz(r.cause_points_removed),
    cause_entries: nz(r.cause_entries),
    causes_used: nz(r.causes_used),
    scope_persons: nz(r.scope_persons),
  };
}

export async function fetchAttendanceByEvent(
  supabase: SupabaseClient, day: string, scope: ScopeSelection, opts: ReadOpts = {}): Promise<EventDayRow[]> {
  const data = await reads.rpc(supabase, 'stats_attendance_by_event', { p_day: day, ...scopeArgs(scope) }, { ...opts, prefixErrors: true });
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    event_id: (r.event_id as string | null) ?? null,
    event_name: String(r.event_name ?? ''),
    church_id: (r.church_id as string | null) ?? null,
    event_scope: (r.event_scope as ScopeLevel) ?? 'church',
    attendance: nz(r.attendance),
    attendees: nz(r.attendees),
    points: nz(r.points),
    eligible: nz(r.eligible),
    first_at: (r.first_at as string | null) ?? null,
    last_at: (r.last_at as string | null) ?? null,
  }));
}

export async function fetchPointsByCause(
  supabase: SupabaseClient, day: string, scope: ScopeSelection, opts: ReadOpts = {}): Promise<CauseDayRow[]> {
  const data = await reads.rpc(supabase, 'stats_points_by_cause', { p_day: day, ...scopeArgs(scope) }, { ...opts, prefixErrors: true });
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    cause_id: (r.cause_id as string | null) ?? null,
    cause_name: String(r.cause_name ?? ''),
    church_id: (r.church_id as string | null) ?? null,
    cause_scope: (r.cause_scope as ScopeLevel) ?? 'church',
    entries: nz(r.entries),
    recipients: nz(r.recipients),
    added: nz(r.added),
    removed: nz(r.removed),
    net: nz(r.net),
    first_at: (r.first_at as string | null) ?? null,
    last_at: (r.last_at as string | null) ?? null,
  }));
}

export async function fetchAttendanceTimeline(
  supabase: SupabaseClient, period: Period, scope: ScopeSelection, opts: ReadOpts = {}): Promise<AttendanceTimelineRow[]> {
  const data = await reads.rpc(supabase, 'stats_attendance_timeline', {
    p_from: period.from, p_to: period.to, p_bucket: period.bucket, ...scopeArgs(scope),
  }, { ...opts, prefixErrors: true });
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    bucket: String(r.bucket),
    event_id: (r.event_id as string | null) ?? null,
    event_name: String(r.event_name ?? ''),
    church_id: (r.church_id as string | null) ?? null,
    attendance: nz(r.attendance),
    attendees: nz(r.attendees),
    points: nz(r.points),
  }));
}

export async function fetchPointsTimeline(
  supabase: SupabaseClient, period: Period, scope: ScopeSelection, opts: ReadOpts = {}): Promise<PointsTimelineRow[]> {
  const data = await reads.rpc(supabase, 'stats_points_timeline', {
    p_from: period.from, p_to: period.to, p_bucket: period.bucket, ...scopeArgs(scope),
  }, { ...opts, prefixErrors: true });
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    bucket: String(r.bucket),
    cause_id: (r.cause_id as string | null) ?? null,
    cause_name: String(r.cause_name ?? ''),
    church_id: (r.church_id as string | null) ?? null,
    entries: nz(r.entries),
    added: nz(r.added),
    removed: nz(r.removed),
    net: nz(r.net),
  }));
}

export async function fetchAttendanceByClass(
  supabase: SupabaseClient, day: string, scope: ScopeSelection, opts: ReadOpts = {}): Promise<ClassDayRow[]> {
  const data = await reads.rpc(supabase, 'stats_attendance_by_class', { p_day: day, ...scopeArgs(scope) }, { ...opts, prefixErrors: true });
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    class_id: String(r.class_id),
    class_name: String(r.class_name ?? ''),
    service_name: String(r.service_name ?? ''),
    church_name: String(r.church_name ?? ''),
    enrolled: nz(r.enrolled),
    attendees: nz(r.attendees),
    attendance: nz(r.attendance),
    points: nz(r.points),
  }));
}

export async function fetchLeaderboard(
  supabase: SupabaseClient, by: 'points' | 'attendance', limit: number, scope: ScopeSelection, opts: ReadOpts = {}): Promise<LeaderRow[]> {
  const data = await reads.rpc(supabase, 'stats_leaderboard_scoped', {
    p_by: by, p_limit: limit, ...scopeArgs(scope),
  }, { ...opts, prefixErrors: true });
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    enrollment_id: String(r.enrollment_id),
    person_id: String(r.person_id),
    name: String(r.name ?? ''),
    image_url: (r.image_url as string | null) ?? null,
    class_name: (r.class_name as string | null) ?? null,
    points: nz(r.points),
    attendance_count: nz(r.attendance_count),
  }));
}

export async function fetchWeekdayProfile(
  supabase: SupabaseClient, period: Period, scope: ScopeSelection, opts: ReadOpts = {}): Promise<WeekdayRow[]> {
  const data = await reads.rpc(supabase, 'stats_weekday_profile', {
    p_from: period.from, p_to: period.to, ...scopeArgs(scope),
  }, { ...opts, prefixErrors: true });
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    weekday: nz(r.weekday),
    attendance: nz(r.attendance),
    days_with_attendance: nz(r.days_with_attendance),
  }));
}

// ---------- Series building for the timeline chart ----------

export interface Series {
  key: string; // event_id / cause_id or 'none'
  label: string;
  total: number;
  values: number[]; // aligned with bucketKeys(period)
}

/** Distinct, high-contrast palette for up to 10 series (then cycles). */
export const SERIES_PALETTE = [
  '#4f46e5', // indigo
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ec4899', // pink
  '#0ea5e9', // sky
  '#8b5cf6', // violet
  '#f97316', // orange
  '#14b8a6', // teal
  '#ef4444', // red
  '#84cc16', // lime
];

export function seriesColor(i: number): string {
  return SERIES_PALETTE[i % SERIES_PALETTE.length];
}

/**
 * Pivot timeline rows into one series per event (or cause), aligned with
 * the bucket keys. Same-named items from different churches get the
 * church name appended so the legend is unambiguous.
 */
export function buildSeries<T extends { bucket: string; church_id: string | null }>(
  rows: T[],
  keys: string[],
  pick: (r: T) => { id: string | null; name: string; value: number },
  churchNames: Record<string, string>
): Series[] {
  const idx = new Map(keys.map((k, i) => [k, i]));
  const map = new Map<string, Series>();
  const nameCount = new Map<string, Set<string>>();
  rows.forEach((r) => {
    const { id, name } = pick(r);
    const set = nameCount.get(name) ?? new Set<string>();
    set.add(id ?? 'none');
    nameCount.set(name, set);
  });
  rows.forEach((r) => {
    const { id, name, value } = pick(r);
    const key = id ?? 'none';
    let s = map.get(key);
    if (!s) {
      const dup = (nameCount.get(name)?.size ?? 0) > 1;
      const church = r.church_id ? churchNames[r.church_id] : undefined;
      s = { key, label: dup && church ? `${name} — ${church}` : name, total: 0, values: keys.map(() => 0) };
      map.set(key, s);
    }
    const i = idx.get(r.bucket);
    if (i !== undefined) {
      s.values[i] += value;
      s.total += value;
    }
  });
  return Array.from(map.values()).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'ar'));
}

/** Today's Cairo day — re-exported so the page has one import for dates. */
export const todayKey = () => cairoToday();

/** Percent helper: 0..100 rounded, safe for zero denominators. */
export const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);
