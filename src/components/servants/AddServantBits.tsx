'use client';

// ---------- Shared bits for «إضافة خدام» (فردي + جماعي) — migration 0041 ----------
// role / scope selectors bound to the approver's level, permission profile
// chips, and the client wrapper around POST /api/servants/create.

import { useEffect, useMemo, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { MultiClassSelect } from '@/components/MultiClassSelect';
import ScopePicker, { clampScope, dedupeScopes, type ScopeDepth } from '@/components/ScopePicker';
import { useAuth } from '@/lib/auth-context';
import {
  ROLE_LABELS, ADD_SERVANT_ERROR_LABELS, scopeKey,
  type AppRole, type Church, type Service, type ClassRoom, type ServantEnrollment,
  type AddServantInput, type AddServantOutcome, type AddServantError, type PermissionProfile, type ScopeRef,
} from '@/lib/types';

const depthOf = (r: AppRole): ScopeDepth => r === 'church_manager' ? 'church' : r === 'service_manager' ? 'service' : 'class';

/** Which roles may THIS manager grant? (mirror of the approval flow + SQL) */
export function grantableRoles(approver: ServantEnrollment): AppRole[] {
  return approver.role === 'owner'
    ? ['church_manager', 'service_manager', 'class_servant']
    : approver.role === 'church_manager'
    ? ['service_manager', 'class_servant']
    : ['class_servant'];
}

/** Call the server route; never throws — one outcome per item, same order. */
export async function postAddServants(items: AddServantInput[]): Promise<AddServantOutcome[]> {
  try {
    const res = await fetch('/api/servants/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = String(j?.error ?? '');
      const code: AddServantError = err === 'forbidden' || err === 'unauthorized' ? 'not_allowed' : 'failed';
      const detail = err === 'not_configured'
        ? 'الخادم غير مهيأ — SUPABASE_SERVICE_ROLE_KEY مفقود في إعدادات النشر'
        : err === 'too_many' ? `الحد الأقصى ${j?.max ?? 200} صفًا في المرة`
        : err || undefined;
      return items.map(() => ({ ok: false, error: code, detail }));
    }
    const results = Array.isArray(j?.results) ? (j.results as AddServantOutcome[]) : [];
    return items.map((_, i) => results[i] ?? { ok: false, error: 'failed' });
  } catch {
    return items.map(() => ({ ok: false, error: 'failed', detail: 'تعذر الاتصال بالخادم' }));
  }
}

export const outcomeLabel = (o: AddServantOutcome): string => {
  if (o.ok) return 'تمت الإضافة';
  const base = ADD_SERVANT_ERROR_LABELS[o.error] ?? 'فشل';
  return o.detail && (o.error === 'failed' || o.error === 'not_allowed') ? `${base} — ${o.detail}` : base;
};

// ---------- role + scope selectors ----------
export function useServantScope(approver: ServantEnrollment | null, churches: Church[], services: Service[], classes: ClassRoom[]) {
  const [role, setRole] = useState<AppRole>('class_servant');
  const [churchId, setChurchId] = useState('');
  const [serviceId, setServiceId] = useState('');
  // several classes may be ticked: each becomes its own place (the first is the primary one)
  const [classIds, setClassIds] = useState<string[]>([]);
  // 0045: ADDITIONAL places besides the primary one above
  const [extraScopes, setExtraScopes] = useState<ScopeRef[]>([]);
  const { scopes: approverScopes } = useAuth();

  useEffect(() => {
    if (!approver) return;
    if (approver.church_id && churches.some((c) => c.id === approver.church_id)) setChurchId(approver.church_id);
    else if (churches.length === 1) setChurchId(churches[0].id);
    if (approver.service_id && services.some((s) => s.id === approver.service_id)) setServiceId(approver.service_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approver?.id, churches.length, services.length]);

  const churchLocked = !!approver && approver.role !== 'owner';
  const serviceLocked = !!approver && approver.role === 'service_manager' && !!approver.service_id;

  const visibleServices = useMemo(() => services.filter((s) => !churchId || s.church_id === churchId), [services, churchId]);
  const visibleClasses = useMemo(
    () => classes.filter((c) => (!churchId || c.church_id === churchId) && (!serviceId || c.service_id === serviceId)),
    [classes, churchId, serviceId],
  );

  const needService = role !== 'church_manager';
  const needClass = role === 'class_servant';

  const onChurch = (v: string) => { setChurchId(v); setServiceId(''); setClassIds([]); };
  const onService = (v: string) => { setServiceId(v); setClassIds([]); };
  const onRole = (r: AppRole) => {
    setRole(r);
    if (r === 'church_manager') { if (!serviceLocked) setServiceId(''); setClassIds([]); }
    if (r === 'service_manager') setClassIds([]);
    setExtraScopes((xs) => dedupeScopes(xs.map((x) => clampScope(x, depthOf(r)))));
  };

  /** validation message or null */
  const validate = (): string | null => {
    if (!churchId) return 'اختر الكنيسة';
    if (role === 'service_manager' && !serviceId) return 'اختر الخدمة لمسؤول الخدمة';
    return null;
  };

  // the chosen classes in list order; the first one is the primary place / drives the code
  const pickedClasses = visibleClasses.filter((c) => classIds.includes(c.id));
  const classId = needClass ? (pickedClasses[0]?.id ?? '') : '';

  const primary: ScopeRef | null = churchId ? {
    church_id: churchId,
    service_id: needService ? (serviceId || null) : null,
    class_id: needClass ? (classId || null) : null,
  } : null;
  // one place per ticked class (beyond the primary)
  const classScopes: ScopeRef[] = primary && needClass
    ? pickedClasses.slice(1).map((c) => ({ church_id: churchId, service_id: serviceId || null, class_id: c.id }))
    : [];
  // every place, primary first, without duplicates
  const allScopes: ScopeRef[] = primary
    ? [primary, ...[...classScopes, ...extraScopes.map((x) => clampScope(x, depthOf(role)))].filter((x, i, arr) =>
        scopeKey(x) !== scopeKey(primary) && arr.findIndex((y) => scopeKey(y) === scopeKey(x)) === i)]
    : [];

  // churches / services the approver may grant (mirror of SQL scope_grantable)
  const allowedChurches = approver && approver.role !== 'owner'
    ? Array.from(new Set((approverScopes.length ? approverScopes.map((s) => s.church_id) : [approver.church_id ?? '']).filter(Boolean)))
    : undefined;
  const wholeChurch = approverScopes.some((s) => !s.service_id);
  const lockServiceExtra = approver?.role === 'service_manager' && !wholeChurch && approver.service_id ? approver.service_id : null;

  return {
    role, churchId, serviceId, classId, classIds,
    setRole: onRole, onChurch, onService, setClassIds,
    churchLocked, serviceLocked, visibleServices, visibleClasses, needService, needClass, validate,
    payloadScope: {
      church_id: churchId,
      service_id: needService ? (serviceId || null) : null,
      class_id: needClass ? (classId || null) : null,
      scopes: allScopes,
    },
    // 0045
    extraScopes, setExtraScopes, allScopes, depth: depthOf(role), allowedChurches, lockServiceExtra,
  };
}

export function RoleScopeFields({
  scope, approver, churches, idPrefix, services = [], classes = [], extraLabel = 'أماكن خدمة إضافية',
}: {
  scope: ReturnType<typeof useServantScope>; approver: ServantEnrollment; churches: Church[]; idPrefix: string;
  /** 0045: pass services + classes to show the «أماكن إضافية» picker */
  services?: Service[]; classes?: ClassRoom[]; extraLabel?: string;
}) {
  const lockCls = (locked: boolean) => `input-field ${locked ? 'bg-primary-50 pointer-events-none opacity-80' : ''}`;
  const lookups = useMemo(() => ({ churches, services, classes }), [churches, services, classes]);
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500">الدور *</label>
        <select id={`${idPrefix}-role`} className="input-field" value={scope.role} onChange={(e) => scope.setRole(e.target.value as AppRole)}>
          {grantableRoles(approver).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500">الكنيسة *</label>
        <select id={`${idPrefix}-church`} className={lockCls(scope.churchLocked)} value={scope.churchId}
          onChange={(e) => scope.onChurch(e.target.value)} tabIndex={scope.churchLocked ? -1 : 0}>
          <option value="">اختر الكنيسة</option>
          {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {scope.needService && (
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">الخدمة {scope.role === 'service_manager' ? '*' : ''}</label>
          <select id={`${idPrefix}-service`} className={lockCls(scope.serviceLocked)} value={scope.serviceId}
            onChange={(e) => scope.onService(e.target.value)} disabled={!scope.churchId} tabIndex={scope.serviceLocked ? -1 : 0}>
            <option value="">{scope.churchId ? 'كل الخدمات (بدون تحديد)' : 'اختر الكنيسة أولاً'}</option>
            {scope.visibleServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
      {scope.needClass && (
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">الفصول</label>
          <MultiClassSelect id={`${idPrefix}-class`} value={scope.classIds} onChange={scope.setClassIds}
            options={scope.visibleClasses} allLabel={scope.serviceId ? 'كل الفصول (بدون تحديد)' : 'اختر الخدمة أولاً'}
            disabled={!scope.serviceId} />
        </div>
      )}
      {/* 0045: more places (the selects above = the primary place) */}
      {(services.length > 0 || scope.depth === 'church') && scope.churchId && (
        <ScopePicker
          idPrefix={`${idPrefix}-extra`}
          title={extraLabel}
          hint="يخدم في أكثر من فصل أو خدمة أو كنيسة؟ أضف باقي الأماكن هنا — المكان أعلاه هو الأساسي"
          value={scope.extraScopes}
          onChange={scope.setExtraScopes}
          lookups={lookups}
          depth={scope.depth}
          allowedChurches={scope.allowedChurches}
          lockService={scope.lockServiceExtra}
          primaryLabel={null}
          emptyText="لا توجد أماكن إضافية"
          addLabel="إضافة مكان آخر"
        />
      )}
    </div>
  );
}

// ---------- permission profile chips ----------
export function ProfileChips({
  profiles, selected, onToggle, idPrefix,
}: { profiles: PermissionProfile[]; selected: string[]; onToggle: (id: string) => void; idPrefix: string }) {
  if (profiles.length === 0) return null;
  return (
    <div className="rounded-xl bg-slate-50 p-2.5">
      <p className="mb-1.5 flex items-center gap-1 text-xs font-extrabold text-slate-500">
        <KeyRound className="h-3.5 w-3.5 text-violet-500" /> ملفات الصلاحيات <span className="font-normal">(اختياري)</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {profiles.map((pp) => {
          const on = selected.includes(pp.id);
          return (
            <button key={pp.id} id={`${idPrefix}-pp-${pp.id}`} type="button" aria-pressed={on} onClick={() => onToggle(pp.id)}
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${on ? 'text-white shadow' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
              style={on ? { backgroundColor: pp.color } : undefined}>
              {pp.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
