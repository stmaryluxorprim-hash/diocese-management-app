'use client';

// ---------- REPORT DATA SOURCES (مصادر البيانات) ----------
// ONE registry: every dataset a report can be built on declares
//   * its fields (key · label · type · group) — the field picker reads them
//   * the filters it understands — the filter panel shows only those
//   * a loader that pulls the rows for a scope + filters (RLS-bounded, paged)
//
// Rows are FLAT `ReportRow`s keyed by FieldDef.key so the engine
// (filter · sort · project · aggregate) and the exporters never care which
// source they came from. To add a source later: add one entry here.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Church, Service, ClassRoom, AppEvent, Cause, CallFeedback } from '@/lib/types';
import { GENDER_LABELS, ENROLLMENT_STATUS_LABELS, ROLE_LABELS, STATUS_LABELS, CONTACT_KIND_LABELS } from '@/lib/types';
import type { FieldDef, ReportFilters, ReportRow, ReportScope, ReportSourceKey } from './types';

// ---------- lookups every loader needs ----------
export interface ReportLookups {
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  events: AppEvent[];
  causes: Cause[];
  feedbacks: CallFeedback[];
}

export type FilterKey = 'period' | 'event' | 'cause' | 'exam' | 'gender' | 'status' | 'kind' | 'contactKind' | 'pointsSign' | 'role' | 'servantStatus';

export interface ReportSource {
  key: ReportSourceKey;
  label: string;
  desc: string;
  /** filters shown for this source */
  filters: FilterKey[];
  fields: FieldDef[];
  /** default sort when the user hasn't chosen one */
  defaultSort?: { field: string; dir: 'asc' | 'desc' }[];
  load: (supabase: SupabaseClient, scope: ReportScope, filters: ReportFilters, lookups: ReportLookups, limit: number) => Promise<ReportRow[]>;
}

// ---------- helpers ----------
const G = {
  basic: 'البيانات الأساسية', scope: 'النطاق', stats: 'الحضور والنقاط', period: 'داخل الفترة',
  log: 'السجل', exam: 'النتيجة', account: 'الحساب', contact: 'الافتقاد',
};

const ageOf = (birthdate: string | null | undefined): number | null => {
  if (!birthdate) return null;
  const b = new Date(birthdate); if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  return a;
};

const nameOf = <T extends { id: string; name: string }>(list: T[], id: string | null | undefined) =>
  id ? (list.find((x) => x.id === id)?.name ?? '') : '';

const applyScope = <Q extends { eq: (c: string, v: string) => Q }>(q: Q, scope: ReportScope): Q => {
  if (scope.church) q = q.eq('church_id', scope.church);
  if (scope.service) q = q.eq('service_id', scope.service);
  if (scope.class) q = q.eq('class_id', scope.class);
  return q;
};

/** page through a PostgREST query (max 1000 per page) until `limit` */
async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>, limit: number): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; from < limit; from += size) {
    const to = Math.min(from + size, limit) - 1;
    const { data, error } = await build(from, to);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < to - from + 1) break;
  }
  return out;
}

const PERSON_SELECT = 'person:persons(id, national_id, name, birthdate, gender, phone, address, notes, image_url)';

interface EnrollRaw {
  id: string; person_id: string; church_id: string; service_id: string; class_id: string;
  attendance_count: number; points: number; created_at: string; kind: 'child' | 'servant'; status: 'active' | 'stopped';
  person: { id: string; national_id: string; name: string; birthdate: string | null; gender: 'male' | 'female' | null; phone: string | null; address: string | null; notes: string | null; image_url: string | null } | null;
}

const personFields = (): FieldDef[] => [
  { key: 'name', label: 'الاسم', type: 'text', group: G.basic, width: 2.2, defaultOn: true },
  { key: 'code', label: 'الكود', type: 'text', group: G.basic, width: 1.4, defaultOn: true },
  { key: 'gender', label: 'النوع', type: 'text', group: G.basic, width: 0.8 },
  { key: 'birthdate', label: 'تاريخ الميلاد', type: 'date', group: G.basic, width: 1.2 },
  { key: 'age', label: 'السن', type: 'number', group: G.basic, width: 0.7, numeric: true },
  { key: 'phone', label: 'الهاتف', type: 'text', group: G.basic, width: 1.3, defaultOn: true },
  { key: 'address', label: 'العنوان', type: 'text', group: G.basic, width: 2 },
  { key: 'notes', label: 'ملاحظات', type: 'text', group: G.basic, width: 2 },
  { key: 'photo', label: 'الصورة', type: 'image', group: G.basic, width: 0.8 },
];

const scopeFields = (): FieldDef[] => [
  { key: 'church', label: 'الكنيسة', type: 'text', group: G.scope, width: 1.5 },
  { key: 'service', label: 'الخدمة', type: 'text', group: G.scope, width: 1.5 },
  { key: 'class', label: 'الفصل', type: 'text', group: G.scope, width: 1.2, defaultOn: true },
];

const flattenEnrollment = (e: EnrollRaw, lk: ReportLookups): ReportRow => ({
  _id: e.id,
  _person_id: e.person_id,
  name: e.person?.name ?? '',
  code: e.person?.national_id ?? '',
  gender: e.person?.gender ? GENDER_LABELS[e.person.gender] : '',
  birthdate: e.person?.birthdate ?? null,
  age: ageOf(e.person?.birthdate),
  phone: e.person?.phone ?? '',
  address: e.person?.address ?? '',
  notes: e.person?.notes ?? '',
  photo: e.person?.image_url ?? null,
  church: nameOf(lk.churches, e.church_id),
  service: nameOf(lk.services, e.service_id),
  class: nameOf(lk.classes, e.class_id),
  status: ENROLLMENT_STATUS_LABELS[e.status ?? 'active'],
  enrolled_at: e.created_at,
});

async function loadEnrollments(supabase: SupabaseClient, scope: ReportScope, f: ReportFilters, lk: ReportLookups, limit: number): Promise<EnrollRaw[]> {
  return pageAll<EnrollRaw>((from, to) => {
    let q = supabase.from('enrollments').select(`id, person_id, church_id, service_id, class_id, attendance_count, points, created_at, kind, status, ${PERSON_SELECT}`);
    q = applyScope(q, scope);
    const kind = f.kind ?? 'child';
    if (kind !== 'all') q = q.eq('kind', kind);
    if (f.status) q = q.eq('status', f.status);
    return q.order('class_id').order('person(name)').order('id').range(from, to);
  }, limit).then((rows) => rows.filter((r) => r.person && (!f.gender || r.person.gender === f.gender)));
}

// ---------- period stats RPC (migration 0050) ----------
interface PeriodStat {
  enrollment_id: string; attendance_count: number; attendance_points: number; points_added: number; points_removed: number;
  first_attended: string | null; last_attended: string | null; calls_count: number; messages_count: number;
}
async function periodStats(supabase: SupabaseClient, ids: string[], f: ReportFilters): Promise<Map<string, PeriodStat>> {
  const out = new Map<string, PeriodStat>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await supabase.rpc('report_enrollment_period_stats', {
      p_enrollments: ids.slice(i, i + 500), p_from: f.from || null, p_to: f.to || null, p_event: f.event || null,
    });
    if (error) throw error;
    for (const r of (data ?? []) as PeriodStat[]) out.set(r.enrollment_id, { ...r, attendance_count: Number(r.attendance_count), attendance_points: Number(r.attendance_points), points_added: Number(r.points_added), points_removed: Number(r.points_removed), calls_count: Number(r.calls_count), messages_count: Number(r.messages_count) });
  }
  return out;
}

// ===================================================================
// 1. المخدومون
// ===================================================================
const enrollmentsSource: ReportSource = {
  key: 'enrollments',
  label: 'المخدومون',
  desc: 'سطر لكل مخدوم في فصله: البيانات الأساسية · النطاق · الحضور والنقاط الإجمالية · وحضور ونقاط الفترة المختارة',
  filters: ['period', 'event', 'gender', 'status', 'kind'],
  fields: [
    ...personFields(),
    ...scopeFields(),
    { key: 'status', label: 'الحالة', type: 'text', group: G.scope, width: 0.9 },
    { key: 'enrolled_at', label: 'تاريخ التسجيل', type: 'date', group: G.scope, width: 1.2 },
    { key: 'attendance_total', label: 'إجمالي الحضور', type: 'number', group: G.stats, width: 0.9, numeric: true, defaultOn: true },
    { key: 'points_total', label: 'رصيد النقاط', type: 'number', group: G.stats, width: 0.9, numeric: true, defaultOn: true },
    { key: 'attendance_period', label: 'حضور الفترة', type: 'number', group: G.period, width: 0.9, numeric: true },
    { key: 'attendance_points_period', label: 'نقاط حضور الفترة', type: 'number', group: G.period, width: 1, numeric: true },
    { key: 'points_added_period', label: 'نقاط مضافة (الفترة)', type: 'number', group: G.period, width: 1, numeric: true },
    { key: 'points_removed_period', label: 'نقاط مخصومة (الفترة)', type: 'number', group: G.period, width: 1, numeric: true },
    { key: 'first_attended', label: 'أول حضور (الفترة)', type: 'date', group: G.period, width: 1.2 },
    { key: 'last_attended', label: 'آخر حضور (الفترة)', type: 'date', group: G.period, width: 1.2 },
    { key: 'calls_period', label: 'مكالمات (الفترة)', type: 'number', group: G.period, width: 0.9, numeric: true },
    { key: 'messages_period', label: 'رسائل (الفترة)', type: 'number', group: G.period, width: 0.9, numeric: true },
  ],
  defaultSort: [{ field: 'class', dir: 'asc' }, { field: 'name', dir: 'asc' }],
  async load(supabase, scope, f, lk, limit) {
    const raw = await loadEnrollments(supabase, scope, f, lk, limit);
    const stats = await periodStats(supabase, raw.map((r) => r.id), f);
    return raw.map((e) => {
      const s = stats.get(e.id);
      return {
        ...flattenEnrollment(e, lk),
        attendance_total: e.attendance_count,
        points_total: e.points,
        attendance_period: s?.attendance_count ?? 0,
        attendance_points_period: s?.attendance_points ?? 0,
        points_added_period: s?.points_added ?? 0,
        points_removed_period: s?.points_removed ?? 0,
        first_attended: s?.first_attended ?? null,
        last_attended: s?.last_attended ?? null,
        calls_period: s?.calls_count ?? 0,
        messages_period: s?.messages_count ?? 0,
      };
    });
  },
};

// ===================================================================
// 2. سجل الحضور
// ===================================================================
interface AttRaw { id: string; enrollment_id: string; event_id: string | null; points_delta: number; attended_on: string; created_at: string }

const attendanceSource: ReportSource = {
  key: 'attendance',
  label: 'سجل الحضور',
  desc: 'سطر لكل حضور مسجّل: من حضر · أي مناسبة · في أي يوم · وكم نقطة أخذ',
  filters: ['period', 'event', 'gender'],
  fields: [
    { key: 'attended_on', label: 'تاريخ الحضور', type: 'date', group: G.log, width: 1.2, defaultOn: true },
    { key: 'event', label: 'المناسبة', type: 'text', group: G.log, width: 1.5, defaultOn: true },
    { key: 'points_delta', label: 'نقاط الحضور', type: 'number', group: G.log, width: 0.9, numeric: true, defaultOn: true },
    { key: 'recorded_at', label: 'وقت التسجيل', type: 'datetime', group: G.log, width: 1.5 },
    ...personFields(),
    ...scopeFields(),
  ],
  defaultSort: [{ field: 'attended_on', dir: 'desc' }, { field: 'name', dir: 'asc' }],
  async load(supabase, scope, f, lk, limit) {
    const enrolls = await loadEnrollments(supabase, scope, { kind: 'all', gender: f.gender }, lk, 20000);
    const byId = new Map(enrolls.map((e) => [e.id, e]));
    const ids = enrolls.map((e) => e.id);
    const out: ReportRow[] = [];
    for (let i = 0; i < ids.length && out.length < limit; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const rows = await pageAll<AttRaw>((from, to) => {
        let q = supabase.from('attendance_log').select('id, enrollment_id, event_id, points_delta, attended_on, created_at').in('enrollment_id', chunk);
        if (f.from) q = q.gte('attended_on', f.from);
        if (f.to) q = q.lte('attended_on', f.to);
        if (f.event) q = q.eq('event_id', f.event);
        return q.order('attended_on', { ascending: false }).order('id').range(from, to);
      }, limit - out.length);
      for (const a of rows) {
        const e = byId.get(a.enrollment_id); if (!e) continue;
        out.push({
          ...flattenEnrollment(e, lk), _id: a.id,
          attended_on: a.attended_on, event: nameOf(lk.events, a.event_id) || (a.event_id ? 'مناسبة محذوفة' : '—'),
          points_delta: a.points_delta, recorded_at: a.created_at,
        });
      }
    }
    return out.slice(0, limit);
  },
};

// ===================================================================
// 3. سجل النقاط
// ===================================================================
interface PtsRaw { id: string; enrollment_id: string; cause_id: string | null; event_id: string | null; delta: number; created_at: string }

const pointsSource: ReportSource = {
  key: 'points',
  label: 'سجل النقاط',
  desc: 'سطر لكل تغيير في النقاط: لمن · السبب · المناسبة · القيمة (+ / −) · الوقت',
  filters: ['period', 'event', 'cause', 'pointsSign', 'gender'],
  fields: [
    { key: 'at', label: 'الوقت', type: 'datetime', group: G.log, width: 1.5, defaultOn: true },
    { key: 'delta', label: 'النقاط', type: 'number', group: G.log, width: 0.8, numeric: true, defaultOn: true },
    { key: 'cause', label: 'السبب', type: 'text', group: G.log, width: 1.5, defaultOn: true },
    { key: 'event', label: 'المناسبة', type: 'text', group: G.log, width: 1.5 },
    { key: 'sign', label: 'النوع', type: 'text', group: G.log, width: 0.8 },
    ...personFields(),
    ...scopeFields(),
  ],
  defaultSort: [{ field: 'at', dir: 'desc' }],
  async load(supabase, scope, f, lk, limit) {
    const enrolls = await loadEnrollments(supabase, scope, { kind: 'all', gender: f.gender }, lk, 20000);
    const byId = new Map(enrolls.map((e) => [e.id, e]));
    const ids = enrolls.map((e) => e.id);
    const out: ReportRow[] = [];
    for (let i = 0; i < ids.length && out.length < limit; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const rows = await pageAll<PtsRaw>((from, to) => {
        let q = supabase.from('points_log').select('id, enrollment_id, cause_id, event_id, delta, created_at').in('enrollment_id', chunk);
        if (f.from) q = q.gte('created_at', `${f.from}T00:00:00+02:00`);
        if (f.to) q = q.lte('created_at', `${f.to}T23:59:59+02:00`);
        if (f.event) q = q.eq('event_id', f.event);
        if (f.cause) q = q.eq('cause_id', f.cause);
        if (f.pointsSign === 'add') q = q.gt('delta', 0);
        if (f.pointsSign === 'remove') q = q.lt('delta', 0);
        return q.order('created_at', { ascending: false }).order('id').range(from, to);
      }, limit - out.length);
      for (const p of rows) {
        const e = byId.get(p.enrollment_id); if (!e) continue;
        out.push({
          ...flattenEnrollment(e, lk), _id: p.id,
          at: p.created_at, delta: p.delta,
          cause: nameOf(lk.causes, p.cause_id) || (p.cause_id ? 'سبب محذوف' : 'حضور'),
          event: nameOf(lk.events, p.event_id), sign: p.delta >= 0 ? 'إضافة' : 'خصم',
        });
      }
    }
    return out.slice(0, limit);
  },
};

// ===================================================================
// 4. الافتقاد (مكالمات · رسائل)
// ===================================================================
interface ConRaw { id: string; enrollment_id: string; event_id: string | null; kind: 'call' | 'whatsapp' | 'sms' | 'internal'; message: string | null; contacted_on: string; feedback_id: string | null; note?: string | null; occurrence_on: string | null; created_at: string }

const contactsSource: ReportSource = {
  key: 'contacts',
  label: 'الافتقاد (مكالمات ورسائل)',
  desc: 'سطر لكل مكالمة أو رسالة متابعة: لمن · النوع · نتيجة المكالمة · المناسبة · اليوم',
  filters: ['period', 'event', 'contactKind', 'gender'],
  fields: [
    { key: 'contacted_on', label: 'اليوم', type: 'date', group: G.contact, width: 1.2, defaultOn: true },
    { key: 'kind', label: 'النوع', type: 'text', group: G.contact, width: 1, defaultOn: true },
    { key: 'feedback', label: 'نتيجة المكالمة', type: 'text', group: G.contact, width: 1.4, defaultOn: true },
    { key: 'event', label: 'المناسبة', type: 'text', group: G.contact, width: 1.4 },
    { key: 'occurrence_on', label: 'يوم المناسبة', type: 'date', group: G.contact, width: 1.2 },
    { key: 'message', label: 'نص الرسالة', type: 'text', group: G.contact, width: 2.5 },
    ...personFields(),
    ...scopeFields(),
  ],
  defaultSort: [{ field: 'contacted_on', dir: 'desc' }],
  async load(supabase, scope, f, lk, limit) {
    const enrolls = await loadEnrollments(supabase, scope, { kind: 'all', gender: f.gender }, lk, 20000);
    const byId = new Map(enrolls.map((e) => [e.id, e]));
    const ids = enrolls.map((e) => e.id);
    const out: ReportRow[] = [];
    // `note` (20261012120000) — fall back to the old column list on a DB without it
    let withNote = true;
    for (let i = 0; i < ids.length && out.length < limit; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const build = (from: number, to: number) => {
        const cols = `id, enrollment_id, event_id, kind, message, contacted_on, feedback_id${withNote ? ', note' : ''}, occurrence_on, created_at`;
        let q = supabase.from('contact_log').select(cols).in('enrollment_id', chunk);
        if (f.from) q = q.gte('contacted_on', f.from);
        if (f.to) q = q.lte('contacted_on', f.to);
        if (f.event) q = q.eq('event_id', f.event);
        if (f.contactKind) q = q.eq('kind', f.contactKind);
        return q.order('contacted_on', { ascending: false }).order('id').range(from, to);
      };
      let rows: ConRaw[];
      try {
        rows = await pageAll<ConRaw>(build, limit - out.length);
      } catch (err) {
        if (!withNote || !/note/i.test((err as { message?: string })?.message ?? '')) throw err;
        withNote = false;
        rows = await pageAll<ConRaw>(build, limit - out.length);
      }
      for (const c of rows) {
        const e = byId.get(c.enrollment_id); if (!e) continue;
        out.push({
          ...flattenEnrollment(e, lk), _id: c.id,
          contacted_on: c.contacted_on, kind: CONTACT_KIND_LABELS[c.kind] ?? c.kind,
          // «أخرى» (20261012120000): no predefined feedback → the hand-written cause
          feedback: c.feedback_id ? nameOf(lk.feedbacks, c.feedback_id) : (c.note?.trim() ? `أخرى: ${c.note.trim()}` : ''),
          event: nameOf(lk.events, c.event_id),
          occurrence_on: c.occurrence_on, message: c.message ?? '',
        });
      }
    }
    return out.slice(0, limit);
  },
};

// ===================================================================
// 5. نتائج الامتحانات (one exam — the summary RPC of module 0038)
// ===================================================================
interface SummaryRaw {
  enrollment_id: string; person_id: string; church_id: string; service_id: string; class_id: string; name: string; national_id: string; image_url: string | null;
  subjects_total: number; subjects_entered: number; subjects_absent: number; total_score: number | null; total_full: number; percent: number | null;
  grade_name: string | null; passed: boolean | null; status: string; rank: number | null;
}
interface SubjRaw { id: string; name: string; sort_order: number }
interface ResRaw { subject_id: string; enrollment_id: string; score: number | null; status: string }

const EXAM_STATUS: Record<string, string> = { not_entered: 'لم تُدخل', incomplete: 'غير مكتملة', draft: 'مسودة', absent: 'غائب', passed: 'ناجح', failed: 'راسب' };

export const EXAM_SUBJECT_PREFIX = 'subject:';

const examResultsSource: ReportSource = {
  key: 'exam_results',
  label: 'نتائج الامتحانات',
  desc: 'سطر لكل طالب في امتحان واحد: درجة كل مادة · المجموع · النسبة · التقدير · الترتيب · ناجح / راسب',
  filters: ['exam', 'gender'],
  fields: [
    { key: 'name', label: 'الاسم', type: 'text', group: G.basic, width: 2.2, defaultOn: true },
    { key: 'code', label: 'الكود', type: 'text', group: G.basic, width: 1.4, defaultOn: true },
    { key: 'photo', label: 'الصورة', type: 'image', group: G.basic, width: 0.8 },
    ...scopeFields(),
    // subject columns are added dynamically (see subjectFieldsFor)
    { key: 'total_score', label: 'المجموع', type: 'number', group: G.exam, width: 0.9, numeric: true, defaultOn: true },
    { key: 'total_full', label: 'الدرجة الكلية', type: 'number', group: G.exam, width: 0.9, numeric: true },
    { key: 'percent', label: 'النسبة ٪', type: 'number', group: G.exam, width: 0.9, numeric: true, digits: 1, defaultOn: true },
    { key: 'grade', label: 'التقدير', type: 'text', group: G.exam, width: 1, defaultOn: true },
    { key: 'rank', label: 'الترتيب', type: 'number', group: G.exam, width: 0.8, numeric: true, defaultOn: true },
    { key: 'result', label: 'النتيجة', type: 'text', group: G.exam, width: 0.9, defaultOn: true },
    { key: 'subjects_entered', label: 'مواد مُدخلة', type: 'number', group: G.exam, width: 0.9, numeric: true },
    { key: 'subjects_absent', label: 'مواد غائب فيها', type: 'number', group: G.exam, width: 0.9, numeric: true },
  ],
  defaultSort: [{ field: 'rank', dir: 'asc' }],
  async load(supabase, scope, f, lk, limit) {
    if (!f.exam) return [];
    const [{ data: sum, error: e1 }, { data: subs, error: e2 }, { data: res, error: e3 }] = await Promise.all([
      supabase.rpc('result_exam_summary', { p_exam: f.exam }),
      supabase.from('result_subjects').select('id, name, sort_order').eq('exam_id', f.exam).order('sort_order'),
      supabase.from('exam_results').select('subject_id, enrollment_id, score, status').eq('exam_id', f.exam).limit(20000),
    ]);
    if (e1) throw e1; if (e2) throw e2; if (e3) throw e3;
    const subjects = (subs ?? []) as SubjRaw[];
    const scores = new Map<string, ResRaw>();
    for (const r of (res ?? []) as ResRaw[]) scores.set(`${r.enrollment_id}|${r.subject_id}`, r);
    // person extras (gender · phone …) — one bounded query
    const summaries = ((sum ?? []) as SummaryRaw[]).filter((s) =>
      (!scope.church || s.church_id === scope.church) && (!scope.service || s.service_id === scope.service) && (!scope.class || s.class_id === scope.class));
    const personIds = Array.from(new Set(summaries.map((s) => s.person_id)));
    const persons = new Map<string, { gender: 'male' | 'female' | null; phone: string | null; birthdate: string | null }>();
    for (let i = 0; i < personIds.length; i += 500) {
      const { data } = await supabase.from('persons').select('id, gender, phone, birthdate').in('id', personIds.slice(i, i + 500));
      for (const p of (data ?? []) as { id: string; gender: 'male' | 'female' | null; phone: string | null; birthdate: string | null }[]) persons.set(p.id, p);
    }
    return summaries
      .filter((s) => !f.gender || persons.get(s.person_id)?.gender === f.gender)
      .slice(0, limit)
      .map((s) => {
        const p = persons.get(s.person_id);
        const row: ReportRow = {
          _id: s.enrollment_id, _person_id: s.person_id,
          name: s.name, code: s.national_id, photo: s.image_url,
          gender: p?.gender ? GENDER_LABELS[p.gender] : '', phone: p?.phone ?? '', birthdate: p?.birthdate ?? null, age: ageOf(p?.birthdate),
          church: nameOf(lk.churches, s.church_id), service: nameOf(lk.services, s.service_id), class: nameOf(lk.classes, s.class_id),
          total_score: s.total_score === null ? null : Number(s.total_score), total_full: Number(s.total_full),
          percent: s.percent === null ? null : Number(s.percent), grade: s.grade_name ?? '', rank: s.rank,
          result: EXAM_STATUS[s.status] ?? s.status, subjects_entered: s.subjects_entered, subjects_absent: s.subjects_absent,
        };
        for (const sb of subjects) {
          const r = scores.get(`${s.enrollment_id}|${sb.id}`);
          row[`${EXAM_SUBJECT_PREFIX}${sb.id}`] = r ? (r.status === 'absent' ? 'غ' : r.status === 'excused' ? 'معذور' : r.score === null ? null : Number(r.score)) : null;
        }
        return row;
      });
  },
};

/** dynamic per-subject fields of ONE exam (merged into the picker when an exam is chosen) */
export async function subjectFieldsFor(supabase: SupabaseClient, examId: string): Promise<FieldDef[]> {
  const { data } = await supabase.from('result_subjects').select('id, name, full_degree, sort_order').eq('exam_id', examId).order('sort_order');
  return ((data ?? []) as { id: string; name: string; full_degree: number }[]).map((s) => ({
    key: `${EXAM_SUBJECT_PREFIX}${s.id}`, label: `${s.name} (${Number(s.full_degree)})`, type: 'number', group: 'درجات المواد', width: 0.9, numeric: true, defaultOn: true,
  }));
}

// ===================================================================
// 6. الخدام
// ===================================================================
interface ServRaw {
  id: string; person_id: string | null; full_name: string; user_id: string; phone: string; role: string; status: string;
  church_id: string | null; service_id: string | null; class_id: string | null; photo_url: string | null; created_at: string; approved_at: string | null;
  person: { national_id: string; gender: 'male' | 'female' | null; birthdate: string | null; address: string | null; notes: string | null } | null;
}

const servantsSource: ReportSource = {
  key: 'servants',
  label: 'الخدام',
  desc: 'سطر لكل خادم: الاسم · الكود · الدور · الحالة · مكان الخدمة · الهاتف',
  filters: ['role', 'servantStatus', 'gender'],
  fields: [
    { key: 'name', label: 'الاسم', type: 'text', group: G.basic, width: 2.2, defaultOn: true },
    { key: 'code', label: 'الكود', type: 'text', group: G.basic, width: 1.4, defaultOn: true },
    { key: 'gender', label: 'النوع', type: 'text', group: G.basic, width: 0.8 },
    { key: 'birthdate', label: 'تاريخ الميلاد', type: 'date', group: G.basic, width: 1.2 },
    { key: 'age', label: 'السن', type: 'number', group: G.basic, width: 0.7, numeric: true },
    { key: 'phone', label: 'الهاتف', type: 'text', group: G.basic, width: 1.3, defaultOn: true },
    { key: 'address', label: 'العنوان', type: 'text', group: G.basic, width: 2 },
    { key: 'photo', label: 'الصورة', type: 'image', group: G.basic, width: 0.8 },
    { key: 'role', label: 'الدور', type: 'text', group: G.account, width: 1.2, defaultOn: true },
    { key: 'status', label: 'الحالة', type: 'text', group: G.account, width: 1 },
    { key: 'login', label: 'اسم الدخول', type: 'text', group: G.account, width: 1.3 },
    { key: 'joined_at', label: 'تاريخ الانضمام', type: 'date', group: G.account, width: 1.2 },
    { key: 'approved_at', label: 'تاريخ الاعتماد', type: 'date', group: G.account, width: 1.2 },
    ...scopeFields(),
  ],
  defaultSort: [{ field: 'name', dir: 'asc' }],
  async load(supabase, scope, f, lk, limit) {
    const rows = await pageAll<ServRaw>((from, to) => {
      let q = supabase.from('servant_enrollments').select('id, person_id, full_name, user_id, phone, role, status, church_id, service_id, class_id, photo_url, created_at, approved_at, person:persons!servant_enrollments_person_id_fkey(national_id, gender, birthdate, address, notes)');
      q = applyScope(q, scope);
      if (f.role) q = q.eq('role', f.role);
      if (f.servantStatus) q = q.eq('status', f.servantStatus);
      return q.order('full_name').order('id').range(from, to);
    }, limit);
    return rows
      .filter((s) => !f.gender || s.person?.gender === f.gender)
      .map((s) => ({
        _id: s.id, _person_id: s.person_id,
        name: s.full_name, code: s.person?.national_id ?? s.user_id, gender: s.person?.gender ? GENDER_LABELS[s.person.gender] : '',
        birthdate: s.person?.birthdate ?? null, age: ageOf(s.person?.birthdate), phone: s.phone ?? '', address: s.person?.address ?? '', photo: s.photo_url,
        role: ROLE_LABELS[s.role as keyof typeof ROLE_LABELS] ?? s.role, status: STATUS_LABELS[s.status as keyof typeof STATUS_LABELS] ?? s.status,
        login: s.user_id, joined_at: s.created_at, approved_at: s.approved_at,
        church: s.church_id ? nameOf(lk.churches, s.church_id) : 'كل الكنائس',
        service: s.service_id ? nameOf(lk.services, s.service_id) : 'كل الخدمات',
        class: s.class_id ? nameOf(lk.classes, s.class_id) : 'كل الفصول',
      }));
  },
};

// ===================================================================
// Registry
// ===================================================================
export const REPORT_SOURCES: ReportSource[] = [enrollmentsSource, attendanceSource, pointsSource, contactsSource, examResultsSource, servantsSource];

export const SOURCE_BY_KEY: Record<ReportSourceKey, ReportSource> = Object.fromEntries(
  REPORT_SOURCES.map((s) => [s.key, s])
) as Record<ReportSourceKey, ReportSource>;

export const FILTER_LABELS: Record<FilterKey, string> = {
  period: 'الفترة', event: 'المناسبة', cause: 'السبب', exam: 'الامتحان', gender: 'النوع', status: 'حالة التسجيل', kind: 'نوع التسجيل',
  contactKind: 'نوع الافتقاد', pointsSign: 'إضافة / خصم', role: 'الدور', servantStatus: 'حالة الحساب',
};
