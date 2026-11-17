// ---------- ACCESS MODULE (التحكم في الدخول) — migration 20260925120000 ----------
// An ACCESS EVENT (بوابة دخول) is something a person is let INTO. At the
// door the servant scans the QR (or searches the person) and the DB RPC
// `access_check` answers مسموح / مرفوض with every rule's own status.
//
//   decision = is_active AND allowed-list AND rule-tree
//   * allowed list: persons · class · service · church (any mix) — or
//     `allow_all` on the event
//   * rule tree: rules in nested groups, each group AND / OR; the event's
//     `root_op` combines the top level; disabled rules are ignored.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Person } from '@/lib/types';

// =====================================================================
// Rows
// =====================================================================
export type BoolOp = 'and' | 'or';

export interface AccessEvent {
  id: string;
  church_id: string;
  service_id: string | null;
  class_id: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
  allow_all: boolean;
  root_op: BoolOp;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

export type RuleKind =
  | 'points' | 'attendance_count' | 'attended_events' | 'gender' | 'age' | 'enrolled_in'
  | 'person_field' | 'exam_passed' | 'achievement' | 'occasion' | 'not_entered';

export type CmpOp = 'gte' | 'lte' | 'eq' | 'neq' | 'between';
export type FieldOp = 'present' | 'absent' | 'contains' | 'equals';

/** params jsonb — a loose bag; each kind reads the keys it needs */
export interface RuleParams {
  op?: CmpOp | FieldOp;
  value?: number | string;
  value2?: number | string;
  from?: string;          // YYYY-MM-DD
  to?: string;
  event_id?: string;      // attendance_count filter
  event_ids?: string[];   // attended_events
  mode?: 'all' | 'any';
  church_id?: string;
  service_id?: string;
  class_id?: string;      // legacy single class (still evaluated server-side)
  class_ids?: string[];   // enrolled_in: any of these classes ([] / undefined = all)
  field?: 'phone' | 'address' | 'notes' | 'image_url' | 'birthdate' | 'name' | 'national_id';
  exam_id?: string;
  achievement_id?: string;
  occasion_id?: string;
  statuses?: string[];
  period?: 'day' | 'ever';
}

export interface AccessRule {
  id: string;
  event_id: string;
  group_id: string | null;
  name: string;
  kind: RuleKind;
  params: RuleParams;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

export interface AccessRuleGroup {
  id: string;
  event_id: string;
  parent_id: string | null;
  name: string | null;
  op: BoolOp;
  sort_order: number;
  created_at: string;
}

export interface AccessAllowed {
  id: string;
  event_id: string;
  person_id: string | null;
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
}

export interface AccessAllowedWithPerson extends AccessAllowed {
  person: Person | null;
}

export type DenyReason = 'not_found' | 'inactive' | 'not_allowed' | 'rules';

export const DENY_REASON_LABELS: Record<DenyReason, string> = {
  not_found: 'كود غير معروف — لا يوجد شخص بهذا الكود',
  inactive: 'بوابة الدخول متوقفة',
  not_allowed: 'الشخص ليس ضمن المسموح لهم بالدخول',
  rules: 'لم تتحقق قواعد الدخول',
};

export interface AccessLogRow {
  id: string;
  event_id: string;
  person_id: string | null;
  code: string | null;
  granted: boolean;
  allowed: boolean;
  rules_ok: boolean;
  reason: DenyReason | null;
  details: unknown;
  checked_by: string | null;
  checked_on: string;
  created_at: string;
  person?: Pick<Person, 'id' | 'name' | 'national_id' | 'image_url'> | null;
}

// =====================================================================
// Rule kinds — labels & metadata for the builder / status list
// =====================================================================
export interface RuleKindDef {
  kind: RuleKind;
  label: string;
  desc: string;
  numeric?: boolean;       // op + value (+ value2)
  dateRange?: boolean;     // from / to
}

export const RULE_KINDS: RuleKindDef[] = [
  { kind: 'points', label: 'النقاط', desc: 'مجموع نقاط الشخص في نطاق البوابة — على الأقل · على الأكثر · يساوي · بين', numeric: true },
  { kind: 'attendance_count', label: 'عدد مرات الحضور', desc: 'عدد الحضور الكلي، أو خلال فترة، أو في مناسبة محددة', numeric: true, dateRange: true },
  { kind: 'attended_events', label: 'حضور مناسبات محددة', desc: 'حضر كل المناسبات المختارة (أو إحداها) — اختيارياً خلال فترة', dateRange: true },
  { kind: 'not_entered', label: 'لم يدخل من قبل', desc: 'لم يُسمح له بالدخول من هذه البوابة اليوم (أو أبداً) — يمنع الدخول مرتين' },
  { kind: 'gender', label: 'النوع', desc: 'ذكر أو أنثى' },
  { kind: 'age', label: 'العمر', desc: 'بالسنوات من تاريخ الميلاد', numeric: true },
  { kind: 'enrolled_in', label: 'مسجّل في', desc: 'له تسجيل يعمل في كنيسة / خدمة / فصل' },
  { kind: 'person_field', label: 'بيانات الشخص', desc: 'حقل موجود / فارغ / يحتوي / يساوي — الهاتف · العنوان · الملاحظات · الصورة · تاريخ الميلاد' },
  { kind: 'exam_passed', label: 'اجتاز امتحاناً', desc: 'نجح في امتحان من وحدة الامتحانات' },
  { kind: 'achievement', label: 'حصل على إنجاز', desc: 'مُنح إنجازاً من وحدة الإنجازات' },
  { kind: 'occasion', label: 'مسجّل في فعالية', desc: 'مشارك في فعالية (مؤكد / سجّل الدخول)' },
];
export const RULE_KIND_BY_KEY: Record<RuleKind, RuleKindDef> = Object.fromEntries(RULE_KINDS.map((k) => [k.kind, k])) as Record<RuleKind, RuleKindDef>;
export const ruleKindLabel = (k: string) => RULE_KIND_BY_KEY[k as RuleKind]?.label ?? k;

export const CMP_OPS: { op: CmpOp; label: string }[] = [
  { op: 'gte', label: 'على الأقل (≥)' },
  { op: 'lte', label: 'على الأكثر (≤)' },
  { op: 'eq', label: 'يساوي بالضبط (=)' },
  { op: 'neq', label: 'لا يساوي (≠)' },
  { op: 'between', label: 'بين' },
];

export const PERSON_FIELDS: { key: NonNullable<RuleParams['field']>; label: string }[] = [
  { key: 'phone', label: 'الهاتف' },
  { key: 'address', label: 'العنوان' },
  { key: 'notes', label: 'الملاحظات' },
  { key: 'image_url', label: 'الصورة' },
  { key: 'birthdate', label: 'تاريخ الميلاد' },
  { key: 'name', label: 'الاسم' },
  { key: 'national_id', label: 'الكود' },
];
export const FIELD_OPS: { op: FieldOp; label: string }[] = [
  { op: 'present', label: 'موجود (غير فارغ)' },
  { op: 'absent', label: 'فارغ' },
  { op: 'contains', label: 'يحتوي على' },
  { op: 'equals', label: 'يساوي' },
];

export interface NamedRow { id: string; name?: string; title?: string }
export interface RuleLookups {
  events?: NamedRow[];
  exams?: NamedRow[];
  achievements?: NamedRow[];
  occasions?: NamedRow[];
  churches?: NamedRow[];
  services?: NamedRow[];
  classes?: NamedRow[];
}

const nm = (list: NamedRow[] | undefined, id?: string | null): string => {
  if (!id) return '';
  const x = list?.find((r) => r.id === id);
  return x ? (x.name ?? x.title ?? '') : '…';
};

const cmpText = (p: RuleParams, unit: string) => {
  const op = (p.op as CmpOp) ?? 'gte';
  if (op === 'between') return `بين ${p.value ?? 0} و ${p.value2 ?? p.value ?? 0} ${unit}`;
  const s = CMP_OPS.find((o) => o.op === op)?.label ?? '';
  return `${s} ${p.value ?? 0} ${unit}`;
};
const windowText = (p: RuleParams) =>
  (p.from || p.to) ? ` (${p.from ? `من ${p.from}` : ''}${p.from && p.to ? ' ' : ''}${p.to ? `إلى ${p.to}` : ''})` : '';

/** Human sentence describing a rule's condition («النقاط على الأقل ٢٠ نقطة»). */
export function describeRule(rule: Pick<AccessRule, 'kind' | 'params'>, lk: RuleLookups = {}): string {
  const p = rule.params ?? {};
  switch (rule.kind) {
    case 'points': return `النقاط ${cmpText(p, 'نقطة')}`;
    case 'attendance_count':
      return `عدد الحضور ${cmpText(p, 'مرة')}${p.event_id ? ` في «${nm(lk.events, p.event_id)}»` : ''}${windowText(p)}`;
    case 'attended_events': {
      const names = (p.event_ids ?? []).map((id) => nm(lk.events, id)).filter(Boolean);
      return `حضر ${p.mode === 'any' ? 'إحدى' : 'كل'} المناسبات: ${names.length ? names.join(' · ') : '—'}${windowText(p)}`;
    }
    case 'gender': return p.value === 'female' ? 'أنثى' : 'ذكر';
    case 'age': return `العمر ${cmpText(p, 'سنة')}`;
    case 'enrolled_in': {
      const cids = p.class_ids?.length ? p.class_ids : p.class_id ? [p.class_id] : [];
      const classNames = cids.length ? cids.map((id) => nm(lk.classes, id)).filter(Boolean).join('، ') : 'كل الفصول';
      const parts = [
        p.church_id ? nm(lk.churches, p.church_id) : 'أي كنيسة',
        p.service_id ? nm(lk.services, p.service_id) : 'كل الخدمات',
        classNames,
      ];
      return `مسجّل في ${parts.join(' ← ')}`;
    }
    case 'person_field': {
      const f = PERSON_FIELDS.find((x) => x.key === p.field)?.label ?? 'حقل';
      const o = FIELD_OPS.find((x) => x.op === p.op)?.label ?? 'موجود';
      return `${f} ${o}${p.op === 'contains' || p.op === 'equals' ? ` «${p.value ?? ''}»` : ''}`;
    }
    case 'exam_passed': return `اجتاز امتحان «${nm(lk.exams, p.exam_id)}»`;
    case 'achievement': return `حصل على إنجاز «${nm(lk.achievements, p.achievement_id)}»`;
    case 'occasion': return `مشارك في فعالية «${nm(lk.occasions, p.occasion_id)}»`;
    case 'not_entered': return p.period === 'ever' ? 'لم يدخل من هذه البوابة من قبل' : 'لم يدخل من هذه البوابة اليوم';
    default: return rule.kind;
  }
}

/** Short text of the measured value («١٠ نقطة»). */
export function describeActual(rule: Pick<AccessRule, 'kind'>, actual: unknown): string {
  if (actual === null || actual === undefined) {
    return rule.kind === 'age' ? 'لا يوجد تاريخ ميلاد' : rule.kind === 'gender' ? 'النوع غير محدد' : '—';
  }
  switch (rule.kind) {
    case 'points': return `${actual} نقطة`;
    case 'attendance_count': return `${actual} مرة`;
    case 'age': return `${actual} سنة`;
    case 'gender': return actual === 'female' ? 'أنثى' : actual === 'male' ? 'ذكر' : '—';
    case 'attended_events': {
      const a = actual as { hit?: number; of?: number };
      return `حضر ${a.hit ?? 0} من ${a.of ?? 0}`;
    }
    case 'not_entered': return Number(actual) === 0 ? 'لم يدخل' : `دخل ${actual} مرة`;
    case 'person_field': return typeof actual === 'string' ? actual : actual ? 'موجود' : 'فارغ';
    default: return actual === true ? 'نعم' : actual === false ? 'لا' : String(actual);
  }
}

// =====================================================================
// access_check result
// =====================================================================
export interface CheckEnrollment {
  id: string;
  church_id: string; service_id: string; class_id: string;
  church_name: string | null; service_name: string | null; class_name: string | null;
  points: number; attendance_count: number; status: string; kind: string; in_scope: boolean;
}
export interface CheckHistoryRow {
  id: string; attended_on: string; created_at: string; event_id: string | null; event_name: string | null;
  points_delta: number; service_name: string | null; class_name: string | null;
}
export interface CheckVisit { id: string; created_at: string; granted: boolean; reason: DenyReason | null; checked_by_name: string | null }
export interface CheckSummary {
  points: number; attendance_count: number; last_attended_on: string | null; attended_today: boolean;
  entered_today: number; entered_total: number; in_scope: boolean; scope_enrollments: number;
}
export interface CheckRuleStatus {
  id: string; group_id: string | null; name: string; kind: RuleKind; params: RuleParams; enabled: boolean; sort_order: number;
  fulfilled: boolean | null; actual: unknown; error?: string | null;
}
export interface CheckGroupStatus { id: string; parent_id: string | null; name: string | null; op: BoolOp; sort_order: number; ok: boolean; empty: boolean }

export interface AccessCheckResult {
  event: AccessEvent;
  matched: boolean;
  person: Person | null;
  code: string | null;
  enrollments: CheckEnrollment[];
  summary: CheckSummary | null;
  history: CheckHistoryRow[];
  visits: CheckVisit[];
  allowed: boolean;
  allowed_by: Pick<AccessAllowed, 'id' | 'person_id' | 'church_id' | 'service_id' | 'class_id'>[];
  rules: { ok: boolean; empty: boolean; root_op: BoolOp; rules: CheckRuleStatus[]; groups: CheckGroupStatus[] } | null;
  granted: boolean;
  reason: DenyReason | null;
  log_id: string | null;
}

export async function accessCheck(
  supabase: SupabaseClient,
  eventId: string,
  target: { code?: string; personId?: string },
  log = true,
): Promise<AccessCheckResult> {
  const { data, error } = await supabase.rpc('access_check', {
    p_event: eventId,
    p_code: target.code?.trim() ?? null,
    p_person: target.personId ?? null,
    p_log: log,
  });
  if (error) throw error;
  const r = (data ?? {}) as Partial<AccessCheckResult>;
  return {
    event: r.event as AccessEvent,
    matched: !!r.matched,
    person: r.person ?? null,
    code: r.code ?? null,
    enrollments: r.enrollments ?? [],
    summary: r.summary ?? null,
    history: r.history ?? [],
    visits: r.visits ?? [],
    allowed: !!r.allowed,
    allowed_by: r.allowed_by ?? [],
    rules: r.rules ?? null,
    granted: !!r.granted,
    reason: r.reason ?? null,
    log_id: r.log_id ?? null,
  };
}

// =====================================================================
// Search · permissions · fetches
// =====================================================================
export interface AccessSearchHit {
  person: Person;
  places: { church_id: string; service_id: string; class_id: string; points: number; attendance_count: number }[];
}

export async function searchPersonsForAccess(supabase: SupabaseClient, query: string, limit = 30): Promise<AccessSearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase.rpc('access_search_persons', { p_query: q, p_limit: limit });
  if (error) throw error;
  return ((data ?? []) as AccessSearchHit[]).filter((h) => h.person);
}

export interface AccessPermissions { check: boolean; manage: boolean }

export async function fetchAccessPermissions(supabase: SupabaseClient): Promise<AccessPermissions> {
  const { data, error } = await supabase.rpc('access_permissions');
  if (error) return { check: false, manage: false };
  const r = (data ?? {}) as Partial<AccessPermissions>;
  return { check: !!r.check, manage: !!r.manage };
}

export async function fetchAccessEvents(supabase: SupabaseClient): Promise<AccessEvent[]> {
  const { data, error } = await supabase.from('access_events').select('*').order('is_active', { ascending: false }).order('name');
  if (error) throw error;
  return (data ?? []) as AccessEvent[];
}

export interface AccessConfig {
  rules: AccessRule[];
  groups: AccessRuleGroup[];
  allowed: AccessAllowedWithPerson[];
}

/** Everything that belongs to one event (rules · groups · allowed list). */
export async function fetchAccessConfig(supabase: SupabaseClient, eventId: string): Promise<AccessConfig> {
  const [r, g, a] = await Promise.all([
    supabase.from('access_rules').select('*').eq('event_id', eventId).order('sort_order').order('created_at'),
    supabase.from('access_rule_groups').select('*').eq('event_id', eventId).order('sort_order').order('created_at'),
    supabase.from('access_allowed').select('*, person:persons(*)').eq('event_id', eventId).order('created_at'),
  ]);
  if (r.error) throw r.error;
  if (g.error) throw g.error;
  if (a.error) throw a.error;
  return {
    rules: (r.data ?? []) as AccessRule[],
    groups: (g.data ?? []) as AccessRuleGroup[],
    allowed: (a.data ?? []) as AccessAllowedWithPerson[],
  };
}

export async function fetchAccessLog(supabase: SupabaseClient, eventId: string, limit = 100): Promise<AccessLogRow[]> {
  const { data, error } = await supabase
    .from('access_log').select('*, person:persons(id, name, national_id, image_url)')
    .eq('event_id', eventId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as AccessLogRow[];
}

// ---------- writes ----------
export type AccessEventInput = Pick<AccessEvent, 'church_id' | 'service_id' | 'class_id' | 'name' | 'description' | 'is_active' | 'allow_all' | 'root_op' | 'starts_at' | 'ends_at'>;

export async function saveAccessEvent(supabase: SupabaseClient, input: AccessEventInput, id?: string): Promise<AccessEvent> {
  const q = id
    ? supabase.from('access_events').update(input).eq('id', id).select('*').single()
    : supabase.from('access_events').insert(input).select('*').single();
  const { data, error } = await q;
  if (error) throw error;
  return data as AccessEvent;
}

export async function deleteAccessEvent(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from('access_events').delete().eq('id', id);
  if (error) throw error;
}

export type AccessRuleInput = Pick<AccessRule, 'event_id' | 'group_id' | 'name' | 'kind' | 'params' | 'enabled' | 'sort_order'>;

export async function saveAccessRule(supabase: SupabaseClient, input: AccessRuleInput, id?: string): Promise<AccessRule> {
  const q = id
    ? supabase.from('access_rules').update(input).eq('id', id).select('*').single()
    : supabase.from('access_rules').insert(input).select('*').single();
  const { data, error } = await q;
  if (error) throw error;
  return data as AccessRule;
}

export async function setRuleEnabled(supabase: SupabaseClient, id: string, enabled: boolean) {
  const { error } = await supabase.from('access_rules').update({ enabled }).eq('id', id);
  if (error) throw error;
}

export async function deleteAccessRule(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from('access_rules').delete().eq('id', id);
  if (error) throw error;
}

export type RuleGroupInput = Pick<AccessRuleGroup, 'event_id' | 'parent_id' | 'name' | 'op' | 'sort_order'>;

export async function saveRuleGroup(supabase: SupabaseClient, input: RuleGroupInput, id?: string): Promise<AccessRuleGroup> {
  const q = id
    ? supabase.from('access_rule_groups').update(input).eq('id', id).select('*').single()
    : supabase.from('access_rule_groups').insert(input).select('*').single();
  const { data, error } = await q;
  if (error) throw error;
  return data as AccessRuleGroup;
}

export async function deleteRuleGroup(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from('access_rule_groups').delete().eq('id', id);
  if (error) throw error;
}

export type AccessAllowedInput = Pick<AccessAllowed, 'event_id' | 'person_id' | 'church_id' | 'service_id' | 'class_id' | 'note'>;

/** Insert allowed rows one by one — a duplicate (already listed) is skipped, never an error. */
export async function addAllowed(supabase: SupabaseClient, rows: AccessAllowedInput[]): Promise<{ added: AccessAllowedWithPerson[]; skipped: number }> {
  const added: AccessAllowedWithPerson[] = [];
  let skipped = 0;
  for (const row of rows) {
    const { data, error } = await supabase.from('access_allowed').insert(row).select('*, person:persons(*)').single();
    if (error) {
      if (error.code === '23505') { skipped++; continue; }
      throw error;
    }
    added.push(data as AccessAllowedWithPerson);
  }
  return { added, skipped };
}

export async function removeAllowed(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from('access_allowed').delete().eq('id', id);
  if (error) throw error;
}

// ---------- helpers ----------
export type AllowedKind = 'person' | 'church' | 'service' | 'class';

export const allowedKind = (a: Pick<AccessAllowed, 'person_id' | 'service_id' | 'class_id'>): AllowedKind =>
  a.person_id ? 'person' : a.class_id ? 'class' : a.service_id ? 'service' : 'church';

export const ALLOWED_KIND_LABELS: Record<AllowedKind, string> = { person: 'شخص', church: 'كنيسة كاملة', service: 'خدمة كاملة', class: 'فصل' };

export function allowedLabel(
  a: Pick<AccessAllowed, 'person_id' | 'church_id' | 'service_id' | 'class_id'> & { person?: Person | null },
  lk: RuleLookups,
): string {
  if (a.person_id) return a.person?.name ?? 'شخص';
  const c = nm(lk.churches, a.church_id);
  if (!a.service_id) return `${c} — كل الكنيسة`;
  const s = nm(lk.services, a.service_id);
  if (!a.class_id) return `${c} ← ${s} — كل الخدمة`;
  return `${c} ← ${s} ← ${nm(lk.classes, a.class_id)}`;
}

/** «٣ قواعد · ١ متوقفة» */
export function rulesSummary(rules: Pick<AccessRule, 'enabled'>[]): string {
  const on = rules.filter((r) => r.enabled).length;
  const off = rules.length - on;
  if (rules.length === 0) return 'بدون قواعد';
  return `${on} ${on === 1 ? 'قاعدة' : 'قواعد'}${off ? ` · ${off} متوقفة` : ''}`;
}

export const OP_LABELS: Record<BoolOp, string> = { and: 'كل الشروط (AND)', or: 'أي شرط (OR)' };
export const OP_SHORT: Record<BoolOp, string> = { and: 'و', or: 'أو' };

export const MIGRATION_HINT = 'تعذر تحميل بوابات الدخول — تأكد من تطبيق تحديث قاعدة البيانات (20260925120000_access_control)';
