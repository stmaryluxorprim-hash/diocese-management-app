'use client';

// ---------- Create / edit an online class ----------
// title · description · scope (church → service → class) · date + start /
// end time · platform + stream URL · chat toggle · bound exam (optional,
// published exams covering the scope) · bound event (optional, attendance
// is registered for it) · ATTENDANCE RULES (min time ٪ · checks required ·
// min successful checks · min answers · check window · attendance points).

import { useEffect, useMemo, useState } from 'react';
import { X, Save, Loader2, CalendarClock, Link2, ShieldCheck, Star, GraduationCap, CalendarCheck } from 'lucide-react';
import InfoTip from '@/components/InfoTip';
import { MultiClassSelect } from '@/components/MultiClassSelect';
import { classSel, classTargets } from '@/lib/class-multi';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { cachedLookup } from '@/lib/queries';
import {
  createOnlineClass, updateOnlineClass, onlineErrorMessage, defaultClassInput, toLocalInput, fromLocalInput,
  detectPlatform, PLATFORMS, PLATFORM_LABELS, type OnlineClass, type OnlineClassInput,
} from '@/lib/online-classes';
import type { Church, Service, ClassRoom, AppEvent } from '@/lib/types';
import type { Exam } from '@/lib/exams';
import { Toggle } from '@/components/exams/ExamFormModal';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-extrabold text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] font-bold text-slate-400">{hint}</span>}
    </label>
  );
}

const strip = (x: OnlineClass): OnlineClassInput => ({
  church_id: x.church_id, service_id: x.service_id, class_id: x.class_id, title: x.title, description: x.description,
  starts_at: x.starts_at, ends_at: x.ends_at, platform: x.platform, stream_url: x.stream_url, chat_enabled: x.chat_enabled,
  exam_id: x.exam_id, event_id: x.event_id, min_time_percent: x.min_time_percent, checks_required: x.checks_required,
  checks_min_success: x.checks_min_success, min_answers: x.min_answers, check_seconds: x.check_seconds,
  attendance_points: x.attendance_points,
});

// an exam / event fits the form when it covers EVERY chosen class
// (class-less = covers all; a one-class item only fits when that is the only class chosen)
const covers = (x: { church_id: string; service_id: string | null; class_id: string | null }, f: OnlineClassInput, classIds: readonly string[]) =>
  x.church_id === f.church_id
  && (x.service_id === null || x.service_id === f.service_id)
  && (x.class_id === null || (classIds.length === 1 && x.class_id === classIds[0]));

export default function ClassFormModal({
  cls, churches, services, classes, onClose, onSaved,
}: {
  cls: OnlineClass | null;
  churches: Church[]; services: Service[]; classes: ClassRoom[];
  onClose: () => void;
  onSaved: (saved: OnlineClass) => void;
}) {
  const { profile, user } = useAuth();
  const [supabase] = useState(() => createClient());
  const mode = cls ? 'edit' : 'add';

  const defaultChurch = cls?.church_id ?? profile?.church_id ?? (churches.length === 1 ? churches[0].id : '');
  const [form, setForm] = useState<OnlineClassInput>(() =>
    cls ? strip(cls) : defaultClassInput({ church_id: defaultChurch, service_id: profile?.service_id ?? null, class_id: profile?.class_id ?? null })
  );
  const set = <K extends keyof OnlineClassInput>(k: K, v: OnlineClassInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  // chosen classes ([] = كل الفصول); one online class is saved per class
  const [classIds, setClassIds] = useState<string[]>(classSel(cls ? cls.class_id : profile?.class_id));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // lookups for the bindings
  const [exams, setExams] = useState<Exam[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  useEffect(() => {
    (async () => {
      const [{ data: ex }, evs] = await Promise.all([
        supabase.from('exams').select('*').in('status', ['published', 'draft']).order('created_at', { ascending: false }).limit(200),
        cachedLookup<AppEvent>(supabase, 'events'),
      ]);
      setExams((ex ?? []) as Exam[]);
      setEvents(evs);
    })();
  }, [supabase]);

  const churchLocked = !!profile && profile.role !== 'owner';
  const serviceLocked = !!profile && !!profile.service_id && profile.role !== 'owner' && profile.role !== 'church_manager';
  const classLocked = !!profile && !!profile.class_id && profile.role === 'class_servant';

  const visibleServices = useMemo(() => services.filter((s) => s.church_id === form.church_id), [services, form.church_id]);
  const visibleClasses = useMemo(
    () => classes.filter((c) => c.church_id === form.church_id && !!form.service_id && c.service_id === form.service_id),
    [classes, form.church_id, form.service_id]
  );
  const visibleExams = useMemo(() => exams.filter((x) => covers(x, form, classIds)), [exams, form, classIds]);
  const visibleEvents = useMemo(() => events.filter((e) => covers(e, form, classIds)), [events, form, classIds]);

  const num = (v: string, min: number, max: number, fallback: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };

  // date + times → starts_at / ends_at
  const startLocal = toLocalInput(form.starts_at);
  const endLocal = toLocalInput(form.ends_at);
  const date = startLocal.slice(0, 10);
  const startTime = startLocal.slice(11, 16);
  const endTime = endLocal.slice(11, 16);
  const setDateTime = (d: string, st: string, et: string) => {
    if (!d || !st || !et) return;
    const s = new Date(`${d}T${st}`);
    let e = new Date(`${d}T${et}`);
    if (e <= s) e = new Date(e.getTime() + 24 * 60 * 60 * 1000);  // past midnight
    setForm((f) => ({ ...f, starts_at: s.toISOString(), ends_at: e.toISOString() }));
  };
  const durationMin = Math.round((new Date(form.ends_at).getTime() - new Date(form.starts_at).getTime()) / 60000);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.title.trim()) return setError('اكتب عنوان الفصل');
    if (!form.church_id) return setError('اختر الكنيسة');
    if (new Date(form.ends_at) <= new Date(form.starts_at)) return setError('وقت الانتهاء يجب أن يكون بعد وقت البدء');
    if (form.checks_min_success > form.checks_required) return setError('الحد الأدنى للفحوص الناجحة لا يتجاوز عدد الفحوص');
    setSaving(true);
    try {
      const payload: OnlineClassInput = {
        ...form,
        title: form.title.trim(),
        description: form.description?.trim() || null,
        stream_url: form.stream_url?.trim() || null,
        service_id: form.service_id || null,
        exam_id: form.exam_id || null,
        event_id: form.event_id || null,
      };
      const targets = form.service_id ? classTargets(classIds) : [null];
      const saved = cls
        ? await updateOnlineClass(supabase, cls.id, { ...payload, class_id: targets[0] }, user?.id)
        : await createOnlineClass(supabase, { ...payload, class_id: targets[0] }, user?.id);
      // extra classes → copies of the same online class
      for (const cid of targets.slice(1)) await createOnlineClass(supabase, { ...payload, class_id: cid }, user?.id);
      onSaved(saved);
    } catch (err) {
      setError(onlineErrorMessage(err, 'تعذر الحفظ'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center" onClick={onClose}>
      <form
        id="online-class-form" onSubmit={submit} onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:rounded-3xl"
        style={{ animation: 'slideUp .25s ease-out' }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-extrabold">{mode === 'add' ? 'فصل أونلاين جديد' : 'إعدادات الفصل'}</h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-3">
          <Field label="عنوان الفصل">
            <input id="oc-title" className="input-field" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="مثال: درس يوم الأحد — سفر التكوين" autoFocus />
          </Field>
          <Field label="وصف (اختياري)">
            <textarea id="oc-desc" className="input-field min-h-[56px]" value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="ملاحظات تظهر للمخدوم قبل الدخول" />
          </Field>

          {/* scope */}
          <div>
            <p className="mb-1 text-xs font-extrabold text-slate-600">لمن هذا الفصل؟ (كنيسة ← خدمة ← فصل / مرحلة عمرية)</p>
            <div className="grid grid-cols-3 gap-2">
              <select id="oc-church" className="input-field appearance-none !px-2 text-xs font-bold" value={form.church_id} disabled={churchLocked}
                onChange={(e) => { setClassIds([]); setForm((f) => ({ ...f, church_id: e.target.value, service_id: null, class_id: null, exam_id: null, event_id: null })); }}>
                <option value="">الكنيسة…</option>
                {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select id="oc-service" className="input-field appearance-none !px-2 text-xs font-bold" value={form.service_id ?? ''} disabled={serviceLocked || !form.church_id}
                onChange={(e) => { setClassIds([]); setForm((f) => ({ ...f, service_id: e.target.value || null, class_id: null, exam_id: null, event_id: null })); }}>
                <option value="">كل الخدمات</option>
                {visibleServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <MultiClassSelect id="oc-class" value={classIds} disabled={classLocked || !form.service_id} options={visibleClasses}
                onChange={(ids) => { setClassIds(ids); setForm((f) => ({ ...f, exam_id: null, event_id: null })); }} />
            </div>
          </div>

          {/* schedule */}
          <div className="rounded-2xl border border-slate-200 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-slate-600"><CalendarClock className="h-4 w-4 text-sky-600" /> الموعد</p>
            <div className="grid grid-cols-3 gap-2">
              <Field label="التاريخ">
                <input id="oc-date" type="date" className="input-field !px-2 text-xs" value={date} onChange={(e) => setDateTime(e.target.value, startTime, endTime)} />
              </Field>
              <Field label="من">
                <input id="oc-start" type="time" className="input-field !px-2 text-xs" value={startTime} onChange={(e) => setDateTime(date, e.target.value, endTime)} />
              </Field>
              <Field label="إلى">
                <input id="oc-end" type="time" className="input-field !px-2 text-xs" value={endTime} onChange={(e) => setDateTime(date, startTime, e.target.value)} />
              </Field>
            </div>
            <p className="mt-1 text-[11px] font-bold text-slate-400">المدة المتوقعة: {durationMin > 0 ? `${durationMin} دقيقة` : '—'} — البدء والانتهاء الفعليان يُسجَّلان عند الضغط على «ابدأ» و«أنهِ»</p>
          </div>

          {/* stream */}
          <div className="rounded-2xl border border-slate-200 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-slate-600"><Link2 className="h-4 w-4 text-red-600" /> رابط البث المباشر</p>
            <div className="grid grid-cols-[110px_1fr] gap-2">
              <select id="oc-platform" className="input-field appearance-none !px-2 text-xs font-bold" value={form.platform} onChange={(e) => set('platform', e.target.value as OnlineClassInput['platform'])}>
                {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
              </select>
              <input id="oc-url" className="input-field text-xs" dir="ltr" placeholder="https://…" value={form.stream_url ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  const p = detectPlatform(v);
                  setForm((f) => ({ ...f, stream_url: v, platform: p ?? f.platform }));
                }} />
            </div>
            <p className="mt-1 text-[11px] font-bold text-slate-400">YouTube و Facebook يظهران داخل الصفحة؛ Zoom و Meet يُفتحان في تطبيقهما مع بقاء صفحة الفصل مفتوحة لحساب الحضور. يمكن إضافة الرابط لاحقاً.</p>
          </div>

          <Toggle id="oc-chat" checked={form.chat_enabled} onChange={(v) => set('chat_enabled', v)} label="الدردشة المباشرة" desc="يكتب المخدومون والخدام في دردشة الفصل أثناء البث" />

          {/* bindings */}
          <div className="grid grid-cols-2 gap-2">
            <Field label="امتحان مرتبط (اختياري)" hint={visibleExams.length === 0 ? 'لا امتحانات تغطي هذا النطاق' : 'يظهر للمخدوم داخل الفصل'}>
              <div className="relative">
                <GraduationCap className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-violet-500" />
                <select id="oc-exam" className="input-field appearance-none !pr-8 !px-2 text-xs font-bold" value={form.exam_id ?? ''} onChange={(e) => set('exam_id', e.target.value || null)}>
                  <option value="">بدون امتحان</option>
                  {visibleExams.map((x) => <option key={x.id} value={x.id}>{x.title}{x.status !== 'published' ? ' (غير منشور)' : ''}</option>)}
                </select>
              </div>
            </Field>
            <Field label="مناسبة الحضور (اختياري)" hint="يُسجَّل الحضور لهذه المناسبة">
              <div className="relative">
                <CalendarCheck className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" />
                <select id="oc-event" className="input-field appearance-none !pr-8 !px-2 text-xs font-bold" value={form.event_id ?? ''} onChange={(e) => set('event_id', e.target.value || null)}>
                  <option value="">بدون مناسبة</option>
                  {visibleEvents.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                </select>
              </div>
            </Field>
          </div>

          {/* attendance rules */}
          <div className="rounded-2xl border-2 border-emerald-100 bg-emerald-50/40 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-emerald-800"><ShieldCheck className="h-4 w-4" /> قواعد الحضور <InfoTip size="xs" title="قواعد الحضور" tone="text-emerald-600 hover:bg-emerald-100">قابلة للتعديل لكل فصل. يُعدّ المخدوم حاضراً إذا حقق كل الشروط معاً: نسبة الوقت، والفحوص الناجحة، وعدد الإجابات. الدخول وحده لا يكفي.</InfoTip></p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="الحد الأدنى للوقت ٪">
                <input id="oc-min-time" type="number" min={0} max={100} className="input-field" value={form.min_time_percent} onChange={(e) => set('min_time_percent', num(e.target.value, 0, 100, 60))} />
              </Field>
              <Field label="فحوص الانتباه المطلوبة">
                <input id="oc-checks" type="number" min={0} max={100} className="input-field" value={form.checks_required}
                  onChange={(e) => { const v = num(e.target.value, 0, 100, 3); setForm((f) => ({ ...f, checks_required: v, checks_min_success: Math.min(f.checks_min_success, v) })); }} />
              </Field>
              <Field label="الحد الأدنى للفحوص الناجحة">
                <input id="oc-checks-min" type="number" min={0} max={form.checks_required} className="input-field" value={form.checks_min_success} onChange={(e) => set('checks_min_success', num(e.target.value, 0, form.checks_required, 2))} />
              </Field>
              <Field label="الحد الأدنى للإجابات">
                <input id="oc-min-answers" type="number" min={0} max={100} className="input-field" value={form.min_answers} onChange={(e) => set('min_answers', num(e.target.value, 0, 100, 0))} />
              </Field>
              <Field label="مهلة الرد على الفحص (ثانية)">
                <input id="oc-check-seconds" type="number" min={10} max={600} className="input-field" value={form.check_seconds} onChange={(e) => set('check_seconds', num(e.target.value, 10, 600, 60))} />
              </Field>
              <Field label="نقاط الحضور">
                <div className="relative">
                  <Star className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-500" />
                  <input id="oc-points" type="number" min={0} max={1000} className="input-field !pr-8" value={form.attendance_points} onChange={(e) => set('attendance_points', num(e.target.value, 0, 1000, 0))} />
                </div>
              </Field>
            </div>
            <p className="mt-2 text-[11px] font-bold text-emerald-800">
              مثال: مخدوم حضر {form.min_time_percent}٪ من الوقت ونجح في {form.checks_min_success} من {form.checks_required} فحوص{form.min_answers ? ` وأجاب ${form.min_answers}` : ''} ← حاضر{form.attendance_points ? ` (+${form.attendance_points} نقطة)` : ''}.
              إن أُرسل عدد فحوص أقل من المطلوب يُحسب الحد الأدنى على ما أُرسل فعلاً.
            </p>
          </div>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
        </div>

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">إلغاء</button>
          <button id="oc-save" type="submit" disabled={saving} className="btn-primary flex flex-1 items-center justify-center gap-2 !from-red-600 !to-red-500">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {mode === 'add' ? 'إنشاء الفصل' : 'حفظ'}
          </button>
        </div>
      </form>
    </div>
  );
}
