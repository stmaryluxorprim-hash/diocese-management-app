'use client';

// ---------- STUDENT RESULTS (نتائج المخدومين) ----------
// Scope selectors + server-side search over enrollments → pick a student →
// exam history (result_student_history): every exam with total / percent /
// grade / pass, a trend bar, and "open result card" (StudentResultModal) per
// exam. `?person=` deep link opens a student directly.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Search, AlertTriangle, ChevronLeft, ClipboardList, Lock, Eye, TrendingUp, History } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { ScopeSelectors, useScopeState } from '@/components/store/StoreBits';
import { ResultsHeader, Toast, StudentStatusBadge, GradePill, PctBar, Avatar, Kpi, useResultLookups } from '@/components/results/ResultBits';
import StudentResultModal from '@/components/results/StudentResultModal';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { fetchEnrollmentsPage } from '@/lib/queries';
import type { EnrollmentWithPerson } from '@/lib/types';
import {
  fetchStudentHistory, fetchResultExam, fetchSubjects, fetchSummary, fetchGrades, fetchResultPermissions,
  fmtNum, fmtPct, fmtDate, isMigrationMissing, MIGRATION_HINT, resultErrorMessage, NO_PERMISSIONS,
  type HistoryRow, type ResultPermissions, type ResultExam, type ResultSubject, type GradingGrade, type StudentSummary,
} from '@/lib/results';

export default function StudentsPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>}>
        <StudentsInner />
      </Suspense>
    </AppShell>
  );
}

function StudentsInner() {
  const params = useSearchParams();
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { churches, services, classes } = useResultLookups(supabase, approved);
  const scope = useScopeState();

  const [perms, setPerms] = useState<ResultPermissions>(NO_PERMISSIONS);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [q, setQ] = useState('');
  const [list, setList] = useState<EnrollmentWithPerson[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<{ person_id: string; name: string; national_id: string; image_url: string | null } | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [card, setCard] = useState<{ exam: ResultExam; subjects: ResultSubject[]; grades: GradingGrade[]; student: StudentSummary } | null>(null);
  const [openingCard, setOpeningCard] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  useEffect(() => {
    if (!approved) return;
    fetchResultPermissions(supabase).then(setPerms).catch((err) => { if (isMigrationMissing(err)) setMigrationMissing(true); });
  }, [supabase, approved]);

  // ---- search (debounced, server-side) ----
  useEffect(() => {
    if (!approved) return;
    let alive = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const { rows, hasMore: more } = await fetchEnrollmentsPage(supabase, { church: scope.church, service: scope.service, classes: scope.classes }, { page, pageSize: 50, search: q });
        if (!alive) return;
        setList((prev) => (page === 0 ? rows : [...prev, ...rows]));
        setHasMore(more);
      } catch (err) { if (alive) flash(resultErrorMessage(err, 'تعذر البحث')); }
      finally { if (alive) setSearching(false); }
    }, q ? 300 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [supabase, approved, q, page, scope.church, scope.service, scope.classes]);
  useEffect(() => { setPage(0); }, [q, scope.church, scope.service, scope.classes]);

  // ---- deep link ?person= ----
  useEffect(() => {
    const pid = params.get('person');
    if (!pid || !approved || selected) return;
    (async () => {
      const { data } = await supabase.from('persons').select('id, name, national_id, image_url').eq('id', pid).maybeSingle();
      if (data) setSelected({ person_id: data.id, name: data.name, national_id: data.national_id, image_url: data.image_url });
    })();
  }, [params, approved, supabase, selected]);

  // ---- history ----
  const loadHistory = useCallback(async () => {
    if (!selected) { setHistory(null); return; }
    setLoadingHistory(true);
    try { setHistory(await fetchStudentHistory(supabase, selected.person_id)); }
    catch (err) { if (isMigrationMissing(err)) setMigrationMissing(true); else flash(resultErrorMessage(err, 'تعذر تحميل السجل')); setHistory([]); }
    finally { setLoadingHistory(false); }
  }, [supabase, selected]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const stats = useMemo(() => {
    const h = (history ?? []).filter((r) => r.percent !== null);
    const avg = h.length ? h.reduce((a, r) => a + (r.percent ?? 0), 0) / h.length : null;
    const best = h.length ? Math.max(...h.map((r) => r.percent ?? 0)) : null;
    const passed = (history ?? []).filter((r) => r.status === 'passed').length;
    const failed = (history ?? []).filter((r) => r.status === 'failed').length;
    return { count: history?.length ?? 0, avg, best, passed, failed };
  }, [history]);

  const openCard = async (h: HistoryRow) => {
    if (!selected) return;
    setOpeningCard(h.exam_id);
    try {
      const [exam, subjects, summary] = await Promise.all([fetchResultExam(supabase, h.exam_id), fetchSubjects(supabase, h.exam_id), fetchSummary(supabase, h.exam_id)]);
      const student = summary.find((s) => s.enrollment_id === h.enrollment_id);
      if (!exam || !student) { flash('تعذر فتح بطاقة النتيجة'); return; }
      const grades = exam.grading_system_id ? await fetchGrades(supabase, [exam.grading_system_id]) : [];
      setCard({ exam, subjects, grades, student });
    } catch (err) { flash(resultErrorMessage(err)); }
    finally { setOpeningCard(null); }
  };

  if (migrationMissing) return (<><ResultsHeader /><div className="card flex items-start gap-3 border-amber-200 bg-amber-50 text-amber-900"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><p className="text-sm font-bold">{MIGRATION_HINT}</p></div></>);

  return (
    <>
      <ResultsHeader title="نتائج المخدومين" />
      <Toast msg={toast} />
      <div className="grid gap-3 lg:grid-cols-[340px_1fr]">
        {/* search */}
        <section className="card space-y-2 !p-2.5">
          <ScopeSelectors idPrefix="stu" scope={scope} churches={churches} services={services} classes={classes} />
          <label className="relative block">
            <Search className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="stu-search" className="input-field pr-8 text-sm" placeholder="بحث بالاسم / الرقم القومي / الهاتف…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto" id="stu-list">
            {list.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => setSelected({ person_id: e.person_id, name: e.person.name, national_id: e.person.national_id, image_url: e.person.image_url })}
                  className={`flex w-full items-center gap-2 px-1.5 py-2 text-start transition ${selected?.person_id === e.person_id ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
                  <Avatar name={e.person.name} url={e.person.image_url} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{e.person.name}</span>
                    <span className="block truncate text-[11px] text-slate-400">{e.person.national_id} · {classes.find((c) => c.id === e.class_id)?.name ?? ''}</span>
                  </span>
                  <ChevronLeft className="h-4 w-4 text-slate-300" />
                </button>
              </li>
            ))}
            {!searching && list.length === 0 && <li className="py-8 text-center text-sm text-slate-500">لا توجد نتائج</li>}
          </ul>
          {searching && <div className="flex justify-center py-2"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}
          {hasMore && !searching && <button type="button" className="btn-secondary w-full !py-1.5 text-xs" onClick={() => setPage((p) => p + 1)}>تحميل المزيد</button>}
        </section>

        {/* history */}
        <section className="space-y-3">
          {!selected ? (
            <div className="card flex flex-col items-center gap-2 py-14 text-center text-sm text-slate-500"><History className="h-8 w-8 text-slate-300" />اختر مخدوماً لعرض سجل نتائجه</div>
          ) : (
            <>
              <div className="card flex items-center gap-3">
                <Avatar name={selected.name} url={selected.image_url} size={48} />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-extrabold">{selected.name}</h3>
                  <p className="text-xs text-slate-400">{selected.national_id}</p>
                </div>
              </div>
              {loadingHistory ? <div className="flex justify-center py-10"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div> : (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Kpi label="الامتحانات" value={stats.count} id="stu-k-count" />
                    <Kpi label="متوسط النسبة" value={fmtPct(stats.avg)} tone="text-emerald-700" id="stu-k-avg" />
                    <Kpi label="أعلى نسبة" value={fmtPct(stats.best)} tone="text-sky-700" id="stu-k-best" />
                    <Kpi label="ناجح / راسب" value={<span><span className="text-emerald-700">{stats.passed}</span> / <span className="text-red-600">{stats.failed}</span></span>} id="stu-k-pf" />
                  </div>

                  {(history ?? []).length > 1 && (
                    <div className="card">
                      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-slate-500"><TrendingUp className="h-4 w-4" /> تطور النسبة</h4>
                      <div className="flex h-24 items-end gap-1.5" role="img" aria-label="تطور النسبة عبر الامتحانات">
                        {[...(history ?? [])].reverse().map((h) => (
                          <div key={h.exam_id} className="flex flex-1 flex-col items-center justify-end gap-0.5" title={`${h.exam_name}: ${fmtPct(h.percent)}`}>
                            <span className="text-[10px] font-bold text-slate-500">{h.percent === null ? '—' : fmtNum(h.percent)}</span>
                            <div className="w-full rounded-t-md" style={{ height: `${Math.max(3, h.percent ?? 0)}%`, background: h.grade_color ?? (h.passed === false ? '#dc2626' : '#059669') }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="card !p-0 overflow-hidden">
                    <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2 text-sm font-extrabold"><ClipboardList className="h-4 w-4 text-emerald-600" /> سجل الامتحانات</div>
                    {(history ?? []).length === 0 ? <p className="py-10 text-center text-sm text-slate-500">لا توجد امتحانات مسجلة لهذا المخدوم</p> : (
                      <ul className="divide-y divide-slate-100" id="stu-history">
                        {(history ?? []).map((h) => (
                          <li key={h.exam_id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <Link href={`/results/${h.exam_id}`} className="truncate text-sm font-bold hover:underline">{h.exam_name}</Link>
                                {h.locked && <Lock className="h-3 w-3 text-slate-400" />}
                              </div>
                              <div className="text-[11px] text-slate-400">{fmtDate(h.exam_date)}{h.academic_year ? ` · ${h.academic_year}` : ''} · {h.class_name} · {h.service_name}</div>
                              <div className="mt-1 max-w-xs"><PctBar pct={h.percent} color={h.grade_color} /></div>
                            </div>
                            <div className="text-center">
                              <div className="text-sm font-extrabold tabular-nums">{h.total_score === null ? '—' : `${fmtNum(h.total_score)} / ${fmtNum(h.total_full)}`}</div>
                              <div className="text-[11px] text-slate-400">{fmtPct(h.percent)} · {h.subjects_entered}/{h.subjects_total} مادة</div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {h.grade_name && <GradePill name={h.grade_name} color={h.grade_color} />}
                              <StudentStatusBadge status={h.status} />
                            </div>
                            <button type="button" className="btn-secondary !py-1 text-xs" disabled={openingCard === h.exam_id} onClick={() => openCard(h)} aria-label="عرض بطاقة النتيجة">
                              {openingCard === h.exam_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} البطاقة
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>

      {card && (
        <StudentResultModal exam={card.exam} subjects={card.subjects} grades={card.grades} student={card.student}
          canWrite={(perms.enter || perms.edit) && !card.exam.locked && card.exam.status !== 'archived'}
          onClose={() => setCard(null)} onSaved={() => { loadHistory(); }} />
      )}
    </>
  );
}
