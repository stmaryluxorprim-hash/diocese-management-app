'use client';

// ---------- Finance module forms ----------
//   EntryFormModal  — record / edit an income or expense INSIDE A BUDGET:
//                     kind · amount · cause (static list of the budget, or
//                     «أخرى» + free text) · day · note
//   CauseFormModal  — create / edit a static cause of the budget (name · kind)
//   BudgetFormModal — create / edit a budget: name · place (church → service
//                     → class, or «الكل» for the owner) · description
//   AddMembersModal — pick servants + a role (يرى · يسجّل · يدير)

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Save, Loader2, TrendingUp, TrendingDown, Tag, PenLine, Wallet, Search, Check, User, UserPlus, Globe } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { ModalFrame } from '@/components/PersonDataModals';
import type { Church, Service, ClassRoom } from '@/lib/types';
import {
  saveFinanceEntry, saveFinanceCause, saveFinanceBudget, addBudgetMembers, fetchBudgetCandidates, causesFor, financeErrorMessage,
  KIND_LABELS, CAUSE_KIND_LABELS, CURRENCY, ROLE_LABELS, ROLE_DESCS,
  type FinanceEntry, type FinanceCause, type FinanceKind, type CauseKind, type FinanceBudget, type BudgetRole, type ServantCandidate,
} from '@/lib/finance';

const ALL = 'all';
const OTHER = '__other__';

export interface ScopeLookups { churches: Church[]; services: Service[]; classes: ClassRoom[] }

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-slate-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] font-bold text-slate-400">{hint}</span>}
    </label>
  );
}

/** church → service → class selects, locked to the caller's own level. */
function useScopeState(lookups: ScopeLookups, initial?: { church_id: string; service_id: string | null; class_id: string | null } | null) {
  const { profile } = useAuth();
  const { churches, services, classes } = lookups;
  const defaultChurch = initial?.church_id ?? profile?.church_id ?? (churches.length === 1 ? churches[0].id : '');
  const [churchId, setChurchId] = useState(defaultChurch);
  const [serviceId, setServiceId] = useState(initial ? (initial.service_id ?? ALL) : (profile?.service_id ?? ALL));
  const [classId, setClassId] = useState(initial ? (initial.class_id ?? ALL) : (profile?.class_id ?? ALL));
  const churchLocked = !!profile && profile.role !== 'owner';
  const serviceLocked = !!profile && !!profile.service_id && profile.role !== 'owner' && profile.role !== 'church_manager';
  const classLocked = !!profile && !!profile.class_id && profile.role === 'class_servant';
  const visibleServices = useMemo(() => services.filter((s) => s.church_id === churchId), [services, churchId]);
  const visibleClasses = useMemo(() => classes.filter((c) => c.church_id === churchId && (serviceId === ALL || c.service_id === serviceId)), [classes, churchId, serviceId]);
  const scope = { church_id: churchId, service_id: serviceId === ALL ? null : serviceId, class_id: serviceId === ALL || classId === ALL ? null : classId };
  return { churchId, setChurchId, serviceId, setServiceId, classId, setClassId, churchLocked, serviceLocked, classLocked, visibleServices, visibleClasses, scope, churches };
}

function ScopeSelects({ id, s }: { id: string; s: ReturnType<typeof useScopeState> }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <select id={`${id}-church`} className={`input-field !px-2 text-xs font-bold ${s.churchLocked ? 'pointer-events-none bg-primary-50 opacity-80' : ''}`}
        value={s.churchId} onChange={(e) => { s.setChurchId(e.target.value); s.setServiceId(ALL); s.setClassId(ALL); }} required>
        <option value="">الكنيسة</option>
        {s.churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select id={`${id}-service`} className={`input-field !px-2 text-xs font-bold ${s.serviceLocked ? 'pointer-events-none bg-primary-50 opacity-80' : ''}`}
        value={s.serviceId} onChange={(e) => { s.setServiceId(e.target.value); s.setClassId(ALL); }}>
        <option value={ALL}>كل الخدمات</option>
        {s.visibleServices.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <select id={`${id}-class`} className={`input-field !px-2 text-xs font-bold ${s.classLocked ? 'pointer-events-none bg-primary-50 opacity-80' : ''}`}
        value={s.classId} onChange={(e) => s.setClassId(e.target.value)} disabled={s.serviceId === ALL}>
        <option value={ALL}>كل الفصول</option>
        {s.visibleClasses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
    </div>
  );
}

// =====================================================================
// EntryFormModal
// =====================================================================
export function EntryFormModal({
  item, budgetId, defaultKind = 'expense', causes, today, onSaved, onClose, onNewCause,
}: {
  item: FinanceEntry | null;
  budgetId: string;
  defaultKind?: FinanceKind;
  causes: FinanceCause[];
  today: string;
  onSaved: (e: FinanceEntry) => void;
  onClose: () => void;
  /** open the cause form for this budget (optional — only for managers) */
  onNewCause?: (kind: FinanceKind) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [kind, setKind] = useState<FinanceKind>(item?.kind ?? defaultKind);
  const [amount, setAmount] = useState(item ? String(item.amount) : '');
  const [causeSel, setCauseSel] = useState<string>(item ? (item.cause_id ?? OTHER) : '');
  const [causeText, setCauseText] = useState(item && !item.cause_id ? (item.cause_text ?? '') : '');
  const [date, setDate] = useState(item?.entry_date ?? today);
  const [note, setNote] = useState(item?.note ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const available = useMemo(() => causesFor(causes, kind), [causes, kind]);

  // when the kind / scope changes and the picked static cause no longer fits → reset
  useEffect(() => {
    if (causeSel && causeSel !== OTHER && !available.some((c) => c.id === causeSel)) setCauseSel('');
  }, [available, causeSel]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const amt = Number(amount.replace(/[^\d.]/g, ''));
    if (!amt || amt <= 0) return setError('اكتب المبلغ (أكبر من صفر)');
    if (!causeSel) return setError('اختر السبب أو «أخرى» واكتبه');
    if (causeSel === OTHER && !causeText.trim()) return setError('اكتب السبب');
    if (!date) return setError('اختر اليوم');
    setSaving(true);
    try {
      const saved = await saveFinanceEntry(supabase, {
        budget_id: budgetId,
        kind,
        amount: Math.round(amt * 100) / 100,
        cause_id: causeSel === OTHER ? null : causeSel,
        cause_text: causeSel === OTHER ? causeText.trim() : null,
        note: note.trim() || null,
        entry_date: date,
      }, item?.id);
      onSaved(saved);
    } catch (err) {
      setError(financeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const isIncome = kind === 'income';
  return (
    <ModalFrame title={item ? 'تعديل القيد' : (isIncome ? 'تسجيل إيراد' : 'تسجيل مصروف')} icon={<Wallet className="h-5 w-5 text-green-700" />} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {/* kind */}
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
          {(['income', 'expense'] as FinanceKind[]).map((k) => {
            const on = kind === k;
            const Icon = k === 'income' ? TrendingUp : TrendingDown;
            return (
              <button key={k} id={`finance-entry-kind-${k}`} type="button" onClick={() => setKind(k)} aria-pressed={on}
                className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-extrabold transition ${on ? (k === 'income' ? 'bg-emerald-500 text-white shadow' : 'bg-rose-500 text-white shadow') : 'text-slate-500'}`}>
                <Icon className="h-4 w-4" /> {KIND_LABELS[k]}
              </button>
            );
          })}
        </div>

        {/* amount */}
        <Field label={`المبلغ (${CURRENCY}) *`}>
          <div className="relative">
            <input id="finance-entry-amount" inputMode="decimal" className={`input-field !text-2xl font-extrabold tabular-nums ${isIncome ? 'text-emerald-700' : 'text-rose-700'}`}
              value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus={!item} required />
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-xs font-extrabold text-slate-400">{CURRENCY}</span>
          </div>
        </Field>

        {/* cause */}
        <Field label="السبب *" hint={available.length === 0 ? 'لا توجد أسباب ثابتة لهذا النوع في الميزانية بعد — اكتب السبب في «أخرى» أو أنشئ أسباباً ثابتة من تبويب «الأسباب»' : undefined}>
          <div className="flex flex-wrap gap-1.5">
            {available.map((c) => {
              const on = causeSel === c.id;
              return (
                <button key={c.id} type="button" onClick={() => setCauseSel(c.id)} aria-pressed={on}
                  className={`inline-flex items-center gap-1 rounded-full border-2 px-3 py-1.5 text-xs font-extrabold transition ${on ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-600'}`}>
                  <Tag className="h-3 w-3" /> {c.name}
                </button>
              );
            })}
            <button id="finance-entry-cause-other" type="button" onClick={() => setCauseSel(OTHER)} aria-pressed={causeSel === OTHER}
              className={`inline-flex items-center gap-1 rounded-full border-2 border-dashed px-3 py-1.5 text-xs font-extrabold transition ${causeSel === OTHER ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-300 bg-white text-slate-600'}`}>
              <PenLine className="h-3 w-3" /> أخرى
            </button>
          </div>
          {causeSel === OTHER && (
            <input id="finance-entry-cause-text" className="input-field mt-2" value={causeText} onChange={(e) => setCauseText(e.target.value)}
              placeholder={isIncome ? 'مثال: تبرع من أحد الآباء' : 'مثال: شراء بالونات للحفلة'} maxLength={160} autoFocus />
          )}
          {onNewCause && (
            <button type="button" onClick={() => onNewCause(kind)} className="mt-2 text-[11px] font-extrabold text-primary-600 underline-offset-2 hover:underline">
              + إنشاء سبب ثابت جديد في هذه الميزانية
            </button>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="اليوم *"><input id="finance-entry-date" type="date" className="input-field !px-2 text-xs" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="ملاحظة (اختياري)"><input id="finance-entry-note" className="input-field !px-2 text-xs" value={note} onChange={(e) => setNote(e.target.value)} placeholder="تفاصيل…" /></Field>
        </div>

        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button id="finance-entry-save" type="submit" disabled={saving} className={`flex items-center justify-center gap-1.5 rounded-xl py-3 font-extrabold text-white shadow-md active:scale-[0.98] disabled:opacity-50 ${isIncome ? 'bg-emerald-600' : 'bg-rose-600'}`}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {item ? 'حفظ' : (isIncome ? 'تسجيل الإيراد' : 'تسجيل المصروف')}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </form>
    </ModalFrame>
  );
}

// =====================================================================
// CauseFormModal
// =====================================================================
export function CauseFormModal({
  item, budgetId, initialKind, onSaved, onClose,
}: {
  item: FinanceCause | null;
  budgetId: string;
  initialKind?: CauseKind;
  onSaved: (c: FinanceCause) => void;
  onClose: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [name, setName] = useState(item?.name ?? '');
  const [kind, setKind] = useState<CauseKind>(item?.kind ?? initialKind ?? 'both');
  const [active, setActive] = useState(item?.is_active ?? true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('اسم السبب مطلوب');
    setSaving(true);
    try {
      const saved = await saveFinanceCause(supabase, { budget_id: budgetId, name: name.trim(), kind, is_active: active }, item?.id);
      onSaved(saved);
    } catch (err) {
      setError(financeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalFrame title={item ? 'تعديل السبب' : 'سبب ثابت جديد'} icon={<Tag className="h-5 w-5 text-primary-600" />} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="الاسم *">
          <input id="finance-cause-name" className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: عشور · تبرعات · رحلة · مطبوعات · ضيافة" maxLength={80} required autoFocus />
        </Field>
        <Field label="يُستخدم في">
          <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
            {(['income', 'expense', 'both'] as CauseKind[]).map((k) => (
              <button key={k} id={`finance-cause-kind-${k}`} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
                className={`rounded-xl py-2 text-[11px] font-extrabold ${kind === k ? 'bg-white shadow text-primary-700' : 'text-slate-500'}`}>{CAUSE_KIND_LABELS[k]}</button>
            ))}
          </div>
        </Field>
        {item && (
          <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
            <input type="checkbox" className="h-4 w-4" checked={active} onChange={(e) => setActive(e.target.checked)} /> مفعّل (يظهر عند التسجيل)
          </label>
        )}
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button id="finance-cause-save" type="submit" disabled={saving} className="btn-primary flex items-center justify-center gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </form>
    </ModalFrame>
  );
}

// =====================================================================
// BudgetFormModal — name · place (or «الكل», owner only) · description
// =====================================================================
export function BudgetFormModal({
  item, lookups, onSaved, onClose,
}: {
  item: FinanceBudget | null;
  lookups: ScopeLookups;
  onSaved: (b: FinanceBudget, isNew: boolean) => void;
  onClose: () => void;
}) {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const isOwner = profile?.role === 'owner';
  const [allScope, setAllScope] = useState(item ? item.church_id === null : false);
  const s = useScopeState(lookups, item && item.church_id ? { church_id: item.church_id, service_id: item.service_id, class_id: item.class_id } : null);
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [active, setActive] = useState(item?.is_active ?? true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('اسم الميزانية مطلوب');
    if (!allScope && !s.scope.church_id) return setError('اختر الكنيسة أو «الكل»');
    setSaving(true);
    try {
      const saved = await saveFinanceBudget(supabase, {
        name: name.trim(),
        description: description.trim() || null,
        church_id: allScope ? null : s.scope.church_id,
        service_id: allScope ? null : s.scope.service_id,
        class_id: allScope ? null : s.scope.class_id,
        is_active: active,
      }, item?.id);
      onSaved(saved, !item);
    } catch (err) {
      setError(financeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalFrame title={item ? 'تعديل الميزانية' : 'ميزانية جديدة'} icon={<Wallet className="h-5 w-5 text-green-700" />} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="اسم الميزانية *">
          <input id="finance-budget-name" className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: ميزانية مدارس الأحد · صندوق الرحلة · خزينة فصل ٣" maxLength={120} required autoFocus />
        </Field>
        <Field label="وصف (اختياري)">
          <textarea id="finance-budget-desc" className="input-field" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="خاصة بـ" hint={allScope ? 'ميزانية عامة لا ترتبط بمكان — للمالك فقط' : 'المكان الذي تخصه الميزانية. لا يعني أن خدام هذا المكان يرونها — يراها أعضاؤها فقط'}>
          {isOwner && (
            <button id="finance-budget-all" type="button" onClick={() => setAllScope((v) => !v)} aria-pressed={allScope}
              className={`mb-2 flex w-full items-center gap-2 rounded-2xl border-2 px-3 py-2 text-sm font-extrabold transition ${allScope ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-600'}`}>
              <Globe className="h-4 w-4" /> الكل — ميزانية عامة لكل الكنائس
            </button>
          )}
          {!allScope && <ScopeSelects id="finance-budget" s={s} />}
        </Field>
        {item && (
          <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
            <input type="checkbox" className="h-4 w-4" checked={active} onChange={(e) => setActive(e.target.checked)} /> مفعّلة
          </label>
        )}
        {!item && (
          <p className="rounded-2xl bg-violet-50 px-3 py-2 text-[11px] font-bold text-violet-800">
            ستكون أنت مدير هذه الميزانية. بعد الإنشاء أضف الأعضاء المسموح لهم من تبويب «الأعضاء» — لا يراها غيرهم.
          </p>
        )}
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button id="finance-budget-save" type="submit" disabled={saving} className="btn-primary flex items-center justify-center gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {item ? 'حفظ' : 'إنشاء الميزانية'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </form>
    </ModalFrame>
  );
}

// =====================================================================
// AddMembersModal — search servants the caller may reach, pick several, choose the role
// =====================================================================
export function AddMembersModal({
  budgetId, lookups, onAdded, onClose,
}: {
  budgetId: string;
  lookups: ScopeLookups;
  onAdded: () => void;
  onClose: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [q, setQ] = useState('');
  const [list, setList] = useState<ServantCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [role, setRole] = useState<BudgetRole>('editor');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const rows = await fetchBudgetCandidates(supabase, budgetId, q.trim());
        if (alive) setList(rows);
      } catch (err) {
        if (alive) setError(financeErrorMessage(err));
      } finally {
        if (alive) setLoading(false);
      }
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [supabase, budgetId, q]);

  const place = (c: ServantCandidate) => {
    const parts = [
      lookups.churches.find((x) => x.id === c.church_id)?.name,
      lookups.services.find((x) => x.id === c.service_id)?.name,
      lookups.classes.find((x) => x.id === c.class_id)?.name,
    ].filter(Boolean);
    return parts.join(' ← ') || 'بدون مكان';
  };
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const submit = async () => {
    if (picked.size === 0) return setError('اختر خادماً واحداً على الأقل');
    setError('');
    setSaving(true);
    try {
      await addBudgetMembers(supabase, budgetId, Array.from(picked), role);
      onAdded();
    } catch (err) {
      setError(financeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalFrame title="إضافة أعضاء" icon={<UserPlus className="h-5 w-5 text-primary-600" />} onClose={onClose}>
      <div className="space-y-3">
        <Field label="الدور">
          <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
            {(['viewer', 'editor', 'manager'] as BudgetRole[]).map((r) => (
              <button key={r} id={`finance-member-role-${r}`} type="button" onClick={() => setRole(r)} aria-pressed={role === r}
                className={`rounded-xl py-2 text-xs font-extrabold ${role === r ? 'bg-white shadow text-primary-700' : 'text-slate-500'}`}>{ROLE_LABELS[r]}</button>
            ))}
          </div>
          <span className="mt-1 block text-[10px] font-bold text-slate-400">{ROLE_DESCS[role]}</span>
        </Field>
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input id="finance-member-search" className="input-field !pr-9" placeholder="ابحث بالاسم أو الكود…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        <ul className="max-h-[45vh] divide-y divide-slate-50 overflow-y-auto rounded-2xl border border-slate-100">
          {loading ? (
            <li className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary-500" /></li>
          ) : list.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs font-bold text-slate-400">{q ? 'لا نتائج' : 'كل الخدام الذين تصل إليهم أعضاء بالفعل — أو لا يوجد خدام في نطاقك'}</li>
          ) : list.map((c) => {
            const on = picked.has(c.id);
            return (
              <li key={c.id}>
                <button type="button" onClick={() => toggle(c.id)} aria-pressed={on}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-right transition ${on ? 'bg-primary-50' : 'hover:bg-slate-50'}`}>
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${on ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300'}`}>
                    {on && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-slate-400">
                    {c.photo_url ? <Image src={c.photo_url} alt={c.full_name} fill sizes="36px" className="object-cover" /> : <User className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold">{c.full_name}</span>
                    <span className="block truncate text-[11px] font-bold text-slate-400">{c.user_id} · {place(c)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button id="finance-members-save" type="button" onClick={submit} disabled={saving || picked.size === 0} className="btn-primary flex items-center justify-center gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} إضافة {picked.size > 0 ? `(${picked.size})` : ''}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </div>
    </ModalFrame>
  );
}
