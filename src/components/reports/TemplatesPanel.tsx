'use client';

// ---------- Templates (القوالب) ----------
// TemplatesList  — saved designs; tap «استخدام» → the wizard opens at step 1
//                  with the template's query + design (the user only picks
//                  the new church / service / class / filters and runs it).
// SaveTemplateModal — name · description · scope (who sees it) · default.

import { useState } from 'react';
import { LayoutTemplate, Trash2, Play, Star, X, Loader2, Pencil, Save } from 'lucide-react';
import type { ReportTemplate } from '@/lib/reports/types';
import { SOURCE_BY_KEY } from '@/lib/reports/sources';
import type { ReportSourceKey } from '@/lib/reports/types';
import type { Church, Service, ClassRoom } from '@/lib/types';
import { Empty, Field } from './ReportBits';
import { MultiClassSelect } from '@/components/MultiClassSelect';

export function TemplatesList({ templates, loading, onUse, onDelete, onEdit, canManage, lookups }: {
  templates: ReportTemplate[]; loading: boolean;
  onUse: (t: ReportTemplate) => void; onDelete: (t: ReportTemplate) => void; onEdit: (t: ReportTemplate) => void;
  canManage: boolean; lookups: { churches: Church[]; services: Service[]; classes: ClassRoom[] };
}) {
  if (loading) return <div className="flex justify-center py-10"><Loader2 className="h-7 w-7 animate-spin text-fuchsia-500" /></div>;
  if (templates.length === 0) {
    return <Empty icon={<LayoutTemplate className="h-7 w-7" />} title="لا قوالب محفوظة بعد" desc="صمّم تقريراً ثم احفظه كقالب من خطوة التصدير — يظهر هنا لإعادة استخدامه بنطاق جديد" />;
  }
  const scopeLabel = (t: ReportTemplate) => {
    if (!t.church_id) return 'مشترك للجميع';
    const parts = [lookups.churches.find((c) => c.id === t.church_id)?.name ?? '—'];
    if (t.service_id) parts.push(lookups.services.find((s) => s.id === t.service_id)?.name ?? '—');
    if (t.class_id) parts.push(lookups.classes.find((c) => c.id === t.class_id)?.name ?? '—');
    return parts.join(' ← ');
  };
  return (
    <ul id="report-templates" className="space-y-2">
      {templates.map((t) => (
        <li key={t.id} id={`report-template-${t.id}`} className="card !p-3 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fuchsia-100 text-fuchsia-700"><LayoutTemplate className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-800">
              <span className="truncate">{t.name}</span>
              {t.is_default && <Star className="h-3.5 w-3.5 shrink-0 fill-gold-400 text-gold-500" />}
            </p>
            <p className="truncate text-[11px] font-bold text-slate-400">
              {SOURCE_BY_KEY[t.source as ReportSourceKey]?.label ?? t.source} · {t.definition.query.fields.length} حقل · {t.definition.design.pages.length} صفحة · {scopeLabel(t)}
            </p>
            {t.description && <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{t.description}</p>}
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            <button type="button" onClick={() => onUse(t)} className="flex items-center gap-1 rounded-lg bg-fuchsia-600 px-2.5 py-1.5 text-[11px] font-extrabold text-white active:scale-95"><Play className="h-3.5 w-3.5" /> استخدام</button>
            {canManage && (
              <div className="flex gap-1">
                <button type="button" onClick={() => onEdit(t)} className="flex-1 rounded-lg bg-slate-100 p-1.5 text-slate-500 hover:bg-slate-200" aria-label="تعديل"><Pencil className="mx-auto h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => onDelete(t)} className="flex-1 rounded-lg bg-slate-100 p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500" aria-label="حذف"><Trash2 className="mx-auto h-3.5 w-3.5" /></button>
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** `class_id` is the first chosen class; `more_class_ids` are the others — the page saves one template per class. */
export interface SaveTemplateValues { name: string; description: string; church_id: string | null; service_id: string | null; class_id: string | null; more_class_ids?: string[]; is_default: boolean }

export function SaveTemplateModal({ initial, existing, onClose, onSave, saving, lookups, canShareAll }: {
  initial: SaveTemplateValues; existing: boolean; onClose: () => void; onSave: (v: SaveTemplateValues) => void; saving: boolean;
  lookups: { churches: Church[]; services: Service[]; classes: ClassRoom[] }; canShareAll: boolean;
}) {
  const [v, setV] = useState<SaveTemplateValues>(initial);
  const services = lookups.services.filter((s) => s.church_id === v.church_id);
  const classes = lookups.classes.filter((c) => c.service_id === v.service_id);
  const selectCls = 'input-field !py-2 !px-2.5 text-sm';
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div id="report-save-modal" className="w-full max-w-md rounded-t-3xl bg-white p-4 shadow-2xl sm:rounded-3xl" style={{ animation: 'slideUp .2s ease-out' }} onClick={(e) => e.stopPropagation()}>
        <header className="mb-3 flex items-center gap-2">
          <Save className="h-5 w-5 text-fuchsia-600" />
          <h3 className="flex-1 text-base font-extrabold">{existing ? 'تحديث القالب' : 'حفظ كقالب'}</h3>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-slate-100" aria-label="إغلاق"><X className="h-5 w-5" /></button>
        </header>
        <div className="space-y-2">
          <Field label="اسم القالب"><input id="report-template-name" className={selectCls} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="مثال: كشف حضور الفصل الشهري" /></Field>
          <Field label="وصف (اختياري)"><input className={selectCls} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
          <p className="text-[11px] font-extrabold text-slate-500">من يرى القالب؟</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <select className={selectCls} value={v.church_id ?? ''} onChange={(e) => setV({ ...v, church_id: e.target.value || null, service_id: null, class_id: null, more_class_ids: [] })}>
              {canShareAll && <option value="">الجميع (مشترك)</option>}
              {lookups.churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className={selectCls} value={v.service_id ?? ''} disabled={!v.church_id} onChange={(e) => setV({ ...v, service_id: e.target.value || null, class_id: null, more_class_ids: [] })}>
              <option value="">كل الخدمات</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <MultiClassSelect id="report-template-classes" className="!py-2 !text-sm" disabled={!v.service_id}
              value={v.class_id ? [v.class_id, ...(v.more_class_ids ?? [])] : []}
              onChange={(ids) => setV({ ...v, class_id: ids[0] ?? null, more_class_ids: ids.slice(1) })}
              options={classes} />
          </div>
          <label className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
            <input type="checkbox" className="h-4 w-4 accent-fuchsia-600" checked={v.is_default} onChange={(e) => setV({ ...v, is_default: e.target.checked })} />
            قالب مميز (يظهر أولاً)
          </label>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1 !py-2.5 text-sm">إلغاء</button>
          <button id="report-template-save" type="button" disabled={saving || !v.name.trim() || (!canShareAll && !v.church_id)} onClick={() => onSave(v)} className="btn-primary flex flex-1 items-center justify-center gap-1 !from-fuchsia-600 !to-fuchsia-500 !py-2.5 text-sm">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ
          </button>
        </div>
      </div>
    </div>
  );
}
