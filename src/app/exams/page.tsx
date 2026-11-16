'use client';

// ---------- EXAMS MODULE HUB (الامتحانات) ----------
// Every exam in the caller's scope (RLS), with status, questions count and
// attempt stats. Scope selectors + status filter + search. «امتحان جديد»
// opens the settings form; tapping an exam opens its page (questions ·
// results · settings).

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plus, Search, Loader2, GraduationCap, ChevronLeft, ListChecks, Users, Trophy, Clock, Copy, Shuffle,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { ExamsHeader, StatusBadge, Toast, scopeLabel } from '@/components/exams/ExamBits';
import ExamFormModal from '@/components/exams/ExamFormModal';
import { ScopeSelectors, useScopeState, useStoreLookups } from '@/components/store/StoreBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import {
  fetchExams, fetchQuestionCounts, fetchAttemptStats, duplicateExam, examErrorMessage, isMigrationMissing,
  MIGRATION_HINT, EXAM_STATUS_LABELS, fmtSeconds, examIsOpen, type Exam, type ExamStatus,
} from '@/lib/exams';

type StatusFilter = 'all' | ExamStatus;

export default function ExamsHubPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { churches, services, classes } = useStoreLookups(supabase, approved);
  const scope = useScopeState();

  const [exams, setExams] = useState<Exam[]>([]);
  const [qCounts, setQCounts] = useState<Map<string, number>>(new Map());
  const [aStats, setAStats] = useState<Map<string, { total: number; passed: number; inProgress: number }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [form, setForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async () => {
    try {
      const rows = await fetchExams(supabase, { church: scope.church, service: scope.service, classes: scope.classes });
      setExams(rows);
      const ids = rows.map((r) => r.id);
      const [qc, as] = await Promise.all([fetchQuestionCounts(supabase, ids), fetchAttemptStats(supabase, ids)]);
      setQCounts(qc); setAStats(as);
      setMigrationMissing(false);
    } catch (e) {
      if (isMigrationMissing(e)) setMigrationMissing(true);
    } finally {
      setLoading(false);
    }
  }, [supabase, scope.church, scope.service, scope.classes]);

  useEffect(() => { if (approved) load(); }, [approved, load]);
  useDebouncedRealtime(
    supabase, 'exams-hub', [{ table: 'exams' }, { table: 'exam_questions' }, { table: 'exam_attempts' }], load,
    { enabled: approved, delayMs: 800 }
  );

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return exams.filter((x) => (status === 'all' || x.status === status) && (!s || x.title.toLowerCase().includes(s)));
  }, [exams, search, status]);

  const kpis = useMemo(() => {
    let attempts = 0, passed = 0;
    aStats.forEach((s) => { attempts += s.total; passed += s.passed; });
    return {
      total: exams.length,
      open: exams.filter((x) => examIsOpen(x)).length,
      attempts,
      passRate: attempts ? Math.round((passed * 100) / attempts) : null,
    };
  }, [exams, aStats]);

  const duplicate = async (x: Exam) => {
    setBusy(x.id);
    try {
      const id = await duplicateExam(supabase, x.id);
      flash('تم إنشاء نسخة كمسودة');
      router.push(`/exams/${id}`);
    } catch (e) {
      flash(examErrorMessage(e, 'تعذر النسخ'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <AppShell>
      <ExamsHeader
        back="/settings"
        badge={<span className="badge bg-violet-100 text-violet-700 tabular-nums">{exams.length}</span>}
        info="أنشئ امتحان اختيار من متعدد، أضف الأسئلة مع الإجابة الصحيحة والدرجة والوقت، وحدد شرط النجاح والنقاط — ثم انشره ليظهر للمخدومين في بوابتهم. النتائج تظهر هنا لحظياً."
        actions={
          <button id="exam-new" type="button" onClick={() => setForm(true)} className="btn-primary flex items-center gap-1.5 !py-2 !px-3 text-sm !from-violet-600 !to-violet-500">
            <Plus className="h-4 w-4" /> امتحان جديد
          </button>
        }
      />

      {migrationMissing && (
        <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">⚠️ {MIGRATION_HINT}</p>
      )}

      <section id="exams-stats" className="mb-3 grid grid-cols-4 gap-2">
        {[
          { label: 'امتحان', value: kpis.total, icon: GraduationCap },
          { label: 'متاح الآن', value: kpis.open, icon: Clock },
          { label: 'محاولة', value: kpis.attempts, icon: Users },
          { label: 'نسبة النجاح', value: kpis.passRate === null ? '—' : `${kpis.passRate}٪`, icon: Trophy },
        ].map((k) => (
          <div key={k.label} className="card !p-2 text-center">
            <p className="text-lg font-extrabold tabular-nums text-violet-600">{loading ? '…' : k.value}</p>
            <p className="text-[10px] font-bold text-slate-400">{k.label}</p>
          </div>
        ))}
      </section>

      <div className="relative mb-2">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input id="exams-search" className="input-field pr-9" placeholder="ابحث بعنوان الامتحان…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ScopeSelectors idPrefix="exams" scope={scope} churches={churches} services={services} classes={classes} />

      <div className="mb-3 flex gap-1.5 overflow-x-auto no-scrollbar">
        {(['all', 'published', 'draft', 'closed'] as StatusFilter[]).map((s) => (
          <button key={s} type="button" id={`exams-filter-${s}`} onClick={() => setStatus(s)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-extrabold transition ${status === s ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>
            {s === 'all' ? 'الكل' : EXAM_STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-violet-500" /></div>
      ) : visible.length === 0 ? (
        <div className="card py-12 text-center text-slate-400">
          <GraduationCap className="mx-auto mb-3 h-10 w-10 text-violet-200" />
          <p className="font-bold">{exams.length === 0 ? 'لا توجد امتحانات بعد — أنشئ أول امتحان' : 'لا نتائج'}</p>
        </div>
      ) : (
        <div id="exams-list" className="space-y-2">
          {visible.map((x) => {
            const qc = qCounts.get(x.id) ?? 0;
            const st = aStats.get(x.id) ?? { total: 0, passed: 0, inProgress: 0 };
            const open = examIsOpen(x);
            return (
              <div key={x.id} id={`exam-row-${x.id}`} className={`card !p-0 overflow-hidden ${x.status === 'draft' ? 'opacity-90' : ''}`}>
                <Link href={`/exams/${x.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-violet-50/40">
                  <span className={`rounded-xl p-2.5 ${open ? 'bg-emerald-50 text-emerald-600' : 'bg-violet-50 text-violet-500'}`}>
                    <GraduationCap className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-extrabold">{x.title}</span>
                      <StatusBadge status={x.status} />
                      {open && <span className="badge bg-emerald-100 text-emerald-700">متاح الآن</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] font-bold text-slate-400">{scopeLabel(x, churches, services, classes)}</span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="badge bg-slate-100 text-slate-600"><ListChecks className="h-3 w-3" /> {qc} سؤال</span>
                      {x.question_mode === 'random' && <span className="badge bg-amber-100 text-amber-700"><Shuffle className="h-3 w-3" /> {Math.min(x.random_count, qc)} عشوائي</span>}
                      <span className="badge bg-slate-100 text-slate-600"><Clock className="h-3 w-3" /> {fmtSeconds(x.default_seconds)}/سؤال</span>
                      <span className="badge bg-primary-100 text-primary-700"><Users className="h-3 w-3" /> {st.total} {st.inProgress ? `· ${st.inProgress} جارٍ` : ''}</span>
                      {st.total > 0 && <span className="badge bg-emerald-100 text-emerald-700"><Trophy className="h-3 w-3" /> {st.passed} ناجح</span>}
                    </span>
                  </span>
                  <ChevronLeft className="h-4 w-4 shrink-0 text-slate-300" />
                </Link>
                <div className="flex items-center justify-end gap-1 border-t border-violet-50 bg-slate-50/60 px-2 py-1">
                  <button type="button" disabled={busy === x.id} onClick={() => duplicate(x)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-500 hover:bg-white">
                    {busy === x.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />} نسخة
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {form && (
        <ExamFormModal
          exam={null} churches={churches} services={services} classes={classes}
          onClose={() => setForm(false)}
          onSaved={(saved) => { setForm(false); router.push(`/exams/${saved.id}`); }}
        />
      )}
      <Toast msg={toast} />
    </AppShell>
  );
}
