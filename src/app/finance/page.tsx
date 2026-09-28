'use client';

// ---------- FINANCE MODULE (الخزينة → الميزانيات) — /finance ----------
// Scenario:
//   1. /finance            — MY BUDGETS: the budgets I am a member of (or all,
//                            for the owner) with role · balance; «+ ميزانية»
//                            creates one for a church / service / class or «الكل».
//   2. /finance?b=<id>     — INSIDE A BUDGET (only its members get here):
//        نظرة عامة — balance now · period KPIs · chart per day / month / year ·
//                    totals per cause
//        القيود    — entries grouped by day, kind filter, edit / delete (manager)
//        الأسباب   — static causes of the budget (manager)
//        الأعضاء   — who sees the budget and with which role (manager adds /
//                    changes / removes)
//      «+ إيراد» / «+ مصروف» for editors and managers.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  Wallet, ArrowRight, Loader2, Plus, TrendingUp, TrendingDown, Scale, Tag, Pencil, Trash2, ListOrdered,
  PieChart, LineChart, PenLine, Info, Lock, CalendarDays, Users, UserPlus, User, ChevronLeft, Globe, X, Crown,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { useAppDate } from '@/lib/app-date-context';
import { createClient } from '@/lib/supabase/client';
import { cachedLookup } from '@/lib/queries';
import { useDebouncedRealtime } from '@/lib/realtime';
import { useNavLabel } from '@/lib/customization-context';
import { cairoToday } from '@/lib/time';
import type { Church, Service, ClassRoom } from '@/lib/types';
import { SectionCard, KpiTile, StackedBarChart, RankedBars } from '@/components/stats/Charts';
import type { Series } from '@/lib/stats';
import {
  fetchFinancePermissions, fetchMyBudgets, fetchBudgetMembers, fetchFinanceCauses, fetchFinanceEntries, fetchFinanceSummary,
  deleteFinanceEntry, deleteFinanceCause, deleteFinanceBudget, setBudgetMemberRole, removeBudgetMember,
  resolvePeriod, financeBucketKeys, financeBucketLabel, fmtMoney, fmtSignedMoney, fmtEntryDay, financeErrorMessage, budgetPlaceLabel, roleAtLeast,
  PERIOD_PRESETS, KIND_LABELS, KIND_PLURAL, CAUSE_KIND_LABELS, ROLE_LABELS, ROLE_DESCS,
  type FinanceCause, type FinanceEntry, type FinancePermissions, type FinanceSummary, type FinanceKind, type FinancePeriodPreset, type CauseKind,
  type FinanceBudget, type FinanceBudgetSummary, type FinanceBudgetMember, type BudgetRole,
} from '@/lib/finance';
import { EntryFormModal, CauseFormModal, BudgetFormModal, AddMembersModal, type ScopeLookups } from '@/components/finance/FinanceForms';

type Tab = 'overview' | 'entries' | 'causes' | 'members';
const TABS: { key: Tab; label: string; icon: typeof Wallet }[] = [
  { key: 'overview', label: 'نظرة عامة', icon: PieChart },
  { key: 'entries', label: 'القيود', icon: ListOrdered },
  { key: 'causes', label: 'الأسباب', icon: Tag },
  { key: 'members', label: 'الأعضاء', icon: Users },
];

export default function FinancePage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>}>
        <FinanceModule />
      </Suspense>
    </AppShell>
  );
}

function useLookups() {
  const [supabase] = useState(() => createClient());
  const [lookups, setLookups] = useState<ScopeLookups>({ churches: [], services: [], classes: [] });
  useEffect(() => {
    (async () => {
      const [churches, services, classes] = await Promise.all([
        cachedLookup<Church>(supabase, 'churches'),
        cachedLookup<Service>(supabase, 'services'),
        cachedLookup<ClassRoom>(supabase, 'classes'),
      ]);
      setLookups({ churches, services, classes });
    })();
  }, [supabase]);
  return lookups;
}

function FinanceModule() {
  const params = useSearchParams();
  const budgetId = params.get('b');
  const lookups = useLookups();
  return budgetId ? <BudgetDetail key={budgetId} budgetId={budgetId} lookups={lookups} /> : <BudgetList lookups={lookups} />;
}

// =====================================================================
// 1. MY BUDGETS
// =====================================================================
function BudgetList({ lookups }: { lookups: ScopeLookups }) {
  const pageName = useNavLabel('finance');
  const { profile } = useAuth();
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [perms, setPerms] = useState<FinancePermissions>({ view: false, create: false });
  const [budgets, setBudgets] = useState<FinanceBudgetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<{ open: boolean; item: FinanceBudget | null }>({ open: false, item: null });

  const load = useCallback(async () => {
    try {
      const [p, bs] = await Promise.all([fetchFinancePermissions(supabase), fetchMyBudgets(supabase)]);
      setPerms(p); setBudgets(bs); setLoadError('');
    } catch (err) {
      setLoadError(financeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [supabase]);
  useEffect(() => { if (profile?.status === 'approved') load(); }, [profile?.status, load]);
  useDebouncedRealtime(supabase, 'finance-budgets', [{ table: 'finance_budgets' }, { table: 'finance_budget_members' }, { table: 'finance_entries' }], load, {
    enabled: profile?.status === 'approved', delayMs: 600,
  });

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>;

  const total = budgets.reduce((a, b) => a + (b.is_active ? b.income - b.expense : 0), 0);

  return (
    <>
      <section className="mb-3 flex items-center gap-2">
        <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100"><ArrowRight className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-extrabold"><Wallet className="h-5 w-5 text-green-700" /> {pageName}</h2>
          <p className="mt-0.5 text-xs text-slate-500">ميزانيات — كل ميزانية لكنيسة أو خدمة أو فصل أو الكل، ولا يراها إلا المسموح لهم</p>
        </div>
        {perms.create && (
          <button id="finance-budget-new" type="button" onClick={() => setForm({ open: true, item: null })} className="btn-primary flex items-center gap-1.5 !py-2 !px-3 text-sm">
            <Plus className="h-4 w-4" /> ميزانية
          </button>
        )}
      </section>

      {loadError && <p className="mb-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">{loadError}</p>}

      {budgets.length > 1 && (
        <div className="card mb-3 flex items-center gap-3 !py-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-100 text-green-700"><Scale className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-slate-500">مجموع أرصدة ميزانياتك المفعّلة ({budgets.filter((b) => b.is_active).length})</p>
            <p className={`text-xl font-extrabold tabular-nums ${total >= 0 ? 'text-green-700' : 'text-rose-700'}`}>{fmtSignedMoney(total)}</p>
          </div>
        </div>
      )}

      {budgets.length === 0 ? (
        <div className="card py-12 text-center">
          <Wallet className="mx-auto mb-2 h-10 w-10 text-slate-300" />
          <p className="font-bold text-slate-500">{perms.create ? 'لا توجد ميزانيات بعد' : 'لم تُضَف إلى أي ميزانية بعد'}</p>
          <p className="mt-1 text-xs font-bold text-slate-400">
            {perms.create ? 'أنشئ ميزانية لكنيسة أو خدمة أو فصل ثم أضف الأعضاء المسموح لهم' : 'يضيفك مدير الميزانية كعضو فتظهر هنا'}
          </p>
          {perms.create && (
            <button type="button" onClick={() => setForm({ open: true, item: null })} className="btn-primary mt-4 inline-flex items-center gap-1.5 !py-2 !px-4 text-sm">
              <Plus className="h-4 w-4" /> أنشئ أول ميزانية
            </button>
          )}
        </div>
      ) : (
        <ul id="finance-budgets" className="space-y-2">
          {budgets.map((b) => {
            const net = b.income - b.expense;
            return (
              <li key={b.id}>
                <button id={`finance-budget-${b.id}`} type="button" onClick={() => router.push(`/finance?b=${b.id}`)}
                  className={`card flex w-full items-center gap-3 text-right transition active:scale-[0.99] ${b.is_active ? '' : 'opacity-60'}`}>
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${net >= 0 ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'}`}>
                    {b.church_id ? <Wallet className="h-5 w-5" /> : <Globe className="h-5 w-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-extrabold text-slate-800">{b.name}</span>
                      {!b.is_active && <span className="rounded-full bg-slate-200 px-1.5 text-[9px] font-extrabold text-slate-600">موقوفة</span>}
                    </span>
                    <span className="block truncate text-[11px] font-bold text-slate-400">{budgetPlaceLabel(b, lookups)}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-[10px] font-bold text-slate-400">
                      <RolePill role={b.role} />
                      <span className="inline-flex items-center gap-0.5"><Users className="h-3 w-3" /> {b.members}</span>
                      {b.last_entry && <span>آخر قيد {fmtEntryDay(b.last_entry)}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-left">
                    <span className={`block text-base font-extrabold tabular-nums ${net >= 0 ? 'text-green-700' : 'text-rose-700'}`}>{fmtSignedMoney(net)}</span>
                    <span className="block text-[10px] font-bold text-slate-400">+{fmtMoney(b.income)} · −{fmtMoney(b.expense)}</span>
                  </span>
                  <ChevronLeft className="h-4 w-4 shrink-0 text-slate-300" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {form.open && (
        <BudgetFormModal item={form.item} lookups={lookups}
          onSaved={(b, isNew) => { setForm({ open: false, item: null }); if (isNew) router.push(`/finance?b=${b.id}&tab=members`); else load(); }}
          onClose={() => setForm({ open: false, item: null })} />
      )}
    </>
  );
}

function RolePill({ role }: { role: BudgetRole }) {
  const cls = role === 'manager' ? 'bg-amber-100 text-amber-700' : role === 'editor' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600';
  return <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold ${cls}`}>{role === 'manager' && <Crown className="h-2.5 w-2.5" />}{ROLE_LABELS[role]}</span>;
}

// =====================================================================
// 2. INSIDE A BUDGET
// =====================================================================
function BudgetDetail({ budgetId, lookups }: { budgetId: string; lookups: ScopeLookups }) {
  const { profile } = useAuth();
  const { now } = useAppDate();
  const router = useRouter();
  const params = useSearchParams();
  const [supabase] = useState(() => createClient());
  const today = cairoToday(now());

  const tab = ((params.get('tab') as Tab) || 'overview');
  const go = (t: Tab) => router.replace(`/finance?b=${budgetId}${t === 'overview' ? '' : `&tab=${t}`}`);

  // ---------- period ----------
  const [preset, setPreset] = useState<FinancePeriodPreset>('month');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const period = useMemo(() => resolvePeriod(preset, today, custom.from && custom.to ? custom : undefined), [preset, today, custom]);

  // ---------- data ----------
  const [budget, setBudget] = useState<FinanceBudgetSummary | null>(null);
  const [members, setMembers] = useState<FinanceBudgetMember[]>([]);
  const [causes, setCauses] = useState<FinanceCause[]>([]);
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [kindFilter, setKindFilter] = useState<FinanceKind | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      const all = await fetchMyBudgets(supabase);
      const b = all.find((x) => x.id === budgetId) ?? null;
      setBudget(b);
      if (!b) { setNotFound(true); setLoading(false); return; }
      const [ms, cs, es, sm] = await Promise.all([
        fetchBudgetMembers(supabase, budgetId),
        fetchFinanceCauses(supabase, budgetId),
        fetchFinanceEntries(supabase, { budget_id: budgetId, kind: kindFilter === 'all' ? null : kindFilter, from: period.from, to: period.to }),
        fetchFinanceSummary(supabase, budgetId, period),
      ]);
      setMembers(ms); setCauses(cs); setEntries(es); setSummary(sm); setLoadError(''); setNotFound(false);
    } catch (err) {
      setLoadError(financeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [supabase, budgetId, period, kindFilter]);
  useEffect(() => { if (profile?.status === 'approved') load(); }, [profile?.status, load]);
  useDebouncedRealtime(supabase, `finance-budget-${budgetId}`, [{ table: 'finance_entries' }, { table: 'finance_causes' }, { table: 'finance_budget_members' }, { table: 'finance_budgets' }], load, {
    enabled: profile?.status === 'approved', delayMs: 600,
  });

  const role = budget?.role ?? null;
  const canAdd = roleAtLeast(role, 'editor');
  const canManage = roleAtLeast(role, 'manager');

  // ---------- modals ----------
  const [entryForm, setEntryForm] = useState<{ open: boolean; item: FinanceEntry | null; kind: FinanceKind }>({ open: false, item: null, kind: 'expense' });
  const [causeForm, setCauseForm] = useState<{ open: boolean; item: FinanceCause | null; kind?: CauseKind }>({ open: false, item: null });
  const [budgetForm, setBudgetForm] = useState(false);
  const [membersForm, setMembersForm] = useState(false);
  const [deleteEntry, setDeleteEntry] = useState<FinanceEntry | null>(null);
  const [deleteCause, setDeleteCause] = useState<FinanceCause | null>(null);
  const [deleteBudgetOpen, setDeleteBudgetOpen] = useState(false);
  const [removeMember, setRemoveMember] = useState<FinanceBudgetMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2500); return () => clearTimeout(t); }, [toast]);

  const onEntrySaved = (e: FinanceEntry) => {
    setEntryForm({ open: false, item: null, kind: e.kind });
    setToast(`${KIND_LABELS[e.kind]} ${fmtMoney(e.amount)} — ${e.cause_text ?? ''} ✓`);
    load();
  };
  const onCauseSaved = (c: FinanceCause) => {
    setCauses((prev) => { const i = prev.findIndex((x) => x.id === c.id); return i >= 0 ? prev.map((x) => (x.id === c.id ? c : x)) : [...prev, c]; });
    setCauseForm({ open: false, item: null });
  };
  const run = async (fn: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    try { await fn(); after?.(); } catch (err) { setToast(financeErrorMessage(err)); } finally { setBusy(false); }
  };
  const doDeleteEntry = () => deleteEntry && run(() => deleteFinanceEntry(supabase, deleteEntry.id), () => { setDeleteEntry(null); load(); });
  const doDeleteCause = () => deleteCause && run(() => deleteFinanceCause(supabase, deleteCause.id), () => { setCauses((p) => p.filter((x) => x.id !== deleteCause.id)); setDeleteCause(null); });
  const doDeleteBudget = () => run(() => deleteFinanceBudget(supabase, budgetId), () => router.replace('/finance'));
  const doRemoveMember = () => removeMember && run(() => removeBudgetMember(supabase, removeMember.id), () => { setRemoveMember(null); load(); });
  const changeRole = (m: FinanceBudgetMember, r: BudgetRole) => run(() => setBudgetMemberRole(supabase, m.id, r), () => setMembers((p) => p.map((x) => (x.id === m.id ? { ...x, role: r } : x))));

  // ---------- chart data ----------
  const chart = useMemo(() => {
    if (!summary) return null;
    const keys = financeBucketKeys(period);
    const byKey = new Map(summary.series.map((s) => [s.key, s]));
    const income = keys.map((k) => byKey.get(k)?.income ?? 0);
    const expense = keys.map((k) => byKey.get(k)?.expense ?? 0);
    const series: Series[] = [
      { key: 'income', label: 'الإيرادات', total: income.reduce((a, b) => a + b, 0), values: income },
      { key: 'expense', label: 'المصروفات', total: expense.reduce((a, b) => a + b, 0), values: expense },
    ];
    return {
      series,
      labels: keys.map((k) => financeBucketLabel(k, period.bucket)),
      longLabels: keys.map((k) => financeBucketLabel(k, period.bucket, true)),
      byCause: (kind: FinanceKind) => summary.by_cause.filter((c) => c.kind === kind).map((c) => ({
        key: `${c.kind}-${c.cause_id ?? c.cause}`,
        label: c.cause,
        value: c.total,
        sublabel: `${c.count} ${c.count === 1 ? 'قيد' : 'قيود'}${c.cause_id ? '' : ' · سبب مكتوب'}`,
        color: kind === 'income' ? '#10b981' : '#f43f5e',
      })),
    };
  }, [summary, period]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>;

  if (notFound || !budget) {
    return (
      <div className="card py-12 text-center">
        <Lock className="mx-auto mb-2 h-10 w-10 text-slate-300" />
        <p className="font-bold text-slate-500">هذه الميزانية غير متاحة لك</p>
        <p className="mt-1 text-xs font-bold text-slate-400">لا تظهر الميزانية إلا لأعضائها — اطلب من مديرها إضافتك</p>
        <Link href="/finance" className="btn-secondary mt-4 inline-flex items-center gap-1 !py-2 !px-4 text-sm"><ArrowRight className="h-4 w-4" /> ميزانياتي</Link>
      </div>
    );
  }

  const bucketWord = period.bucket === 'day' ? 'يومياً' : period.bucket === 'week' ? 'أسبوعياً' : period.bucket === 'month' ? 'شهرياً' : 'سنوياً';
  const periodLabel = PERIOD_PRESETS.find((p) => p.value === preset)?.label ?? '';

  return (
    <>
      {/* ---------- header ---------- */}
      <section className="mb-3 flex items-center gap-2">
        <Link href="/finance" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100"><ArrowRight className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 truncate text-lg font-extrabold">
            {budget.church_id ? <Wallet className="h-5 w-5 shrink-0 text-green-700" /> : <Globe className="h-5 w-5 shrink-0 text-green-700" />}
            <span className="truncate">{budget.name}</span>
            {!budget.is_active && <span className="rounded-full bg-slate-200 px-1.5 text-[9px] font-extrabold text-slate-600">موقوفة</span>}
          </h2>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-500">{budgetPlaceLabel(budget, lookups)} <RolePill role={budget.role} /></p>
        </div>
        {canManage && (
          <button type="button" aria-label="تعديل الميزانية" onClick={() => setBudgetForm(true)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>
        )}
      </section>

      {/* ---------- quick actions ---------- */}
      {canAdd && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <button id="finance-add-income" type="button" onClick={() => setEntryForm({ open: true, item: null, kind: 'income' })}
            className="flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 py-3 font-extrabold text-white shadow-md active:scale-[0.98]">
            <Plus className="h-4 w-4" /><TrendingUp className="h-4 w-4" /> إيراد
          </button>
          <button id="finance-add-expense" type="button" onClick={() => setEntryForm({ open: true, item: null, kind: 'expense' })}
            className="flex items-center justify-center gap-1.5 rounded-2xl bg-rose-600 py-3 font-extrabold text-white shadow-md active:scale-[0.98]">
            <Plus className="h-4 w-4" /><TrendingDown className="h-4 w-4" /> مصروف
          </button>
        </div>
      )}

      {loadError && <p className="mb-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">{loadError}</p>}

      {/* ---------- tabs ---------- */}
      <div className="mb-3 grid grid-cols-4 gap-1 rounded-2xl bg-slate-100 p-1">
        {TABS.map((t) => (
          <button key={t.key} id={`finance-tab-${t.key}`} type="button" onClick={() => go(t.key)} aria-pressed={tab === t.key}
            className={`flex items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-extrabold ${tab === t.key ? 'bg-white text-primary-700 shadow' : 'text-slate-500'}`}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {/* ---------- period ---------- */}
      {(tab === 'overview' || tab === 'entries') && (
        <div className="card mb-3 !p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-extrabold text-slate-500"><CalendarDays className="h-3.5 w-3.5" /> الفترة</div>
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
            {PERIOD_PRESETS.map((p) => (
              <button key={p.value} id={`finance-period-${p.value}`} type="button" onClick={() => setPreset(p.value)} aria-pressed={preset === p.value}
                className={`shrink-0 rounded-full border-2 px-3 py-1 text-[11px] font-extrabold ${preset === p.value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-600'}`}>{p.label}</button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input type="date" aria-label="من" className="input-field !py-2 !px-2 text-xs" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              <input type="date" aria-label="إلى" className="input-field !py-2 !px-2 text-xs" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </div>
          )}
        </div>
      )}

      {/* ================= OVERVIEW ================= */}
      {tab === 'overview' && summary && chart && (
        <div className="space-y-3">
          <div id="finance-balance" className={`card !border-0 bg-gradient-to-l ${summary.balance.net >= 0 ? 'from-green-700 to-emerald-500' : 'from-rose-700 to-rose-500'} text-white`}>
            <div className="flex items-center gap-2 text-xs font-bold text-white/80"><Scale className="h-4 w-4" /> الرصيد الحالي (كل الوقت)</div>
            <p className="mt-1 text-3xl font-extrabold tabular-nums">{fmtSignedMoney(summary.balance.net)}</p>
            <div className="mt-2 flex gap-4 text-[11px] font-bold text-white/85">
              <span className="inline-flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" /> دخل {fmtMoney(summary.balance.income)}</span>
              <span className="inline-flex items-center gap-1"><TrendingDown className="h-3.5 w-3.5" /> خرج {fmtMoney(summary.balance.expense)}</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <KpiTile id="finance-kpi-income" icon={TrendingUp} tone="emerald" compact value={fmtMoney(summary.period.income)} label="إيرادات الفترة" />
            <KpiTile id="finance-kpi-expense" icon={TrendingDown} tone="rose" compact value={fmtMoney(summary.period.expense)} label="مصروفات الفترة" />
            <KpiTile id="finance-kpi-net" icon={Scale} tone={summary.period.net >= 0 ? 'primary' : 'rose'} compact value={fmtSignedMoney(summary.period.net)} label="صافي الفترة" hint={`${summary.period.count} قيد`} />
          </div>

          <SectionCard id="finance-timeline" icon={LineChart} tone="emerald" title={`الإيرادات والمصروفات ${bucketWord}`} subtitle={periodLabel}>
            <StackedBarChart id="finance-chart" series={chart.series} labels={chart.labels} longLabels={chart.longLabels} mode="grouped" emptyText="لا توجد قيود في هذه الفترة" />
          </SectionCard>

          <div className="grid gap-3 sm:grid-cols-2">
            <SectionCard id="finance-by-cause-income" icon={TrendingUp} tone="emerald" title="الإيرادات حسب السبب" subtitle={periodLabel}>
              <RankedBars items={chart.byCause('income')} valueLabel={fmtMoney} emptyText="لا إيرادات في هذه الفترة" />
            </SectionCard>
            <SectionCard id="finance-by-cause-expense" icon={TrendingDown} tone="rose" title="المصروفات حسب السبب" subtitle={periodLabel}>
              <RankedBars items={chart.byCause('expense')} valueLabel={fmtMoney} emptyText="لا مصروفات في هذه الفترة" />
            </SectionCard>
          </div>
        </div>
      )}

      {/* ================= ENTRIES ================= */}
      {tab === 'entries' && (
        <>
          <div className="mb-3 grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
            {(['all', 'income', 'expense'] as const).map((k) => (
              <button key={k} id={`finance-kind-${k}`} type="button" onClick={() => setKindFilter(k)} aria-pressed={kindFilter === k}
                className={`rounded-xl py-1.5 text-xs font-extrabold ${kindFilter === k ? 'bg-white shadow ' + (k === 'income' ? 'text-emerald-700' : k === 'expense' ? 'text-rose-700' : 'text-primary-700') : 'text-slate-500'}`}>
                {k === 'all' ? 'الكل' : KIND_PLURAL[k]}
              </button>
            ))}
          </div>
          {entries.length === 0 ? (
            <div className="card py-10 text-center">
              <Wallet className="mx-auto mb-2 h-10 w-10 text-slate-300" />
              <p className="font-bold text-slate-500">لا توجد قيود في هذه الفترة</p>
              {canAdd && <p className="mt-1 text-xs font-bold text-slate-400">سجّل أول إيراد أو مصروف من الزرين بالأعلى</p>}
            </div>
          ) : (
            <ul id="finance-entries" className="space-y-2">
              {groupByDay(entries).map(([day, rows]) => (
                <li key={day}>
                  <div className="mb-1 flex items-center justify-between px-1 text-[11px] font-extrabold text-slate-400">
                    <span>{fmtEntryDay(day)}</span>
                    <span className="tabular-nums">{fmtSignedMoney(rows.reduce((a, r) => a + (r.kind === 'income' ? r.amount : -r.amount), 0))}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {rows.map((e) => (
                      <li key={e.id} id={`finance-entry-${e.id}`} className="card flex items-center gap-3 !p-3">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${e.kind === 'income' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                          {e.kind === 'income' ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1 truncate text-sm font-extrabold text-slate-800">
                            {e.cause_id ? <Tag className="h-3 w-3 shrink-0 text-slate-400" /> : <PenLine className="h-3 w-3 shrink-0 text-amber-500" />}
                            {e.cause_text}
                          </p>
                          <p className="truncate text-[11px] font-bold text-slate-400">{e.note ?? ''}</p>
                        </div>
                        <span className={`shrink-0 text-sm font-extrabold tabular-nums ${e.kind === 'income' ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {e.kind === 'income' ? '+' : '−'} {fmtMoney(e.amount)}
                        </span>
                        {canManage && (
                          <div className="flex shrink-0 flex-col gap-1">
                            <button type="button" aria-label="تعديل" onClick={() => setEntryForm({ open: true, item: e, kind: e.kind })} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>
                            <button type="button" aria-label="حذف" onClick={() => setDeleteEntry(e)} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ================= CAUSES ================= */}
      {tab === 'causes' && (
        <>
          <p className="mb-3 flex items-start gap-2 rounded-2xl bg-violet-50 px-3 py-2.5 text-xs font-bold text-violet-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>الأسباب الثابتة تُنشأ مرة وتُختار من قائمة عند التسجيل. وعند الحاجة إلى سبب غير موجود يختار الخادم «أخرى» ويكتبه.</span>
          </p>
          {canManage && (
            <button id="finance-cause-new" type="button" onClick={() => setCauseForm({ open: true, item: null })}
              className="btn-primary mb-3 flex w-full items-center justify-center gap-1.5">
              <Plus className="h-4 w-4" /> سبب ثابت جديد
            </button>
          )}
          {causes.length === 0 ? (
            <div className="card py-10 text-center">
              <Tag className="mx-auto mb-2 h-10 w-10 text-slate-300" />
              <p className="font-bold text-slate-500">لا توجد أسباب ثابتة في هذه الميزانية بعد</p>
              {!canManage && <p className="mt-1 flex items-center justify-center gap-1 text-xs font-bold text-slate-400"><Lock className="h-3 w-3" /> إنشاء الأسباب لمدير الميزانية</p>}
            </div>
          ) : (
            <ul id="finance-causes" className="space-y-1.5">
              {causes.map((c) => (
                <li key={c.id} id={`finance-cause-${c.id}`} className={`card flex items-center gap-3 !p-3 ${c.is_active ? '' : 'opacity-60'}`}>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${c.kind === 'income' ? 'bg-emerald-100 text-emerald-700' : c.kind === 'expense' ? 'bg-rose-100 text-rose-700' : 'bg-primary-100 text-primary-700'}`}><Tag className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-slate-800">{c.name}{!c.is_active && <span className="mr-1 text-[10px] font-bold text-slate-400">(موقوف)</span>}</p>
                    <p className="truncate text-[11px] font-bold text-slate-400">{CAUSE_KIND_LABELS[c.kind]}</p>
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 gap-1">
                      <button type="button" aria-label="تعديل" onClick={() => setCauseForm({ open: true, item: c })} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>
                      <button type="button" aria-label="حذف" onClick={() => setDeleteCause(c)} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ================= MEMBERS ================= */}
      {tab === 'members' && (
        <>
          <p className="mb-3 flex items-start gap-2 rounded-2xl bg-violet-50 px-3 py-2.5 text-xs font-bold text-violet-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>لا يرى هذه الميزانية إلا الأعضاء المذكورون هنا (ومالك التطبيق). <b>يرى</b>: الرصيد والقيود · <b>يسجّل</b>: + إيراد ومصروف · <b>يدير</b>: + تعديل وحذف والأسباب والأعضاء.</span>
          </p>
          {canManage && (
            <button id="finance-members-add" type="button" onClick={() => setMembersForm(true)} className="btn-primary mb-3 flex w-full items-center justify-center gap-1.5">
              <UserPlus className="h-4 w-4" /> إضافة أعضاء
            </button>
          )}
          <ul id="finance-members" className="space-y-1.5">
            {members.map((m) => {
              const isMe = m.servant_id === profile?.id;
              return (
                <li key={m.id} id={`finance-member-${m.id}`} className="card flex items-center gap-3 !p-3">
                  <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-slate-400">
                    {m.photo_url ? <Image src={m.photo_url} alt={m.full_name} fill sizes="40px" className="object-cover" /> : <User className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-slate-800">{m.full_name}{isMe && <span className="mr-1 text-[10px] font-bold text-slate-400">(أنت)</span>}</p>
                    <p className="truncate text-[11px] font-bold text-slate-400">{m.user_id} · {budgetPlaceLabel(m, lookups)}</p>
                  </div>
                  {canManage && !isMe ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <select aria-label="الدور" className="input-field !w-auto !py-1.5 !px-2 text-[11px] font-extrabold" value={m.role} onChange={(e) => changeRole(m, e.target.value as BudgetRole)} disabled={busy} title={ROLE_DESCS[m.role]}>
                        {(['viewer', 'editor', 'manager'] as BudgetRole[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                      <button type="button" aria-label="إزالة" onClick={() => setRemoveMember(m)} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"><X className="h-4 w-4" /></button>
                    </div>
                  ) : (
                    <RolePill role={m.role} />
                  )}
                </li>
              );
            })}
          </ul>
          {canManage && (
            <button id="finance-budget-delete" type="button" onClick={() => setDeleteBudgetOpen(true)} className="mt-6 flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-red-200 py-2.5 text-sm font-extrabold text-red-600 hover:bg-red-50">
              <Trash2 className="h-4 w-4" /> حذف الميزانية بكل قيودها
            </button>
          )}
        </>
      )}

      {/* ---------- modals ---------- */}
      {entryForm.open && (
        <EntryFormModal item={entryForm.item} budgetId={budgetId} defaultKind={entryForm.kind} causes={causes} today={today}
          onSaved={onEntrySaved} onClose={() => setEntryForm({ open: false, item: null, kind: 'expense' })}
          onNewCause={canManage ? (k) => setCauseForm({ open: true, item: null, kind: k }) : undefined} />
      )}
      {causeForm.open && (
        <CauseFormModal item={causeForm.item} budgetId={budgetId} initialKind={causeForm.kind} onSaved={onCauseSaved} onClose={() => setCauseForm({ open: false, item: null })} />
      )}
      {budgetForm && (
        <BudgetFormModal item={budget} lookups={lookups} onSaved={() => { setBudgetForm(false); load(); }} onClose={() => setBudgetForm(false)} />
      )}
      {membersForm && (
        <AddMembersModal budgetId={budgetId} lookups={lookups} onAdded={() => { setMembersForm(false); load(); }} onClose={() => setMembersForm(false)} />
      )}
      {deleteEntry && (
        <ConfirmDelete title="حذف القيد" text={`حذف ${KIND_LABELS[deleteEntry.kind]} ${fmtMoney(deleteEntry.amount)} — «${deleteEntry.cause_text}»؟ سيتغير الرصيد.`} busy={busy} onConfirm={doDeleteEntry} onClose={() => setDeleteEntry(null)} />
      )}
      {deleteCause && (
        <ConfirmDelete title="حذف السبب" text={`حذف «${deleteCause.name}»؟ القيود المسجلة به تبقى كما هي باسم السبب.`} busy={busy} onConfirm={doDeleteCause} onClose={() => setDeleteCause(null)} />
      )}
      {removeMember && (
        <ConfirmDelete title="إزالة عضو" text={`إزالة «${removeMember.full_name}» من الميزانية؟ لن يراها بعد ذلك.`} busy={busy} onConfirm={doRemoveMember} onClose={() => setRemoveMember(null)} />
      )}
      {deleteBudgetOpen && (
        <ConfirmDelete title="حذف الميزانية" text={`حذف «${budget.name}» نهائياً مع كل قيودها (${summary?.period.count ?? ''}) وأسبابها وأعضائها؟ لا يمكن التراجع.`} busy={busy} onConfirm={doDeleteBudget} onClose={() => setDeleteBudgetOpen(false)} />
      )}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
          <p className="rounded-2xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white shadow-lg">{toast}</p>
        </div>
      )}
    </>
  );
}

// ---------- small bits ----------
function ConfirmDelete({ title, text, busy, onConfirm, onClose }: { title: string; text: string; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-sm sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-2 flex items-center gap-2 text-lg font-extrabold text-red-600"><Trash2 className="h-5 w-5" /> {title}</h3>
        <p className="mb-4 text-sm font-bold text-slate-600">{text}</p>
        <div className="grid grid-cols-2 gap-2">
          <button id="finance-delete-confirm" type="button" onClick={onConfirm} disabled={busy} className="flex items-center justify-center gap-1.5 rounded-xl bg-red-500 py-2.5 font-extrabold text-white shadow active:scale-95 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} حذف
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

function groupByDay(rows: FinanceEntry[]): [string, FinanceEntry[]][] {
  const m = new Map<string, FinanceEntry[]>();
  rows.forEach((r) => { (m.get(r.entry_date) ?? m.set(r.entry_date, []).get(r.entry_date)!).push(r); });
  return Array.from(m.entries());
}
