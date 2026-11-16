'use client';

// ---------- ScopeGroups — the church → service → class tree for EVERY management page ----------
// A generic wrapper around buildScopeTree / ScopeTreeView (ScopeTree.tsx) so
// any list of scoped records (services, classes, events, causes, call
// feedbacks, card templates, join requests …) is shown the same organized way
// as إدارة المخدومين / إدارة الخدام:
//
//   ScopeGroupFilters   كنيسة → خدمة → فصل selects (+ optional search) that
//                       narrow the list
//   ScopeGroups         nested collapsible headers (church → service → class),
//                       each with a count; the caller only renders the item
//
// Records whose service_id / class_id is null ("كل الخدمات" / "كل الفصول")
// are grouped under a virtual node of that level so a church-wide event sits
// directly under its church, not under a fake class.

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Search, Church as ChurchIcon, Layers, School, FolderTree } from 'lucide-react';
import { ALL } from '@/lib/queries';
import type { Church, Service, ClassRoom } from '@/lib/types';
import { MultiClassSelect } from '@/components/MultiClassSelect';
import { inClassesOrWide } from '@/lib/class-multi';
import { ScopeSelect, scopeOrderOf, type Lookups, type ScopeSelection, type ScopedRow, type ScopeLevel } from '@/components/ScopeTree';

export type { Lookups, ScopeSelection, ScopedRow } from '@/components/ScopeTree';

export const ALL_SCOPE: ScopeSelection = { church: ALL, service: ALL, classes: [] };

/** Keep the rows inside the selected church / service / class (null scope = "all" → matches any narrower filter) */
export type ScopeOf<T> = (r: T) => ScopedRow;
const defaultScopeOf = <T,>(r: T): ScopedRow => {
  const o = r as Partial<ScopedRow>;
  return { church_id: o.church_id ?? null, service_id: o.service_id ?? null, class_id: o.class_id ?? null };
};

export function filterByScope<T>(rows: T[], sel: ScopeSelection, scopeOf: ScopeOf<T> = defaultScopeOf): T[] {
  return rows.filter((row) => {
    const r = scopeOf(row);
    return (sel.church === ALL || r.church_id === sel.church) &&
      (sel.service === ALL || r.service_id === sel.service || r.service_id === null) &&
      inClassesOrWide(sel.classes, r.class_id);
  });
}

/** Build Lookups from the three lists the pages already load */
export const toLookups = (churches: Church[], services: Service[], classes: ClassRoom[]): Lookups => ({ churches, services, classes });

// =====================================================================
// Filters — كنيسة → خدمة → فصل (+ search)
// =====================================================================
export function ScopeGroupFilters({
  idPrefix, scope, onScope, lookups, search, onSearch, placeholder = 'بحث بالاسم...', className = '', deepest = 'class',
}: {
  idPrefix: string;
  scope: ScopeSelection;
  onScope: (s: ScopeSelection) => void;
  lookups: Lookups;
  search?: string;
  onSearch?: (v: string) => void;
  placeholder?: string;
  className?: string;
  /** hide the selects below the records' own level (services → 'church', classes → 'service') */
  deepest?: ScopeLevel;
}) {
  const visibleServices = lookups.services.filter((s) => scope.church === ALL || s.church_id === scope.church);
  const visibleClasses = lookups.classes.filter(
    (c) => (scope.church === ALL || c.church_id === scope.church) && (scope.service === ALL || c.service_id === scope.service)
  );
  // a single church → no point in showing the church filter
  const showChurch = lookups.churches.length > 1;
  const showService = deepest !== 'church';
  const showClass = deepest === 'class';
  const cols = [showChurch, showService, showClass].filter(Boolean).length;
  if (cols === 0 && !onSearch) return null;
  return (
    <div className={`mb-3 space-y-2 ${className}`}>
      {onSearch && (
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input id={`${idPrefix}-search`} className="input-field pr-9" placeholder={placeholder} value={search ?? ''} onChange={(e) => onSearch(e.target.value)} />
        </div>
      )}
      {cols > 0 && (
        <div className={`grid gap-2 ${cols === 3 ? 'grid-cols-3' : cols === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {showChurch && (
            <ScopeSelect id={`${idPrefix}-church`} icon={<ChurchIcon className="h-3.5 w-3.5 text-gold-500" />} value={scope.church}
              onChange={(v) => onScope({ church: v, service: ALL, classes: [] })} all="كل الكنائس" options={lookups.churches} />
          )}
          {showService && (
            <ScopeSelect id={`${idPrefix}-service`} icon={<Layers className="h-3.5 w-3.5 text-accent-600" />} value={scope.service}
              onChange={(v) => onScope({ ...scope, service: v, classes: [] })} all="كل الخدمات" options={visibleServices} />
          )}
          {showClass && (
            <MultiClassSelect id={`${idPrefix}-class`} icon={<School className="h-3.5 w-3.5 text-sky-600" />} value={scope.classes}
              onChange={(ids) => onScope({ ...scope, classes: ids })} options={visibleClasses} />
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Tree
// =====================================================================
interface GroupNode<T> {
  key: string;
  level: ScopeLevel;
  id: string | null;
  name: string;
  /** items bound EXACTLY to this node (e.g. a church-wide event under the church) */
  items: T[];
  /** every item under this node incl. descendants (for the count) */
  total: number;
  children: GroupNode<T>[];
}

const WIDE_LABEL: Record<Exclude<ScopeLevel, 'church'>, string> = {
  service: 'على مستوى الكنيسة (كل الخدمات)',
  class: 'على مستوى الخدمة (كل الفصول)',
};

function buildGroups<T>(rows: T[], lk: Lookups, itemName: ((r: T) => string) | null, deepest: ScopeLevel, scopeOf: ScopeOf<T>): GroupNode<T>[] {
  const cmp = (a: string, b: string) => a.localeCompare(b, 'ar');
  const churches = new Map<string, GroupNode<T>>();
  const services = new Map<string, GroupNode<T>>();
  const classes = new Map<string, GroupNode<T>>();
  const nameOf = (list: { id: string; name: string }[], id: string) => list.find((x) => x.id === id)?.name ?? '—';

  for (const row of rows) {
    const r = scopeOf(row);
    const cKey = `c:${r.church_id ?? ''}`;
    let c = churches.get(cKey);
    if (!c) {
      c = { key: cKey, level: 'church', id: r.church_id, name: r.church_id ? nameOf(lk.churches, r.church_id) : 'بدون كنيسة', items: [], total: 0, children: [] };
      churches.set(cKey, c);
    }
    c.total++;
    if (deepest === 'church' || r.service_id === null) { c.items.push(row); continue; }

    const sKey = `${cKey}/s:${r.service_id}`;
    let s = services.get(sKey);
    if (!s) {
      s = { key: sKey, level: 'service', id: r.service_id, name: nameOf(lk.services, r.service_id), items: [], total: 0, children: [] };
      services.set(sKey, s);
      c.children.push(s);
    }
    s.total++;
    if (deepest === 'service' || r.class_id === null) { s.items.push(row); continue; }

    const kKey = `${sKey}/k:${r.class_id}`;
    let k = classes.get(kKey);
    if (!k) {
      k = { key: kKey, level: 'class', id: r.class_id, name: nameOf(lk.classes, r.class_id), items: [], total: 0, children: [] };
      classes.set(kKey, k);
      s.children.push(k);
    }
    k.total++;
    k.items.push(row);
  }

  // groups follow the MANUAL order of the settings pages (sort_order), then the name
  const cmpNode = (a: GroupNode<T>, b: GroupNode<T>) =>
    (a.id === null ? 1 : 0) - (b.id === null ? 1 : 0)
    || scopeOrderOf(lk, a.level, a.id) - scopeOrderOf(lk, b.level, b.id)
    || cmp(a.name, b.name);
  const sortNode = (n: GroupNode<T>) => {
    if (itemName) n.items.sort((a, b) => cmp(itemName(a), itemName(b)));
    n.children.sort(cmpNode);
    n.children.forEach(sortNode);
  };
  const out = Array.from(churches.values()).sort(cmpNode);
  out.forEach(sortNode);
  return out;
}

const LEVEL_ICON: Record<ScopeLevel, typeof ChurchIcon> = { church: ChurchIcon, service: Layers, class: School };
const LEVEL_STYLE: Record<ScopeLevel, string> = {
  church: 'bg-indigo-100/95 text-indigo-900',
  service: 'bg-indigo-50/95 text-indigo-800',
  class: 'bg-white/95 text-indigo-700 ring-1 ring-indigo-100',
};
const LEVEL_INDENT: Record<ScopeLevel, string> = { church: '', service: 'mr-2', class: 'mr-4' };

export function ScopeGroups<T>({
  rows, lookups, itemName, renderItem, idPrefix, deepest = 'class', emptyText = 'لا توجد عناصر', wideLabel, tone = 'indigo', scopeOf = defaultScopeOf,
}: {
  rows: T[];
  /** where the record lives (defaults to its own church_id / service_id / class_id fields) */
  scopeOf?: ScopeOf<T>;
  lookups: Lookups;
  /** sort key inside a group — null keeps the caller's order (e.g. manual sort_order) */
  itemName: ((r: T) => string) | null;
  renderItem: (r: T) => ReactNode;
  idPrefix: string;
  /** the deepest level the records are bound to: services → 'church', classes → 'service', else 'class' */
  deepest?: ScopeLevel;
  emptyText?: string;
  /** label of the virtual bucket for items bound to the node itself (wide scope) */
  wideLabel?: Partial<Record<Exclude<ScopeLevel, 'church'>, string>>;
  tone?: 'indigo' | 'emerald' | 'violet' | 'amber' | 'sky' | 'teal';
}) {
  const groups = useMemo(() => buildGroups(rows, lookups, itemName, deepest, scopeOf), [rows, lookups, itemName, deepest, scopeOf]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const toneCls: Record<NonNullable<typeof tone>, Record<ScopeLevel, string>> = {
    indigo: LEVEL_STYLE,
    emerald: { church: 'bg-emerald-100/95 text-emerald-900', service: 'bg-emerald-50/95 text-emerald-800', class: 'bg-white/95 text-emerald-700 ring-1 ring-emerald-100' },
    violet: { church: 'bg-violet-100/95 text-violet-900', service: 'bg-violet-50/95 text-violet-800', class: 'bg-white/95 text-violet-700 ring-1 ring-violet-100' },
    amber: { church: 'bg-amber-100/95 text-amber-900', service: 'bg-amber-50/95 text-amber-800', class: 'bg-white/95 text-amber-700 ring-1 ring-amber-100' },
    sky: { church: 'bg-sky-100/95 text-sky-900', service: 'bg-sky-50/95 text-sky-800', class: 'bg-white/95 text-sky-700 ring-1 ring-sky-100' },
    teal: { church: 'bg-teal-100/95 text-teal-900', service: 'bg-teal-50/95 text-teal-800', class: 'bg-white/95 text-teal-700 ring-1 ring-teal-100' },
  };

  if (rows.length === 0) {
    return <div className="card py-12 text-center font-bold text-slate-400">{emptyText}</div>;
  }

  // Single church for the whole list → skip the church header, start at services
  const skipChurch = groups.length === 1 && groups[0].id !== null && deepest !== 'church';

  const renderNode = (n: GroupNode<T>): ReactNode => {
    const Icon = LEVEL_ICON[n.level];
    const isCollapsed = collapsed.has(n.key);
    // items bound to the node itself while it also has sub-nodes → label the bucket
    const wide = n.items.length > 0 && n.children.length > 0
      ? (n.level === 'church' ? WIDE_LABEL.service : (wideLabel?.[n.level] ?? WIDE_LABEL[n.level]))
      : null;
    return (
      <section key={n.key} id={`${idPrefix}-group-${n.key}`} className={LEVEL_INDENT[n.level]}>
        <h3 className={`mb-2 flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-extrabold ${toneCls[tone][n.level]}`}>
          <button type="button" onClick={() => toggle(n.key)} aria-expanded={!isCollapsed} className="flex min-w-0 flex-1 items-center gap-1.5 text-right">
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 opacity-60 transition ${isCollapsed ? '-rotate-90' : ''}`} />
            <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate">{n.name}</span>
          </button>
          <span className="badge !py-0 bg-white/80 text-slate-600">{n.total}</span>
        </h3>
        {!isCollapsed && (
          <div className="space-y-2 pb-1">
            {n.items.length > 0 && (
              <div className={n.children.length > 0 ? 'mr-2' : ''}>
                {wide && (
                  <p className="mb-1.5 flex items-center gap-1 px-1 text-[10px] font-extrabold text-slate-400">
                    <FolderTree className="h-3 w-3" /> {wide}
                  </p>
                )}
                <ul className="space-y-2">{n.items.map((r) => renderItem(r))}</ul>
              </div>
            )}
            {n.children.length > 0 && <div className="space-y-1">{n.children.map(renderNode)}</div>}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="space-y-3">
      {skipChurch
        ? (
          <>
            {groups[0].items.length > 0 && (
              <div>
                {groups[0].children.length > 0 && (
                  <p className="mb-1.5 flex items-center gap-1 px-1 text-[10px] font-extrabold text-slate-400">
                    <FolderTree className="h-3 w-3" /> على مستوى الكنيسة (كل الخدمات)
                  </p>
                )}
                <ul className="space-y-2">{groups[0].items.map((r) => renderItem(r))}</ul>
              </div>
            )}
            {groups[0].children.map(renderNode)}
          </>
        )
        : groups.map(renderNode)}
    </div>
  );
}

/** Convenience hook: scope selection + search state + the filtered rows */
export function useScopeGroups<T>(rows: T[], matches?: (r: T, q: string) => boolean, scopeOf: ScopeOf<T> = defaultScopeOf) {
  const [scope, setScope] = useState<ScopeSelection>(ALL_SCOPE);
  const [search, setSearch] = useState('');
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const scoped = filterByScope(rows, scope, scopeOf);
    return q && matches ? scoped.filter((r) => matches(r, q)) : scoped;
  }, [rows, scope, search, matches, scopeOf]);
  return { scope, setScope, search, setSearch, visible };
}
