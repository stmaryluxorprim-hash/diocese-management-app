'use client';

// ---------- Create / edit a results exam ----------
// name · date · academic year · scope (church → service → class) · status ·
// description · grading system · grade options (overall / per subject) ·
// pass rule + pass % · absent-as-zero · min required subjects.

import { useMemo, useState } from 'react';
import { Save, Loader2, ClipboardList } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { ALL } from '@/lib/queries';
import { Field, Toggle, ModalFrame } from '@/components/results/ResultBits';
import {
  createResultExam, updateResultExam, resultErrorMessage, defaultExamInput, EXAM_STATUS_LABELS, PASS_RULE_LABELS,
  type ResultExam, type ResultExamInput, type GradingSystem, type ResultExamStatus, type PassRule,
} from '@/lib/results';
import type { Church, Service, ClassRoom } from '@/lib/types';

export default function ExamFormModal({
  exam, churches, services, classes, gradingSystems, initialScope, onClose, onSaved,
}: {
  exam: ResultExam | null;
  churches: Church[]; services: Service[]; classes: ClassRoom[];
  gradingSystems: GradingSystem[];
  initialScope?: { church: string; service: string; classes?: string[]; class?: string };
  onClose: () => void;
  onSaved: (saved: ResultExam) => void;
}) {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());

  const startChurch = exam?.church_id ?? (initialScope && initialScope.church !== ALL ? initialScope.church : profile?.church_id ?? churches[0]?.id ?? '');
  const defaultSystem = gradingSystems.find((g) => g.is_default && (g.church_id === null || g.church_id === startChurch))?.id
    ?? gradingSystems.find((g) => g.church_id === null || g.church_id === startChurch)?.id ?? null;

  const [form, setForm] = useState<ResultExamInput>(() => exam
    ? {
        church_id: exam.church_id, service_id: exam.service_id, class_id: exam.class_id, name: exam.name, exam_date: exam.exam_date,
        academic_year: exam.academic_year, description: exam.description, status: exam.status, grading_system_id: exam.grading_system_id,
        grade_overall: exam.grade_overall, grade_subject: exam.grade_subject, pass_rule: exam.pass_rule, pass_percent: exam.pass_percent,
        absent_as_zero: exam.absent_as_zero, min_required_subjects: exam.min_required_subjects,
      }
    : defaultExamInput({
        church_id: startChurch,
        service_id: initialScope && initialScope.service !== ALL ? initialScope.service : profile?.service_id ?? null,
        class_id: (initialScope && (initialScope.classes?.length === 1 ? initialScope.classes[0] : initialScope.classes === undefined && initialScope.class && initialScope.class !== ALL ? initialScope.class : null)) || profile?.class_id || null,
      }, defaultSystem));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ResultExamInput>(k: K, v: ResultExamInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const visibleServices = useMemo(() => services.filter((s) => s.church_id === form.church_id), [services, form.church_id]);
  const visibleClasses = useMemo(() => classes.filter((c) => c.service_id === form.service_id), [classes, form.service_id]);
  const visibleSystems = useMemo(() => gradingSystems.filter((g) => g.church_id === null || g.church_id === form.church_id), [gradingSystems, form.church_id]);

  // scope locks mirror the caller's role
  const lockChurch = profile?.role !== 'owner';
  const lockService = lockChurch && profile?.role !== 'church_manager' && !!profile?.service_id;
  const lockClass = lockService && profile?.role === 'class_servant' && !!profile?.class_id;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('اكتب اسم الامتحان'); return; }
    if (!form.church_id) { setError('اختر الكنيسة'); return; }
    if (!form.grade_overall && !form.grade_subject) { setError('فعّل طريقة واحدة على الأقل لحساب التقدير'); return; }
    setSaving(true); setError(null);
    try {
      const payload: ResultExamInput = {
        ...form,
        name: form.name.trim(),
        academic_year: form.academic_year?.trim() || null,
        description: form.description?.trim() || null,
        exam_date: form.exam_date || null,
        service_id: form.service_id || null,
        class_id: form.service_id ? form.class_id || null : null,
      };
      const saved = exam ? await updateResultExam(supabase, exam.id, payload) : await createResultExam(supabase, payload);
      onSaved(saved);
    } catch (err) {
      setError(resultErrorMessage(err, 'تعذر الحفظ'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalFrame title={exam ? 'تعديل الامتحان' : 'امتحان جديد'} icon={<ClipboardList className="h-5 w-5 text-emerald-600" />} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="اسم الامتحان *">
          <input id="rx-name" className="input-field" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="مثال: امتحان نهاية العام 2026" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="تاريخ الامتحان">
            <input id="rx-date" type="date" className="input-field" value={form.exam_date ?? ''} onChange={(e) => set('exam_date', e.target.value || null)} />
          </Field>
          <Field label="العام الدراسي / الموسم">
            <input id="rx-year" className="input-field" value={form.academic_year ?? ''} onChange={(e) => set('academic_year', e.target.value)} placeholder="2025/2026" />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Field label="الكنيسة *">
            <select id="rx-church" className="input-field appearance-none !px-2 text-xs" value={form.church_id} disabled={lockChurch || !!exam}
              onChange={(e) => setForm((f) => ({ ...f, church_id: e.target.value, service_id: null, class_id: null, grading_system_id: null }))}>
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="الخدمة">
            <select id="rx-service" className="input-field appearance-none !px-2 text-xs" value={form.service_id ?? ''} disabled={lockService}
              onChange={(e) => setForm((f) => ({ ...f, service_id: e.target.value || null, class_id: null }))}>
              <option value="">كل الخدمات</option>
              {visibleServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="الفصل">
            <select id="rx-class" className="input-field appearance-none !px-2 text-xs" value={form.class_id ?? ''} disabled={lockClass || !form.service_id}
              onChange={(e) => set('class_id', e.target.value || null)}>
              <option value="">كل الفصول</option>
              {visibleClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>

        <Field label="الحالة">
          <div className="grid grid-cols-4 gap-1">
            {(Object.keys(EXAM_STATUS_LABELS) as ResultExamStatus[]).map((s) => (
              <button key={s} type="button" onClick={() => set('status', s)} aria-pressed={form.status === s}
                className={`rounded-xl px-1 py-2 text-[11px] font-extrabold ${form.status === s ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
                {EXAM_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </Field>

        <Field label="الوصف">
          <textarea id="rx-desc" className="input-field min-h-[64px]" value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} />
        </Field>

        <div className="space-y-2 rounded-2xl bg-emerald-50/60 p-3">
          <p className="text-xs font-extrabold text-emerald-800">التقدير</p>
          <Field label="نظام التقدير" hint={visibleSystems.length === 0 ? 'لا يوجد نظام تقدير — أنشئه من تبويب «أنظمة التقدير»' : undefined}>
            <select id="rx-grading" className="input-field appearance-none text-sm" value={form.grading_system_id ?? ''} onChange={(e) => set('grading_system_id', e.target.value || null)}>
              <option value="">بدون تقدير</option>
              {visibleSystems.map((g) => <option key={g.id} value={g.id}>{g.name}{g.church_id === null ? ' (عام)' : ''}</option>)}
            </select>
          </Field>
          <Toggle id="rx-grade-overall" checked={form.grade_overall} onChange={(v) => set('grade_overall', v)} label="تقدير كلي للامتحان" desc="يُحسب من النسبة الكلية لكل المواد" />
          <Toggle id="rx-grade-subject" checked={form.grade_subject} onChange={(v) => set('grade_subject', v)} label="تقدير لكل مادة" desc="يُحسب من نسبة كل مادة على حدة" />
        </div>

        <div className="space-y-2 rounded-2xl bg-slate-50 p-3">
          <p className="text-xs font-extrabold text-slate-700">النجاح</p>
          <Field label="قاعدة النجاح">
            <select id="rx-pass-rule" className="input-field appearance-none text-sm" value={form.pass_rule} onChange={(e) => set('pass_rule', e.target.value as PassRule)}>
              {(Object.keys(PASS_RULE_LABELS) as PassRule[]).map((r) => <option key={r} value={r}>{PASS_RULE_LABELS[r]}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="نسبة النجاح ٪">
              <input id="rx-pass-pct" type="number" min={0} max={100} step="0.5" className="input-field" value={form.pass_percent}
                onChange={(e) => set('pass_percent', Math.max(0, Math.min(100, Number(e.target.value) || 0)))} disabled={form.pass_rule === 'subjects'} />
            </Field>
            <Field label="أقل عدد مواد مطلوب" hint="فارغ = كل المواد">
              <input id="rx-min-subj" type="number" min={1} className="input-field" value={form.min_required_subjects ?? ''}
                onChange={(e) => set('min_required_subjects', e.target.value ? Math.max(1, Number(e.target.value)) : null)} />
            </Field>
          </div>
          <Toggle id="rx-absent-zero" checked={form.absent_as_zero} onChange={(v) => set('absent_as_zero', v)} label="الغائب يحصل على صفر" desc="افتراضياً الغائب / المعذور لا يُحسب له صفر وتُحسب نسبته من المواد التي أداها" />
        </div>

        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}

        <button id="rx-save" type="submit" disabled={saving} className="btn-primary flex w-full items-center justify-center gap-2 !from-emerald-600 !to-emerald-500">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {exam ? 'حفظ التعديلات' : 'إنشاء الامتحان'}
        </button>
      </form>
    </ModalFrame>
  );
}
