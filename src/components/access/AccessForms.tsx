'use client';

// ---------- Access module admin forms ----------
//   EventFormModal — create / edit a بوابة دخول (name · scope · active ·
//                    allow_all · root_op · window)
//   RuleFormModal  — create / edit a rule of any kind (params per kind)
//   GroupFormModal — create / edit an AND / OR group

import { useMemo, useState } from 'react';
import { Save, Loader2, DoorOpen, ListChecks, Layers, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { ModalFrame } from '@/components/PersonDataModals';
import { MultiClassSelect } from '@/components/MultiClassSelect';
import { classSel, classTargets } from '@/lib/class-multi';
import type { Church, Service, ClassRoom } from '@/lib/types';
import {
  saveAccessEvent, saveAccessRule, saveRuleGroup, deleteRuleGroup,
  RULE_KINDS, RULE_KIND_BY_KEY, CMP_OPS, PERSON_FIELDS, FIELD_OPS, OP_LABELS, describeRule,
  type AccessEvent, type AccessRule, type AccessRuleGroup, type BoolOp, type RuleKind, type RuleParams, type RuleLookups, type CmpOp, type FieldOp,
} from '@/lib/access';

const ALL = 'all';

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

function Toggle({ id, checked, onChange, label, desc }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <button id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={`flex w-full items-center gap-3 rounded-2xl border-2 px-3 py-2.5 text-right transition ${checked ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'right-0.5' : 'right-[22px]'}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-extrabold">{label}</span>
        {desc && <span className="block text-[11px] font-bold text-slate-500">{desc}</span>}
      </span>
    </button>
  );
}

const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

// =====================================================================
// EventFormModal
// =====================================================================
export function EventFormModal({ item, lookups, onSaved, onClose }: { item: AccessEvent | null; lookups: ScopeLookups; onSaved: (e: AccessEvent) => void; onClose: () => void }) {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const { churches, services, classes } = lookups;

  const defaultChurch = item?.church_id ?? profile?.church_id ?? (churches.length === 1 ? churches[0].id : '');
  const [churchId, setChurchId] = useState(defaultChurch);
  const [serviceId, setServiceId] = useState(item ? (item.service_id ?? ALL) : (profile?.service_id ?? ALL));
  const [classIds, setClassIds] = useState<string[]>(classSel(item ? item.class_id : profile?.class_id)); // [] = كل الفصول
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [isActive, setIsActive] = useState(item?.is_active ?? true);
  const [allowAll, setAllowAll] = useState(item?.allow_all ?? false);
  const [rootOp, setRootOp] = useState<BoolOp>(item?.root_op ?? 'and');
  const [startsAt, setStartsAt] = useState(toLocalInput(item?.starts_at));
  const [endsAt, setEndsAt] = useState(toLocalInput(item?.ends_at));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const churchLocked = !!profile && profile.role !== 'owner';
  const serviceLocked = !!profile && !!profile.service_id && profile.role !== 'owner' && profile.role !== 'church_manager';
  const classLocked = !!profile && !!profile.class_id && profile.role === 'class_servant';

  const visibleServices = useMemo(() => services.filter((s) => s.church_id === churchId), [services, churchId]);
  const visibleClasses = useMemo(() => classes.filter((c) => c.church_id === churchId && (serviceId === ALL || c.service_id === serviceId)), [classes, churchId, serviceId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!churchId) return setError('اختر الكنيسة');
    if (!name.trim()) return setError('اسم بوابة الدخول مطلوب');
    setSaving(true);
    try {
      const body = {
        church_id: churchId,
        service_id: serviceId === ALL ? null : serviceId,
        name: name.trim(),
        description: description.trim() || null,
        is_active: isActive,
        allow_all: allowAll,
        root_op: rootOp,
        starts_at: fromLocalInput(startsAt),
        ends_at: fromLocalInput(endsAt),
      };
      // one gate per chosen class (none = whole service / church); editing updates the
      // existing gate to the first class and creates copies for the others
      const targets = serviceId === ALL ? [null] : classTargets(classIds);
      const saved = await saveAccessEvent(supabase, { ...body, class_id: targets[0] }, item?.id);
      for (const cid of targets.slice(1)) await saveAccessEvent(supabase, { ...body, class_id: cid });
      onSaved(saved);
    } catch (err) {
      const msg = (err as { message?: string }).message ?? '';
      setError(msg.includes('row-level security') ? 'ليس لديك صلاحية على هذا النطاق' : 'تعذر الحفظ — ' + msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalFrame title={item ? 'تعديل بوابة الدخول' : 'بوابة دخول جديدة'} icon={<DoorOpen className="h-5 w-5 text-emerald-600" />} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="الاسم *">
          <input id="access-event-name" className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: حفلة نهاية العام · أتوبيس الرحلة · قاعة الاجتماع" required />
        </Field>
        <Field label="وصف (اختياري)">
          <textarea id="access-event-desc" className="input-field" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="نطاق البوابة (كنيسة ← خدمة ← فصل)" hint="يحدد من يرى البوابة من الخدام، وأي تسجيلات الشخص تُحسب نقاطها وحضورها. اترك «الكل» لبوابة على مستوى الكنيسة أو الخدمة.">
          <div className="grid grid-cols-3 gap-2">
            <select id="access-event-church" className={`input-field !px-2 text-xs font-bold ${churchLocked ? 'pointer-events-none bg-primary-50 opacity-80' : ''}`}
              value={churchId} onChange={(e) => { setChurchId(e.target.value); setServiceId(ALL); setClassIds([]); }} required>
              <option value="">الكنيسة</option>
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select id="access-event-service" className={`input-field !px-2 text-xs font-bold ${serviceLocked ? 'pointer-events-none bg-primary-50 opacity-80' : ''}`}
              value={serviceId} onChange={(e) => { setServiceId(e.target.value); setClassIds([]); }}>
              <option value={ALL}>كل الخدمات</option>
              {visibleServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <MultiClassSelect id="access-event-class" className={classLocked ? 'pointer-events-none bg-primary-50 opacity-80' : ''}
              value={classIds} onChange={setClassIds} options={visibleClasses} disabled={serviceId === ALL} />
          </div>
        </Field>
        <Field label="ربط القواعد في المستوى الأعلى">
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
            {(['and', 'or'] as BoolOp[]).map((op) => (
              <button key={op} id={`access-event-op-${op}`} type="button" onClick={() => setRootOp(op)} aria-pressed={rootOp === op}
                className={`rounded-xl py-2 text-xs font-extrabold ${rootOp === op ? 'bg-white shadow text-primary-700' : 'text-slate-500'}`}>{OP_LABELS[op]}</button>
            ))}
          </div>
        </Field>
        <Toggle id="access-event-active" checked={isActive} onChange={setIsActive} label="البوابة تعمل" desc="عند الإيقاف يُرفض الجميع" />
        <Toggle id="access-event-allow-all" checked={allowAll} onChange={setAllowAll} label="مفتوحة للجميع (بدون قائمة مسموح لهم)" desc="عند التفعيل تُهمل قائمة المسموح لهم ويُحكم بالقواعد فقط" />
        <div className="grid grid-cols-2 gap-2">
          <Field label="من (اختياري)"><input id="access-event-starts" type="datetime-local" className="input-field !px-2 text-xs" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></Field>
          <Field label="إلى (اختياري)"><input id="access-event-ends" type="datetime-local" className="input-field !px-2 text-xs" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></Field>
        </div>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button id="access-event-save" type="submit" disabled={saving} className="btn-primary flex items-center justify-center gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </form>
    </ModalFrame>
  );
}

// =====================================================================
// RuleFormModal
// =====================================================================
export function RuleFormModal({
  event, rule, groupId, lookups, scope, onSaved, onClose,
}: {
  event: AccessEvent;
  rule: AccessRule | null;
  /** group to create in (ignored when editing) */
  groupId: string | null;
  lookups: RuleLookups;
  scope: ScopeLookups;
  onSaved: (r: AccessRule) => void;
  onClose: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [kind, setKind] = useState<RuleKind>(rule?.kind ?? 'points');
  const [name, setName] = useState(rule?.name ?? '');
  const [nameTouched, setNameTouched] = useState(!!rule);
  const [params, setParams] = useState<RuleParams>(rule?.params ?? { op: 'gte', value: 10 });
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const def = RULE_KIND_BY_KEY[kind];
  const set = (patch: Partial<RuleParams>) => setParams((p) => ({ ...p, ...patch }));

  const changeKind = (k: RuleKind) => {
    setKind(k);
    const defaults: Record<RuleKind, RuleParams> = {
      points: { op: 'gte', value: 10 },
      attendance_count: { op: 'gte', value: 3 },
      attended_events: { event_ids: [], mode: 'all' },
      gender: { value: 'male' },
      age: { op: 'between', value: 6, value2: 12 },
      enrolled_in: { church_id: event.church_id, service_id: event.service_id ?? undefined, class_ids: event.class_id ? [event.class_id] : undefined },
      person_field: { field: 'phone', op: 'present' },
      exam_passed: { exam_id: lookups.exams?.[0]?.id },
      achievement: { achievement_id: lookups.achievements?.[0]?.id },
      occasion: { occasion_id: lookups.occasions?.[0]?.id, statuses: ['confirmed', 'checked_in'] },
      not_entered: { period: 'day' },
    };
    setParams(defaults[k]);
  };

  const autoName = describeRule({ kind, params }, lookups);
  const finalName = nameTouched && name.trim() ? name.trim() : autoName;

  const visibleServices = useMemo(() => scope.services.filter((s) => !params.church_id || s.church_id === params.church_id), [scope.services, params.church_id]);
  const visibleClasses = useMemo(() => scope.classes.filter((c) => (!params.church_id || c.church_id === params.church_id) && (!params.service_id || c.service_id === params.service_id)), [scope.classes, params.church_id, params.service_id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!finalName) return setError('اسم القاعدة مطلوب');
    if (def.numeric && (params.value === '' || params.value === undefined || Number.isNaN(Number(params.value)))) return setError('أدخل القيمة');
    if (def.numeric && params.op === 'between' && (params.value2 === '' || params.value2 === undefined)) return setError('أدخل الحد الأعلى');
    if (kind === 'attended_events' && (params.event_ids ?? []).length === 0) return setError('اختر مناسبة واحدة على الأقل');
    if (kind === 'exam_passed' && !params.exam_id) return setError('اختر الامتحان');
    if (kind === 'achievement' && !params.achievement_id) return setError('اختر الإنجاز');
    if (kind === 'occasion' && !params.occasion_id) return setError('اختر الفعالية');
    if ((kind === 'person_field') && (params.op === 'contains' || params.op === 'equals') && !String(params.value ?? '').trim()) return setError('أدخل النص');
    setSaving(true);
    try {
      const clean: RuleParams = { ...params };
      if (def.numeric) { clean.value = Number(params.value); clean.value2 = params.op === 'between' ? Number(params.value2) : undefined; }
      (Object.keys(clean) as (keyof RuleParams)[]).forEach((k) => { if (clean[k] === undefined || clean[k] === '') delete clean[k]; });
      const saved = await saveAccessRule(supabase, {
        event_id: event.id,
        group_id: rule ? rule.group_id : groupId,
        name: finalName.slice(0, 160),
        kind, params: clean, enabled,
        sort_order: rule?.sort_order ?? Date.now() % 1_000_000,
      }, rule?.id);
      onSaved(saved);
    } catch (err) {
      setError('تعذر الحفظ — ' + ((err as { message?: string }).message ?? ''));
    } finally {
      setSaving(false);
    }
  };

  const numericInputs = def.numeric && (
    <div className="grid grid-cols-3 gap-2">
      <Field label="الشرط">
        <select id="access-rule-op" className="input-field !px-2 text-xs font-bold" value={(params.op as CmpOp) ?? 'gte'} onChange={(e) => set({ op: e.target.value as CmpOp })}>
          {CMP_OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
        </select>
      </Field>
      <Field label={params.op === 'between' ? 'من' : 'القيمة'}>
        <input id="access-rule-value" type="number" inputMode="numeric" className="input-field !px-2 text-center font-extrabold" value={params.value ?? ''} onChange={(e) => set({ value: e.target.value })} />
      </Field>
      {params.op === 'between' ? (
        <Field label="إلى"><input id="access-rule-value2" type="number" inputMode="numeric" className="input-field !px-2 text-center font-extrabold" value={params.value2 ?? ''} onChange={(e) => set({ value2: e.target.value })} /></Field>
      ) : <div />}
    </div>
  );

  const dateInputs = def.dateRange && (
    <div className="grid grid-cols-2 gap-2">
      <Field label="من تاريخ (اختياري)"><input id="access-rule-from" type="date" className="input-field !px-2 text-xs" value={params.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} /></Field>
      <Field label="إلى تاريخ (اختياري)"><input id="access-rule-to" type="date" className="input-field !px-2 text-xs" value={params.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} /></Field>
    </div>
  );

  return (
    <ModalFrame title={rule ? 'تعديل القاعدة' : 'قاعدة جديدة'} icon={<ListChecks className="h-5 w-5 text-primary-600" />} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="نوع القاعدة" hint={def.desc}>
          <select id="access-rule-kind" className="input-field text-sm font-bold" value={kind} onChange={(e) => changeKind(e.target.value as RuleKind)} disabled={!!rule}>
            {RULE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
        </Field>

        {numericInputs}

        {kind === 'attendance_count' && (
          <Field label="في مناسبة محددة (اختياري)" hint="بدون اختيار: العدّاد الكلي للحضور. مع اختيار مناسبة أو فترة: يُحسب من سجل الحضور.">
            <select id="access-rule-event" className="input-field !px-2 text-xs font-bold" value={params.event_id ?? ''} onChange={(e) => set({ event_id: e.target.value || undefined })}>
              <option value="">كل المناسبات</option>
              {(lookups.events ?? []).map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
            </select>
          </Field>
        )}

        {kind === 'attended_events' && (
          <>
            <Field label="المناسبات المطلوبة *">
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-2xl border-2 border-slate-200 p-2 no-scrollbar">
                {(lookups.events ?? []).length === 0 && <p className="py-2 text-center text-[11px] font-bold text-slate-400">لا توجد مناسبات في نطاقك</p>}
                {(lookups.events ?? []).map((ev) => {
                  const on = (params.event_ids ?? []).includes(ev.id);
                  return (
                    <label key={ev.id} className={`flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-xs font-bold ${on ? 'bg-primary-50 text-primary-800' : ''}`}>
                      <input type="checkbox" className="h-4 w-4 accent-primary-600" checked={on}
                        onChange={() => set({ event_ids: on ? (params.event_ids ?? []).filter((x) => x !== ev.id) : [...(params.event_ids ?? []), ev.id] })} />
                      {ev.name}
                    </label>
                  );
                })}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
              {(['all', 'any'] as const).map((m) => (
                <button key={m} type="button" onClick={() => set({ mode: m })} aria-pressed={(params.mode ?? 'all') === m}
                  className={`rounded-xl py-2 text-xs font-extrabold ${(params.mode ?? 'all') === m ? 'bg-white shadow text-primary-700' : 'text-slate-500'}`}>
                  {m === 'all' ? 'حضرها كلها' : 'حضر إحداها'}
                </button>
              ))}
            </div>
          </>
        )}

        {dateInputs}

        {kind === 'gender' && (
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
            {(['male', 'female'] as const).map((g) => (
              <button key={g} id={`access-rule-gender-${g}`} type="button" onClick={() => set({ value: g })} aria-pressed={params.value === g}
                className={`rounded-xl py-2 text-xs font-extrabold ${params.value === g ? 'bg-white shadow text-primary-700' : 'text-slate-500'}`}>{g === 'male' ? 'ذكر' : 'أنثى'}</button>
            ))}
          </div>
        )}

        {kind === 'enrolled_in' && (
          <Field label="المكان (كنيسة ← خدمة ← فصل)">
            <div className="grid grid-cols-3 gap-2">
              <select className="input-field !px-2 text-xs font-bold" value={params.church_id ?? ''} onChange={(e) => set({ church_id: e.target.value || undefined, service_id: undefined, class_id: undefined, class_ids: undefined })}>
                <option value="">أي كنيسة</option>
                {scope.churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className="input-field !px-2 text-xs font-bold" value={params.service_id ?? ''} onChange={(e) => set({ service_id: e.target.value || undefined, class_id: undefined, class_ids: undefined })}>
                <option value="">كل الخدمات</option>
                {visibleServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <MultiClassSelect id="access-rule-classes" className={!params.service_id ? 'pointer-events-none opacity-60' : ''}
                value={params.class_ids?.length ? params.class_ids : classSel(params.class_id)}
                onChange={(ids) => set({ class_ids: ids.length ? ids : undefined, class_id: undefined })}
                options={visibleClasses} disabled={!params.service_id} />
            </div>
          </Field>
        )}

        {kind === 'person_field' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="الحقل">
              <select className="input-field !px-2 text-xs font-bold" value={params.field ?? 'phone'} onChange={(e) => set({ field: e.target.value as RuleParams['field'] })}>
                {PERSON_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="الشرط">
              <select className="input-field !px-2 text-xs font-bold" value={(params.op as FieldOp) ?? 'present'} onChange={(e) => set({ op: e.target.value as FieldOp })}>
                {FIELD_OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
              </select>
            </Field>
            {(params.op === 'contains' || params.op === 'equals') && (
              <div className="col-span-2"><Field label="النص"><input className="input-field" value={String(params.value ?? '')} onChange={(e) => set({ value: e.target.value })} /></Field></div>
            )}
          </div>
        )}

        {kind === 'exam_passed' && (
          <Field label="الامتحان *">
            <select className="input-field text-xs font-bold" value={params.exam_id ?? ''} onChange={(e) => set({ exam_id: e.target.value || undefined })}>
              <option value="">اختر</option>
              {(lookups.exams ?? []).map((x) => <option key={x.id} value={x.id}>{x.title ?? x.name}</option>)}
            </select>
          </Field>
        )}
        {kind === 'achievement' && (
          <Field label="الإنجاز *">
            <select className="input-field text-xs font-bold" value={params.achievement_id ?? ''} onChange={(e) => set({ achievement_id: e.target.value || undefined })}>
              <option value="">اختر</option>
              {(lookups.achievements ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
        )}
        {kind === 'occasion' && (
          <Field label="الفعالية *" hint="يُقبل المشارك المؤكد أو الذي سجّل الدخول">
            <select className="input-field text-xs font-bold" value={params.occasion_id ?? ''} onChange={(e) => set({ occasion_id: e.target.value || undefined })}>
              <option value="">اختر</option>
              {(lookups.occasions ?? []).map((x) => <option key={x.id} value={x.id}>{x.title ?? x.name}</option>)}
            </select>
          </Field>
        )}
        {kind === 'not_entered' && (
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
            {(['day', 'ever'] as const).map((p) => (
              <button key={p} type="button" onClick={() => set({ period: p })} aria-pressed={(params.period ?? 'day') === p}
                className={`rounded-xl py-2 text-xs font-extrabold ${(params.period ?? 'day') === p ? 'bg-white shadow text-primary-700' : 'text-slate-500'}`}>
                {p === 'day' ? 'لم يدخل اليوم' : 'لم يدخل أبداً'}
              </button>
            ))}
          </div>
        )}

        <Field label="اسم القاعدة (يظهر عند البوابة)" hint={!nameTouched ? `تلقائياً: ${autoName}` : undefined}>
          <input id="access-rule-name" className="input-field" value={nameTouched ? name : ''} placeholder={autoName}
            onChange={(e) => { setName(e.target.value); setNameTouched(true); }} onBlur={() => { if (!name.trim()) setNameTouched(false); }} />
        </Field>

        <Toggle id="access-rule-enabled" checked={enabled} onChange={setEnabled} label="القاعدة مفعّلة" desc="القاعدة المتوقفة تظهر في القائمة ولا تؤثر على القرار" />

        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button id="access-rule-save" type="submit" disabled={saving} className="btn-primary flex items-center justify-center gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </form>
    </ModalFrame>
  );
}

// =====================================================================
// GroupFormModal
// =====================================================================
export function GroupFormModal({
  event, group, parentId, onSaved, onDeleted, onClose,
}: {
  event: AccessEvent;
  group: AccessRuleGroup | null;
  parentId: string | null;
  onSaved: (g: AccessRuleGroup) => void;
  onDeleted?: (id: string) => void;
  onClose: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [name, setName] = useState(group?.name ?? '');
  const [op, setOp] = useState<BoolOp>(group?.op ?? 'or');
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const saved = await saveRuleGroup(supabase, {
        event_id: event.id, parent_id: group ? group.parent_id : parentId, name: name.trim() || null, op,
        sort_order: group?.sort_order ?? Date.now() % 1_000_000,
      }, group?.id);
      onSaved(saved);
    } catch (err) {
      setError('تعذر الحفظ — ' + ((err as { message?: string }).message ?? ''));
    } finally { setSaving(false); }
  };
  const remove = async () => {
    if (!group) return;
    setSaving(true);
    try { await deleteRuleGroup(supabase, group.id); onDeleted?.(group.id); } finally { setSaving(false); }
  };

  return (
    <ModalFrame title={group ? 'تعديل المجموعة' : 'مجموعة قواعد جديدة'} icon={<Layers className="h-5 w-5 text-indigo-600" />} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="rounded-xl bg-indigo-50 px-3 py-2 text-[11px] font-bold text-indigo-700">
          المجموعة تجمع عدة قواعد (أو مجموعات فرعية) بشرط واحد: <b>كلها</b> (AND) أو <b>أي منها</b> (OR) — ثم تُعامل كشرط واحد في المستوى الأعلى.
        </p>
        <Field label="اسم المجموعة (اختياري)">
          <input id="access-group-name" className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: أحد شرطي الحضور" />
        </Field>
        <Field label="ربط القواعد داخل المجموعة">
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
            {(['and', 'or'] as BoolOp[]).map((o) => (
              <button key={o} id={`access-group-op-${o}`} type="button" onClick={() => setOp(o)} aria-pressed={op === o}
                className={`rounded-xl py-2 text-xs font-extrabold ${op === o ? 'bg-white shadow text-indigo-700' : 'text-slate-500'}`}>{OP_LABELS[o]}</button>
            ))}
          </div>
        </Field>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button id="access-group-save" type="submit" disabled={saving} className="btn-primary flex items-center justify-center gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
        {group && onDeleted && (
          !confirm ? (
            <button type="button" onClick={() => setConfirm(true)} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-red-50 py-2 text-xs font-extrabold text-red-600">
              <Trash2 className="h-4 w-4" /> حذف المجموعة (وكل قواعدها)
            </button>
          ) : (
            <button id="access-group-delete-confirm" type="button" onClick={remove} disabled={saving} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-red-500 py-2 text-xs font-extrabold text-white">
              <Trash2 className="h-4 w-4" /> تأكيد الحذف
            </button>
          )
        )}
      </form>
    </ModalFrame>
  );
}
