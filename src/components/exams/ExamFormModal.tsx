'use client';

// ---------- Create / edit an exam (settings) ----------
// title · description · scope (church → service → class) · timing window ·
// default seconds / points per question · pass rule (percent | score) ·
// points for pass / full mark · question mode (all | random N) · shuffle ·
// attempts · what the child sees afterwards.

import { useMemo, useState } from 'react';
import { X, Save, Loader2, Clock, Star, Trophy, ListChecks, CalendarClock } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { MultiClassSelect } from '@/components/MultiClassSelect';
import { classSel, classTargets } from '@/lib/class-multi';
import {
  createExam, updateExam, examErrorMessage, defaultExamInput, toLocalInput, fromLocalInput,
  type Exam, type ExamInput,
} from '@/lib/exams';
import type { Church, Service, ClassRoom } from '@/lib/types';

const ALL = 'all';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-extrabold text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] font-bold text-slate-400">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, desc, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; desc?: string; id?: string }) {
  return (
    <button type="button" id={id} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-start">
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-violet-600' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'right-0.5' : 'right-[1.375rem]'}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold">{label}</span>
        {desc && <span className="block text-[11px] font-bold text-slate-400">{desc}</span>}
      </span>
    </button>
  );
}

const stripAudit = (x: Exam): ExamInput => {
  const { id: _id, created_at: _ca, created_by: _cb, edited_at: _ea, edited_by: _eb, ...rest } = x;
  void _id; void _ca; void _cb; void _ea; void _eb;
  return rest;
};

export default function ExamFormModal({
  exam, churches, services, classes, questionCount = 0, onClose, onSaved,
}: {
  exam: Exam | null;
  churches: Church[]; services: Service[]; classes: ClassRoom[];
  questionCount?: number;
  onClose: () => void;
  onSaved: (saved: Exam) => void;
}) {
  const { profile, user } = useAuth();
  const [supabase] = useState(() => createClient());
  const mode = exam ? 'edit' : 'add';

  const defaultChurch = exam?.church_id ?? profile?.church_id ?? (churches.length === 1 ? churches[0].id : '');
  const [form, setForm] = useState<ExamInput>(() =>
    exam
      ? stripAudit(exam)
      : defaultExamInput({
          church_id: defaultChurch,
          service_id: profile?.service_id ?? null,
          class_id: profile?.class_id ?? null,
        })
  );
  const set = <K extends keyof ExamInput>(k: K, v: ExamInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  // chosen classes ([] = كل الفصول); one exam is saved per class
  const [classIds, setClassIds] = useState<string[]>(classSel(exam ? exam.class_id : profile?.class_id));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // scope locks follow the profile (a class servant can only add to his class)
  const churchLocked = !!profile && profile.role !== 'owner';
  const serviceLocked = !!profile && !!profile.service_id && profile.role !== 'owner' && profile.role !== 'church_manager';
  const classLocked = !!profile && !!profile.class_id && profile.role === 'class_servant';

  const visibleServices = useMemo(() => services.filter((s) => s.church_id === form.church_id), [services, form.church_id]);
  const visibleClasses = useMemo(
    () => classes.filter((c) => c.church_id === form.church_id && !!form.service_id && c.service_id === form.service_id),
    [classes, form.church_id, form.service_id]
  );

  const num = (v: string, min: number, max: number, fallback: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.title.trim()) return setError('اكتب عنوان الامتحان');
    if (!form.church_id) return setError('اختر الكنيسة');
    if (form.pass_mode === 'percent' && (form.pass_value < 0 || form.pass_value > 100)) return setError('نسبة النجاح بين 0 و 100');
    if (form.opens_at && form.closes_at && new Date(form.closes_at) <= new Date(form.opens_at)) return setError('وقت الإغلاق يجب أن يكون بعد وقت البدء');
    setSaving(true);
    try {
      const payload: ExamInput = {
        ...form,
        title: form.title.trim(),
        description: form.description?.trim() || null,
        service_id: form.service_id || null,
      };
      const targets = form.service_id ? classTargets(classIds) : [null];
      const saved = exam
        ? await updateExam(supabase, exam.id, { ...payload, class_id: targets[0] }, user?.id)
        : await createExam(supabase, { ...payload, class_id: targets[0] }, user?.id);
      // extra classes → copies of the same exam
      for (const cid of targets.slice(1)) await createExam(supabase, { ...payload, class_id: cid }, user?.id);
      onSaved(saved);
    } catch (err) {
      setError(examErrorMessage(err, 'تعذر الحفظ'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center" onClick={onClose}>
      <form
        id="exam-form" onSubmit={submit} onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:rounded-3xl"
        style={{ animation: 'slideUp .25s ease-out' }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-extrabold">{mode === 'add' ? 'امتحان جديد' : 'إعدادات الامتحان'}</h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-3">
          <Field label="عنوان الامتحان">
            <input id="exam-title" className="input-field" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="مثال: امتحان سفر التكوين" autoFocus />
          </Field>
          <Field label="وصف / تعليمات (اختياري)">
            <textarea id="exam-desc" className="input-field min-h-[64px]" value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="تعليمات تظهر للمخدوم قبل البدء" />
          </Field>

          {/* scope */}
          <div>
            <p className="mb-1 text-xs font-extrabold text-slate-600">لمن هذا الامتحان؟</p>
            <div className="grid grid-cols-3 gap-2">
              <select id="exam-church" className="input-field appearance-none !px-2 text-xs font-bold" value={form.church_id} disabled={churchLocked}
                onChange={(e) => { setClassIds([]); setForm((f) => ({ ...f, church_id: e.target.value, service_id: null, class_id: null })); }}>
                <option value="">الكنيسة…</option>
                {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select id="exam-service" className="input-field appearance-none !px-2 text-xs font-bold" value={form.service_id ?? ALL} disabled={serviceLocked || !form.church_id}
                onChange={(e) => { const v = e.target.value === ALL ? null : e.target.value; setClassIds([]); setForm((f) => ({ ...f, service_id: v, class_id: null })); }}>
                <option value={ALL}>كل الخدمات</option>
                {visibleServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <MultiClassSelect id="exam-class" value={classIds} onChange={setClassIds} options={visibleClasses}
                disabled={classLocked || !form.service_id} />
            </div>
          </div>

          {/* timing window */}
          <div className="rounded-2xl bg-violet-50/60 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-violet-800"><CalendarClock className="h-4 w-4" /> فترة الإتاحة (اختياري)</p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="يبدأ من">
                <input id="exam-opens" type="datetime-local" className="input-field !px-2 text-xs" value={toLocalInput(form.opens_at)} onChange={(e) => set('opens_at', fromLocalInput(e.target.value))} />
              </Field>
              <Field label="يُغلق في">
                <input id="exam-closes" type="datetime-local" className="input-field !px-2 text-xs" value={toLocalInput(form.closes_at)} onChange={(e) => set('closes_at', fromLocalInput(e.target.value))} />
              </Field>
            </div>
            <p className="mt-1 text-[11px] font-bold text-slate-400">اتركهما فارغين ليكون الامتحان متاحاً طوال فترة النشر</p>
          </div>

          {/* per-question defaults */}
          <div className="grid grid-cols-2 gap-2">
            <Field label="وقت السؤال الافتراضي (ثانية)" hint="يمكن تغييره لكل سؤال">
              <div className="relative">
                <Clock className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input id="exam-seconds" type="number" min={5} max={3600} className="input-field pr-9 tabular-nums" value={form.default_seconds}
                  onChange={(e) => set('default_seconds', num(e.target.value, 5, 3600, 30))} />
              </div>
            </Field>
            <Field label="درجة السؤال الافتراضية" hint="تُستخدم عند إضافة سؤال جديد">
              <div className="relative">
                <Star className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input id="exam-points" type="number" min={0} max={1000} className="input-field pr-9 tabular-nums" value={form.default_points}
                  onChange={(e) => set('default_points', num(e.target.value, 0, 1000, 1))} />
              </div>
            </Field>
          </div>

          {/* pass rule */}
          <div className="rounded-2xl bg-emerald-50/60 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-emerald-800"><Trophy className="h-4 w-4" /> شرط النجاح والنقاط</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-200">
                {(['percent', 'score'] as const).map((m) => (
                  <button key={m} type="button" id={`exam-pass-${m}`} onClick={() => set('pass_mode', m)}
                    className={`rounded-lg py-2 text-xs font-extrabold transition ${form.pass_mode === m ? 'bg-emerald-600 text-white' : 'text-slate-500'}`}>
                    {m === 'percent' ? 'نسبة ٪' : 'درجة'}
                  </button>
                ))}
              </div>
              <input id="exam-pass-value" type="number" min={0} max={form.pass_mode === 'percent' ? 100 : 100000} step="0.5" className="input-field tabular-nums"
                value={form.pass_value} onChange={(e) => set('pass_value', Math.max(0, Number(e.target.value) || 0))} />
            </div>
            <p className="mt-1 text-[11px] font-bold text-slate-400">
              {form.pass_mode === 'percent' ? `ينجح المخدوم إذا حصل على ${form.pass_value}٪ أو أكثر من مجموع درجات أسئلته` : `ينجح المخدوم إذا حصل على ${form.pass_value} درجة أو أكثر`}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="نقاط النجاح">
                <input id="exam-points-pass" type="number" min={0} className="input-field tabular-nums" value={form.points_pass} onChange={(e) => set('points_pass', num(e.target.value, 0, 100000, 0))} />
              </Field>
              <Field label="نقاط الدرجة الكاملة">
                <input id="exam-points-full" type="number" min={0} className="input-field tabular-nums" value={form.points_full} onChange={(e) => set('points_full', num(e.target.value, 0, 100000, 0))} />
              </Field>
            </div>
            <p className="mt-1 text-[11px] font-bold text-slate-400">تُضاف النقاط لرصيد المخدوم تلقائياً فور انتهاء الامتحان (الدرجة الكاملة تأخذ الأعلى من الرقمين)</p>
          </div>

          {/* question selection */}
          <div className="rounded-2xl bg-amber-50/60 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-amber-800"><ListChecks className="h-4 w-4" /> الأسئلة التي يراها كل مخدوم</p>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-200">
              {(['all', 'random'] as const).map((m) => (
                <button key={m} type="button" id={`exam-qmode-${m}`} onClick={() => set('question_mode', m)}
                  className={`rounded-lg py-2 text-xs font-extrabold transition ${form.question_mode === m ? 'bg-amber-600 text-white' : 'text-slate-500'}`}>
                  {m === 'all' ? 'كل الأسئلة' : 'عدد عشوائي'}
                </button>
              ))}
            </div>
            {form.question_mode === 'random' && (
              <div className="mt-2">
                <Field label="عدد الأسئلة لكل مخدوم" hint={questionCount ? `الامتحان يحتوي حالياً على ${questionCount} سؤال — يُختار منها ${Math.min(form.random_count, questionCount)} عشوائياً لكل مخدوم` : 'أضف الأسئلة من تبويب الأسئلة'}>
                  <input id="exam-random-count" type="number" min={1} className="input-field tabular-nums" value={form.random_count} onChange={(e) => set('random_count', num(e.target.value, 1, 1000, 10))} />
                </Field>
              </div>
            )}
            <div className="mt-2 space-y-2">
              <Toggle id="exam-shuffle-q" checked={form.shuffle_questions} onChange={(v) => set('shuffle_questions', v)} label="ترتيب الأسئلة عشوائي" desc="كل مخدوم يرى الأسئلة بترتيب مختلف" />
              <Toggle id="exam-shuffle-o" checked={form.shuffle_options} onChange={(v) => set('shuffle_options', v)} label="ترتيب الاختيارات عشوائي" desc="يمنع نقل الإجابات بين المخدومين (أ/ب/ج تتغير)" />
            </div>
          </div>

          {/* attempts + visibility */}
          <Field label="عدد المحاولات المسموحة" hint="المحاولة الملغاة من الخادم لا تُحسب">
            <input id="exam-attempts" type="number" min={1} max={100} className="input-field tabular-nums" value={form.max_attempts} onChange={(e) => set('max_attempts', num(e.target.value, 1, 100, 1))} />
          </Field>
          <div className="space-y-2">
            <Toggle id="exam-show-result" checked={form.show_result} onChange={(v) => set('show_result', v)} label="إظهار النتيجة للمخدوم" desc="الدرجة والنسبة ونجح / لم ينجح فور الانتهاء" />
            <Toggle id="exam-show-answers" checked={form.show_answers} onChange={(v) => set('show_answers', v)} label="إظهار الإجابات الصحيحة للمخدوم" desc="مراجعة كل سؤال بإجابته وإجابة المخدوم بعد الانتهاء" />
          </div>
        </div>

        {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button type="submit" id="exam-save" disabled={saving} className="btn-primary flex flex-1 items-center justify-center gap-2 !from-violet-600 !to-violet-500">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {mode === 'add' ? 'إنشاء الامتحان' : 'حفظ الإعدادات'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
        {mode === 'add' && (
          <p className="mt-2 text-[11px] font-bold text-slate-400">الامتحان يُنشأ كمسودة — أضف الأسئلة ثم انشره من صفحته</p>
        )}
      </form>
    </div>
  );
}
