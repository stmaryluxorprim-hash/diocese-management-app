'use client';

// ---------- EXAM RESULTS — exams list (الامتحانات) ----------
// Scoped church → service → class selectors, search, status filter, KPIs.
// Each card: name · date · scope · status · lock · subjects count · entered
// results. Actions: open · duplicate · delete. «امتحان جديد» → ExamFormModal.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Search, Loader2, ClipboardList, Copy, Trash2, CalendarDays, BookOpen, Users, ChevronLeft, Lock } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { ScopeSelectors, useScopeState } from '@/components/store/StoreBits';
import { ResultsHeader, StatusBadge, Toast, ConfirmModal, useResultLookups } from '@/components/results/ResultBits';
import ExamFormModal from '@/components/results/ExamFormModal';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import {
  fetchResultExams, fetchResultPermissions, fetchGradingSystems, fetchSubjectsOf, duplicateResultExam, deleteResultExam,
  isMigrationMissing, MIGRATION_HINT, resultErrorMessage, examScopeLabel, fmtDate, EXAM_STATUS_LABELS, NO_PERMISSIONS,
  type ResultExam, type ResultPermissions, type GradingSystem, type ResultExamStatus,
} from '@/lib/results';

type Filter = 'all' | ResultExamStatus | 'locked';

export default function ResultsExamsPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { churches, services, classes } = useResultLookups(supabase, approved);
  const scope = useScopeState();

  const [exams, setExams] = useState<ResultExam[]>([]);
  const [subjectCounts, setSubjectCounts] = useState<Map<string, number>>(new Map());
  const [resultCounts, setResultCounts] = useState<Map<string, number>>(new Map());
  const [systems, setSystems] = useState<GradingSystem[]>([]);
  const [perms, setPerms] = useState<ResultPermissions>(NO_PERMISSIONS);
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [form, setForm] = useState<{ open: boolean; exam: ResultExam | null }>({ open: false, exam: null });
  const [confirmDel, setConfirmDel] = useState<ResultExam | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  const load = useCallback(async () => {
    try {
      const [rows, p, gs] = await Promise.all([
        fetchResultExams(supabase, { church: scope.church, service: scope.service, classes: scope.classes }),
        fetchResultPermissions(supabase),
        fetchGradingSystems(supabase),
      ]);
      setExams(rows); setPerms(p); setSystems(gs);
      const ids = rows.map((r) => r.id);
      const subs = await fetchSubjectsOf(supabase, ids);
      const sc = new Map<string, number>();
      subs.forEach((s) => sc.set(s.exam_id, (sc.get(s.exam_id) ?? 0) + 1));
      setSubjectCounts(sc);
      if (ids.length) {
        const { data } = await supabase.from('exam_results').select('exam_id, enrollment_id').in('exam_id', ids).limit(20000);
        const per = new Map<string, Set<string>>();
        ((data ?? []) as { exam_id: string; enrollment_id: string }[]).forEach((r) => {
          if (!per.has(r.exam_id)) per.set(r.exam_id, new Set());
          per.get(r.exam_id)!.add(r.enrollment_id);
        });
        setResultCounts(new Map(Array.from(per.entries()).map(([k, v]) => [k, v.size])));
      } else setResultCounts(new Map());
      setMigrationMissing(false);
    } catch (err) {
      if (isMigrationMissing(err)) setMigrationMissing(true);
      else flash(resultErrorMessage(err, 'تعذر التحميل'));
    } finally {
      setLoading(false);
    }
  }, [supabase, scope.church, scope.service, scope.classes]);

  useEffect(() => { if (approved) load(); }, [approved, load]);
  useDebouncedRealtime(supabase, 'results-exams', [{ table: 'result_exams' }, { table: 'result_subjects' }, { table: 'exam_results' }], load, { enabled: approved, delayMs: 800 });

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return exams.filter((x) =>
      (filter === 'all' || (filter === 'locked' ? x.locked : x.status === filter)) &&
      (!s || x.name.toLowerCase().includes(s) || (x.academic_year ?? '').includes(s) || (x.description ?? '').toLowerCase().includes(s))
    );
  }, [exams, search, filter]);

  const kpis = useMemo(() => ({
    open: exams.filter((x) => x.status === 'open').length,
    completed: exams.filter((x) => x.status === 'completed').length,
    locked: exams.filter((x) => x.locked).length,
  }), [exams]);

  const duplicate = async (x: ResultExam) => {
    const name = prompt('اسم الامتحان الجديد', `${x.name} (نسخة)`);
    if (name === null) return;
    setBusy(x.id);
    try {
      const id = await duplicateResultExam(supabase, x.id, name);
      flash('تم إنشاء النسخة');
      router.push(`/results/${id}`);
    } catch (e) { flash(resultErrorMessage(e, 'تعذر النسخ')); }
    finally { setBusy(null); }
  };

  const remove = async () => {
    if (!confirmDel) return;
    setBusy(confirmDel.id);
    try {
      await deleteResultExam(supabase, confirmDel.id);
      setExams((l) => l.filter((x) => x.id !== confirmDel.id));
      flash('تم حذف الامتحان');
      setConfirmDel(null);
    } catch (e) { flash(resultErrorMessage(e, 'تعذر الحذف')); }
    finally { setBusy(null); }
  };

  const FILTERS: { value: Filter; label: string }[] = [
    { value: 'all', label: 'الكل' },
    ...(Object.keys(EXAM_STATUS_LABELS) as ResultExamStatus[]).map((s) => ({ value: s as Filter, label: EXAM_STATUS_LABELS[s] })),
    { value: 'locked', label: 'مقفل' },
  ];

  return (
    <AppShell>
      <ResultsHeader badge={<span className="badge bg-emerald-100 text-emerald-700 tabular-nums">{exams.length}</span>} />

      {migrationMissing && <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">⚠️ {MIGRATION_HINT}</p>}

      <section className="mb-3 grid grid-cols-3 gap-2">
        <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-emerald-600">{kpis.open}</p><p className="text-[10px] font-bold text-slate-400">مفتوح للنتائج</p></div>
        <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-sky-600">{kpis.completed}</p><p className="text-[10px] font-bold text-slate-400">مكتمل</p></div>
        <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-slate-700">{kpis.locked}</p><p className="text-[10px] font-bold text-slate-400">مقفل</p></div>
      </section>

      <div className="relative mb-2">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input id="rx-search" className="input-field pr-9" placeholder="ابحث بالاسم أو العام الدراسي…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ScopeSelectors idPrefix="rx" scope={scope} churches={churches} services={services} classes={classes} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {perms.manage_exams && (
          <button id="rx-add" type="button" onClick={() => setForm({ open: true, exam: null })}
            className="btn-primary flex items-center gap-1.5 !py-2 !px-3 text-sm !from-emerald-600 !to-emerald-500">
            <Plus className="h-4 w-4" /> امتحان جديد
          </button>
        )}
        <div id="rx-filters" className="mr-auto flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button key={f.value} type="button" onClick={() => setFilter(f.value)} aria-pressed={filter === f.value}
              className={`rounded-full px-3 py-1 text-xs font-extrabold ${filter === f.value ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-500" /></div>
      ) : visible.length === 0 ? (
        <div className="card py-12 text-center text-slate-400">
          <ClipboardList className="mx-auto mb-3 h-10 w-10 text-emerald-200" />
          <p className="font-bold">{exams.length === 0 ? 'لا توجد امتحانات بعد' : 'لا نتائج'}</p>
          {exams.length === 0 && perms.manage_exams && (
            <p className="mt-2 text-xs font-bold text-slate-400">ابدأ بـ «امتحان جديد» ثم أضف المواد وحدد نظام التقدير، ثم أدخل النتائج جماعياً</p>
          )}
        </div>
      ) : (
        <div id="rx-list" className="space-y-2">
          {visible.map((x) => {
            const nSub = subjectCounts.get(x.id) ?? 0;
            const nRes = resultCounts.get(x.id) ?? 0;
            return (
              <div key={x.id} id={`rx-item-${x.id}`} className="card flex items-start gap-3 !p-3">
                <Link href={`/results/${x.id}`} className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate font-extrabold">{x.name}</p>
                    <StatusBadge status={x.status} locked={x.locked} />
                  </div>
                  <p className="mt-0.5 truncate text-[11px] font-bold text-slate-400">{examScopeLabel(x, churches, services, classes)}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-slate-500">
                    <span className="badge bg-slate-100 text-slate-600"><CalendarDays className="h-3 w-3" /> {fmtDate(x.exam_date)}</span>
                    {x.academic_year && <span className="badge bg-slate-100 text-slate-600">{x.academic_year}</span>}
                    <span className={`badge ${nSub ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}><BookOpen className="h-3 w-3" /> {nSub} مادة</span>
                    <span className="badge bg-sky-50 text-sky-700"><Users className="h-3 w-3" /> {nRes} مخدوم له نتائج</span>
                    {x.published_at && <span className="badge bg-violet-50 text-violet-700">منشور للمخدومين</span>}
                  </div>
                </Link>
                <div className="flex flex-col items-center gap-1">
                  <Link href={`/results/${x.id}`} aria-label="فتح" className="rounded-full bg-emerald-50 p-2 text-emerald-600 hover:bg-emerald-100"><ChevronLeft className="h-4 w-4" /></Link>
                  {perms.manage_exams && (
                    <button type="button" aria-label="نسخ" disabled={busy === x.id} onClick={() => duplicate(x)} className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"><Copy className="h-4 w-4" /></button>
                  )}
                  {perms.manage_exams && !x.locked && (
                    <button type="button" aria-label="حذف" disabled={busy === x.id} onClick={() => setConfirmDel(x)} className="rounded-full bg-red-50 p-2 text-red-500 hover:bg-red-100"><Trash2 className="h-4 w-4" /></button>
                  )}
                  {x.locked && <span className="rounded-full bg-slate-800 p-2 text-white" title="مقفل"><Lock className="h-4 w-4" /></span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {form.open && (
        <ExamFormModal
          exam={form.exam} churches={churches} services={services} classes={classes} gradingSystems={systems}
          initialScope={{ church: scope.church, service: scope.service, classes: scope.classes }}
          onClose={() => setForm({ open: false, exam: null })}
          onSaved={(saved) => {
            setForm({ open: false, exam: null });
            flash('تم إنشاء الامتحان — أضف المواد الآن');
            router.push(`/results/${saved.id}?tab=subjects`);
          }}
        />
      )}
      {confirmDel && (
        <ConfirmModal
          title="حذف الامتحان"
          desc={<>سيُحذف امتحان «{confirmDel.name}» مع كل مواده و<b>{resultCounts.get(confirmDel.id) ?? 0}</b> مخدوم له نتائج فيه. لا يمكن التراجع.</>}
          confirmLabel="حذف نهائياً" busy={busy === confirmDel.id} onConfirm={remove} onClose={() => setConfirmDel(null)}
        />
      )}
      <Toast msg={toast} />
    </AppShell>
  );
}
