'use client';

// ---------- ScopeTree — shared bits of إدارة المخدومين ↔ إدارة الخدام ----------
// Both management pages are built from the SAME pieces so they look and
// behave alike:
//
//   ScopeFilters          search · كنيسة → خدمة → فصل selects · الكل / يعمل / موقوف
//   buildScopeTree()      flat rows → NESTED groups: church → service → class
//   ScopeTreeView         renders the tree with a sticky header per level; every
//                         header carries a count, a collapse toggle and an
//                         optional ⏸ إيقاف الكل / ▶ تفعيل الكل button for THAT node
//   PersonCard / ActionBtn one card per person + the action row under it
//   BulkScopeStatusCard   «إيقاف / تفعيل نطاق كامل» — a whole church / service /
//                         class at once through RPC set_enrollments_status
//
// Replaces the old «ترتيب حسب» toolbar (ScopeOrganizer, 0043): the list is
// now ALWAYS grouped church → service → class.

import { useState, type ReactNode } from 'react';
import Image from 'next/image';
import {
  Loader2, Search, PauseCircle, PlayCircle, User, Ban, ChevronDown, AlertTriangle,
  Church as ChurchIcon, Layers, School,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { ALL } from '@/lib/queries';
import { MultiClassSelect } from '@/components/MultiClassSelect';
import type { Church, Service, ClassRoom } from '@/lib/types';

// =====================================================================
// Types
// =====================================================================
export type StatusFilter = 'all' | 'active' | 'stopped';
export type PeopleKind = 'child' | 'servant';
export type ScopeLevel = 'church' | 'service' | 'class';

export interface ScopedRow {
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
}

export interface Lookups {
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
}

export interface ScopeSelection {
  church: string;
  service: string;
  /** MULTI-select: chosen class ids — EMPTY = «كل الفصول» */
  classes: string[];
}

export interface ScopeNode<T> {
  key: string;
  level: ScopeLevel;
  id: string | null;
  name: string;
  /** the scope this node stands for (nulls above the level are inherited) */
  scope: { church: string | null; service: string | null; class: string | null };
  /** EVERY row under this node (used for counts + stop all) */
  rows: T[];
  /** sub-nodes — church → services, service → classes, class → [] */
  children: ScopeNode<T>[];
}

export const KIND_LABELS: Record<PeopleKind, { one: string; many: string }> = {
  child: { one: 'المخدوم', many: 'المخدومين' },
  servant: { one: 'الخادم', many: 'الخدام' },
};

// =====================================================================
// buildScopeTree — church → service → class
// =====================================================================
const NO_SCOPE: Record<ScopeLevel, string> = {
  church: 'بدون كنيسة محددة',
  service: 'بدون خدمة محددة',
  class: 'بدون فصل محدد',
};

const nameOf = (list: { id: string; name: string }[], id: string | null, level: ScopeLevel) =>
  id ? list.find((x) => x.id === id)?.name ?? '—' : NO_SCOPE[level];

/**
 * Manual order of a church / service / class (20260928130000): the position
 * the manager gave it in the settings pages. Unknown id → after everything.
 */
export function scopeOrderOf(lk: Lookups, level: ScopeLevel, id: string | null): number {
  if (id === null) return Number.MAX_SAFE_INTEGER;
  const list: { id: string; sort_order?: number }[] = level === 'church' ? lk.churches : level === 'service' ? lk.services : lk.classes;
  const row = list.find((x) => x.id === id);
  return row ? (row.sort_order ?? 0) : Number.MAX_SAFE_INTEGER - 1;
}

export function buildScopeTree<T extends ScopedRow>(
  rows: T[],
  lk: Lookups,
  rowName: (r: T) => string
): ScopeNode<T>[] {
  const cmpName = (a: string, b: string) => a.localeCompare(b, 'ar');
  // nodes without an id (no scope) always sink to the bottom of their level;
  // the rest follow the MANUAL order of the settings pages, then the name
  const cmpNode = <R,>(a: ScopeNode<R>, b: ScopeNode<R>) =>
    (a.id === null ? 1 : 0) - (b.id === null ? 1 : 0)
    || scopeOrderOf(lk, a.level, a.id) - scopeOrderOf(lk, b.level, b.id)
    || cmpName(a.name, b.name);

  const churches = new Map<string, ScopeNode<T>>();
  const services = new Map<string, ScopeNode<T>>();
  const classes = new Map<string, ScopeNode<T>>();

  for (const r of rows) {
    const cKey = `c:${r.church_id ?? ''}`;
    let c = churches.get(cKey);
    if (!c) {
      c = { key: cKey, level: 'church', id: r.church_id, name: nameOf(lk.churches, r.church_id, 'church'),
        scope: { church: r.church_id, service: null, class: null }, rows: [], children: [] };
      churches.set(cKey, c);
    }
    c.rows.push(r);

    const sKey = `${cKey}/s:${r.service_id ?? ''}`;
    let s = services.get(sKey);
    if (!s) {
      s = { key: sKey, level: 'service', id: r.service_id, name: nameOf(lk.services, r.service_id, 'service'),
        scope: { church: r.church_id, service: r.service_id, class: null }, rows: [], children: [] };
      services.set(sKey, s);
      c.children.push(s);
    }
    s.rows.push(r);

    const kKey = `${sKey}/k:${r.class_id ?? ''}`;
    let k = classes.get(kKey);
    if (!k) {
      k = { key: kKey, level: 'class', id: r.class_id, name: nameOf(lk.classes, r.class_id, 'class'),
        scope: { church: r.church_id, service: r.service_id, class: r.class_id }, rows: [], children: [] };
      classes.set(kKey, k);
      s.children.push(k);
    }
    k.rows.push(r);
  }

  const sortTree = (nodes: ScopeNode<T>[]) => {
    nodes.sort(cmpNode);
    for (const n of nodes) {
      if (n.level === 'class') n.rows.sort((a, b) => cmpName(rowName(a), rowName(b)));
      else sortTree(n.children);
    }
  };
  const out = Array.from(churches.values());
  sortTree(out);
  return out;
}

// =====================================================================
// ScopeFilters — search + كنيسة → خدمة → فصل + الكل / يعمل / موقوف
// =====================================================================
export function ScopeFilters({
  idPrefix, search, onSearch, placeholder = 'بحث بالاسم أو الهاتف أو الكود...',
  scope, onScope, status, onStatus, lookups, counts,
}: {
  idPrefix: string;
  search: string;
  onSearch: (v: string) => void;
  placeholder?: string;
  scope: ScopeSelection;
  onScope: (s: ScopeSelection) => void;
  status: StatusFilter;
  onStatus: (s: StatusFilter) => void;
  lookups: Lookups;
  /** optional counters shown on the status tabs */
  counts?: Partial<Record<StatusFilter, number>>;
}) {
  const visibleServices = lookups.services.filter((s) => scope.church === ALL || s.church_id === scope.church);
  const visibleClasses = lookups.classes.filter(
    (c) => (scope.church === ALL || c.church_id === scope.church) && (scope.service === ALL || c.service_id === scope.service)
  );
  return (
    <div className="mb-3 space-y-2">
      <div className="relative">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input id={`${idPrefix}-search`} className="input-field pr-9" placeholder={placeholder} value={search} onChange={(e) => onSearch(e.target.value)} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <ScopeSelect id={`${idPrefix}-church`} icon={<ChurchIcon className="h-3.5 w-3.5 text-gold-500" />} value={scope.church}
          onChange={(v) => onScope({ church: v, service: ALL, classes: [] })} all="كل الكنائس" options={lookups.churches} />
        <ScopeSelect id={`${idPrefix}-service`} icon={<Layers className="h-3.5 w-3.5 text-accent-600" />} value={scope.service}
          onChange={(v) => onScope({ ...scope, service: v, classes: [] })} all="كل الخدمات" options={visibleServices} />
        <MultiClassSelect id={`${idPrefix}-class`} icon={<School className="h-3.5 w-3.5 text-sky-600" />} value={scope.classes}
          onChange={(ids) => onScope({ ...scope, classes: ids })} options={visibleClasses} />
      </div>
      <div id={`${idPrefix}-status-filter`} role="tablist" aria-label="الحالة" className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
        {([['all', 'الكل'], ['active', 'يعمل'], ['stopped', 'موقوف']] as [StatusFilter, string][]).map(([v, l]) => (
          <button key={v} id={`${idPrefix}-status-${v}`} type="button" role="tab" aria-selected={status === v} onClick={() => onStatus(v)}
            className={`flex h-8 items-center justify-center gap-1 rounded-lg text-[11px] font-extrabold transition ${
              status === v ? 'bg-white shadow ' + (v === 'stopped' ? 'text-red-600' : v === 'active' ? 'text-emerald-700' : 'text-primary-700') : 'text-slate-500'}`}>
            {l}
            {counts && typeof counts[v] === 'number' && (
              <span className={`rounded-full px-1.5 text-[10px] ${status === v ? 'bg-slate-100 text-slate-600' : 'bg-white/70 text-slate-500'}`}>{counts[v]}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ScopeSelect({ id, icon, value, onChange, all, options }: {
  id: string; icon: ReactNode; value: string; onChange: (v: string) => void; all: string; options: { id: string; name: string }[];
}) {
  return (
    <label className="relative block">
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">{icon}</span>
      <select id={id} className="input-field appearance-none !pr-7 !text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={ALL}>{all}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}

// =====================================================================
// ScopeTreeView — nested sticky headers + rows
// =====================================================================
export interface NodeStatusAction {
  /** true → the whole node is stopped → the button offers «تفعيل الكل» */
  allStopped: boolean;
  busy: boolean;
  onToggle: () => void;
}

const LEVEL_STYLE: Record<PeopleKind, Record<ScopeLevel, string>> = {
  child: {
    church: 'top-[71px] z-30 bg-indigo-100/95 text-indigo-900',
    service: 'top-[111px] z-20 bg-indigo-50/95 text-indigo-800',
    class: 'top-[151px] z-10 bg-white/95 text-indigo-700 ring-1 ring-indigo-100',
  },
  servant: {
    church: 'top-[71px] z-30 bg-emerald-100/95 text-emerald-900',
    service: 'top-[111px] z-20 bg-emerald-50/95 text-emerald-800',
    class: 'top-[151px] z-10 bg-white/95 text-emerald-700 ring-1 ring-emerald-100',
  },
};
const LEVEL_ICON: Record<ScopeLevel, typeof ChurchIcon> = { church: ChurchIcon, service: Layers, class: School };
const LEVEL_INDENT: Record<ScopeLevel, string> = { church: '', service: 'mr-2', class: 'mr-4' };

export function ScopeTreeView<T extends ScopedRow>({
  nodes, kind, idPrefix, renderRow, nodeAction, canToggle,
}: {
  nodes: ScopeNode<T>[];
  kind: PeopleKind;
  idPrefix: string;
  renderRow: (row: T) => ReactNode;
  /** stop / activate everyone under a node — return null to hide the button */
  nodeAction?: (node: ScopeNode<T>) => NodeStatusAction | null;
  /** may the caller stop / activate at all (managers) */
  canToggle?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const renderNode = (n: ScopeNode<T>): ReactNode => {
    const Icon = LEVEL_ICON[n.level];
    const isCollapsed = collapsed.has(n.key);
    const action = canToggle !== false && nodeAction ? nodeAction(n) : null;
    return (
      <section key={n.key} id={`${idPrefix}-node-${n.key}`} className={LEVEL_INDENT[n.level]}>
        <h3 className={`sticky mb-2 flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-extrabold backdrop-blur ${LEVEL_STYLE[kind][n.level]}`}>
          <button type="button" onClick={() => toggle(n.key)} aria-expanded={!isCollapsed}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-right">
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 opacity-60 transition ${isCollapsed ? '-rotate-90' : ''}`} />
            <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate">{n.name}</span>
          </button>
          <span className="badge !py-0 bg-white/80 text-slate-600">{n.rows.length}</span>
          {action && (
            <button
              id={`${idPrefix}-toggle-${n.key}`}
              type="button"
              disabled={action.busy}
              onClick={action.onToggle}
              className={`flex h-6 items-center gap-1 rounded-lg px-1.5 text-[10px] font-extrabold transition active:scale-95 disabled:opacity-60 ${
                action.allStopped ? 'bg-emerald-500 text-white' : 'bg-white text-red-600 hover:bg-red-50'}`}
              title={action.allStopped ? 'تفعيل الكل في هذا النطاق' : 'إيقاف الكل في هذا النطاق'}
            >
              {action.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : action.allStopped ? <PlayCircle className="h-3 w-3" /> : <PauseCircle className="h-3 w-3" />}
              {action.allStopped ? 'تفعيل الكل' : 'إيقاف الكل'}
            </button>
          )}
        </h3>
        {!isCollapsed && (
          n.level === 'class' ? (
            <ul className="space-y-2 pb-2">{n.rows.map((r) => renderRow(r))}</ul>
          ) : (
            <div className="space-y-1">{n.children.map(renderNode)}</div>
          )
        )}
      </section>
    );
  };

  return <div className="space-y-3">{nodes.map(renderNode)}</div>;
}

// =====================================================================
// PersonCard + ActionBtn — one card per person, actions under it
// =====================================================================
const TONES = {
  primary: 'bg-primary-50 text-primary-600 hover:bg-primary-100',
  violet: 'bg-violet-50 text-violet-600 hover:bg-violet-100',
  amber: 'bg-amber-50 text-amber-600 hover:bg-amber-100',
  emerald: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100',
  red: 'bg-red-50 text-red-600 hover:bg-red-100',
};
export type ActionTone = keyof typeof TONES;

export interface PersonAction {
  id: string;
  tone: ActionTone;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}

export function ActionBtn({ id, tone, icon, label, onClick, disabled, busy }: PersonAction) {
  return (
    <button id={id} type="button" onClick={onClick} disabled={disabled || busy}
      className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition disabled:opacity-60 ${TONES[tone]}`}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon} {label}
    </button>
  );
}

export function PersonCard({
  id, kind, name, photo, stopped, badges, meta, extra, actions, note,
}: {
  id: string;
  kind: PeopleKind;
  name: string;
  photo: string | null | undefined;
  stopped: boolean;
  /** small badges after the name (role, status …) — the موقوف badge is added here */
  badges?: ReactNode;
  /** the code / phone line */
  meta?: ReactNode;
  /** anything else under the meta (permission profiles …) */
  extra?: ReactNode;
  actions?: PersonAction[];
  /** shown instead of the actions when the caller may not manage this person */
  note?: string;
}) {
  const ring = kind === 'child' ? 'bg-primary-50 ring-primary-100 text-primary-300' : 'bg-emerald-50 ring-emerald-100 text-emerald-400';
  return (
    <li id={id} className={`card !p-3 ${stopped ? 'bg-slate-100/80' : ''}`}>
      <div className="flex items-center gap-3">
        <div className={`relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full ring-2 ${ring}`}>
          {photo ? (
            <Image src={photo} alt={name} fill sizes="48px" className={`object-cover ${stopped ? 'grayscale' : ''}`} />
          ) : (
            <User className="h-6 w-6" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`truncate font-extrabold ${stopped ? 'text-slate-400 line-through decoration-slate-300' : ''}`}>{name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
            {stopped && <span className="badge bg-slate-200 text-slate-600"><Ban className="h-3 w-3" /> موقوف</span>}
            {badges}
            {meta}
          </p>
          {extra}
        </div>
      </div>
      {actions && actions.length > 0 ? (
        <div className={`mt-2.5 grid gap-2 border-t border-slate-100 pt-2.5 ${actions.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
          {actions.map((a) => <ActionBtn key={a.id} {...a} />)}
        </div>
      ) : note ? (
        <p className="mt-2 text-[11px] font-bold text-slate-400">{note}</p>
      ) : null}
    </li>
  );
}

// =====================================================================
// BulkScopeStatusCard — «إيقاف / تفعيل نطاق كامل»
// =====================================================================
export function BulkScopeStatusCard({
  kind, lookups, initial, stoppedCount, onDone,
}: {
  kind: PeopleKind;
  lookups: Lookups;
  initial: ScopeSelection;
  stoppedCount?: number;
  onDone: (msg: string, ok: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card mb-3 !p-0 overflow-hidden">
      <button id={`bulk-stop-toggle-${kind}`} type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-right">
        <Ban className="h-4 w-4 text-red-500" />
        <span className="flex-1 text-sm font-extrabold text-slate-700">إيقاف / تفعيل نطاق كامل من {KIND_LABELS[kind].many}</span>
        {!!stoppedCount && <span className="badge bg-slate-200 text-slate-600">{stoppedCount} موقوف</span>}
        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <BulkScopeStatusForm kind={kind} lookups={lookups} initial={initial} onDone={onDone} />}
    </div>
  );
}

function BulkScopeStatusForm({ kind, lookups, initial, onDone }: {
  kind: PeopleKind; lookups: Lookups; initial: ScopeSelection; onDone: (msg: string, ok: boolean) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [church, setChurch] = useState(initial.church === ALL ? '' : initial.church);
  const [service, setService] = useState(initial.service === ALL ? '' : initial.service);
  const [cls, setCls] = useState<string[]>(initial.classes);
  const [busy, setBusy] = useState<'stopped' | 'active' | null>(null);

  const scopedServices = lookups.services.filter((s) => !church || s.church_id === church);
  const scopedClasses = lookups.classes.filter((c) => (!church || c.church_id === church) && (!service || c.service_id === service));

  const level = cls.length > 1 ? 'الفصول' : cls.length === 1 ? 'الفصل' : service ? 'الخدمة' : church ? 'الكنيسة' : '';
  const who = KIND_LABELS[kind].many;
  const scopeName = cls.length > 0 ? cls.map((id) => lookups.classes.find((c) => c.id === id)?.name ?? '—').join('، ')
    : service ? lookups.services.find((s) => s.id === service)?.name
    : lookups.churches.find((c) => c.id === church)?.name;

  const run = async (status: 'stopped' | 'active') => {
    if (!church) return onDone('اختر الكنيسة أولاً', false);
    const verb = status === 'stopped' ? 'إيقاف' : 'تفعيل';
    const effect = status === 'stopped'
      ? (kind === 'child' ? 'لن يُسجَّل لهم حضور أو نقاط ولن يدخلوا بوابتهم حتى تعيد تفعيلهم.' : 'لن يستطيعوا الدخول إلى التطبيق حتى تعيد تفعيلهم.')
      : 'سيعودون للعمل فورًا.';
    if (!confirm(`${verb} كل ${who} في ${level} «${scopeName}»؟\n\n${effect}`)) return;
    setBusy(status);
    // the RPC takes ONE class → one call per chosen class (none chosen = the whole service / church)
    const targets: (string | null)[] = cls.length > 0 ? cls : [null];
    let n = 0;
    for (const target of targets) {
      const { data, error } = await supabase.rpc('set_enrollments_status', {
        p_status: status, p_church: church, p_service: service || null, p_class: target, p_kind: kind,
      });
      if (error) {
        setBusy(null);
        return onDone('تعذر تنفيذ العملية — تأكد من صلاحياتك على هذا النطاق وتحديث قاعدة البيانات (0043)', false);
      }
      const r = (data ?? {}) as { children?: number; servants?: number };
      n += kind === 'child' ? r.children ?? 0 : r.servants ?? 0;
    }
    setBusy(null);
    onDone(`تم ${verb} ${n} من ${who} — ${level} «${scopeName}»`, true);
  };

  return (
    <div className="space-y-2 border-t border-slate-100 px-4 py-3">
      <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        اختر المستوى: كنيسة كاملة، أو خدمة، أو فصل. الموقوف يحتفظ ببياناته وسجلاته ويمكن تفعيله في أي وقت.
      </p>
      <div className="grid grid-cols-3 gap-2">
        <select id={`bulk-${kind}-church`} className="input-field !text-xs" value={church} onChange={(e) => { setChurch(e.target.value); setService(''); setCls([]); }}>
          <option value="">الكنيسة *</option>
          {lookups.churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select id={`bulk-${kind}-service`} className="input-field !text-xs" value={service} disabled={!church} onChange={(e) => { setService(e.target.value); setCls([]); }}>
          <option value="">كل الخدمات</option>
          {scopedServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <MultiClassSelect id={`bulk-${kind}-class`} className="!py-3" value={cls} disabled={!service} onChange={setCls} options={scopedClasses} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button id={`bulk-${kind}-stop-run`} type="button" disabled={!church || busy !== null} onClick={() => run('stopped')}
          className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-red-500 text-sm font-extrabold text-white shadow transition hover:bg-red-600 active:scale-95 disabled:opacity-50">
          {busy === 'stopped' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />}
          إيقاف {level || 'النطاق'}
        </button>
        <button id={`bulk-${kind}-activate-run`} type="button" disabled={!church || busy !== null} onClick={() => run('active')}
          className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 text-sm font-extrabold text-white shadow transition hover:bg-emerald-600 active:scale-95 disabled:opacity-50">
          {busy === 'active' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          تفعيل {level || 'النطاق'}
        </button>
      </div>
    </div>
  );
}

/** Small helper: the empty-state / notice pieces both panels share. */
export function PanelNotice({ notice }: { notice: { tone: 'ok' | 'err'; text: string } | null }) {
  if (!notice) return null;
  return (
    <p className={`mb-3 rounded-xl px-3 py-2 text-xs font-bold ${notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
      {notice.text}
    </p>
  );
}
