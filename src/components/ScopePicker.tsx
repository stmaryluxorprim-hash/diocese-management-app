'use client';

// ---------- ScopePicker — choose SEVERAL places (church → service → class) ----------
// migration 0045: one person → many places. Used by:
//   * /signup step 1               (the servant picks every class he serves in)
//   * إدارة الخدام → الطلبات / تعديل / إضافة   (the manager sets the servant's places)
//   * إدارة المخدومين → المخدومين → الفصول    (a child in several classes)
//
// Model: a list of ScopeRef — the FIRST is the primary place (for servants it
// becomes servant_enrollments.church/service/class). Under the list a small
// «إضافة مكان» chooser (church → service → class) adds a new row; each row
// has a ✕ and a ★ («اجعله الأساسي»). `depth` decides how deep a place must
// go: 'church' (church manager) · 'service' (service manager) · 'class'
// (class servant / child) — with `requireLeaf` the last level is mandatory
// (children), otherwise it may stay «كل الفصول».

import { useMemo, useState } from 'react';
import { Plus, X, Star, MapPin, Church as ChurchIcon, Layers, School, Lock } from 'lucide-react';
import type { Church, Service, ClassRoom, ScopeRef } from '@/lib/types';
import { scopeKey } from '@/lib/types';
import { MultiClassSelect } from '@/components/MultiClassSelect';

export type ScopeDepth = 'church' | 'service' | 'class';

export interface ScopeLookups {
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
}

/** «كنيسة أ ← مدارس الأحد ← فصل ٣» — or the level-wide labels. */
export function scopeLabel(s: ScopeRef, lk: ScopeLookups, depth: ScopeDepth = 'class'): string {
  const c = lk.churches.find((x) => x.id === s.church_id)?.name ?? '—';
  const parts = [c];
  if (depth !== 'church') {
    parts.push(s.service_id ? (lk.services.find((x) => x.id === s.service_id)?.name ?? '—') : 'كل الخدمات');
    if (depth === 'class') parts.push(s.class_id ? (lk.classes.find((x) => x.id === s.class_id)?.name ?? '—') : 'كل الفصول');
  }
  return parts.join(' ← ');
}

/** Normalise a scope to the given depth (drops the levels below). */
export const clampScope = (s: ScopeRef, depth: ScopeDepth): ScopeRef => ({
  church_id: s.church_id,
  service_id: depth === 'church' ? null : s.service_id,
  class_id: depth === 'class' ? s.class_id : null,
});

export const dedupeScopes = (list: ScopeRef[]): ScopeRef[] => {
  const seen = new Set<string>();
  return list.filter((s) => { const k = scopeKey(s); if (seen.has(k)) return false; seen.add(k); return true; });
};

export default function ScopePicker({
  value, onChange, lookups, depth = 'class', requireLeaf = false,
  idPrefix = 'scope', title = 'أماكن الخدمة', hint,
  /** places the caller may pick from (RLS already narrows the lookups — this is an extra UI lock) */
  lockChurch, lockService, allowedChurches,
  max, disabled = false, primaryLabel = 'الأساسي', addLabel = 'إضافة مكان آخر',
  emptyText = 'لم يُختر أي مكان بعد',
}: {
  value: ScopeRef[];
  onChange: (next: ScopeRef[]) => void;
  lookups: ScopeLookups;
  depth?: ScopeDepth;
  requireLeaf?: boolean;
  idPrefix?: string;
  title?: string | null;
  hint?: string;
  lockChurch?: string | null;
  lockService?: string | null;
  allowedChurches?: string[];
  max?: number;
  disabled?: boolean;
  primaryLabel?: string | null;
  addLabel?: string;
  emptyText?: string;
}) {
  const churches = useMemo(
    () => lookups.churches.filter((c) => (!lockChurch || c.id === lockChurch) && (!allowedChurches || allowedChurches.includes(c.id))),
    [lookups.churches, lockChurch, allowedChurches],
  );
  const single = churches.length === 1;

  const [churchId, setChurchId] = useState(lockChurch ?? (single ? churches[0]?.id ?? '' : ''));
  const [serviceId, setServiceId] = useState(lockService ?? '');
  // several classes may be ticked → one place is added per class
  const [classIds, setClassIds] = useState<string[]>([]);
  const [open, setOpen] = useState(value.length === 0);

  // keep the locked / single church in sync when the lookups arrive later
  const effChurch = lockChurch ?? (churchId || (single ? churches[0]?.id ?? '' : ''));
  const effService = lockService ?? serviceId;

  const services = useMemo(() => lookups.services.filter((s) => s.church_id === effChurch && (!lockService || s.id === lockService)), [lookups.services, effChurch, lockService]);
  const classes = useMemo(() => lookups.classes.filter((c) => c.service_id === effService), [lookups.classes, effService]);

  // [] = «no class chosen» → a single service-level place (or the leaf is required)
  const classTargetIds: (string | null)[] = depth === 'class' && classIds.length ? classIds : [null];
  const candidates: ScopeRef[] = effChurch
    ? classTargetIds.map((cid) => clampScope({ church_id: effChurch, service_id: effService || null, class_id: cid }, depth))
    : [];
  const fresh = candidates.filter((c) => !value.some((v) => scopeKey(v) === scopeKey(c)));
  const already = candidates.length > 0 && fresh.length === 0;
  const leafMissing = requireLeaf && (
    (depth === 'class' && classIds.length === 0) || (depth === 'service' && !effService)
  );
  const room = max === undefined ? Infinity : max - value.length;
  const canAdd = candidates.length > 0 && !already && !leafMissing && !disabled && room > 0;

  const add = () => {
    if (!canAdd) return;
    const toAdd = fresh.slice(0, room);
    onChange(dedupeScopes([...value, ...toAdd]));
    // keep church / service (the usual case: several classes of the same service), reset the classes
    setClassIds([]);
    if (value.length + toAdd.length >= (max ?? Infinity)) setOpen(false);
  };
  const remove = (i: number) => { if (!disabled) onChange(value.filter((_, j) => j !== i)); };
  const makePrimary = (i: number) => {
    if (disabled || i === 0) return;
    const next = [...value];
    const [x] = next.splice(i, 1);
    onChange([x, ...next]);
  };

  const selectCls = (locked: boolean) => `input-field !py-2 text-sm ${locked ? 'bg-primary-50 text-primary-800 font-bold pointer-events-none' : ''}`;

  return (
    <div id={`${idPrefix}-picker`} className="space-y-2">
      {title && (
        <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
          <MapPin className="h-4 w-4 text-primary-500" /> {title}
          {value.length > 0 && <span className="badge bg-primary-100 text-primary-700">{value.length}</span>}
        </p>
      )}
      {hint && <p className="text-xs text-slate-400">{hint}</p>}

      {/* ---- chosen places ---- */}
      {value.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-center text-xs font-bold text-slate-400">{emptyText}</p>
      ) : (
        <ul id={`${idPrefix}-list`} className="space-y-1.5">
          {value.map((s, i) => (
            <li key={scopeKey(s)} id={`${idPrefix}-item-${i}`}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${i === 0 && primaryLabel ? 'bg-primary-50 ring-1 ring-primary-200' : 'bg-white ring-1 ring-slate-100'}`}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-primary-500 ring-1 ring-primary-100">
                {depth === 'church' ? <ChurchIcon className="h-4 w-4" /> : depth === 'service' ? <Layers className="h-4 w-4" /> : <School className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1 truncate font-bold text-slate-700">{scopeLabel(s, lookups, depth)}</span>
              {primaryLabel && (i === 0 ? (
                <span className="badge bg-primary-600 text-white"><Star className="h-3 w-3" /> {primaryLabel}</span>
              ) : !disabled && (
                <button type="button" onClick={() => makePrimary(i)} aria-label="اجعله الأساسي" title="اجعله الأساسي"
                  className="rounded-lg p-1 text-slate-400 transition hover:bg-primary-50 hover:text-primary-600">
                  <Star className="h-4 w-4" />
                </button>
              ))}
              {!disabled && (
                <button type="button" id={`${idPrefix}-remove-${i}`} onClick={() => remove(i)} aria-label="إزالة" title="إزالة"
                  className="rounded-lg p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-500">
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* ---- add another place ---- */}
      {!disabled && (max === undefined || value.length < max) && (
        !open ? (
          <button type="button" id={`${idPrefix}-open`} onClick={() => setOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary-300 bg-primary-50/40 py-2 text-xs font-extrabold text-primary-600 transition hover:bg-primary-50">
            <Plus className="h-4 w-4" /> {addLabel}
          </button>
        ) : (
          <div id={`${idPrefix}-add`} className="space-y-2 rounded-2xl border border-primary-100 bg-primary-50/30 p-3">
            {!(single || lockChurch) && (
              <select id={`${idPrefix}-church`} className={selectCls(false)} value={effChurch}
                onChange={(e) => { setChurchId(e.target.value); setServiceId(''); setClassIds([]); }}>
                <option value="">اختر الكنيسة</option>
                {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {(single || lockChurch) && (
              <p className="flex items-center gap-1 text-xs font-bold text-primary-700">
                {lockChurch && <Lock className="h-3 w-3" />} <ChurchIcon className="h-3 w-3" /> {churches[0]?.name ?? '…'}
              </p>
            )}
            {depth !== 'church' && (
              <select id={`${idPrefix}-service`} className={selectCls(!!lockService)} value={effService}
                onChange={(e) => { setServiceId(e.target.value); setClassIds([]); }} disabled={!effChurch} tabIndex={lockService ? -1 : 0}>
                <option value="">{!effChurch ? 'اختر الكنيسة أولاً' : requireLeaf && depth === 'service' ? 'اختر الخدمة' : 'كل الخدمات (بدون تحديد)'}</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            {depth === 'class' && (
              <MultiClassSelect id={`${idPrefix}-class`} value={classIds} onChange={setClassIds} options={classes}
                showAll={!requireLeaf} disabled={!effService}
                allLabel={!effService ? 'اختر الخدمة أولاً' : requireLeaf ? 'اختر الفصول' : 'كل الفصول (بدون تحديد)'}
                className="!py-2 !text-sm" />
            )}
            <div className="flex gap-2">
              <button type="button" id={`${idPrefix}-add-btn`} onClick={add} disabled={!canAdd}
                className="btn-primary flex flex-1 items-center justify-center gap-1 !py-2 text-sm disabled:opacity-50">
                <Plus className="h-4 w-4" /> {already ? 'مُضاف بالفعل' : fresh.length > 1 ? `إضافة ${fresh.length} فصول` : 'إضافة'}
              </button>
              {value.length > 0 && (
                <button type="button" onClick={() => setOpen(false)} className="btn-secondary !px-3 !py-2 text-sm">إغلاق</button>
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}
