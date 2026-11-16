'use client';
import { inClasses } from '@/lib/class-multi';

// ---------- BULK RESULTS ENTRY (إدخال جماعي) ----------
// Pick exam → (church → service → class narrow) → subject (or ALL subjects
// as a grid) → every student in one table. Keyboard-first: Enter / ↓ moves
// to the next student, ↑ back, Alt+←/→ next/previous subject, Alt+A absent,
// paste a column of scores fills downwards. Live validation (> full,
// negative, NaN), live grade preview, autosave draft in localStorage,
// save-all with progress and a failed-rows list that can be retried.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, Save, Keyboard, AlertTriangle, CheckCircle2, RotateCcw, Trash2, UserX, Search, Lock, Filter } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { ScopeSelectors, useScopeState } from '@/components/store/StoreBits';
import { ResultsHeader, Toast, ConfirmModal, useResultLookups, ExamPicker, GradePill, Avatar } from '@/components/results/ResultBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { ALL } from '@/lib/queries';
import {
  fetchResultExams, fetchResultExam, fetchSubjects, fetchSummary, fetchResultRows, fetchGrades, fetchResultPermissions,
  saveBulk, validateScore, previewPercent, gradeFor, fmtNum, isMigrationMissing, MIGRATION_HINT, resultErrorMessage, NO_PERMISSIONS,
  type ResultExam, type ResultSubject, type StudentSummary, type GradingGrade, type ResultPermissions, type BulkRow, type ResultRowStatus,
} from '@/lib/results';

const ALL_SUBJECTS = '__all__';
const ABSENT_WORDS = ['غ', 'غائب', 'غياب', 'absent', 'a', 'abs'];

interface Cell {
  value: string;              // raw text as typed ('' = empty)
  status: ResultRowStatus;    // draft | completed | absent | excused
  dirty: boolean;
  error: string | null;
  saved?: 'ok' | 'fail';
  failMsg?: string;
}
type Grid = Record<string, Record<string, Cell>>; // enrollment_id → subject_id → Cell
const key = (e: string, s: string) => `${e}|${s}`;
const emptyCell = (): Cell => ({ value: '', status: 'completed', dirty: false, error: null });

const draftKey = (examId: string) => `results-bulk-draft:${examId}`;

export default function BulkPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>}>
        <BulkInner />
      </Suspense>
    </AppShell>
  );
}

function BulkInner() {
  const params = useSearchParams();
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { churches, services, classes } = useResultLookups(supabase, approved);
  const scope = useScopeState();

  const [exams, setExams] = useState<ResultExam[]>([]);
  const [examId, setExamId] = useState(params.get('exam') ?? '');
  const [exam, setExam] = useState<ResultExam | null>(null);
  const [subjects, setSubjects] = useState<ResultSubject[]>([]);
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [grades, setGrades] = useState<GradingGrade[]>([]);
  const [perms, setPerms] = useState<ResultPermissions>(NO_PERMISSIONS);
  const [subjectId, setSubjectId] = useState(params.get('subject') ?? '');
  const [grid, setGrid] = useState<Grid>({});
  const [loading, setLoading] = useState(true);
  const [loadingExam, setLoadingExam] = useState(false);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [q, setQ] = useState('');
  const [emptyOnly, setEmptyOnly] = useState(false);
  const [asDraft, setAsDraft] = useState(false);
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<{ ok: number; fail: number } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };
  const inputs = useRef<Map<string, HTMLInputElement>>(new Map());

  // ---- exams list + permissions ----
  useEffect(() => {
    if (!approved) return;
    (async () => {
      try {
        const [xs, p] = await Promise.all([fetchResultExams(supabase), fetchResultPermissions(supabase)]);
        setExams(xs); setPerms(p); setMigrationMissing(false);
      } catch (err) {
        if (isMigrationMissing(err)) setMigrationMissing(true); else flash(resultErrorMessage(err));
      } finally { setLoading(false); }
    })();
  }, [supabase, approved]);

  // ---- selected exam: subjects, students, existing rows ----
  const loadExam = useCallback(async () => {
    if (!examId) { setExam(null); setSubjects([]); setStudents([]); setGrid({}); return; }
    setLoadingExam(true);
    try {
      const [x, subs, sum, rows] = await Promise.all([
        fetchResultExam(supabase, examId), fetchSubjects(supabase, examId), fetchSummary(supabase, examId), fetchResultRows(supabase, examId),
      ]);
      setExam(x); setSubjects(subs); setStudents(sum);
      if (x?.grading_system_id) setGrades(await fetchGrades(supabase, [x.grading_system_id])); else setGrades([]);
      // Base grid from DB
      const g: Grid = {};
      sum.forEach((s) => { g[s.enrollment_id] = {}; subs.forEach((sb) => { g[s.enrollment_id][sb.id] = emptyCell(); }); });
      rows.forEach((r) => {
        const c = g[r.enrollment_id]?.[r.subject_id];
        if (!c) return;
        c.value = r.score === null ? '' : String(r.score);
        c.status = r.status;
      });
      // Restore unsaved draft
      let restored = false;
      try {
        const raw = localStorage.getItem(draftKey(examId));
        if (raw) {
          const d = JSON.parse(raw) as Record<string, { value: string; status: ResultRowStatus }>;
          Object.entries(d).forEach(([k, v]) => {
            const [e, s] = k.split('|');
            const c = g[e]?.[s];
            if (!c) return;
            const sub = subs.find((z) => z.id === s);
            if (c.value === v.value && c.status === v.status) return;
            c.value = v.value; c.status = v.status; c.dirty = true;
            c.error = v.status === 'absent' || v.status === 'excused' ? null : validateScore(v.value, sub?.full_degree ?? 0).error;
            restored = true;
          });
        }
      } catch { /* ignore corrupt draft */ }
      setDraftRestored(restored);
      setGrid(g);
      setReport(null);
      if (!subjectId || (subjectId !== ALL_SUBJECTS && !subs.some((s) => s.id === subjectId))) setSubjectId(subs[0]?.id ?? '');
    } catch (err) {
      flash(resultErrorMessage(err, 'تعذر تحميل الامتحان'));
    } finally { setLoadingExam(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, examId]);
  useEffect(() => { loadExam(); }, [loadExam]);

  // ---- autosave draft (dirty cells only) ----
  useEffect(() => {
    if (!examId || !Object.keys(grid).length) return;
    const d: Record<string, { value: string; status: ResultRowStatus }> = {};
    Object.entries(grid).forEach(([e, row]) => Object.entries(row).forEach(([s, c]) => { if (c.dirty) d[key(e, s)] = { value: c.value, status: c.status }; }));
    try {
      if (Object.keys(d).length) localStorage.setItem(draftKey(examId), JSON.stringify(d));
      else localStorage.removeItem(draftKey(examId));
    } catch { /* storage full */ }
  }, [grid, examId]);

  // ---- derived ----
  const canWrite = (perms.enter || perms.edit) && !!exam && !exam.locked && exam.status !== 'archived';
  const activeSubjects = useMemo(
    () => (subjectId === ALL_SUBJECTS ? subjects : subjects.filter((s) => s.id === subjectId)),
    [subjects, subjectId],
  );
  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return students.filter((st) =>
      (scope.church === ALL || st.church_id === scope.church) &&
      (scope.service === ALL || st.service_id === scope.service) &&
      inClasses(scope.classes, st.class_id) &&
      (!s || st.name.toLowerCase().includes(s) || st.national_id.includes(s)) &&
      (!emptyOnly || activeSubjects.some((sb) => { const c = grid[st.enrollment_id]?.[sb.id]; return !c || (c.value === '' && c.status !== 'absent' && c.status !== 'excused'); })),
    );
  }, [students, scope.church, scope.service, scope.classes, q, emptyOnly, activeSubjects, grid]);

  const dirtyCells = useMemo(() => {
    const out: { e: string; s: string; c: Cell }[] = [];
    Object.entries(grid).forEach(([e, row]) => Object.entries(row).forEach(([s, c]) => { if (c.dirty) out.push({ e, s, c }); }));
    return out;
  }, [grid]);
  const errorCount = dirtyCells.filter((d) => d.c.error).length;
  const failedCells = dirtyCells.filter((d) => d.c.saved === 'fail');
  const classNameOf = (id: string) => classes.find((c) => c.id === id)?.name ?? '';

  // ---- cell updates ----
  const setCell = (e: string, s: string, patch: Partial<Cell>) =>
    setGrid((g) => ({ ...g, [e]: { ...g[e], [s]: { ...(g[e]?.[s] ?? emptyCell()), ...patch, dirty: true, saved: undefined, failMsg: undefined } } }));

  const typeScore = (e: string, sb: ResultSubject, raw: string) => {
    const t = raw.trim().toLowerCase();
    if (ABSENT_WORDS.includes(t)) { setCell(e, sb.id, { value: '', status: 'absent', error: null }); return; }
    const { error } = validateScore(raw, sb.full_degree);
    setCell(e, sb.id, { value: raw, status: asDraft ? 'draft' : 'completed', error });
  };
  const toggleAbsent = (e: string, sb: ResultSubject) => {
    const c = grid[e]?.[sb.id];
    if (c?.status === 'absent') setCell(e, sb.id, { status: asDraft ? 'draft' : 'completed', error: validateScore(c.value, sb.full_degree).error });
    else setCell(e, sb.id, { value: '', status: 'absent', error: null });
  };

  const focus = (e: string, s: string) => { const el = inputs.current.get(key(e, s)); if (el) { el.focus(); el.select(); } };
  const onKey = (ev: React.KeyboardEvent<HTMLInputElement>, rowIdx: number, colIdx: number) => {
    const sb = activeSubjects[colIdx];
    const st = visible[rowIdx];
    if (ev.key === 'Enter' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      const next = visible[rowIdx + 1];
      if (next) focus(next.enrollment_id, sb.id);
      else if (activeSubjects[colIdx + 1] && visible[0]) focus(visible[0].enrollment_id, activeSubjects[colIdx + 1].id);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      const prev = visible[rowIdx - 1];
      if (prev) focus(prev.enrollment_id, sb.id);
    } else if (ev.altKey && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
      ev.preventDefault();
      // RTL: ← visually moves to the next column
      const dir = ev.key === 'ArrowLeft' ? 1 : -1;
      const tgt = activeSubjects[colIdx + dir];
      if (tgt) focus(st.enrollment_id, tgt.id);
    } else if (ev.altKey && (ev.key === 'a' || ev.key === 'A' || ev.key === 'ش')) {
      ev.preventDefault(); toggleAbsent(st.enrollment_id, sb);
    }
  };

  const onPaste = (ev: React.ClipboardEvent<HTMLInputElement>, rowIdx: number, colIdx: number) => {
    const text = ev.clipboardData.getData('text');
    if (!text.includes('\n') && !text.includes('\t')) return; // single value → default paste
    ev.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n').filter((l, i, arr) => l.trim() !== '' || i < arr.length - 1);
    setGrid((g) => {
      const ng = { ...g };
      lines.forEach((line, li) => {
        const st = visible[rowIdx + li];
        if (!st) return;
        line.split('\t').forEach((val, ci) => {
          const sb = activeSubjects[colIdx + ci];
          if (!sb) return;
          const t = val.trim().toLowerCase();
          const absent = ABSENT_WORDS.includes(t);
          const { error } = absent ? { error: null } : validateScore(val, sb.full_degree);
          ng[st.enrollment_id] = {
            ...ng[st.enrollment_id],
            [sb.id]: { value: absent ? '' : val.trim(), status: absent ? 'absent' : asDraft ? 'draft' : 'completed', dirty: true, error },
          };
        });
      });
      return ng;
    });
    flash(`تم لصق ${lines.length} صف`);
  };

  // ---- save ----
  const save = async (onlyFailed = false) => {
    if (!examId || !canWrite) return;
    const targets = (onlyFailed ? failedCells : dirtyCells).filter((d) => !d.c.error);
    if (!targets.length) { flash(errorCount ? 'صحّح الأخطاء أولاً' : 'لا توجد تغييرات'); return; }
    const rows: BulkRow[] = targets.map(({ e, s, c }) => ({
      subject_id: s, enrollment_id: e,
      score: c.status === 'absent' || c.status === 'excused' || c.value.trim() === '' ? null : validateScore(c.value, Infinity).value,
      status: c.status,
    }));
    setSaving({ done: 0, total: rows.length });
    const out = await saveBulk(supabase, examId, rows, (done, total) => setSaving({ done, total }));
    setGrid((g) => {
      const ng = { ...g };
      out.forEach((o) => {
        const c = ng[o.enrollment_id]?.[o.subject_id];
        if (!c) return;
        ng[o.enrollment_id] = {
          ...ng[o.enrollment_id],
          [o.subject_id]: o.ok
            ? { ...c, dirty: false, saved: 'ok', failMsg: undefined }
            : { ...c, dirty: true, saved: 'fail', failMsg: resultErrorMessage({ message: o.error }, o.error ?? 'فشل الحفظ') },
        };
      });
      return ng;
    });
    const ok = out.filter((o) => o.ok).length;
    setReport({ ok, fail: out.length - ok });
    setSaving(null);
    flash(out.length - ok ? `تم حفظ ${ok} · فشل ${out.length - ok}` : `تم حفظ ${ok} نتيجة`);
  };

  const discard = () => {
    localStorage.removeItem(draftKey(examId));
    setConfirmDiscard(false);
    setDraftRestored(false);
    loadExam();
  };

  // ---- render ----
  if (migrationMissing) {
    return (
      <>
        <ResultsHeader />
        <div className="card flex items-start gap-3 border-amber-200 bg-amber-50 text-amber-900"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><p className="text-sm font-bold">{MIGRATION_HINT}</p></div>
      </>
    );
  }

  return (
    <>
      <ResultsHeader title="إدخال جماعي للنتائج" badge={exam?.locked ? <span className="badge bg-slate-100 text-slate-700"><Lock className="ml-1 inline h-3 w-3" />مقفول</span> : undefined} />
      <Toast msg={toast} />

      {/* selectors */}
      <section className="card mb-3 space-y-2.5">
        <div className="grid gap-2 sm:grid-cols-[2fr_3fr]">
          <ExamPicker exams={exams} value={examId} onChange={(v) => { setExamId(v); setSubjectId(''); setReport(null); }} id="bulk-exam" filter={(x) => x.status !== 'archived'} />
          <ScopeSelectors idPrefix="bulk" scope={scope} churches={churches} services={services} classes={classes} />
        </div>
        {exam && subjects.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="المادة">
            {subjects.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={subjectId === s.id} id={`bulk-sub-${s.id}`}
                onClick={() => setSubjectId(s.id)}
                className={`rounded-full px-3 py-1 text-xs font-bold transition ${subjectId === s.id ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                {s.name} <span className="opacity-70">/ {fmtNum(s.full_degree)}</span>
              </button>
            ))}
            <button type="button" role="tab" aria-selected={subjectId === ALL_SUBJECTS} id="bulk-sub-all" onClick={() => setSubjectId(ALL_SUBJECTS)}
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${subjectId === ALL_SUBJECTS ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
              كل المواد
            </button>
          </div>
        )}
        {exam && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="relative flex-1 min-w-[160px]">
              <Search className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input id="bulk-search" aria-label="بحث عن مخدوم" className="input-field !py-1.5 pr-8 text-sm" placeholder="بحث بالاسم أو الرقم القومي…" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <button type="button" id="bulk-empty-only" onClick={() => setEmptyOnly((v) => !v)} aria-pressed={emptyOnly}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-bold ${emptyOnly ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600'}`}>
              <Filter className="h-3.5 w-3.5" /> الفارغة فقط
            </button>
            <label className="inline-flex items-center gap-1.5 font-bold text-slate-600">
              <input type="checkbox" id="bulk-as-draft" className="h-4 w-4 accent-emerald-600" checked={asDraft} onChange={(e) => setAsDraft(e.target.checked)} /> حفظ كمسودة
            </label>
            <span className="hidden items-center gap-1 text-slate-400 sm:inline-flex"><Keyboard className="h-3.5 w-3.5" /> Enter/↓ التالي · Alt+A غائب · Alt+←/→ المادة · لصق عمود من Excel</span>
          </div>
        )}
      </section>

      {!exam && !loading && (
        <div className="card py-12 text-center text-sm text-slate-500">اختر امتحاناً للبدء في إدخال النتائج</div>
      )}
      {(loading || loadingExam) && <div className="flex justify-center py-10"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>}

      {exam && !loadingExam && subjects.length === 0 && (
        <div className="card py-10 text-center text-sm text-slate-500">لا توجد مواد في هذا الامتحان — أضف المواد من صفحة الامتحان أولاً</div>
      )}

      {exam && !loadingExam && !canWrite && subjects.length > 0 && (
        <div className="card mb-3 flex items-center gap-2 border-amber-200 bg-amber-50 text-sm font-bold text-amber-900">
          <Lock className="h-4 w-4" /> {exam.locked ? 'النتائج مقفولة — لا يمكن التعديل' : exam.status === 'archived' ? 'الامتحان مؤرشف' : 'ليس لديك صلاحية إدخال النتائج'}
        </div>
      )}

      {draftRestored && (
        <div className="card mb-3 flex flex-wrap items-center gap-2 border-sky-200 bg-sky-50 text-sm text-sky-900">
          <RotateCcw className="h-4 w-4" /> تم استرجاع مسودة غير محفوظة من هذا الجهاز
          <button type="button" className="mr-auto text-xs font-bold underline" onClick={() => setConfirmDiscard(true)}>تجاهل المسودة</button>
        </div>
      )}

      {exam && !loadingExam && subjects.length > 0 && activeSubjects.length > 0 && (
        <section className="card overflow-hidden !p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm" id="bulk-table">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="sticky right-0 z-10 bg-slate-50 px-3 py-2 text-right font-bold">المخدوم <span className="font-normal">({visible.length})</span></th>
                  {activeSubjects.map((s) => (
                    <th key={s.id} className="px-2 py-2 text-center font-bold whitespace-nowrap">{s.name}<div className="font-normal">من {fmtNum(s.full_degree)} · نجاح {fmtNum(s.pass_degree)}</div></th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((st, ri) => (
                  <tr key={st.enrollment_id} className="hover:bg-slate-50/60">
                    <td className="sticky right-0 z-10 bg-white px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <Avatar name={st.name} url={st.image_url} size={30} />
                        <div className="min-w-0">
                          <div className="truncate font-bold leading-tight">{st.name}</div>
                          <div className="truncate text-[11px] text-slate-400">{classNameOf(st.class_id)}</div>
                        </div>
                      </div>
                    </td>
                    {activeSubjects.map((sb, ci) => {
                      const c = grid[st.enrollment_id]?.[sb.id] ?? emptyCell();
                      const absent = c.status === 'absent' || c.status === 'excused';
                      const { value } = validateScore(c.value, sb.full_degree);
                      const pct = absent ? null : previewPercent(value, sb.full_degree);
                      const g = exam.grade_subject ? gradeFor(grades, exam.grading_system_id, pct) : null;
                      const pass = !absent && value !== null && !c.error ? value >= sb.pass_degree : null;
                      return (
                        <td key={sb.id} className="px-2 py-1.5 align-middle">
                          <div className="flex items-center justify-center gap-1">
                            <div className="relative">
                              <input
                                ref={(el) => { if (el) inputs.current.set(key(st.enrollment_id, sb.id), el); else inputs.current.delete(key(st.enrollment_id, sb.id)); }}
                                id={`cell-${st.enrollment_id}-${sb.id}`}
                                aria-label={`${st.name} — ${sb.name}`}
                                inputMode="decimal"
                                disabled={!canWrite}
                                value={absent ? (c.status === 'absent' ? 'غ' : 'معذور') : c.value}
                                onChange={(e) => typeScore(st.enrollment_id, sb, e.target.value)}
                                onKeyDown={(e) => onKey(e, ri, ci)}
                                onPaste={(e) => onPaste(e, ri, ci)}
                                onFocus={(e) => e.currentTarget.select()}
                                className={`w-[76px] rounded-lg border px-2 py-1.5 text-center font-bold tabular-nums outline-none transition focus:ring-2 focus:ring-emerald-300
                                  ${c.error ? 'border-red-400 bg-red-50 text-red-700' : c.saved === 'fail' ? 'border-red-300 bg-red-50' : c.dirty ? 'border-amber-300 bg-amber-50' : c.saved === 'ok' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}
                                  ${absent ? 'text-slate-500' : pass === false ? 'text-red-600' : ''}`}
                              />
                              {(c.error || c.failMsg) && (
                                <div className="absolute -bottom-3.5 right-0 left-0 truncate text-[10px] font-bold text-red-600" title={c.error ?? c.failMsg ?? ''}>{c.error ?? c.failMsg}</div>
                              )}
                            </div>
                            {canWrite && (
                              <button type="button" tabIndex={-1} onClick={() => toggleAbsent(st.enrollment_id, sb)} aria-label="غائب" title="غائب (Alt+A)"
                                className={`rounded-md p-1 ${absent ? 'bg-slate-200 text-slate-700' : 'text-slate-300 hover:bg-slate-100 hover:text-slate-600'}`}>
                                <UserX className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <div className="hidden w-14 text-right text-[11px] leading-tight sm:block">
                              {g ? <GradePill name={g.name} color={g.color} /> : pct !== null && !c.error ? <span className="text-slate-500">{fmtNum(pct)}٪</span> : absent ? <span className="text-slate-400">غائب</span> : null}
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan={activeSubjects.length + 1} className="py-10 text-center text-sm text-slate-500">{students.length ? 'لا يوجد مخدومون مطابقون للفلتر' : 'لا يوجد مخدومون في نطاق هذا الامتحان'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* save bar */}
      {exam && canWrite && (dirtyCells.length > 0 || saving || report) && (
        <div className="fixed inset-x-0 bottom-16 z-30 px-3 sm:bottom-4">
          <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur">
            {saving ? (
              <div>
                <div className="mb-1 flex items-center justify-between text-xs font-bold text-slate-600"><span>جارٍ الحفظ…</span><span>{saving.done} / {saving.total}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${saving.total ? (saving.done / saving.total) * 100 : 0}%` }} /></div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex-1 text-xs font-bold text-slate-600">
                  {dirtyCells.length > 0 && <span>{dirtyCells.length} تغيير غير محفوظ</span>}
                  {errorCount > 0 && <span className="mr-2 text-red-600"><AlertTriangle className="ml-0.5 inline h-3.5 w-3.5" />{errorCount} خطأ</span>}
                  {report && dirtyCells.length === 0 && <span className="text-emerald-700"><CheckCircle2 className="ml-0.5 inline h-3.5 w-3.5" />تم حفظ {report.ok} نتيجة</span>}
                  {report && report.fail > 0 && <span className="mr-2 text-red-600">فشل {report.fail}</span>}
                </div>
                {failedCells.length > 0 && (
                  <button type="button" id="bulk-retry" className="btn-secondary !py-1.5 text-xs" onClick={() => save(true)}><RotateCcw className="h-3.5 w-3.5" /> إعادة المحاولة للفاشلة ({failedCells.length})</button>
                )}
                {dirtyCells.length > 0 && (
                  <>
                    <button type="button" id="bulk-discard" className="btn-secondary !py-1.5 text-xs" onClick={() => setConfirmDiscard(true)}><Trash2 className="h-3.5 w-3.5" /> تجاهل</button>
                    <button type="button" id="bulk-save" className="btn-primary !py-1.5 text-xs" disabled={errorCount === dirtyCells.length} onClick={() => save(false)}>
                      <Save className="h-3.5 w-3.5" /> حفظ الكل ({dirtyCells.length - errorCount})
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {confirmDiscard && (
        <ConfirmModal title="تجاهل التغييرات غير المحفوظة؟" desc="سيتم إرجاع الجدول إلى آخر نسخة محفوظة وحذف المسودة من هذا الجهاز." confirmLabel="تجاهل" onConfirm={discard} onClose={() => setConfirmDiscard(false)} />
      )}
      <div className="h-24" />
    </>
  );
}
