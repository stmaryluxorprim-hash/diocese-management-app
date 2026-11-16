'use client';
import { inClasses, inClassesOrWide } from '@/lib/class-multi';

// ---------- REPORTS (التقارير) ----------
// Filters: church → service → class · exam(s) · academic year · date range.
// Report types:
//   results      — per-student results of one exam (with subjects)
//   ranking      — ranking (ties 1,2,2,4) by percent / total
//   subjects     — per-subject performance (avg · pass rate · highest/lowest)
//   classes      — per-class / per-service performance across the chosen exams
//   grades       — grade distribution (chart + table)
//   passfail     — pass / fail summary per exam
// Every report exports to Excel; the page is printable.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, AlertTriangle, FileDown, Printer, BarChart3, Trophy, BookOpen, Users, Percent, CheckCircle2 } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { ScopeSelectors, useScopeState } from '@/components/store/StoreBits';
import { ResultsHeader, Toast, GradePill, StudentStatusBadge, BarChart, Kpi, useResultLookups, ExamPicker, gradeOf } from '@/components/results/ResultBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { ALL } from '@/lib/queries';
import {
  fetchResultExams, fetchSubjectsOf, fetchSummary, fetchResultRows, fetchGradingSystems, fetchGrades, fetchResultPermissions,
  computeStats, fmtNum, fmtPct, fmtDate, rankLabel, safeFile, isMigrationMissing, MIGRATION_HINT, resultErrorMessage, NO_PERMISSIONS, STUDENT_STATUS_LABELS,
  type ResultExam, type ResultSubject, type StudentSummary, type ExamResultRow, type GradingGrade, type ResultPermissions,
} from '@/lib/results';

type ReportKind = 'results' | 'ranking' | 'subjects' | 'classes' | 'grades' | 'passfail';
const KINDS: { key: ReportKind; label: string; icon: typeof BarChart3; multi: boolean }[] = [
  { key: 'results', label: 'نتائج امتحان', icon: BarChart3, multi: false },
  { key: 'ranking', label: 'الترتيب', icon: Trophy, multi: false },
  { key: 'subjects', label: 'أداء المواد', icon: BookOpen, multi: false },
  { key: 'classes', label: 'أداء الفصول والخدمات', icon: Users, multi: true },
  { key: 'grades', label: 'توزيع التقديرات', icon: Percent, multi: true },
  { key: 'passfail', label: 'النجاح والرسوب', icon: CheckCircle2, multi: true },
];

type SheetRow = Record<string, string | number | null>;

export default function ReportsPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>}>
        <ReportsInner />
      </Suspense>
    </AppShell>
  );
}

function ReportsInner() {
  const params = useSearchParams();
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { churches, services, classes } = useResultLookups(supabase, approved);
  const scope = useScopeState();

  const [kind, setKind] = useState<ReportKind>((params.get('kind') as ReportKind) || 'results');
  const [exams, setExams] = useState<ResultExam[]>([]);
  const [perms, setPerms] = useState<ResultPermissions>(NO_PERMISSIONS);
  const [grades, setGrades] = useState<GradingGrade[]>([]);
  const [examId, setExamId] = useState(params.get('exam') ?? '');
  const [year, setYear] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'final' | 'passed' | 'failed'>('all');
  const [rankBy, setRankBy] = useState<'percent' | 'score'>('percent');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [data, setData] = useState<{ exams: ResultExam[]; subjects: ResultSubject[]; summaries: Map<string, StudentSummary[]>; rows: ExamResultRow[] } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  useEffect(() => {
    if (!approved) return;
    (async () => {
      try {
        const [xs, p, gs] = await Promise.all([fetchResultExams(supabase), fetchResultPermissions(supabase), fetchGradingSystems(supabase)]);
        setExams(xs); setPerms(p);
        setGrades(await fetchGrades(supabase, gs.map((g) => g.id)));
        setMigrationMissing(false);
      } catch (err) { if (isMigrationMissing(err)) setMigrationMissing(true); else flash(resultErrorMessage(err)); }
      finally { setLoading(false); }
    })();
  }, [supabase, approved]);

  const multi = KINDS.find((k) => k.key === kind)?.multi ?? false;
  const years = useMemo(() => Array.from(new Set(exams.map((x) => x.academic_year).filter((y): y is string => !!y))).sort().reverse(), [exams]);

  // exams in the current filter set (used for multi reports + exam picker)
  const filteredExams = useMemo(() => exams.filter((x) =>
    x.status !== 'archived' || multi) .filter((x) =>
    (scope.church === ALL || x.church_id === scope.church) &&
    (scope.service === ALL || x.service_id === null || x.service_id === scope.service) &&
    inClassesOrWide(scope.classes, x.class_id) &&
    (year === 'all' || x.academic_year === year) &&
    (!from || (x.exam_date ?? '') >= from) &&
    (!to || (x.exam_date ?? '') <= to)), [exams, scope.church, scope.service, scope.classes, year, from, to, multi]);

  // ---- run ----
  const run = useCallback(async () => {
    const targets = multi ? filteredExams : exams.filter((x) => x.id === examId);
    if (!targets.length) { setData(null); return; }
    setRunning(true);
    try {
      const subjects = await fetchSubjectsOf(supabase, targets.map((x) => x.id));
      const summaries = new Map<string, StudentSummary[]>();
      const sums = await Promise.all(targets.map((x) => fetchSummary(supabase, x.id)));
      targets.forEach((x, i) => summaries.set(x.id, sums[i]));
      const rows = !multi && targets[0] ? await fetchResultRows(supabase, targets[0].id) : [];
      setData({ exams: targets, subjects, summaries, rows });
    } catch (err) { flash(resultErrorMessage(err, 'تعذر تحميل التقرير')); }
    finally { setRunning(false); }
  }, [supabase, multi, filteredExams, exams, examId]);
  useEffect(() => { if (!loading) run(); }, [run, loading]);

  // ---- scope filter of students within a summary ----
  const inScope = useCallback((s: StudentSummary) =>
    (scope.church === ALL || s.church_id === scope.church) && (scope.service === ALL || s.service_id === scope.service) && inClasses(scope.classes, s.class_id),
  [scope.church, scope.service, scope.classes]);
  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? '—';
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? '—';
  const churchName = (id: string) => churches.find((c) => c.id === id)?.name ?? '—';

  // ---- derived per report ----
  const single = !multi && data?.exams[0] ? data.exams[0] : null;
  const singleSubjects = useMemo(() => (single ? (data?.subjects ?? []).filter((s) => s.exam_id === single.id).sort((a, b) => a.sort_order - b.sort_order) : []), [data, single]);
  const singleStudents = useMemo(() => {
    if (!single) return [];
    let list = (data?.summaries.get(single.id) ?? []).filter(inScope);
    if (statusFilter === 'final') list = list.filter((s) => s.status === 'passed' || s.status === 'failed');
    if (statusFilter === 'passed') list = list.filter((s) => s.status === 'passed');
    if (statusFilter === 'failed') list = list.filter((s) => s.status === 'failed');
    return list;
  }, [data, single, inScope, statusFilter]);
  const rowsByKey = useMemo(() => new Map((data?.rows ?? []).map((r) => [`${r.enrollment_id}|${r.subject_id}`, r])), [data]);
  const ranked = useMemo(() => singleStudents.filter((s) => s.rank !== null).sort((a, b) => (rankBy === 'percent' ? (a.rank ?? 0) - (b.rank ?? 0) : (a.rank_score ?? 0) - (b.rank_score ?? 0)) || a.name.localeCompare(b.name, 'ar')), [singleStudents, rankBy]);
  const singleStats = useMemo(() => (single ? computeStats(singleStudents, grades, single.grading_system_id) : null), [single, singleStudents, grades]);

  const subjectPerf = useMemo(() => {
    if (!single) return [];
    const ids = new Set(singleStudents.map((s) => s.enrollment_id));
    return singleSubjects.map((sb) => {
      const rs = (data?.rows ?? []).filter((r) => r.subject_id === sb.id && ids.has(r.enrollment_id));
      const scored = rs.filter((r) => r.score !== null && r.status !== 'absent' && r.status !== 'excused');
      const avg = scored.length ? scored.reduce((a, r) => a + (r.score ?? 0), 0) / scored.length : null;
      const passed = scored.filter((r) => (r.score ?? 0) >= sb.pass_degree).length;
      const hi = scored.length ? Math.max(...scored.map((r) => r.score ?? 0)) : null;
      const lo = scored.length ? Math.min(...scored.map((r) => r.score ?? 0)) : null;
      return { sb, entered: scored.length, absent: rs.filter((r) => r.status === 'absent' || r.status === 'excused').length, avg, avgPct: avg === null ? null : (avg / sb.full_degree) * 100, passed, failed: scored.length - passed, passRate: scored.length ? (passed / scored.length) * 100 : null, hi, lo };
    });
  }, [single, singleSubjects, singleStudents, data]);

  // multi-exam groupings
  const allStudents = useMemo(() => {
    const out: (StudentSummary & { exam: ResultExam })[] = [];
    (data?.exams ?? []).forEach((x) => (data?.summaries.get(x.id) ?? []).filter(inScope).forEach((s) => out.push({ ...s, exam: x })));
    return out;
  }, [data, inScope]);
  const groupPerf = (keyOf: (s: StudentSummary) => string, nameOf: (k: string) => string) => {
    const m = new Map<string, StudentSummary[]>();
    allStudents.forEach((s) => { const k = keyOf(s); m.set(k, [...(m.get(k) ?? []), s]); });
    return Array.from(m.entries()).map(([k, list]) => {
      const final = list.filter((s) => s.status === 'passed' || s.status === 'failed');
      const passed = final.filter((s) => s.passed).length;
      const pcts = final.map((s) => s.percent).filter((p): p is number => p !== null);
      return { key: k, name: nameOf(k), students: list.length, completed: final.length, passed, failed: final.length - passed, passRate: final.length ? (passed / final.length) * 100 : null, avg: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null, hi: pcts.length ? Math.max(...pcts) : null, lo: pcts.length ? Math.min(...pcts) : null };
    }).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));
  };
  const classPerf = useMemo(() => groupPerf((s) => s.class_id, className), [allStudents, classes]); // eslint-disable-line react-hooks/exhaustive-deps
  const servicePerf = useMemo(() => groupPerf((s) => s.service_id, serviceName), [allStudents, services]); // eslint-disable-line react-hooks/exhaustive-deps
  const passFail = useMemo(() => (data?.exams ?? []).map((x) => ({ x, st: computeStats((data?.summaries.get(x.id) ?? []).filter(inScope), grades, x.grading_system_id) })), [data, inScope, grades]);
  const gradeDist = useMemo(() => {
    const m = new Map<string, { name: string; color: string | null; count: number }>();
    allStudents.filter((s) => s.status === 'passed' || s.status === 'failed').forEach((s) => {
      const k = s.grade_name ?? 'بدون تقدير';
      const e = m.get(k) ?? { name: k, color: s.grade_color, count: 0 }; e.count++; m.set(k, e);
    });
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
  }, [allStudents]);

  // ---- export ----
  const exportExcel = async () => {
    if (!data) return;
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const add = (rows: SheetRow[], name: string) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': 'لا توجد بيانات' }]), name.slice(0, 31));
    let title = 'تقرير';
    if (kind === 'results' && single) {
      title = `نتائج_${single.name}`;
      add(singleStudents.map((st) => {
        const o: SheetRow = { 'الترتيب': st.rank, 'الكود': st.national_id, 'الاسم': st.name, 'الفصل': className(st.class_id), 'الخدمة': serviceName(st.service_id) };
        singleSubjects.forEach((s) => { const r = rowsByKey.get(`${st.enrollment_id}|${s.id}`); o[`${s.name} (${fmtNum(s.full_degree)})`] = r ? (r.status === 'absent' || r.status === 'excused' ? 'غائب' : r.score) : null; });
        o['المجموع'] = st.total_score; o['من'] = st.total_full; o['النسبة'] = st.percent; o['التقدير'] = st.grade_name; o['النتيجة'] = STUDENT_STATUS_LABELS[st.status];
        return o;
      }), 'النتائج');
    } else if (kind === 'ranking' && single) {
      title = `ترتيب_${single.name}`;
      add(ranked.map((st) => ({ 'الترتيب': rankBy === 'percent' ? st.rank : st.rank_score, 'الكود': st.national_id, 'الاسم': st.name, 'الفصل': className(st.class_id), 'المجموع': st.total_score, 'من': st.total_full, 'النسبة': st.percent, 'التقدير': st.grade_name })), 'الترتيب');
    } else if (kind === 'subjects' && single) {
      title = `أداء_المواد_${single.name}`;
      add(subjectPerf.map((p) => ({ 'المادة': p.sb.name, 'الدرجة الكاملة': p.sb.full_degree, 'درجة النجاح': p.sb.pass_degree, 'تم إدخاله': p.entered, 'غائب': p.absent, 'المتوسط': p.avg === null ? null : Math.round(p.avg * 100) / 100, 'متوسط ٪': p.avgPct === null ? null : Math.round(p.avgPct * 10) / 10, 'ناجح': p.passed, 'راسب': p.failed, 'نسبة النجاح ٪': p.passRate === null ? null : Math.round(p.passRate * 10) / 10, 'الأعلى': p.hi, 'الأقل': p.lo })), 'المواد');
    } else if (kind === 'classes') {
      title = 'أداء_الفصول_والخدمات';
      const map = (rows: typeof classPerf) => rows.map((p) => ({ 'الاسم': p.name, 'المخدومون': p.students, 'مكتمل': p.completed, 'ناجح': p.passed, 'راسب': p.failed, 'نسبة النجاح ٪': p.passRate === null ? null : Math.round(p.passRate * 10) / 10, 'المتوسط ٪': p.avg === null ? null : Math.round(p.avg * 10) / 10, 'الأعلى ٪': p.hi, 'الأقل ٪': p.lo }));
      add(map(classPerf), 'الفصول'); add(map(servicePerf), 'الخدمات');
    } else if (kind === 'grades') {
      title = 'توزيع_التقديرات';
      add(gradeDist.map((g) => ({ 'التقدير': g.name, 'العدد': g.count, 'النسبة ٪': allStudents.length ? Math.round((g.count / allStudents.length) * 1000) / 10 : 0 })), 'التقديرات');
    } else if (kind === 'passfail') {
      title = 'النجاح_والرسوب';
      add(passFail.map(({ x, st }) => ({ 'الامتحان': x.name, 'التاريخ': x.exam_date, 'العام': x.academic_year, 'الكنيسة': churchName(x.church_id), 'المخدومون': st.students, 'مكتمل': st.completed, 'ناجح': st.passed, 'راسب': st.failed, 'غائب': st.absent, 'لم يُدخل': st.notEntered, 'نسبة النجاح ٪': st.passRate, 'المتوسط ٪': st.average })), 'النجاح والرسوب');
    }
    XLSX.writeFile(wb, `${safeFile(title)}.xlsx`);
  };

  if (migrationMissing) return (<><ResultsHeader /><div className="card flex items-start gap-3 border-amber-200 bg-amber-50 text-amber-900"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><p className="text-sm font-bold">{MIGRATION_HINT}</p></div></>);

  const Empty = ({ text }: { text: string }) => <div className="card py-12 text-center text-sm text-slate-500">{text}</div>;
  const pctCell = (n: number | null) => (n === null ? '—' : `${fmtNum(Math.round(n * 10) / 10)}٪`);

  return (
    <>
      <div className="print:hidden">
        <ResultsHeader title="تقارير النتائج" actions={
          <div className="flex gap-1">
            {perms.export && <button type="button" id="rep-export" className="btn-secondary !py-1.5 text-xs" disabled={!data} onClick={exportExcel}><FileDown className="h-4 w-4" /> Excel</button>}
            <button type="button" id="rep-print" className="btn-secondary !py-1.5 text-xs" disabled={!data} onClick={() => window.print()}><Printer className="h-4 w-4" /></button>
          </div>
        } />
      </div>
      <Toast msg={toast} />

      {/* report type */}
      <section className="mb-3 grid grid-cols-3 gap-1.5 sm:grid-cols-6 print:hidden" role="tablist" aria-label="نوع التقرير">
        {KINDS.map((k) => (
          <button key={k.key} type="button" role="tab" aria-selected={kind === k.key} id={`rep-kind-${k.key}`} onClick={() => setKind(k.key)}
            className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-bold transition ${kind === k.key ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            <k.icon className="h-4 w-4" />{k.label}
          </button>
        ))}
      </section>

      {/* filters */}
      <section className="card mb-3 space-y-2 print:hidden">
        <ScopeSelectors idPrefix="rep" scope={scope} churches={churches} services={services} classes={classes} />
        <div className="grid gap-2 sm:grid-cols-4">
          {!multi ? (
            <div className="sm:col-span-2"><ExamPicker exams={filteredExams} value={examId} onChange={setExamId} id="rep-exam" /></div>
          ) : (
            <div className="flex items-center rounded-xl bg-slate-50 px-3 text-xs font-bold text-slate-600 sm:col-span-2">{filteredExams.length} امتحان في النطاق والفترة المحددة</div>
          )}
          <select id="rep-year" aria-label="العام الدراسي" className="input-field appearance-none text-sm" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="all">كل الأعوام</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-1">
            <input id="rep-from" type="date" aria-label="من تاريخ" className="input-field !px-2 text-xs" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input id="rep-to" type="date" aria-label="إلى تاريخ" className="input-field !px-2 text-xs" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        {(kind === 'results' || kind === 'ranking') && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {kind === 'results' && (['all', 'final', 'passed', 'failed'] as const).map((f) => (
              <button key={f} type="button" onClick={() => setStatusFilter(f)} className={`rounded-full px-2.5 py-1 font-bold ${statusFilter === f ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {f === 'all' ? 'الكل' : f === 'final' ? 'مكتمل فقط' : f === 'passed' ? 'ناجح' : 'راسب'}
              </button>
            ))}
            {kind === 'ranking' && (['percent', 'score'] as const).map((f) => (
              <button key={f} type="button" onClick={() => setRankBy(f)} className={`rounded-full px-2.5 py-1 font-bold ${rankBy === f ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {f === 'percent' ? 'بالنسبة' : 'بالمجموع'}
              </button>
            ))}
          </div>
        )}
      </section>

      {(loading || running) && <div className="flex justify-center py-10"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>}

      {!loading && !running && (
        <div id="rep-body">
          {/* print title */}
          <div className="hidden print:block mb-3">
            <h1 className="text-lg font-extrabold">{KINDS.find((k) => k.key === kind)?.label}{single ? ` — ${single.name}` : ''}</h1>
            <p className="text-xs text-slate-500">{new Date().toLocaleDateString('ar-EG')}</p>
          </div>

          {!multi && !single && <Empty text="اختر امتحاناً لعرض التقرير" />}
          {multi && (!data || !data.exams.length) && <Empty text="لا توجد امتحانات مطابقة للفلاتر" />}

          {/* RESULTS */}
          {kind === 'results' && single && singleStats && (
            <>
              <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                <Kpi label="المخدومون" value={singleStats.students} />
                <Kpi label="مكتمل" value={singleStats.completed} />
                <Kpi label="ناجح" value={singleStats.passed} tone="text-emerald-700" />
                <Kpi label="راسب" value={singleStats.failed} tone="text-red-600" />
                <Kpi label="نسبة النجاح" value={fmtPct(singleStats.passRate)} tone="text-emerald-700" />
                <Kpi label="المتوسط" value={fmtPct(singleStats.average)} />
              </div>
              <div className="card !p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm" id="rep-results-table">
                    <thead className="bg-slate-50 text-xs text-slate-500"><tr>
                      <th className="px-2 py-2 text-center font-bold">#</th><th className="px-3 py-2 text-right font-bold">المخدوم</th><th className="px-2 py-2 text-right font-bold">الفصل</th>
                      {singleSubjects.map((s) => <th key={s.id} className="px-2 py-2 text-center font-bold whitespace-nowrap">{s.name}<div className="font-normal">/{fmtNum(s.full_degree)}</div></th>)}
                      <th className="px-2 py-2 text-center font-bold">المجموع</th><th className="px-2 py-2 text-center font-bold">النسبة</th><th className="px-2 py-2 text-center font-bold">التقدير</th><th className="px-2 py-2 text-center font-bold">النتيجة</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {singleStudents.map((st) => (
                        <tr key={st.enrollment_id}>
                          <td className="px-2 py-1.5 text-center text-xs tabular-nums text-slate-500">{st.rank ?? '—'}</td>
                          <td className="px-3 py-1.5 font-bold">{st.name}<div className="text-[11px] font-normal text-slate-400">{st.national_id}</div></td>
                          <td className="px-2 py-1.5 text-xs text-slate-500">{className(st.class_id)}</td>
                          {singleSubjects.map((s) => { const r = rowsByKey.get(`${st.enrollment_id}|${s.id}`); const g = single.grade_subject ? gradeOf(grades, r?.grade_id) : null; return (
                            <td key={s.id} className={`px-2 py-1.5 text-center tabular-nums ${r && r.score !== null && r.score < s.pass_degree ? 'text-red-600' : ''}`}>
                              {!r ? <span className="text-slate-300">—</span> : r.status === 'absent' || r.status === 'excused' ? <span className="text-slate-400">غ</span> : fmtNum(r.score)}
                              {g && <div><GradePill name={g.name} color={g.color} /></div>}
                            </td>); })}
                          <td className="px-2 py-1.5 text-center font-bold tabular-nums">{st.total_score === null ? '—' : `${fmtNum(st.total_score)}/${fmtNum(st.total_full)}`}</td>
                          <td className="px-2 py-1.5 text-center tabular-nums">{fmtPct(st.percent)}</td>
                          <td className="px-2 py-1.5 text-center">{st.grade_name ? <GradePill name={st.grade_name} color={st.grade_color} /> : '—'}</td>
                          <td className="px-2 py-1.5 text-center"><StudentStatusBadge status={st.status} /></td>
                        </tr>
                      ))}
                      {singleStudents.length === 0 && <tr><td colSpan={7 + singleSubjects.length} className="py-8 text-center text-slate-500">لا توجد بيانات</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* RANKING */}
          {kind === 'ranking' && single && (
            <div className="card !p-0 overflow-hidden">
              <table className="w-full text-sm" id="rep-ranking-table">
                <thead className="bg-slate-50 text-xs text-slate-500"><tr>
                  <th className="px-3 py-2 text-right font-bold">الترتيب</th><th className="px-3 py-2 text-right font-bold">المخدوم</th><th className="px-2 py-2 text-right font-bold">الفصل</th><th className="px-2 py-2 text-center font-bold">المجموع</th><th className="px-2 py-2 text-center font-bold">النسبة</th><th className="px-2 py-2 text-center font-bold">التقدير</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {ranked.map((st) => { const r = rankBy === 'percent' ? st.rank : st.rank_score; return (
                    <tr key={st.enrollment_id} className={r !== null && r <= 3 ? 'bg-amber-50/40' : ''}>
                      <td className="px-3 py-1.5"><span className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-extrabold ${r === 1 ? 'bg-amber-400 text-white' : r === 2 ? 'bg-slate-300 text-slate-800' : r === 3 ? 'bg-amber-700 text-white' : 'bg-slate-100 text-slate-600'}`}>{rankLabel(r)}</span></td>
                      <td className="px-3 py-1.5 font-bold">{st.name}</td>
                      <td className="px-2 py-1.5 text-xs text-slate-500">{className(st.class_id)}</td>
                      <td className="px-2 py-1.5 text-center font-bold tabular-nums">{fmtNum(st.total_score)} / {fmtNum(st.total_full)}</td>
                      <td className="px-2 py-1.5 text-center tabular-nums">{fmtPct(st.percent)}</td>
                      <td className="px-2 py-1.5 text-center">{st.grade_name ? <GradePill name={st.grade_name} color={st.grade_color} /> : '—'}</td>
                    </tr>); })}
                  {ranked.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-slate-500">لا يوجد ترتيب بعد — يظهر الترتيب بعد اكتمال النتائج</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* SUBJECTS */}
          {kind === 'subjects' && single && (
            <div className="space-y-3">
              <div className="card"><BarChart id="rep-subjects-chart" items={subjectPerf.map((p) => ({ name: p.sb.name, count: p.avgPct === null ? 0 : Math.round(p.avgPct), color: (p.passRate ?? 100) < 50 ? '#dc2626' : '#059669' }))} /></div>
              <div className="card !p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm" id="rep-subjects-table">
                    <thead className="bg-slate-50 text-xs text-slate-500"><tr>
                      <th className="px-3 py-2 text-right font-bold">المادة</th><th className="px-2 py-2 text-center font-bold">أُدخل</th><th className="px-2 py-2 text-center font-bold">غائب</th><th className="px-2 py-2 text-center font-bold">المتوسط</th><th className="px-2 py-2 text-center font-bold">متوسط ٪</th><th className="px-2 py-2 text-center font-bold">ناجح</th><th className="px-2 py-2 text-center font-bold">راسب</th><th className="px-2 py-2 text-center font-bold">نسبة النجاح</th><th className="px-2 py-2 text-center font-bold">الأعلى</th><th className="px-2 py-2 text-center font-bold">الأقل</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {subjectPerf.map((p) => (
                        <tr key={p.sb.id}>
                          <td className="px-3 py-1.5 font-bold">{p.sb.name}<div className="text-[11px] font-normal text-slate-400">من {fmtNum(p.sb.full_degree)} · نجاح {fmtNum(p.sb.pass_degree)}</div></td>
                          <td className="px-2 py-1.5 text-center tabular-nums">{p.entered}</td><td className="px-2 py-1.5 text-center tabular-nums">{p.absent}</td>
                          <td className="px-2 py-1.5 text-center tabular-nums font-bold">{p.avg === null ? '—' : fmtNum(Math.round(p.avg * 100) / 100)}</td>
                          <td className="px-2 py-1.5 text-center tabular-nums">{pctCell(p.avgPct)}</td>
                          <td className="px-2 py-1.5 text-center tabular-nums text-emerald-700">{p.passed}</td><td className="px-2 py-1.5 text-center tabular-nums text-red-600">{p.failed}</td>
                          <td className="px-2 py-1.5 text-center tabular-nums">{pctCell(p.passRate)}</td>
                          <td className="px-2 py-1.5 text-center tabular-nums">{fmtNum(p.hi)}</td><td className="px-2 py-1.5 text-center tabular-nums">{fmtNum(p.lo)}</td>
                        </tr>
                      ))}
                      {subjectPerf.length === 0 && <tr><td colSpan={10} className="py-8 text-center text-slate-500">لا توجد مواد</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* CLASSES / SERVICES */}
          {kind === 'classes' && data && data.exams.length > 0 && (
            <div className="space-y-3">
              {[{ title: 'الفصول', rows: classPerf, id: 'rep-classes-table' }, { title: 'الخدمات', rows: servicePerf, id: 'rep-services-table' }].map((blk) => (
                <div key={blk.id} className="card !p-0 overflow-hidden">
                  <div className="border-b border-slate-100 px-3 py-2 text-sm font-extrabold">{blk.title}</div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm" id={blk.id}>
                      <thead className="bg-slate-50 text-xs text-slate-500"><tr>
                        <th className="px-3 py-2 text-right font-bold">الاسم</th><th className="px-2 py-2 text-center font-bold">المخدومون</th><th className="px-2 py-2 text-center font-bold">مكتمل</th><th className="px-2 py-2 text-center font-bold">ناجح</th><th className="px-2 py-2 text-center font-bold">راسب</th><th className="px-2 py-2 text-center font-bold">نسبة النجاح</th><th className="px-2 py-2 text-center font-bold">المتوسط</th><th className="px-2 py-2 text-center font-bold">الأعلى</th><th className="px-2 py-2 text-center font-bold">الأقل</th>
                      </tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {blk.rows.map((p) => (
                          <tr key={p.key}>
                            <td className="px-3 py-1.5 font-bold">{p.name}</td>
                            <td className="px-2 py-1.5 text-center tabular-nums">{p.students}</td><td className="px-2 py-1.5 text-center tabular-nums">{p.completed}</td>
                            <td className="px-2 py-1.5 text-center tabular-nums text-emerald-700">{p.passed}</td><td className="px-2 py-1.5 text-center tabular-nums text-red-600">{p.failed}</td>
                            <td className="px-2 py-1.5 text-center tabular-nums">{pctCell(p.passRate)}</td><td className="px-2 py-1.5 text-center tabular-nums font-bold">{pctCell(p.avg)}</td>
                            <td className="px-2 py-1.5 text-center tabular-nums">{pctCell(p.hi)}</td><td className="px-2 py-1.5 text-center tabular-nums">{pctCell(p.lo)}</td>
                          </tr>
                        ))}
                        {blk.rows.length === 0 && <tr><td colSpan={9} className="py-8 text-center text-slate-500">لا توجد بيانات</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* GRADES */}
          {kind === 'grades' && data && data.exams.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="card"><BarChart id="rep-grades-chart" items={gradeDist} /></div>
              <div className="card !p-0 overflow-hidden">
                <table className="w-full text-sm" id="rep-grades-table">
                  <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-right font-bold">التقدير</th><th className="px-2 py-2 text-center font-bold">العدد</th><th className="px-2 py-2 text-center font-bold">النسبة</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {gradeDist.map((g) => { const tot = gradeDist.reduce((a, b) => a + b.count, 0); return (
                      <tr key={g.name}><td className="px-3 py-1.5"><GradePill name={g.name} color={g.color} size="lg" /></td><td className="px-2 py-1.5 text-center font-bold tabular-nums">{g.count}</td><td className="px-2 py-1.5 text-center tabular-nums">{tot ? `${fmtNum(Math.round((g.count / tot) * 1000) / 10)}٪` : '—'}</td></tr>); })}
                    {gradeDist.length === 0 && <tr><td colSpan={3} className="py-8 text-center text-slate-500">لا توجد نتائج مكتملة</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* PASS / FAIL */}
          {kind === 'passfail' && data && data.exams.length > 0 && (
            <div className="card !p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm" id="rep-passfail-table">
                  <thead className="bg-slate-50 text-xs text-slate-500"><tr>
                    <th className="px-3 py-2 text-right font-bold">الامتحان</th><th className="px-2 py-2 text-center font-bold">المخدومون</th><th className="px-2 py-2 text-center font-bold">مكتمل</th><th className="px-2 py-2 text-center font-bold">ناجح</th><th className="px-2 py-2 text-center font-bold">راسب</th><th className="px-2 py-2 text-center font-bold">غائب</th><th className="px-2 py-2 text-center font-bold">لم يُدخل</th><th className="px-2 py-2 text-center font-bold">نسبة النجاح</th><th className="px-2 py-2 text-center font-bold">المتوسط</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {passFail.map(({ x, st }) => (
                      <tr key={x.id}>
                        <td className="px-3 py-1.5 font-bold">{x.name}<div className="text-[11px] font-normal text-slate-400">{fmtDate(x.exam_date)} · {churchName(x.church_id)}</div></td>
                        <td className="px-2 py-1.5 text-center tabular-nums">{st.students}</td><td className="px-2 py-1.5 text-center tabular-nums">{st.completed}</td>
                        <td className="px-2 py-1.5 text-center tabular-nums text-emerald-700">{st.passed}</td><td className="px-2 py-1.5 text-center tabular-nums text-red-600">{st.failed}</td>
                        <td className="px-2 py-1.5 text-center tabular-nums">{st.absent}</td><td className="px-2 py-1.5 text-center tabular-nums">{st.notEntered}</td>
                        <td className="px-2 py-1.5 text-center"><div className="mx-auto w-24"><div className="h-2 overflow-hidden rounded-full bg-red-100"><div className="h-full bg-emerald-500" style={{ width: `${st.passRate ?? 0}%` }} /></div><div className="text-[11px] tabular-nums">{fmtPct(st.passRate)}</div></div></td>
                        <td className="px-2 py-1.5 text-center tabular-nums font-bold">{fmtPct(st.average)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
