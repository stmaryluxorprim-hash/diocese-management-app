'use client';

// ---------- Automation form (bottom sheet) ----------
// Trigger → Recipient → Notification (templates with [variables]) → scope.

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Zap, X, Users, UserCog, ImagePlus, Eye, Loader2 } from 'lucide-react';
import InfoTip from '@/components/InfoTip';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ScopeSelectors, useScopeState } from '@/components/store/StoreBits';
import { compressImage } from '@/components/messages/ChatBits';
import { uploadPhoto } from '@/lib/upload';
import { ALL } from '@/lib/queries';
import type { Church, Service, ClassRoom } from '@/lib/types';
import {
  TRIGGERS, TRIGGER_BY_KEY, RECIPIENT_LABELS, STANDARD_VARS, LINK_PRESETS,
  saveAutomation, notifErrorMessage, renderPreview,
  type NotificationAutomation, type TriggerKey, type AutomationRecipient, type AutomationInput,
} from '@/lib/notifications';

export default function AutomationForm({ supabase, initial, churches, services, classes, isOwner, userId, onClose, onSaved }: {
  supabase: SupabaseClient;
  initial: NotificationAutomation | null;
  churches: Church[]; services: Service[]; classes: ClassRoom[];
  isOwner: boolean;
  userId?: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [trigger, setTrigger] = useState<TriggerKey>(initial?.trigger_key ?? 'attendance');
  const def = TRIGGER_BY_KEY[trigger];
  const [recipient, setRecipient] = useState<AutomationRecipient>(initial?.recipient ?? 'student');
  const [name, setName] = useState(initial?.name ?? '');
  const [titleT, setTitleT] = useState(initial?.title_template ?? def.sample.title);
  const [bodyT, setBodyT] = useState(initial?.body_template ?? def.sample.body);
  const [linkPreset, setLinkPreset] = useState(() => {
    const l = initial?.link_url ?? '';
    if (!l) return '';
    return LINK_PRESETS.some((p) => p.value === l) ? l : 'custom';
  });
  const [linkCustom, setLinkCustom] = useState(initial?.link_url ?? '');
  const [cfg, setCfg] = useState<number>(() => {
    const c = initial?.config?.[def.config?.key ?? ''];
    return typeof c === 'number' ? c : (def.config?.default ?? 0);
  });
  const [active, setActive] = useState(initial?.is_active ?? true);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.image_url ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scope = useScopeState();
  const [scopeInit, setScopeInit] = useState(false);

  useEffect(() => {
    if (!file) { setFilePreview(null); return; }
    const u = URL.createObjectURL(file);
    setFilePreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // preload the scope of an existing row once the lookups are ready
  useEffect(() => {
    if (scopeInit || !initial || churches.length === 0) return;
    if (initial.church_id) scope.setChurch(initial.church_id);
    setTimeout(() => {
      if (initial.service_id) scope.setService(initial.service_id);
      setTimeout(() => { if (initial.class_id) scope.setClass(initial.class_id); }, 0);
    }, 0);
    setScopeInit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, churches.length, scopeInit]);

  const pickTrigger = (k: TriggerKey) => {
    setTrigger(k);
    const d = TRIGGER_BY_KEY[k];
    if (!initial) { setTitleT(d.sample.title); setBodyT(d.sample.body); if (!name) setName(d.label); }
    if (d.config) setCfg(d.config.default);
    if (!d.recipients.includes(recipient)) setRecipient(d.recipients[0]);
  };

  const scopeIds = useMemo(() => {
    const church = scope.church !== ALL ? scope.church : churches.length === 1 ? churches[0].id : null;
    const visServices = services.filter((s) => !church || s.church_id === church);
    const service = scope.service !== ALL ? scope.service : (church && visServices.length === 1 ? visServices[0].id : null);
    const visClasses = classes.filter((c) => (!church || c.church_id === church) && (!service || c.service_id === service));
    const clsList: string[] = scope.classes.length > 0 ? scope.classes : (service && visClasses.length === 1 ? [visClasses[0].id] : []);
    return { church, service, classes: clsList, class: clsList.length === 1 ? clsList[0] : null };
  }, [scope.church, scope.service, scope.classes, churches, services, classes]);

  const linkValue = linkPreset === 'custom' ? linkCustom.trim() : linkPreset;
  const linkOk = !linkValue || linkValue.startsWith('/') || linkValue.startsWith('https://');
  const canSave = !busy && !!name.trim() && !!titleT.trim() && linkOk && (!!scopeIds.church || isOwner);

  const save = async () => {
    if (!canSave) return;
    setBusy(true); setErr(null);
    try {
      let image_url = imageUrl;
      if (file) image_url = await uploadPhoto(supabase, 'notifications', await compressImage(file), 'auto.webp');
      const baseInput: Omit<AutomationInput, 'class_id'> = {
        church_id: scopeIds.church,
        service_id: scopeIds.church ? scopeIds.service : null,
        trigger_key: trigger, recipient, name: name.trim(), title_template: titleT.trim(), body_template: bodyT.trim(),
        image_url, link_url: linkValue || null, is_active: active,
        config: def.config ? { [def.config.key]: Math.max(def.config.min, Math.min(def.config.max, Math.round(cfg || def.config.default))) } : {},
      };
      // A row holds ONE class. Several chosen classes → the first one updates / creates the row,
      // every other chosen class gets its own copy (one automation per class).
      const classTargets: (string | null)[] = scopeIds.church && scopeIds.service && scopeIds.classes.length > 0 ? scopeIds.classes : [null];
      await saveAutomation(supabase, { ...baseInput, class_id: classTargets[0] }, initial?.id, userId);
      for (const c of classTargets.slice(1)) await saveAutomation(supabase, { ...baseInput, class_id: c }, undefined, userId);
      onSaved(initial ? (classTargets.length > 1 ? `تم حفظ التعديل وإنشاء ${classTargets.length - 1} نسخة للفصول الأخرى ✅` : 'تم حفظ التعديل')
        : classTargets.length > 1 ? `تم إنشاء ${classTargets.length} إشعارات تلقائية (واحد لكل فصل) ✅` : 'تم إنشاء الإشعار التلقائي ✅');
    } catch (e) { setErr(notifErrorMessage(e, 'تعذر الحفظ')); }
    finally { setBusy(false); }
  };

  const scopeTrigger = def.key === 'online_class_started' || def.key === 'exam_published' || def.key === 'occasion_reminder';
  const vars = [...def.vars, ...(scopeTrigger ? ['الفصل', 'الخدمة', 'الكنيسة', 'التاريخ'] : STANDARD_VARS)];

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:rounded-3xl" style={{ animation: 'slideUp .25s ease-out' }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-extrabold"><Zap className="h-5 w-5 text-violet-600" /> {initial ? 'تعديل إشعار تلقائي' : 'إشعار تلقائي جديد'}</h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <p className="mb-1 flex items-center gap-1 text-[11px] font-extrabold text-slate-500">١ · الحدث (Trigger) <InfoTip size="xs" title={def.label}>{def.desc}</InfoTip></p>
        <select id="auto-trigger" value={trigger} onChange={(e) => pickTrigger(e.target.value as TriggerKey)} className="input-field mb-3 appearance-none text-sm font-bold">
          {TRIGGERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>

        {def.config && (
          <div className="mb-3">
            <label className="mb-1 block text-[11px] font-extrabold text-slate-500">{def.config.label}</label>
            <input id="auto-config" type="number" inputMode="numeric" min={def.config.min} max={def.config.max} value={cfg}
              onChange={(e) => setCfg(Number(e.target.value))} className="input-field !py-2.5 text-sm tabular-nums" />
          </div>
        )}

        <p className="mb-1 text-[11px] font-extrabold text-slate-500">٢ · المستلم</p>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {def.recipients.map((r) => (
            <button key={r} id={`auto-rcpt-${r}`} type="button" onClick={() => setRecipient(r)} aria-pressed={recipient === r}
              className={`flex h-10 items-center justify-center gap-2 rounded-xl text-xs font-extrabold transition ${recipient === r ? (r === 'student' ? 'bg-emerald-600 text-white ring-2 ring-emerald-300' : 'bg-sky-600 text-white ring-2 ring-sky-300') : 'border border-slate-200 bg-white text-slate-600'}`}>
              {r === 'student' ? <Users className="h-4 w-4" /> : <UserCog className="h-4 w-4" />} {RECIPIENT_LABELS[r]}
            </button>
          ))}
        </div>

        <p className="mb-1 text-[11px] font-extrabold text-slate-500">٣ · الإشعار</p>
        <input id="auto-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="اسم القاعدة (للسجل فقط)" className="input-field mb-2 !py-2.5 text-sm" />
        <input id="auto-title" value={titleT} onChange={(e) => setTitleT(e.target.value)} maxLength={120} placeholder="عنوان الإشعار" className="input-field mb-2 !py-2.5 text-sm font-extrabold" />
        <textarea id="auto-body" value={bodyT} onChange={(e) => setBodyT(e.target.value)} maxLength={1000} rows={3} placeholder="نص الإشعار — استخدم المتغيرات بين [ ]" className="input-field resize-y text-sm leading-relaxed" />
        <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {vars.map((v) => (
            <button key={v} type="button" onClick={() => setBodyT((t) => `${t}[${v}]`)} className="shrink-0 rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-extrabold text-violet-700 hover:bg-violet-100">[{v}]</button>
          ))}
        </div>

        <div className="mt-2 flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-600 hover:bg-slate-200">
            <ImagePlus className="h-4 w-4" /> صورة
            <input type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {(filePreview || imageUrl) && (
            <div className="flex items-center gap-1.5">
              <div className="relative h-10 w-10 overflow-hidden rounded-lg ring-1 ring-slate-200">
                <Image src={filePreview ?? imageUrl!} alt="" fill sizes="40px" className="object-cover" unoptimized />
              </div>
              <button type="button" onClick={() => { setFile(null); setImageUrl(null); }} className="rounded-full bg-slate-100 p-1 text-slate-500"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <select id="auto-link" value={linkPreset} onChange={(e) => setLinkPreset(e.target.value)} className="input-field appearance-none !py-2.5 text-xs font-bold">
            <option value="">الصفحة الافتراضية للحدث</option>
            {LINK_PRESETS.filter((l) => l.value).map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            <option value="custom">رابط آخر…</option>
          </select>
          {linkPreset === 'custom' && (
            <input value={linkCustom} onChange={(e) => setLinkCustom(e.target.value)} placeholder="/child/… أو https://…" dir="ltr" className={`input-field !py-2.5 text-xs ${!linkOk ? '!border-red-300' : ''}`} />
          )}
        </div>

        <p className="mb-1 mt-3 text-[11px] font-extrabold text-slate-500">٤ · النطاق</p>
        <ScopeSelectors idPrefix="auto-scope" scope={scope} churches={churches} services={services} classes={classes} />
        {!scopeIds.church && !isOwner && <p className="-mt-2 mb-2 text-[11px] font-bold text-amber-700">اختر الكنيسة</p>}

        <section className="mb-3 rounded-2xl border border-dashed border-violet-200 bg-violet-50/40 p-3">
          <p className="mb-1.5 flex items-center gap-1 text-[11px] font-extrabold text-slate-400"><Eye className="h-3.5 w-3.5" /> معاينة بقيم تجريبية</p>
          <p className="text-sm font-extrabold text-slate-900">{renderPreview(titleT, def) || '—'}</p>
          {bodyT && <p className="mt-0.5 whitespace-pre-line text-xs text-slate-600">{renderPreview(bodyT, def)}</p>}
        </section>

        <label className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
          <input id="auto-active" type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-violet-600" /> مفعّل
        </label>

        {err && <p className="mb-2 text-xs font-bold text-red-600">{err}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="btn-secondary !py-2.5 text-sm">إلغاء</button>
          <button id="auto-save" type="button" onClick={save} disabled={!canSave} className="btn-primary !from-violet-600 !to-violet-500 !py-2.5 text-sm">
            {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : initial ? 'حفظ' : 'إنشاء'}
          </button>
        </div>
      </div>
    </div>
  );
}
