'use client';

// ---------- EXAM PAGE (صفحة الامتحان) ----------
// Header with status + publish / close controls, then 3 tabs:
//   الأسئلة  — list (reorder ↑↓, edit, delete, duplicate) + add
//   النتائج  — every child's attempt (ResultsTab)
//   الإعدادات — summary card + «تعديل الإعدادات» (ExamFormModal) + delete

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Loader2, Plus, Pencil, Trash2, ChevronUp, ChevronDown, ListChecks, Users, Settings2, Clock, Star, Check,
  Rocket, Lock, Undo2, Trophy, Shuffle, Eye, EyeOff, CalendarClock, Copy, AlertTriangle, RotateCcw, ClipboardPaste,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { ExamsHeader, StatusBadge, Toast, scopeLabel, fmtDateTime } from '@/components/exams/ExamBits';
import ExamFormModal from '@/components/exams/ExamFormModal';
import QuestionFormModal from '@/components/exams/QuestionFormModal';
import BulkQuestionsModal from '@/components/exams/BulkQuestionsModal';
import ResultsTab from '@/components/exams/ResultsTab';
import { useStoreLookups } from '@/components/store/StoreBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import {
  fetchExam, fetchQuestions, fetchAttempts, updateExam, deleteExam, deleteQuestion, createQuestion, reorderQuestions,
  examErrorMessage, fmtSeconds, passLabel, examIsOpen, OPTION_LETTERS,
  type Exam, type ExamQuestion, type ExamAttemptWithPerson,
} from '@/lib/exams';

type Tab = 'questions' | 'results' | 'settings';

export default function ExamPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { profile, user } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { churches, services, classes } = useStoreLookups(supabase, approved);
  const className = (cid: string) => classes.find((c) => c.id === cid)?.name ?? '';

  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [attempts, setAttempts] = useState<ExamAttemptWithPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [attLoading, setAttLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>('questions');
  const [qForm, setQForm] = useState<{ open: boolean; q: ExamQuestion | null }>({ open: false, q: null });
  const [bulkOpen, setBulkOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  // can the caller WRITE this exam? (mirror of scope_contains; RLS is the wall)
  const canWrite = useMemo(() => {
    if (!profile || !exam) return false;
    if (profile.role === 'owner') return true;
    if (exam.church_id !== profile.church_id) return false;
    if (profile.role === 'church_manager') return true;
    if (profile.service_id && exam.service_id !== profile.service_id) return false;
    if (profile.role === 'service_manager') return true;
    if (profile.class_id && exam.class_id !== profile.class_id) return false;
    return true;
  }, [profile, exam]);

  const loadExam = useCallback(async () => {
    try {
      const [x, qs] = await Promise.all([fetchExam(supabase, id), fetchQuestions(supabase, id)]);
      if (!x) { setNotFound(true); return; }
      setExam(x); setQuestions(qs);
    } catch (e) {
      flash(examErrorMessage(e, 'تعذر التحميل'));
    } finally {
      setLoading(false);
    }
  }, [supabase, id]);

  const loadAttempts = useCallback(async () => {
    try { setAttempts(await fetchAttempts(supabase, id)); } catch { /* ignore */ } finally { setAttLoading(false); }
  }, [supabase, id]);

  useEffect(() => { if (approved) { loadExam(); loadAttempts(); } }, [approved, loadExam, loadAttempts]);
  useDebouncedRealtime(supabase, `exam-${id}`,
    [{ table: 'exams', filter: `id=eq.${id}` }, { table: 'exam_questions', filter: `exam_id=eq.${id}` }],
    loadExam, { enabled: approved, delayMs: 600 });
  useDebouncedRealtime(supabase, `exam-att-${id}`,
    [{ table: 'exam_attempts', filter: `exam_id=eq.${id}` }],
    loadAttempts, { enabled: approved, delayMs: 800 });

  // ---------- status ----------
  const setStatus = async (status: Exam['status']) => {
    if (!exam) return;
    if (status === 'published' && questions.length === 0) return flash('أضف سؤالاً واحداً على الأقل قبل النشر');
    if (status === 'published' && exam.question_mode === 'random' && exam.random_count > questions.length) {
      if (!confirm(`الامتحان يختار ${exam.random_count} سؤال عشوائياً لكن يحتوي على ${questions.length} فقط — سيحصل كل مخدوم على كل الأسئلة. نشر على أي حال؟`)) return;
    }
    setBusy('status');
    try {
      setExam(await updateExam(supabase, exam.id, { status }, user?.id));
      flash(status === 'published' ? 'تم نشر الامتحان — أصبح متاحاً للمخدومين' : status === 'closed' ? 'تم إغلاق الامتحان' : 'عاد الامتحان مسودة');
    } catch (e) { flash(examErrorMessage(e, 'تعذر تغيير الحالة')); } finally { setBusy(null); }
  };

  const removeExam = async () => {
    if (!exam) return;
    if (!confirm(`حذف الامتحان «${exam.title}» نهائياً مع كل أسئلته ونتائجه؟\nالنقاط التي أُضيفت للمخدومين لا تُخصم.`)) return;
    setBusy('delete');
    try { await deleteExam(supabase, exam.id); router.replace('/exams'); }
    catch (e) { flash(examErrorMessage(e, 'تعذر الحذف')); setBusy(null); }
  };

  // ---------- questions ----------
  const totalPoints = questions.reduce((s, q) => s + q.points, 0);
  const totalSeconds = exam ? questions.reduce((s, q) => s + (q.seconds ?? exam.default_seconds), 0) : 0;

  const removeQuestion = async (q: ExamQuestion) => {
    if (!confirm('حذف هذا السؤال؟ النتائج القديمة تحتفظ بنسخته.')) return;
    setBusy(q.id);
    try { await deleteQuestion(supabase, q.id); setQuestions((l) => l.filter((x) => x.id !== q.id)); }
    catch (e) { flash(examErrorMessage(e, 'تعذر الحذف')); } finally { setBusy(null); }
  };

  const duplicateQuestion = async (q: ExamQuestion) => {
    if (!exam) return;
    setBusy(q.id);
    try {
      const saved = await createQuestion(supabase, exam.id,
        { text: q.text, image_url: q.image_url, options: q.options, correct_index: q.correct_index, points: q.points, seconds: q.seconds },
        questions.length + 1);
      setQuestions((l) => [...l, saved]);
    } catch (e) { flash(examErrorMessage(e, 'تعذر النسخ')); } finally { setBusy(null); }
  };

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= questions.length) return;
    const next = [...questions];
    [next[i], next[j]] = [next[j], next[i]];
    setQuestions(next.map((q, k) => ({ ...q, sort_order: k + 1 })));
    try { await reorderQuestions(supabase, next.map((q) => q.id)); } catch { flash('تعذر حفظ الترتيب'); loadExam(); }
  };

  if (notFound) {
    return (
      <AppShell>
        <ExamsHeader />
        <div className="card py-12 text-center text-slate-400"><AlertTriangle className="mx-auto mb-2 h-8 w-8" /><p className="font-bold">الامتحان غير موجود أو خارج نطاقك</p></div>
      </AppShell>
    );
  }
  if (loading || !exam) {
    return (<AppShell><ExamsHeader /><div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-violet-500" /></div></AppShell>);
  }

  const open = examIsOpen(exam);
  const submittedCount = attempts.filter((a) => a.status === 'submitted').length;

  return (
    <AppShell>
      <ExamsHeader title={exam.title} badge={<StatusBadge status={exam.status} />} />

      {/* status strip */}
      <section id="exam-status-strip" className={`mb-3 rounded-2xl p-3 ${open ? 'bg-emerald-50' : exam.status === 'closed' ? 'bg-red-50' : 'bg-slate-100'}`}>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 text-xs font-bold text-slate-600">
            {exam.status === 'draft' && <p>مسودة — لا يراها المخدومون. أضف الأسئلة ثم اضغط «نشر».</p>}
            {exam.status === 'published' && (open
              ? <p className="text-emerald-800">منشور ومتاح الآن للمخدومين في نطاقه{exam.closes_at ? ` حتى ${fmtDateTime(exam.closes_at)}` : ''}.</p>
              : <p className="text-amber-800">منشور لكن خارج فترة الإتاحة {exam.opens_at && new Date(exam.opens_at) > new Date() ? `— يبدأ ${fmtDateTime(exam.opens_at)}` : `— انتهى ${fmtDateTime(exam.closes_at)}`}.</p>)}
            {exam.status === 'closed' && <p className="text-red-700">مغلق — لا يمكن حله، والنتائج محفوظة ويراها المخدومون الذين حلّوه.</p>}
            <p className="mt-0.5 truncate text-[11px] text-slate-400">{scopeLabel(exam, churches, services, classes)}</p>
          </div>
          {canWrite && (
            <div className="flex shrink-0 gap-1.5">
              {exam.status === 'draft' && (
                <button id="exam-publish" type="button" disabled={busy === 'status'} onClick={() => setStatus('published')} className="btn-primary flex items-center gap-1 !py-2 !px-3 text-xs !from-emerald-600 !to-emerald-500">
                  <Rocket className="h-4 w-4" /> نشر
                </button>
              )}
              {exam.status === 'published' && (
                <>
                  <button id="exam-unpublish" type="button" disabled={busy === 'status'} onClick={() => setStatus('draft')} title="إعادة إلى مسودة" className="btn-secondary flex items-center gap-1 !py-2 !px-2.5 text-xs">
                    <Undo2 className="h-4 w-4" />
                  </button>
                  <button id="exam-close" type="button" disabled={busy === 'status'} onClick={() => { if (confirm('إغلاق الامتحان؟ لن يستطيع أحد حله بعد الآن.')) setStatus('closed'); }} className="btn-primary flex items-center gap-1 !py-2 !px-3 text-xs !from-red-600 !to-red-500">
                    <Lock className="h-4 w-4" /> إغلاق
                  </button>
                </>
              )}
              {exam.status === 'closed' && (
                <button id="exam-reopen" type="button" disabled={busy === 'status'} onClick={() => setStatus('published')} className="btn-secondary flex items-center gap-1 !py-2 !px-3 text-xs">
                  <RotateCcw className="h-4 w-4" /> إعادة النشر
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* tabs */}
      <nav id="exam-tabs" className="mb-3 grid grid-cols-3 gap-2">
        {([
          ['questions', 'الأسئلة', ListChecks, questions.length],
          ['results', 'النتائج', Users, submittedCount],
          ['settings', 'الإعدادات', Settings2, null],
        ] as [Tab, string, typeof ListChecks, number | null][]).map(([k, label, Icon, n]) => (
          <button key={k} id={`exam-tab-${k}`} type="button" onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}
            className={`flex h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-extrabold transition active:scale-95 ${tab === k ? 'bg-violet-600 text-white shadow ring-2 ring-violet-300' : 'bg-white text-slate-600 border border-slate-200'}`}>
            <Icon className="h-4 w-4" /> {label}
            {n !== null && <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${tab === k ? 'bg-white/20' : 'bg-slate-100'}`}>{n}</span>}
          </button>
        ))}
      </nav>

      {/* ---------- QUESTIONS ---------- */}
      {tab === 'questions' && (
        <>
          <section className="mb-3 grid grid-cols-3 gap-2">
            <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-violet-600">{questions.length}</p><p className="text-[10px] font-bold text-slate-400">سؤال</p></div>
            <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-gold-600">{totalPoints}</p><p className="text-[10px] font-bold text-slate-400">مجموع الدرجات</p></div>
            <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-slate-600">{fmtSeconds(totalSeconds)}</p><p className="text-[10px] font-bold text-slate-400">الوقت الكلي</p></div>
          </section>
          {exam.question_mode === 'random' && (
            <p className="mb-3 flex items-center gap-2 rounded-2xl bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-800">
              <Shuffle className="h-4 w-4 shrink-0" /> كل مخدوم يحصل على {Math.min(exam.random_count, questions.length)} سؤال عشوائياً من هذه القائمة
              {exam.random_count > questions.length && questions.length > 0 && <span className="text-red-600">(المطلوب {exam.random_count} — أضف المزيد)</span>}
            </p>
          )}
          {canWrite && (
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button id="q-add" type="button" onClick={() => setQForm({ open: true, q: null })} className="btn-primary flex items-center justify-center gap-1.5 !from-violet-600 !to-violet-500">
                <Plus className="h-5 w-5" /> إضافة سؤال
              </button>
              <button id="q-bulk-add" type="button" onClick={() => setBulkOpen(true)} className="btn-secondary flex items-center justify-center gap-1.5 !border-violet-300 !text-violet-700">
                <ClipboardPaste className="h-5 w-5" /> إضافة أسئلة بالجملة
              </button>
            </div>
          )}
          {questions.length === 0 ? (
            <div className="card py-12 text-center text-slate-400">
              <ListChecks className="mx-auto mb-3 h-10 w-10 text-violet-200" />
              <p className="font-bold">لا توجد أسئلة بعد</p>
            </div>
          ) : (
            <div id="q-list" className="space-y-2">
              {questions.map((q, i) => (
                <div key={q.id} id={`q-row-${q.id}`} className="card !p-3">
                  <div className="flex items-start gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-xs font-extrabold tabular-nums text-violet-700">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold leading-snug">{q.text}</p>
                      {q.image_url && (
                        <div className="relative mt-2 h-28 w-full overflow-hidden rounded-xl bg-slate-100">
                          <Image src={q.image_url} alt="" fill sizes="400px" className="object-contain" />
                        </div>
                      )}
                      <ul className="mt-2 space-y-1">
                        {q.options.map((o, k) => (
                          <li key={k} className={`flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-bold ${k === q.correct_index ? 'bg-emerald-50 text-emerald-800' : 'text-slate-500'}`}>
                            <span className="w-4 text-center">{OPTION_LETTERS[k]}</span>
                            <span className="flex-1">{o}</span>
                            {k === q.correct_index && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex items-center gap-1.5">
                        <span className="badge bg-gold-100 text-gold-700"><Star className="h-3 w-3" /> {q.points}</span>
                        <span className="badge bg-slate-100 text-slate-600"><Clock className="h-3 w-3" /> {fmtSeconds(q.seconds ?? exam.default_seconds)}{q.seconds === null && <span className="opacity-60"> (افتراضي)</span>}</span>
                      </div>
                    </div>
                    {canWrite && (
                      <div className="flex shrink-0 flex-col gap-1">
                        <button type="button" aria-label="أعلى" disabled={i === 0} onClick={() => move(i, -1)} className="rounded-lg bg-slate-100 p-1.5 text-slate-500 disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
                        <button type="button" aria-label="أسفل" disabled={i === questions.length - 1} onClick={() => move(i, 1)} className="rounded-lg bg-slate-100 p-1.5 text-slate-500 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
                        <button type="button" aria-label="تعديل" onClick={() => setQForm({ open: true, q })} className="rounded-lg bg-primary-50 p-1.5 text-primary-600"><Pencil className="h-4 w-4" /></button>
                        <button type="button" aria-label="نسخ" disabled={busy === q.id} onClick={() => duplicateQuestion(q)} className="rounded-lg bg-slate-100 p-1.5 text-slate-500"><Copy className="h-4 w-4" /></button>
                        <button type="button" aria-label="حذف" disabled={busy === q.id} onClick={() => removeQuestion(q)} className="rounded-lg bg-red-50 p-1.5 text-red-500"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ---------- RESULTS ---------- */}
      {tab === 'results' && (
        <ResultsTab exam={exam} attempts={attempts} loading={attLoading} canWrite={canWrite} className={className} onChanged={loadAttempts} />
      )}

      {/* ---------- SETTINGS ---------- */}
      {tab === 'settings' && (
        <>
          <div className="card space-y-3">
            {exam.description && <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">{exam.description}</p>}
            <Row icon={CalendarClock} label="فترة الإتاحة" value={exam.opens_at || exam.closes_at ? `${exam.opens_at ? `من ${fmtDateTime(exam.opens_at)}` : 'من الآن'} ${exam.closes_at ? `حتى ${fmtDateTime(exam.closes_at)}` : 'بلا نهاية'}` : 'طوال فترة النشر'} />
            <Row icon={Clock} label="الوقت الافتراضي للسؤال" value={fmtSeconds(exam.default_seconds)} />
            <Row icon={Star} label="الدرجة الافتراضية للسؤال" value={`${exam.default_points}`} />
            <Row icon={Trophy} label="شرط النجاح" value={passLabel(exam)} />
            <Row icon={Star} label="النقاط" value={`النجاح +${exam.points_pass} · الدرجة الكاملة +${exam.points_full}`} />
            <Row icon={Shuffle} label="الأسئلة لكل مخدوم" value={exam.question_mode === 'random' ? `${exam.random_count} عشوائياً من ${questions.length}` : `كل الأسئلة (${questions.length})`} />
            <Row icon={Shuffle} label="ترتيب عشوائي" value={`${exam.shuffle_questions ? 'الأسئلة ✓' : 'الأسئلة ✗'} · ${exam.shuffle_options ? 'الاختيارات ✓' : 'الاختيارات ✗'}`} />
            <Row icon={Users} label="المحاولات المسموحة" value={`${exam.max_attempts}`} />
            <Row icon={exam.show_result ? Eye : EyeOff} label="يرى المخدوم بعد الانتهاء" value={`${exam.show_result ? 'النتيجة ✓' : 'النتيجة ✗'} · ${exam.show_answers ? 'الإجابات الصحيحة ✓' : 'الإجابات الصحيحة ✗'}`} />
          </div>
          {canWrite && (
            <div className="mt-3 flex gap-2">
              <button id="exam-edit-settings" type="button" onClick={() => setSettings(true)} className="btn-primary flex flex-1 items-center justify-center gap-1.5 !from-violet-600 !to-violet-500">
                <Pencil className="h-4 w-4" /> تعديل الإعدادات
              </button>
              <button id="exam-delete" type="button" disabled={busy === 'delete'} onClick={removeExam} className="flex items-center gap-1.5 rounded-xl bg-red-50 px-4 py-3 text-sm font-extrabold text-red-600 hover:bg-red-100">
                <Trash2 className="h-4 w-4" /> حذف
              </button>
            </div>
          )}
          <p className="mt-3 text-[11px] font-bold text-slate-400">أُنشئ {fmtDateTime(exam.created_at)} · آخر تعديل {fmtDateTime(exam.edited_at)}</p>
        </>
      )}

      {qForm.open && (
        <QuestionFormModal
          exam={exam} question={qForm.q} nextSortOrder={questions.length + 1}
          onClose={() => setQForm({ open: false, q: null })}
          onSaved={(saved, addAnother) => {
            setQuestions((l) => (l.some((x) => x.id === saved.id) ? l.map((x) => (x.id === saved.id ? saved : x)) : [...l, saved]));
            if (!addAnother) setQForm({ open: false, q: null });
          }}
        />
      )}
      {bulkOpen && (
        <BulkQuestionsModal
          exam={exam} nextSortOrder={questions.length + 1}
          onClose={() => setBulkOpen(false)}
          onSaved={(saved) => {
            setQuestions((l) => [...l, ...saved.filter((x) => !l.some((y) => y.id === x.id))]);
            setBulkOpen(false);
            flash(`تمت إضافة ${saved.length} سؤال`);
          }}
        />
      )}
      {settings && (
        <ExamFormModal
          exam={exam} churches={churches} services={services} classes={classes} questionCount={questions.length}
          onClose={() => setSettings(false)}
          onSaved={(saved) => { setExam(saved); setSettings(false); flash('تم حفظ الإعدادات'); }}
        />
      )}
      <Toast msg={toast} />
    </AppShell>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
      <span className="w-36 shrink-0 text-xs font-extrabold text-slate-500">{label}</span>
      <span className="min-w-0 flex-1 font-bold">{value}</span>
    </div>
  );
}
