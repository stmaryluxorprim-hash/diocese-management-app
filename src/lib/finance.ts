// ---------- FINANCE MODULE (الخزينة → الميزانيات) — migrations 20260928140000 + 20260929120000 ----------
// A BUDGET (ميزانية) is created for a church / service / class (or «الكل»)
// and is visible ONLY to its members (viewer · editor · manager) + the owner.
// Inside a budget — a money book:
//   * ENTRY  = kind (income | expense) + amount + cause + optional note on a day
//   * CAUSE  = static (finance_causes row, created once per scope, typed
//              income / expense / both) — or free text typed for one entry
//              («أخرى» → entry.cause_text, cause_id = null)
//   * SUMMARY (RPC finance_summary) = balance now (all time) + income /
//     expense of a period + per-bucket series (day · week · month · year)
//     + totals per cause.

import type { SupabaseClient } from '@supabase/supabase-js';

// =====================================================================
// Rows
// =====================================================================
export type FinanceKind = 'income' | 'expense';
export type CauseKind = FinanceKind | 'both';

export type BudgetRole = 'viewer' | 'editor' | 'manager';

export interface FinanceBudget {
  id: string;
  name: string;
  description: string | null;
  church_id: string | null;    // null = «الكل»
  service_id: string | null;
  class_id: string | null;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  edited_at?: string;
  edited_by?: string | null;
}

/** finance_my_budgets() row */
export interface FinanceBudgetSummary extends FinanceBudget {
  role: BudgetRole;
  members: number;
  income: number;
  expense: number;
  last_entry: string | null;
}

export interface FinanceBudgetMember {
  id: string;
  budget_id: string;
  servant_id: string;
  role: BudgetRole;
  created_at: string;
  full_name: string;
  user_id: string;
  photo_url: string | null;
  servant_role: string;
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
}

export interface ServantCandidate {
  id: string;
  full_name: string;
  user_id: string;
  photo_url: string | null;
  role: string;
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
}

export interface FinanceCause {
  id: string;
  budget_id: string;
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
  name: string;
  kind: CauseKind;
  color: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

export interface FinanceEntry {
  id: string;
  budget_id: string;
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
  kind: FinanceKind;
  amount: number;
  cause_id: string | null;
  /** the cause name at the time of the entry (mirrored for static causes; typed for «أخرى») */
  cause_text: string | null;
  note: string | null;
  entry_date: string;   // YYYY-MM-DD
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

export interface FinancePermissions { view: boolean; create: boolean }

export const ROLE_LABELS: Record<BudgetRole, string> = { viewer: 'يرى', editor: 'يسجّل', manager: 'يدير' };
export const ROLE_DESCS: Record<BudgetRole, string> = {
  viewer: 'يرى الرصيد والقيود فقط',
  editor: 'يرى ويسجّل إيرادات ومصروفات',
  manager: 'يسجّل ويعدّل ويحذف ويدير الأسباب والأعضاء والميزانية',
};
export const roleAtLeast = (r: BudgetRole | null | undefined, min: BudgetRole) =>
  r === 'manager' || (r === 'editor' && min !== 'manager') || (r === 'viewer' && min === 'viewer');

export type FinanceBucket = 'day' | 'week' | 'month' | 'year';

export interface FinanceSummary {
  from: string;
  to: string;
  bucket: FinanceBucket;
  balance: { income: number; expense: number; net: number };
  period: { income: number; expense: number; net: number; count: number };
  series: { key: string; income: number; expense: number }[];
  by_cause: { kind: FinanceKind; cause_id: string | null; cause: string; total: number; count: number }[];
}

// =====================================================================
// Labels
// =====================================================================
export const KIND_LABELS: Record<FinanceKind, string> = { income: 'إيراد', expense: 'مصروف' };
export const KIND_PLURAL: Record<FinanceKind, string> = { income: 'الإيرادات', expense: 'المصروفات' };
export const CAUSE_KIND_LABELS: Record<CauseKind, string> = { income: 'إيراد فقط', expense: 'مصروف فقط', both: 'إيراد ومصروف' };

export const CURRENCY = 'ج.م';
const moneyFmt = new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const fmtMoney = (n: number) => `${moneyFmt.format(Math.abs(n))} ${CURRENCY}`;
export const fmtSignedMoney = (n: number) => (n < 0 ? `− ${fmtMoney(n)}` : fmtMoney(n));

/** «هذا الشهر · هذه السنة · …» — preset periods for the overview */
export type FinancePeriodPreset = 'month' | 'last_month' | 'year' | '30d' | '12m' | 'all' | 'custom';

export interface FinancePeriod { from: string | null; to: string | null; bucket: FinanceBucket }

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const shiftDays = (s: string, n: number) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
};

export const PERIOD_PRESETS: { value: FinancePeriodPreset; label: string }[] = [
  { value: 'month', label: 'هذا الشهر' },
  { value: 'last_month', label: 'الشهر الماضي' },
  { value: '30d', label: 'آخر 30 يوم' },
  { value: 'year', label: 'هذه السنة' },
  { value: '12m', label: 'آخر 12 شهر' },
  { value: 'all', label: 'كل الوقت' },
  { value: 'custom', label: 'فترة مخصصة' },
];

/** Resolve a preset to from/to/bucket (today = the working day YYYY-MM-DD). */
export function resolvePeriod(preset: FinancePeriodPreset, today: string, custom?: { from: string; to: string }): FinancePeriod {
  const [y, m] = today.split('-').map(Number);
  switch (preset) {
    case 'month': return { from: ymd(y, m, 1), to: ymd(y, m, daysInMonth(y, m)), bucket: 'day' };
    case 'last_month': {
      const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1;
      return { from: ymd(py, pm, 1), to: ymd(py, pm, daysInMonth(py, pm)), bucket: 'day' };
    }
    case '30d': return { from: shiftDays(today, -29), to: today, bucket: 'day' };
    case 'year': return { from: ymd(y, 1, 1), to: ymd(y, 12, 31), bucket: 'month' };
    case '12m': {
      const sy = m === 12 ? y : y - 1; const sm = m === 12 ? 1 : m + 1;
      return { from: ymd(sy, sm, 1), to: ymd(y, m, daysInMonth(y, m)), bucket: 'month' };
    }
    case 'all': return { from: '2000-01-01', to: ymd(y, 12, 31), bucket: 'year' };
    case 'custom': {
      const from = custom?.from || shiftDays(today, -29);
      const to = custom?.to || today;
      const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1);
      return { from, to, bucket: days <= 62 ? 'day' : days <= 400 ? 'month' : 'year' };
    }
  }
}

/** Every bucket key between from..to so the chart shows zero bars for empty buckets. */
export function financeBucketKeys(p: FinancePeriod): string[] {
  if (!p.from || !p.to) return [];
  const out: string[] = [];
  const [fy, fm] = p.from.split('-').map(Number);
  const [ty, tm] = p.to.split('-').map(Number);
  if (p.bucket === 'day') {
    for (let k = p.from; k <= p.to; k = shiftDays(k, 1)) out.push(k);
  } else if (p.bucket === 'week') {
    const [y, m, d] = p.from.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    for (let k = shiftDays(p.from, -((dow + 6) % 7)); k <= p.to; k = shiftDays(k, 7)) out.push(k);
  } else if (p.bucket === 'month') {
    for (let t = fy * 12 + fm - 1; t <= ty * 12 + tm - 1; t++) out.push(ymd(Math.floor(t / 12), (t % 12) + 1, 1));
  } else {
    for (let yy = fy; yy <= ty; yy++) out.push(ymd(yy, 1, 1));
  }
  return out;
}

export function financeBucketLabel(key: string, bucket: FinanceBucket, long = false): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (bucket === 'year') return String(y);
  if (bucket === 'month') return new Intl.DateTimeFormat('ar-EG', { timeZone: 'UTC', month: long ? 'long' : 'short', year: long ? 'numeric' : '2-digit' }).format(dt);
  if (bucket === 'week') return `أسبوع ${new Intl.DateTimeFormat('ar-EG', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(dt)}`;
  return new Intl.DateTimeFormat('ar-EG', { timeZone: 'UTC', day: 'numeric', month: long ? 'long' : 'short', ...(long ? { weekday: 'long' } : {}) }).format(dt);
}

export const fmtEntryDay = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Intl.DateTimeFormat('ar-EG', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)));
};

// =====================================================================
// Fetchers
// =====================================================================
export async function fetchFinancePermissions(supabase: SupabaseClient): Promise<FinancePermissions> {
  const { data, error } = await supabase.rpc('finance_permissions');
  if (error) throw error;
  const p = (data ?? {}) as Partial<FinancePermissions>;
  return { view: !!p.view, create: !!p.create };
}

export async function fetchMyBudgets(supabase: SupabaseClient): Promise<FinanceBudgetSummary[]> {
  const { data, error } = await supabase.rpc('finance_my_budgets');
  if (error) throw error;
  return ((data ?? []) as FinanceBudgetSummary[]).map((b) => ({ ...b, income: Number(b.income), expense: Number(b.expense), members: Number(b.members) }));
}

export async function fetchBudgetMembers(supabase: SupabaseClient, budgetId: string): Promise<FinanceBudgetMember[]> {
  const { data, error } = await supabase.rpc('finance_budget_members_list', { p_budget: budgetId });
  if (error) throw error;
  return (data ?? []) as FinanceBudgetMember[];
}

export async function fetchBudgetCandidates(supabase: SupabaseClient, budgetId: string, q = ''): Promise<ServantCandidate[]> {
  const { data, error } = await supabase.rpc('finance_budget_candidates', { p_budget: budgetId, p_q: q });
  if (error) throw error;
  return (data ?? []) as ServantCandidate[];
}

export async function fetchFinanceCauses(supabase: SupabaseClient, budgetId: string): Promise<FinanceCause[]> {
  const { data, error } = await supabase.from('finance_causes').select('*').eq('budget_id', budgetId).order('sort_order').order('name');
  if (error) throw error;
  return (data ?? []) as FinanceCause[];
}

export interface EntryFilter {
  budget_id: string;
  kind?: FinanceKind | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
}

export async function fetchFinanceEntries(supabase: SupabaseClient, f: EntryFilter): Promise<FinanceEntry[]> {
  let q = supabase.from('finance_entries').select('*').eq('budget_id', f.budget_id).order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(f.limit ?? 300);
  if (f.kind) q = q.eq('kind', f.kind);
  if (f.from) q = q.gte('entry_date', f.from);
  if (f.to) q = q.lte('entry_date', f.to);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as FinanceEntry[]).map((e) => ({ ...e, amount: Number(e.amount) }));
}

export async function fetchFinanceSummary(
  supabase: SupabaseClient,
  budgetId: string,
  period: FinancePeriod,
): Promise<FinanceSummary> {
  const { data, error } = await supabase.rpc('finance_summary', {
    p_budget: budgetId, p_from: period.from, p_to: period.to, p_bucket: period.bucket,
  });
  if (error) throw error;
  const s = data as FinanceSummary;
  const num = (v: unknown) => Number(v ?? 0);
  return {
    ...s,
    balance: { income: num(s.balance.income), expense: num(s.balance.expense), net: num(s.balance.net) },
    period: { income: num(s.period.income), expense: num(s.period.expense), net: num(s.period.net), count: num(s.period.count) },
    series: (s.series ?? []).map((x) => ({ key: x.key, income: num(x.income), expense: num(x.expense) })),
    by_cause: (s.by_cause ?? []).map((x) => ({ ...x, total: num(x.total), count: num(x.count) })),
  };
}

// =====================================================================
// Writers
// =====================================================================
export type BudgetInput = Pick<FinanceBudget, 'name' | 'description' | 'church_id' | 'service_id' | 'class_id'> & Partial<Pick<FinanceBudget, 'is_active'>>;

export async function saveFinanceBudget(supabase: SupabaseClient, input: BudgetInput, id?: string): Promise<FinanceBudget> {
  const q = id
    ? supabase.from('finance_budgets').update(input).eq('id', id)
    : supabase.from('finance_budgets').insert(input);
  const { data, error } = await q.select('*').single();
  if (error) throw error;
  return data as FinanceBudget;
}

export async function deleteFinanceBudget(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('finance_budgets').delete().eq('id', id);
  if (error) throw error;
}

export async function addBudgetMembers(supabase: SupabaseClient, budgetId: string, servantIds: string[], role: BudgetRole): Promise<void> {
  if (servantIds.length === 0) return;
  const { error } = await supabase.from('finance_budget_members').insert(servantIds.map((servant_id) => ({ budget_id: budgetId, servant_id, role })));
  if (error) throw error;
}

export async function setBudgetMemberRole(supabase: SupabaseClient, memberId: string, role: BudgetRole): Promise<void> {
  const { error } = await supabase.from('finance_budget_members').update({ role }).eq('id', memberId);
  if (error) throw error;
}

export async function removeBudgetMember(supabase: SupabaseClient, memberId: string): Promise<void> {
  const { error } = await supabase.from('finance_budget_members').delete().eq('id', memberId);
  if (error) throw error;
}

export type EntryInput = Pick<FinanceEntry, 'budget_id' | 'kind' | 'amount' | 'cause_id' | 'cause_text' | 'note' | 'entry_date'>;

export async function saveFinanceEntry(supabase: SupabaseClient, input: EntryInput, id?: string): Promise<FinanceEntry> {
  const q = id
    ? supabase.from('finance_entries').update(input).eq('id', id)
    : supabase.from('finance_entries').insert(input);
  const { data, error } = await q.select('*').single();
  if (error) throw error;
  return { ...(data as FinanceEntry), amount: Number((data as FinanceEntry).amount) };
}

export async function deleteFinanceEntry(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('finance_entries').delete().eq('id', id);
  if (error) throw error;
}

export type CauseInput = Pick<FinanceCause, 'budget_id' | 'name' | 'kind'> & Partial<Pick<FinanceCause, 'color' | 'is_active' | 'sort_order'>>;

export async function saveFinanceCause(supabase: SupabaseClient, input: CauseInput, id?: string): Promise<FinanceCause> {
  const q = id
    ? supabase.from('finance_causes').update(input).eq('id', id)
    : supabase.from('finance_causes').insert(input);
  const { data, error } = await q.select('*').single();
  if (error) throw error;
  return data as FinanceCause;
}

export async function deleteFinanceCause(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('finance_causes').delete().eq('id', id);
  if (error) throw error;
}

// =====================================================================
// Helpers
// =====================================================================
/** Active causes of the budget that fit the entry kind. */
export function causesFor(causes: FinanceCause[], kind: FinanceKind): FinanceCause[] {
  return causes.filter((c) => c.is_active && (c.kind === 'both' || c.kind === kind));
}

/** «كنيسة أ ← مدارس الأحد ← فصل ٣» — or «الكل» for a budget without a place. */
export function budgetPlaceLabel(
  b: { church_id: string | null; service_id: string | null; class_id: string | null },
  lk: { churches: { id: string; name: string }[]; services: { id: string; name: string }[]; classes: { id: string; name: string }[] },
): string {
  if (!b.church_id) return 'الكل — كل الكنائس';
  const parts = [lk.churches.find((x) => x.id === b.church_id)?.name ?? '—'];
  if (b.service_id) parts.push(lk.services.find((x) => x.id === b.service_id)?.name ?? '—');
  if (b.class_id) parts.push(lk.classes.find((x) => x.id === b.class_id)?.name ?? '—');
  return parts.join(' ← ');
}

/** Friendly message for the DB errors the module raises. */
export function financeErrorMessage(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? '';
  if (msg.includes('row-level security') || msg.includes('not_allowed')) return 'ليس لديك صلاحية على هذا النطاق';
  if (msg.includes('cause_kind_mismatch')) return 'هذا السبب لا يصلح لهذا النوع (إيراد / مصروف)';
  if (msg.includes('cause_out_of_scope')) return 'هذا السبب لا ينتمي إلى هذه الميزانية';
  if (msg.includes('budget_not_found')) return 'الميزانية غير موجودة';
  if (msg.includes('finance_budget_members_budget_id_servant_id_key')) return 'هذا الخادم عضو بالفعل';
  if (msg.includes('uq_finance_causes_budget_name')) return 'يوجد سبب بنفس الاسم في هذه الميزانية';
  if (msg.includes('finance_entries_cause_chk')) return 'اختر سبباً أو اكتبه';
  if (msg.includes('finance_entries_amount_check') || msg.includes('amount')) return 'المبلغ يجب أن يكون أكبر من صفر';
  if (msg.includes('uq_finance_causes_scope_name')) return 'يوجد سبب بنفس الاسم في هذا النطاق';
  if (msg.includes('does not exist') || msg.includes('schema cache')) return 'تعذر الوصول — تأكد من تطبيق تحديث قاعدة البيانات (20260929120000_finance_budgets)';
  return msg ? `تعذر الحفظ — ${msg}` : 'تعذر الحفظ';
}
