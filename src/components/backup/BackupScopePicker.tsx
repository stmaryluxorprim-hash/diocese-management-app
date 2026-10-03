'use client';

// ---------- BackupScopePicker — «ماذا تنسخ؟ الكل أم نطاق محدد» ----------
// migration 20261009120000. Four big choices: الكل · كنيسة · خدمة · فصل, then
// the cascading selects for the chosen level. Emits a BackupScope (ids only,
// null = everything). Used by the backup modal and the schedule form.

import { useEffect, useMemo, useState } from 'react';
import { Database, Church as ChurchIcon, Layers, School, Loader2 } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Church, Service, ClassRoom } from '@/lib/types';
import { SCOPE_LEVEL_LABELS, scopeLevelOf, type BackupScope, type BackupScopeLevel } from '@/lib/backup';

export interface ScopeLookups { churches: Church[]; services: Service[]; classes: ClassRoom[] }

/** Load churches → services → classes once (the owner sees everything). */
export async function fetchScopeLookups(supabase: SupabaseClient): Promise<ScopeLookups> {
  const [c, s, k] = await Promise.all([
    supabase.from('churches').select('*').order('sort_order').order('name'),
    supabase.from('services').select('*').order('sort_order').order('name'),
    supabase.from('classes').select('*').order('sort_order').order('name'),
  ]);
  return {
    churches: (c.data as Church[]) ?? [],
    services: (s.data as Service[]) ?? [],
    classes: (k.data as ClassRoom[]) ?? [],
  };
}

type Choice = 'all' | BackupScopeLevel;
const CHOICES: { key: Choice; label: string; desc: string; icon: React.ReactNode }[] = [
  { key: 'all',     label: 'الكل',    desc: 'قاعدة البيانات كاملة',          icon: <Database className="h-5 w-5" /> },
  { key: 'church',  label: SCOPE_LEVEL_LABELS.church,  desc: 'كنيسة واحدة بكل خدماتها وفصولها', icon: <ChurchIcon className="h-5 w-5" /> },
  { key: 'service', label: SCOPE_LEVEL_LABELS.service, desc: 'خدمة واحدة بكل فصولها',          icon: <Layers className="h-5 w-5" /> },
  { key: 'class',   label: SCOPE_LEVEL_LABELS.class,   desc: 'فصل واحد',                      icon: <School className="h-5 w-5" /> },
];

export default function BackupScopePicker({
  value, onChange, lookups, disabled = false, idPrefix = 'backup-scope', accent = 'primary',
}: {
  value: BackupScope | null;
  onChange: (next: BackupScope | null) => void;
  lookups: ScopeLookups | null;         // null = still loading
  disabled?: boolean;
  idPrefix?: string;
  accent?: 'primary' | 'violet';
}) {
  const [choice, setChoice] = useState<Choice>(scopeLevelOf(value) ?? 'all');
  const [churchId, setChurchId] = useState(value?.church_id ?? '');
  const [serviceId, setServiceId] = useState(value?.service_id ?? '');
  const [classId, setClassId] = useState(value?.class_id ?? '');

  // keep the local selects in sync when the parent resets the value
  useEffect(() => {
    const lvl = scopeLevelOf(value);
    setChoice(lvl ?? 'all');
    setChurchId(value?.church_id ?? '');
    setServiceId(value?.service_id ?? '');
    setClassId(value?.class_id ?? '');
  }, [value]);

  const services = useMemo(() => (lookups?.services ?? []).filter((s) => s.church_id === churchId), [lookups, churchId]);
  const classes = useMemo(() => (lookups?.classes ?? []).filter((k) => k.service_id === serviceId), [lookups, serviceId]);

  const emit = (c: Choice, ch: string, sv: string, cl: string) => {
    if (c === 'all') { onChange(null); return; }
    if (c === 'church') { onChange(ch ? { church_id: ch, service_id: null, class_id: null } : null); return; }
    if (c === 'service') { onChange(ch && sv ? { church_id: ch, service_id: sv, class_id: null } : null); return; }
    onChange(ch && sv && cl ? { church_id: ch, service_id: sv, class_id: cl } : null);
  };

  const pick = (c: Choice) => {
    setChoice(c);
    const ch = c === 'all' ? '' : (churchId || (lookups?.churches.length === 1 ? lookups.churches[0].id : ''));
    setChurchId(ch);
    if (c === 'church' || c === 'all') { setServiceId(''); setClassId(''); }
    emit(c, ch, c === 'church' || c === 'all' ? '' : serviceId, c === 'class' ? classId : '');
  };
  const pickChurch = (ch: string) => { setChurchId(ch); setServiceId(''); setClassId(''); emit(choice, ch, '', ''); };
  const pickService = (sv: string) => { setServiceId(sv); setClassId(''); emit(choice, churchId, sv, ''); };
  const pickClass = (cl: string) => { setClassId(cl); emit(choice, churchId, serviceId, cl); };

  const on = accent === 'violet' ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-primary-500 bg-primary-50 text-primary-700';
  const incomplete = choice !== 'all' && !value;

  return (
    <div id={`${idPrefix}-picker`} className="space-y-2">
      <div className="grid grid-cols-4 gap-2">
        {CHOICES.map((c) => (
          <button
            key={c.key} type="button" data-scope-level={c.key} disabled={disabled}
            onClick={() => pick(c.key)}
            className={`flex flex-col items-center gap-1 rounded-xl border-2 px-2 py-2.5 text-xs font-bold transition disabled:opacity-50 ${choice === c.key ? on : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            {c.icon}
            <span>{c.label}</span>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">{CHOICES.find((c) => c.key === choice)?.desc}</p>

      {choice !== 'all' && (
        lookups === null ? (
          <div className="flex justify-center py-3"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold text-slate-500">الكنيسة</span>
              <select id={`${idPrefix}-church`} value={churchId} disabled={disabled} onChange={(e) => pickChurch(e.target.value)} className="input-field !py-2 text-sm">
                <option value="">— اختر —</option>
                {lookups.churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            {(choice === 'service' || choice === 'class') && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold text-slate-500">الخدمة</span>
                <select id={`${idPrefix}-service`} value={serviceId} disabled={disabled || !churchId} onChange={(e) => pickService(e.target.value)} className="input-field !py-2 text-sm">
                  <option value="">— اختر —</option>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
            {choice === 'class' && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold text-slate-500">الفصل</span>
                <select id={`${idPrefix}-class`} value={classId} disabled={disabled || !serviceId} onChange={(e) => pickClass(e.target.value)} className="input-field !py-2 text-sm">
                  <option value="">— اختر —</option>
                  {classes.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select>
              </label>
            )}
          </div>
        )
      )}
      {incomplete && lookups !== null && (
        <p className="text-[11px] font-bold text-amber-600">أكمل اختيار {SCOPE_LEVEL_LABELS[choice as BackupScopeLevel]} لتحديد النطاق.</p>
      )}
      {choice !== 'all' && value && (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          تشمل النسخة: هيكل هذا النطاق (الكنيسة ← الخدمة ← الفصل) · المخدومين والخدام المسجّلين فيه · حضورهم ونقاطهم وافتقادهم ·
          كل ما يخص النطاق في بقية الوحدات · والسجلات المشتركة (مثل المناسبات العامة للكنيسة). الجداول غير المرتبطة بالهيكل (الإعدادات · ملفات الصلاحيات …) تُنسخ كاملة.
          <strong className="block mt-1 text-amber-700">نسخة النطاق تُسترجع بوضع «دمج» فقط.</strong>
        </p>
      )}
    </div>
  );
}
