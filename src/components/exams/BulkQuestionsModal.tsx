'use client';

// ---------- Bulk add questions (إضافة أسئلة بالجملة) ----------
// Step 1 — paste text: question line, then its answers, next question, ...
// Step 2 — review: every parsed question is editable (text, answers, correct
//          answer, points, seconds); apply points / seconds to all; remove.
// Save    — all valid questions are inserted in ONE request (all or none).

import { useMemo, useState } from 'react';
import {
  X, Save, Loader2, Plus, Trash2, Check, Wand2, ArrowRight, AlertTriangle, ClipboardPaste, Star, Clock,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  createQuestionsBulk, examErrorMessage, OPTION_LETTERS, MIN_OPTIONS, MAX_OPTIONS,
  type Exam, type ExamQuestion,
} from '@/lib/exams';
import { parseBulkQuestions, validateDraft, type BulkDraft } from '@/lib/exam-bulk';

const EXAMPLE = `ما هو أول أسفار الكتاب المقدس؟
التكوين *
الخروج
اللاويين
العدد

من بنى الفلك؟
موسى
نوح *
إبراهيم
داود`;

export default function BulkQuestionsModal({
  exam, nextSortOrder, onClose, onSaved,
}: {
  exam: Exam;
  nextSortOrder: number;
  onClose: () => void;
  onSaved: (saved: ExamQuestion[]) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [step, setStep] = useState<'paste' | 'review'>('paste');

  // step 1 settings
  const [raw, setRaw] = useState('');
  const [perQ, setPerQ] = useState<'auto' | string>('auto');
  const [firstIsCorrect, setFirstIsCorrect] = useState(false);
  const [points, setPoints] = useState(String(exam.default_points));
  const [seconds, setSeconds] = useState('');
  const [note, setNote] = useState('');

  // step 2
  const [drafts, setDrafts] = useState<BulkDraft[]>([]);
  const [applyPoints, setApplyPoints] = useState('');
  const [applySeconds, setApplySeconds] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const errors = useMemo(() => drafts.map(validateDraft), [drafts]);
  const invalidCount = errors.filter(Boolean).length;
  const missingCorrect = drafts.filter((d) => d.correct < 0).length;

  const analyse = () => {
    setError('');
    if (!raw.trim()) return setError('الصق النص أولاً');
    const res = parseBulkQuestions(raw, {
      answersPerQuestion: perQ === 'auto' ? 'auto' : Number(perQ),
      firstIsCorrect, points, seconds,
    });
    if (res.drafts.length === 0) {
      return setError(res.leftover.length
        ? `النص لا يكفي لسؤال كامل (سؤال + ${res.mode.kind === 'fixed' ? res.mode.n : ''} إجابات)`
        : 'لم يتم العثور على أسئلة');
    }
    setNote(res.leftover.length
      ? `تم تجاهل ${res.leftover.length} سطر في النهاية لأنها لا تكمل سؤالاً (${res.leftover.join(' / ').slice(0, 80)})`
      : res.mode.kind === 'blocks'
        ? 'تم التقسيم حسب الأسطر الفارغة بين الأسئلة'
        : `تم التقسيم: كل سؤال يتبعه ${res.mode.n} إجابات`);
    setDrafts(res.drafts);
    setStep('review');
  };

  const patch = (key: string, p: Partial<BulkDraft>) =>
    setDrafts((l) => l.map((d) => (d.key === key ? { ...d, ...p } : d)));
  const setOpt = (key: string, i: number, v: string) =>
    setDrafts((l) => l.map((d) => (d.key === key ? { ...d, options: d.options.map((o, j) => (j === i ? v : o)) } : d)));
  const addOpt = (key: string) =>
    setDrafts((l) => l.map((d) => (d.key === key && d.options.length < MAX_OPTIONS ? { ...d, options: [...d.options, ''] } : d)));
  const removeOpt = (key: string, i: number) =>
    setDrafts((l) => l.map((d) => {
      if (d.key !== key || d.options.length <= MIN_OPTIONS) return d;
      return { ...d, options: d.options.filter((_, j) => j !== i), correct: d.correct === i ? -1 : d.correct > i ? d.correct - 1 : d.correct };
    }));
  const removeDraft = (key: string) => setDrafts((l) => l.filter((d) => d.key !== key));

  const applyAll = () => {
    setDrafts((l) => l.map((d) => ({
      ...d,
      points: applyPoints !== '' ? applyPoints : d.points,
      seconds: applySeconds !== '' ? applySeconds : d.seconds,
    })));
  };

  const save = async () => {
    setError('');
    if (drafts.length === 0) return setError('لا توجد أسئلة للحفظ');
    if (invalidCount > 0) return setError(`أصلح ${invalidCount} سؤال به أخطاء (مظللة بالأحمر) قبل الحفظ`);
    setSaving(true);
    try {
      const saved = await createQuestionsBulk(supabase, exam.id, drafts.map((d) => ({
        text: d.text.trim(),
        image_url: null,
        options: d.options.map((o) => o.trim()),
        correct_index: d.correct,
        points: Math.round(Number(d.points)),
        seconds: d.seconds === '' ? null : Math.round(Number(d.seconds)),
      })), nextSortOrder);
      onSaved(saved);
    } catch (e) {
      setError(examErrorMessage(e, 'تعذر حفظ الأسئلة — لم يُحفظ شيء'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center" onClick={onClose}>
      <div
        id="bulk-modal" onClick={(e) => e.stopPropagation()}
        className="flex max-h-[94vh] w-full max-w-2xl flex-col rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
        style={{ animation: 'slideUp .25s ease-out' }}
      >
        <div className="flex items-center justify-between border-b border-slate-100 p-4">
          <h3 className="flex items-center gap-2 text-base font-extrabold">
            <ClipboardPaste className="h-5 w-5 text-violet-600" />
            {step === 'paste' ? 'إضافة أسئلة بالجملة' : `مراجعة ${drafts.length} سؤال`}
          </h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {step === 'paste' && (
            <>
              <p className="mb-2 text-xs font-bold leading-relaxed text-slate-500">
                الصق الأسئلة: سطر للسؤال ثم سطر لكل إجابة، ثم السؤال التالي. يمكنك الفصل بين الأسئلة بسطر فارغ
                (فيصبح عدد الإجابات مختلفاً لكل سؤال). لتحديد الإجابة الصحيحة ضع <b>*</b> أو <b>✓</b> أو <b>(صح)</b> بجانبها
                — أو حدّدها في الخطوة التالية.
              </p>
              <textarea
                id="bulk-text" dir="auto" autoFocus value={raw} onChange={(e) => setRaw(e.target.value)}
                className="input-field min-h-[240px] font-mono text-sm leading-relaxed" placeholder={EXAMPLE}
              />
              <button type="button" onClick={() => setRaw(EXAMPLE)} className="mt-1 text-xs font-extrabold text-violet-600">إدراج مثال</button>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-extrabold text-slate-600">عدد الإجابات لكل سؤال</span>
                  <select id="bulk-per" className="input-field" value={perQ} onChange={(e) => setPerQ(e.target.value)}>
                    <option value="auto">تلقائي (أسطر فارغة، وإلا 4)</option>
                    {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} إجابات ثابتة</option>)}
                  </select>
                </label>
                <label className="flex items-end gap-2 pb-2.5">
                  <input id="bulk-first" type="checkbox" className="h-4 w-4 accent-violet-600" checked={firstIsCorrect} onChange={(e) => setFirstIsCorrect(e.target.checked)} />
                  <span className="text-xs font-extrabold text-slate-600">الإجابة الأولى هي الصحيحة إن لم تُحدَّد</span>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-extrabold text-slate-600">درجة كل سؤال</span>
                  <input id="bulk-points" type="number" min={0} max={1000} className="input-field tabular-nums" value={points} onChange={(e) => setPoints(e.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-extrabold text-slate-600">الوقت (ثانية)</span>
                  <input id="bulk-seconds" type="number" min={5} max={3600} className="input-field tabular-nums" value={seconds} onChange={(e) => setSeconds(e.target.value)} placeholder={`افتراضي ${exam.default_seconds}`} />
                </label>
              </div>
            </>
          )}

          {step === 'review' && (
            <>
              <p className="mb-2 rounded-xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-800">{note}</p>

              {/* apply to all */}
              <div className="mb-3 flex flex-wrap items-end gap-2 rounded-2xl bg-slate-50 p-2.5">
                <label className="block">
                  <span className="mb-0.5 block text-[10px] font-extrabold text-slate-500">الدرجة للكل</span>
                  <input id="bulk-apply-points" type="number" min={0} max={1000} className="input-field !py-1.5 !px-2 w-20 text-sm tabular-nums" value={applyPoints} onChange={(e) => setApplyPoints(e.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[10px] font-extrabold text-slate-500">الوقت للكل (ث)</span>
                  <input id="bulk-apply-seconds" type="number" min={5} max={3600} className="input-field !py-1.5 !px-2 w-24 text-sm tabular-nums" value={applySeconds} onChange={(e) => setApplySeconds(e.target.value)} />
                </label>
                <button type="button" id="bulk-apply" onClick={applyAll} disabled={applyPoints === '' && applySeconds === ''}
                  className="btn-secondary flex items-center gap-1 !py-1.5 !px-3 text-xs disabled:opacity-40">
                  <Wand2 className="h-3.5 w-3.5" /> تطبيق على الكل
                </button>
                {missingCorrect > 0 && (
                  <button type="button" onClick={() => setDrafts((l) => l.map((d) => (d.correct < 0 ? { ...d, correct: 0 } : d)))}
                    className="mr-auto text-[11px] font-extrabold text-violet-600 underline">
                    الأولى صحيحة لـ {missingCorrect} بلا تحديد
                  </button>
                )}
              </div>

              <div id="bulk-list" className="space-y-3">
                {drafts.map((d, qi) => {
                  const err = errors[qi];
                  return (
                    <div key={d.key} id={`bulk-row-${qi}`} className={`rounded-2xl p-3 ring-1 ${err ? 'bg-red-50/40 ring-red-300' : 'bg-white ring-slate-200'}`}>
                      <div className="flex items-start gap-2">
                        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-xs font-extrabold tabular-nums text-violet-700">{nextSortOrder + qi}</span>
                        <textarea
                          dir="auto" rows={2} className="input-field min-h-[52px] flex-1 text-sm font-bold" value={d.text}
                          onChange={(e) => patch(d.key, { text: e.target.value })} placeholder="نص السؤال"
                        />
                        <button type="button" aria-label="حذف السؤال" onClick={() => removeDraft(d.key)} className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="mt-2 space-y-1.5 pr-9">
                        {d.options.map((o, i) => {
                          const isCorrect = d.correct === i;
                          return (
                            <div key={i} className={`flex items-center gap-1.5 rounded-xl p-1 ring-1 ${isCorrect ? 'bg-emerald-50 ring-emerald-300' : 'ring-slate-200'}`}>
                              <button type="button" onClick={() => patch(d.key, { correct: i })} aria-pressed={isCorrect} aria-label={`الإجابة ${OPTION_LETTERS[i]} صحيحة`}
                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold ${isCorrect ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                                {isCorrect ? <Check className="h-4 w-4" /> : OPTION_LETTERS[i]}
                              </button>
                              <input dir="auto" className="input-field !py-1.5 !px-2 text-sm" value={o} onChange={(e) => setOpt(d.key, i, e.target.value)} placeholder={`الاختيار ${OPTION_LETTERS[i]}`} />
                              <button type="button" aria-label="حذف الاختيار" disabled={d.options.length <= MIN_OPTIONS} onClick={() => removeOpt(d.key, i)}
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          );
                        })}
                        {d.options.length < MAX_OPTIONS && (
                          <button type="button" onClick={() => addOpt(d.key)} className="flex items-center gap-1 text-[11px] font-extrabold text-violet-600">
                            <Plus className="h-3.5 w-3.5" /> إضافة اختيار
                          </button>
                        )}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2 pr-9">
                        <label className="flex items-center gap-1 text-[11px] font-extrabold text-slate-500">
                          <Star className="h-3.5 w-3.5 text-gold-500" />
                          <input type="number" min={0} max={1000} className="input-field !py-1 !px-2 w-16 text-xs tabular-nums" value={d.points} onChange={(e) => patch(d.key, { points: e.target.value })} />
                        </label>
                        <label className="flex items-center gap-1 text-[11px] font-extrabold text-slate-500">
                          <Clock className="h-3.5 w-3.5 text-slate-400" />
                          <input type="number" min={5} max={3600} className="input-field !py-1 !px-2 w-20 text-xs tabular-nums" value={d.seconds} onChange={(e) => patch(d.key, { seconds: e.target.value })} placeholder={`${exam.default_seconds}`} />
                        </label>
                        {err && <span className="flex items-center gap-1 text-[11px] font-extrabold text-red-600"><AlertTriangle className="h-3.5 w-3.5" /> {err}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
        </div>

        <div className="flex gap-2 border-t border-slate-100 p-4">
          {step === 'paste' ? (
            <button type="button" id="bulk-analyse" onClick={analyse} className="btn-primary flex flex-1 items-center justify-center gap-2 !from-violet-600 !to-violet-500">
              <Wand2 className="h-4 w-4" /> تحليل ومراجعة
            </button>
          ) : (
            <>
              <button type="button" onClick={() => { setStep('paste'); setError(''); }} disabled={saving} className="btn-secondary flex items-center gap-1.5 text-sm">
                <ArrowRight className="h-4 w-4" /> رجوع للنص
              </button>
              <button type="button" id="bulk-save" onClick={save} disabled={saving || drafts.length === 0}
                className="btn-primary flex flex-1 items-center justify-center gap-2 !from-violet-600 !to-violet-500">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                حفظ {drafts.length} سؤال
                {invalidCount > 0 && <span className="rounded-full bg-white/25 px-1.5 text-[10px]">{invalidCount} بها أخطاء</span>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
