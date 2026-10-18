'use client';

// =====================================================================
// الافتقاد — calls tab of the statistics page (20261018120000)
//
//   1. KPIs          — calls · persons reached · feedbacks · messages ·
//                      servants · coverage of absentees
//   2. Coverage      — split bars: absentees called / not called;
//                      calls with feedback / without
//   3. Timeline      — calls · persons · feedbacks per bucket (line/area)
//   4. By servant | by class  (toggle)
//        servant → calls, persons, feedbacks, messages, days, classes
//        class   → coverage % of absentees, feedback %, callers
//   5. Feedback outcomes — donut by outcome (colors / icons of the
//                      call_feedbacks) incl. «أخرى» and «بدون نتيجة»
//   6. Persons       — who was called · who wasn't (filters + search),
//                      tap-to-call for the not-called ones
//   7. Excel         — the parent collects `exportRows()` from this tab
// =====================================================================

import { useCallback, useEffect, useImperativeHandle, useMemo, useState, forwardRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PhoneCall, Phone, Users, MessageSquareText, UserRound, BookOpen, Flag, ListChecks, TrendingUp, Search,
  PhoneMissed, PhoneOutgoing, CheckCircle2, CalendarDays, Sparkles,
} from 'lucide-react';
import { SectionCard, KpiTile, MiniStat, RankedBars, fmtNum } from '@/components/stats/Charts';
import {
  SegmentDonut, LineAreaChart, CoverageBar, PersonRow, ProgressTable, Chips, EmptyState, Avatar,
} from '@/components/stats/Charts2';
import { CallFeedbackIcon } from '@/components/CallFeedback';
import { bucketKeys, bucketLabel, bucketLongLabel, formatClock, pct, type Period } from '@/lib/stats';
import {
  fetchCallsSummary, fetchCallsByServant, fetchCallsByClass, fetchCallsByFeedback, fetchCallsTimeline, fetchCallsPersons,
  alignToKeys, formatDateTimeShort, ROLE_LABELS,
  type StatsFilter, type CallsSummary, type CallsByServantRow, type CallsByClassRow, type CallsByFeedbackRow,
  type CallsTimelineRow, type CallsPersonRow, type CallsPersonsFilter,
} from '@/lib/stats-period';

export interface TabHandle {
  reload: () => Promise<void>;
  exportSheets: () => { name: string; rows: Record<string, unknown>[] }[];
}

interface Props {
  supabase: SupabaseClient;
  period: Period;
  filter: StatsFilter;
  onError: (e: string | null) => void;
  onLoaded: () => void;
}

const PERSON_FILTERS: { value: CallsPersonsFilter; label: string }[] = [
  { value: 'not_called', label: 'لم يُفتقد' },
  { value: 'absent_not_called', label: 'غائب ولم يُفتقد' },
  { value: 'called', label: 'تم افتقاده' },
  { value: 'absent', label: 'الغائبون' },
  { value: 'all', label: 'الكل' },
];

const CallsTab = forwardRef<TabHandle, Props>(function CallsTab({ supabase, period, filter, onError, onLoaded }, ref) {
  const [summary, setSummary] = useState<CallsSummary | null>(null);
  const [byServant, setByServant] = useState<CallsByServantRow[]>([]);
  const [byClass, setByClass] = useState<CallsByClassRow[]>([]);
  const [byFeedback, setByFeedback] = useState<CallsByFeedbackRow[]>([]);
  const [timeline, setTimeline] = useState<CallsTimelineRow[]>([]);
  const [persons, setPersons] = useState<CallsPersonRow[]>([]);
  const [personsFilter, setPersonsFilter] = useState<CallsPersonsFilter>('not_called');
  const [groupBy, setGroupBy] = useState<'servant' | 'class'>('servant');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [personsLoading, setPersonsLoading] = useState(false);

  const loadMain = useCallback(async () => {
    const [s, sv, cl, fb, tl] = await Promise.all([
      fetchCallsSummary(supabase, period, filter),
      fetchCallsByServant(supabase, period, filter),
      fetchCallsByClass(supabase, period, filter),
      fetchCallsByFeedback(supabase, period, filter),
      fetchCallsTimeline(supabase, period, filter),
    ]);
    setSummary(s); setByServant(sv); setByClass(cl); setByFeedback(fb); setTimeline(tl);
  }, [supabase, period, filter]);

  const loadPersons = useCallback(async () => {
    setPersonsLoading(true);
    try { setPersons(await fetchCallsPersons(supabase, period, filter, personsFilter, 400)); }
    finally { setPersonsLoading(false); }
  }, [supabase, period, filter, personsFilter]);

  const reload = useCallback(async () => {
    onError(null);
    try {
      await Promise.all([loadMain(), loadPersons()]);
      onLoaded();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'تعذر تحميل إحصائيات الافتقاد');
    } finally {
      setLoading(false);
    }
  }, [loadMain, loadPersons, onError, onLoaded]);

  useEffect(() => { reload(); }, [reload]);

  // ---------- derived ----------
  const keys = useMemo(() => bucketKeys(period), [period]);
  const labels = useMemo(() => keys.map((k) => bucketLabel(k, period.bucket)), [keys, period.bucket]);
  const longLabels = useMemo(() => keys.map((k) => bucketLongLabel(k, period.bucket)), [keys, period.bucket]);
  const series = useMemo(() => [
    { key: 'calls', label: 'مكالمات', color: '#0d9488', values: alignToKeys(timeline, keys, (r) => r.calls) },
    { key: 'persons', label: 'أفراد', color: '#4f46e5', values: alignToKeys(timeline, keys, (r) => r.persons), dashed: true },
    { key: 'feedbacks', label: 'نتائج', color: '#f59e0b', values: alignToKeys(timeline, keys, (r) => r.feedbacks) },
    { key: 'messages', label: 'رسائل', color: '#ec4899', values: alignToKeys(timeline, keys, (r) => r.messages), dashed: true },
  ], [timeline, keys]);
  const bestBucket = useMemo(() => {
    const v = series[0].values; let bi = -1, bv = 0;
    v.forEach((x, i) => { if (x > bv) { bv = x; bi = i; } });
    return bi >= 0 ? { label: longLabels[bi], value: bv } : null;
  }, [series, longLabels]);

  const filteredPersons = useMemo(() => {
    const q = search.trim();
    if (!q) return persons;
    return persons.filter((p) => p.name.includes(q) || (p.class_name ?? '').includes(q) || (p.phone ?? '').includes(q));
  }, [persons, search]);

  const coverage = summary ? pct(summary.absentees_called, summary.absentees) : 0;
  const feedbackRate = summary ? pct(summary.persons_feedback, summary.persons_called) : 0;

  useImperativeHandle(ref, () => ({
    reload,
    exportSheets: () => [
      { name: 'الافتقاد — ملخص', rows: summary ? [
        { البند: 'المكالمات', القيمة: summary.calls },
        { البند: 'اتصالات بدون نتيجة', القيمة: summary.dials },
        { البند: 'النتائج المسجلة', القيمة: summary.feedbacks },
        { البند: 'نتائج «أخرى»', القيمة: summary.other_feedbacks },
        { البند: 'أفراد تم افتقادهم', القيمة: summary.persons_called },
        { البند: 'أفراد لهم نتيجة', القيمة: summary.persons_feedback },
        { البند: 'الرسائل', القيمة: summary.messages },
        { البند: 'أفراد وصلتهم رسائل', القيمة: summary.persons_messaged },
        { البند: 'الخدام المتصلون', القيمة: summary.servants },
        { البند: 'أيام بها مكالمات', القيمة: summary.days_with_calls },
        { البند: 'المخدومون في النطاق', القيمة: summary.scope_persons },
        { البند: 'الغائبون في الفترة', القيمة: summary.absentees },
        { البند: 'غائبون تم افتقادهم', القيمة: summary.absentees_called },
        { البند: 'نسبة افتقاد الغائبين %', القيمة: coverage },
        { البند: 'حاضرون تم الاتصال بهم', القيمة: summary.attendees_called },
      ] : [] },
      { name: 'الافتقاد حسب الخادم', rows: byServant.map((r, i) => ({
        الترتيب: i + 1, الخادم: r.servant_name, الدور: ROLE_LABELS[r.role ?? ''] ?? r.role ?? '', الفصل: r.class_name ?? '',
        المكالمات: r.calls, 'أفراد': r.persons_called, النتائج: r.feedbacks, '«أخرى»': r.other_feedbacks, الرسائل: r.messages,
        'فصول': r.classes_touched, 'أيام نشطة': r.days_active, 'أول مكالمة': formatDateTimeShort(r.first_call), 'آخر مكالمة': formatDateTimeShort(r.last_call),
      })) },
      { name: 'الافتقاد حسب الفصل', rows: byClass.map((r) => ({
        الكنيسة: r.church_name, الخدمة: r.service_name, الفصل: r.class_name, المسجلون: r.enrolled, الغائبون: r.absentees,
        المكالمات: r.calls, 'أفراد تم افتقادهم': r.persons_called, 'غائبون تم افتقادهم': r.absentees_called,
        'نسبة افتقاد الغائبين %': pct(r.absentees_called, r.absentees), 'نسبة الافتقاد من الفصل %': pct(r.persons_called, r.enrolled),
        النتائج: r.feedbacks, 'أفراد لهم نتيجة': r.persons_feedback, 'نسبة النتائج %': pct(r.persons_feedback, r.persons_called),
        الرسائل: r.messages, 'الخدام المتصلون': r.servants, 'آخر مكالمة': formatDateTimeShort(r.last_call),
      })) },
      { name: 'نتائج الافتقاد', rows: byFeedback.map((r) => ({
        النتيجة: r.feedback_name, النوع: r.feedback_kind === 'feedback' ? 'معرّفة' : r.feedback_kind === 'other' ? 'أخرى' : 'بدون نتيجة',
        'عدد المرات': r.entries, 'أفراد': r.persons, 'خدام': r.servants, 'آخر تسجيل': formatDateTimeShort(r.last_at),
      })) },
      { name: 'الافتقاد عبر الفترة', rows: keys.map((k, i) => ({
        الفترة: k, المكالمات: series[0].values[i], 'أفراد': series[1].values[i], النتائج: series[2].values[i], الرسائل: series[3].values[i],
      })) },
      { name: 'المخدومون — الافتقاد', rows: persons.map((p) => ({
        الاسم: p.name, الفصل: p.class_name ?? '', الهاتف: p.phone ?? '', 'حضور الفترة': p.attended, المكالمات: p.calls, النتائج: p.feedbacks,
        'آخر مكالمة': formatDateTimeShort(p.last_call_at), 'آخر متصل': p.last_caller ?? '', 'آخر نتيجة': p.last_feedback ?? '',
        الحالة: p.calls > 0 ? 'تم افتقاده' : p.attended === 0 ? 'غائب ولم يُفتقد' : 'لم يُفتقد',
      })) },
    ],
  }), [reload, summary, byServant, byClass, byFeedback, keys, series, persons, coverage]);

  if (loading) {
    return <div className="flex justify-center py-16"><span className="h-8 w-8 animate-spin rounded-full border-4 border-teal-200 border-t-teal-600" /></div>;
  }

  const sum = summary ?? ({} as CallsSummary);
  const tone = 'bg-teal-600';

  return (
    <div className="space-y-4">
      {/* ---------- 1. KPIs ---------- */}
      <section id="calls-kpis" className="grid grid-cols-2 gap-3">
        <KpiTile icon={PhoneCall} value={sum.calls ?? 0} label="مكالمات الافتقاد" tone="primary"
          hint={`${fmtNum(sum.persons_called ?? 0)} مخدوم · ${fmtNum(sum.days_with_calls ?? 0)} يوم`} />
        <KpiTile icon={CheckCircle2} value={sum.feedbacks ?? 0} label="نتائج مسجلة" tone="gold"
          hint={`${fmtNum(sum.persons_feedback ?? 0)} مخدوم · ${fmtNum(sum.other_feedbacks ?? 0)} «أخرى»`} />
        <KpiTile icon={Users} value={`${coverage}%`} label="افتقاد الغائبين" tone={coverage >= 75 ? 'emerald' : coverage >= 40 ? 'sky' : 'rose'}
          hint={`${fmtNum(sum.absentees_called ?? 0)} من ${fmtNum(sum.absentees ?? 0)} غائب`} />
        <KpiTile icon={MessageSquareText} value={sum.messages ?? 0} label="رسائل مُرسلة" tone="violet"
          hint={`${fmtNum(sum.persons_messaged ?? 0)} مخدوم · ${fmtNum(sum.servants ?? 0)} خادم متصل`} />
      </section>

      {/* ---------- 2. Coverage ---------- */}
      <SectionCard id="calls-coverage" icon={ListChecks} title="تغطية الافتقاد" subtitle="من تم افتقاده ومن لم يُفتقد في الفترة" tone="emerald">
        <div className="space-y-4">
          <CoverageBar
            label="الغائبون في الفترة"
            total={sum.absentees ?? 0}
            parts={[
              { key: 'called', label: 'تم افتقادهم', value: sum.absentees_called ?? 0, color: '#10b981' },
              { key: 'not', label: 'لم يُفتقدوا', value: Math.max(0, (sum.absentees ?? 0) - (sum.absentees_called ?? 0)), color: '#ef4444' },
            ]}
          />
          <CoverageBar
            label="كل المخدومين في النطاق"
            total={sum.scope_persons ?? 0}
            parts={[
              { key: 'abs-called', label: 'غائب وتم افتقاده', value: sum.absentees_called ?? 0, color: '#10b981' },
              { key: 'abs-not', label: 'غائب ولم يُفتقد', value: Math.max(0, (sum.absentees ?? 0) - (sum.absentees_called ?? 0)), color: '#ef4444' },
              { key: 'att-called', label: 'حاضر وتم الاتصال به', value: sum.attendees_called ?? 0, color: '#0ea5e9' },
              { key: 'att', label: 'حاضر', value: Math.max(0, (sum.scope_persons ?? 0) - (sum.absentees ?? 0) - (sum.attendees_called ?? 0)), color: '#cbd5e1' },
            ]}
          />
          <CoverageBar
            label="المكالمات حسب تسجيل النتيجة"
            total={sum.calls ?? 0}
            parts={[
              { key: 'fb', label: 'بنتيجة معرّفة', value: Math.max(0, (sum.feedbacks ?? 0) - (sum.other_feedbacks ?? 0)), color: '#f59e0b' },
              { key: 'other', label: '«أخرى»', value: sum.other_feedbacks ?? 0, color: '#f97316' },
              { key: 'dial', label: 'بدون نتيجة', value: sum.dials ?? 0, color: '#94a3b8' },
            ]}
          />
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="متوسط مكالمات / مخدوم" value={sum.persons_called ? (sum.calls / sum.persons_called).toFixed(1) : '0'} tone="primary" />
            <MiniStat label="نسبة المكالمات بنتيجة" value={`${pct(sum.feedbacks ?? 0, sum.calls ?? 0)}%`} tone="gold" />
            <MiniStat label="مخدومون لهم نتيجة" value={`${feedbackRate}%`} tone="emerald" />
          </div>
          {sum.first_call && (
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
              <CalendarDays className="h-3.5 w-3.5" /> أول مكالمة {formatDateTimeShort(sum.first_call)} · آخر مكالمة {formatDateTimeShort(sum.last_call)}
            </p>
          )}
        </div>
      </SectionCard>

      {/* ---------- 3. Timeline ---------- */}
      <SectionCard id="calls-timeline" icon={TrendingUp} title="الافتقاد عبر الفترة" subtitle="مكالمات · أفراد · نتائج · رسائل" tone="primary"
        actions={bestBucket ? <span className="badge bg-teal-100 text-teal-700"><Sparkles className="h-3 w-3" /> {fmtNum(bestBucket.value)}</span> : undefined}>
        <LineAreaChart id="calls-line" series={series} labels={labels} longLabels={longLabels} emptyText="لا توجد مكالمات في هذه الفترة" />
        {bestBucket && <p className="mt-2 rounded-xl bg-teal-50 px-3 py-1.5 text-[11px] font-extrabold text-teal-700">أعلى نشاط افتقاد: {bestBucket.label} — {fmtNum(bestBucket.value)} مكالمة</p>}
      </SectionCard>

      {/* ---------- 4. By servant | by class ---------- */}
      <SectionCard
        id="calls-group"
        icon={groupBy === 'servant' ? UserRound : BookOpen}
        title={groupBy === 'servant' ? 'الافتقاد حسب الخادم' : 'الافتقاد حسب الفصل'}
        subtitle={groupBy === 'servant' ? 'من اتصل · كم مكالمة · كم نتيجة' : 'نسبة افتقاد غائبي كل فصل ونسبة النتائج'}
        tone="violet"
        actions={
          <div className="flex items-center gap-0.5 rounded-xl bg-slate-100 p-0.5">
            <button type="button" onClick={() => setGroupBy('servant')} className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-extrabold ${groupBy === 'servant' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}><UserRound className="h-3 w-3" /> خادم</button>
            <button type="button" onClick={() => setGroupBy('class')} className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-extrabold ${groupBy === 'class' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}><BookOpen className="h-3 w-3" /> فصل</button>
          </div>
        }
      >
        {groupBy === 'servant' ? (
          byServant.length === 0 ? <EmptyState text="لا توجد مكالمات مسجلة في هذه الفترة" /> : (
            <>
              <ul className="space-y-2">
                {byServant.map((r, i) => {
                  const maxCalls = Math.max(1, ...byServant.map((x) => x.calls));
                  return (
                    <li key={r.servant_id ?? `none-${i}`} className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${i === 0 ? 'bg-gold-100 text-gold-700' : i === 1 ? 'bg-slate-200 text-slate-600' : i === 2 ? 'bg-orange-100 text-orange-600' : 'bg-white text-slate-500 ring-1 ring-slate-100'}`}>{i + 1}</span>
                        <Avatar url={r.photo_url} name={r.servant_name} tone="from-violet-600 to-fuchsia-500" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-extrabold text-slate-800">{r.servant_name}</p>
                          <p className="truncate text-[10px] font-bold text-slate-400">
                            {ROLE_LABELS[r.role ?? ''] ?? r.role ?? ''}{r.class_name ? ` · ${r.class_name}` : ''} · {fmtNum(r.days_active)} يوم نشط · {fmtNum(r.classes_touched)} فصل
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                          <span className="badge bg-teal-100 text-teal-700"><PhoneCall className="h-3 w-3" /> {fmtNum(r.calls)}</span>
                          <span className="text-[10px] font-bold text-slate-400">{fmtNum(r.persons_called)} مخدوم</span>
                        </div>
                      </div>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white">
                        <div className="flex h-full">
                          <div className="h-full bg-gold-500" style={{ width: `${((r.feedbacks - r.other_feedbacks) / maxCalls) * 100}%` }} title="نتيجة معرّفة" />
                          <div className="h-full bg-orange-500" style={{ width: `${(r.other_feedbacks / maxCalls) * 100}%` }} title="أخرى" />
                          <div className="h-full bg-teal-500" style={{ width: `${((r.calls - r.feedbacks) / maxCalls) * 100}%` }} title="بدون نتيجة" />
                        </div>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-bold text-slate-500">
                        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gold-500" /> نتائج {fmtNum(r.feedbacks)} ({pct(r.feedbacks, r.calls)}%)</span>
                        {r.other_feedbacks > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-500" /> أخرى {fmtNum(r.other_feedbacks)}</span>}
                        <span className="flex items-center gap-1"><MessageSquareText className="h-3 w-3 text-pink-500" /> رسائل {fmtNum(r.messages)}</span>
                        {r.last_call && <span className="mr-auto tabular-nums text-slate-400">آخر مكالمة {formatDateTimeShort(r.last_call)}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 flex items-center gap-2 text-[10px] font-bold text-slate-400">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gold-500" /> بنتيجة</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-500" /> أخرى</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-teal-500" /> بدون نتيجة</span>
              </div>
            </>
          )
        ) : (
          <>
            <ProgressTable
              id="calls-by-class"
              rows={[...byClass]
                .sort((a, b) => pct(b.absentees_called, b.absentees) - pct(a.absentees_called, a.absentees) || b.calls - a.calls)
                .map((r) => ({
                  key: r.class_id,
                  label: r.class_name,
                  sublabel: `${r.church_name} › ${r.service_name} · ${fmtNum(r.calls)} مكالمة · ${fmtNum(r.servants)} خادم · نتائج ${pct(r.persons_feedback, r.persons_called)}% · رسائل ${fmtNum(r.messages)}${r.last_call ? ` · آخر ${formatDateTimeShort(r.last_call)}` : ''}`,
                  num: r.absentees_called,
                  den: r.absentees,
                  extra: (
                    <span className="hidden items-center gap-1 xs:flex">
                      <span className="badge bg-teal-100 text-teal-700"><PhoneCall className="h-3 w-3" /> {fmtNum(r.persons_called)}/{fmtNum(r.enrolled)}</span>
                      <span className="badge bg-gold-100 text-gold-700"><CheckCircle2 className="h-3 w-3" /> {fmtNum(r.feedbacks)}</span>
                    </span>
                  ),
                }))}
              numLabel={(r) => `${fmtNum(r.num)} من ${fmtNum(r.den)} غائب`}
              emptyText="لا توجد فصول في النطاق"
            />
            <p className="mt-2 text-[10px] font-bold text-slate-400">الشريط = نسبة الغائبين الذين تم افتقادهم في كل فصل · الشارات: المفتقَدون من المسجلين · النتائج المسجلة</p>
          </>
        )}
      </SectionCard>

      {/* ---------- 5. Feedback outcomes ---------- */}
      <SectionCard id="calls-feedback" icon={Flag} title="نتائج الافتقاد" subtitle="توزيع المكالمات حسب النتيجة المسجلة" tone="gold"
        actions={<span className="badge bg-gold-100 text-gold-700">{fmtNum(byFeedback.filter((f) => f.feedback_kind === 'feedback').length)} نتيجة</span>}>
        <SegmentDonut
          id="calls-donut"
          centerLabel="مكالمة"
          segments={byFeedback.map((f) => ({
            key: `${f.feedback_kind}-${f.feedback_id ?? 'x'}`,
            label: f.feedback_name,
            value: f.entries,
            color: f.color,
            icon: <CallFeedbackIcon icon={f.icon} className="h-3 w-3" />,
          }))}
          emptyText="لم تُسجّل مكالمات في هذه الفترة"
        />
        {byFeedback.length > 0 && (
          <div className="mt-3">
            <RankedBars
              items={byFeedback.map((f) => ({
                key: `${f.feedback_kind}-${f.feedback_id ?? 'x'}`,
                label: f.feedback_name,
                value: f.entries,
                color: f.color,
                sublabel: `${fmtNum(f.persons)} مخدوم · ${fmtNum(f.servants)} خادم`,
                secondary: f.last_at ? `آخر ${formatDateTimeShort(f.last_at)}` : '',
              }))}
            />
          </div>
        )}
      </SectionCard>

      {/* ---------- 6. Persons ---------- */}
      <SectionCard id="calls-persons" icon={personsFilter === 'called' ? PhoneOutgoing : PhoneMissed}
        title={personsFilter === 'called' ? 'من تم افتقاده' : personsFilter === 'all' ? 'كل المخدومين' : personsFilter === 'absent' ? 'الغائبون في الفترة' : 'من لم يُفتقد'}
        subtitle={`${fmtNum(filteredPersons.length)} مخدوم · اضغط الهاتف للاتصال`} tone={personsFilter === 'called' ? 'emerald' : 'rose'}>
        <Chips tone={tone} value={personsFilter} onChange={setPersonsFilter} options={PERSON_FILTERS} />
        <label className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <Search className="h-4 w-4 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم أو الفصل أو الهاتف" className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none" />
        </label>
        {personsLoading ? (
          <div className="flex justify-center py-8"><span className="h-6 w-6 animate-spin rounded-full border-4 border-teal-200 border-t-teal-600" /></div>
        ) : filteredPersons.length === 0 ? (
          <div className="mt-3"><EmptyState text={personsFilter === 'not_called' || personsFilter === 'absent_not_called' ? 'تم افتقاد الجميع ✓' : 'لا يوجد مخدومون'} /></div>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {filteredPersons.slice(0, 150).map((p) => (
              <PersonRow
                key={p.enrollment_id}
                url={p.image_url}
                name={p.name}
                highlight={p.calls > 0 ? 'emerald' : p.attended === 0 ? 'rose' : null}
                sub={
                  <>
                    {p.class_name ?? ''}{p.class_name ? ' · ' : ''}
                    {p.attended > 0 ? `حضر ${fmtNum(p.attended)}` : 'غائب طوال الفترة'}
                    {p.last_call_at ? ` · آخر مكالمة ${formatDateTimeShort(p.last_call_at)}${p.last_caller ? ` (${p.last_caller})` : ''}` : ''}
                  </>
                }
                badges={
                  <>
                    {p.calls > 0 ? <span className="badge bg-teal-100 text-teal-700"><PhoneCall className="h-3 w-3" /> {fmtNum(p.calls)}</span> : <span className="badge bg-rose-100 text-rose-700"><PhoneMissed className="h-3 w-3" /> لم يُفتقد</span>}
                    {p.last_feedback && (
                      <span className="badge text-white" style={{ background: p.last_feedback_color ?? '#64748b' }}>{p.last_feedback.slice(0, 18)}</span>
                    )}
                  </>
                }
                trailing={p.phone ? (
                  <a href={`tel:${p.phone}`} className="rounded-xl bg-white p-2 text-teal-700 ring-1 ring-teal-100 hover:bg-teal-50" aria-label={`اتصال بـ ${p.name}`}><Phone className="h-4 w-4" /></a>
                ) : undefined}
              />
            ))}
            {filteredPersons.length > 150 && <li className="py-2 text-center text-[11px] font-bold text-slate-400">و{fmtNum(filteredPersons.length - 150)} آخرون — صدّر Excel للقائمة الكاملة</li>}
          </ul>
        )}
      </SectionCard>

      <p className="text-center text-[10px] font-bold text-slate-300">{formatClock(sum.last_call) ? `آخر مكالمة في الفترة ${formatClock(sum.last_call)}` : ''}</p>
    </div>
  );
});

export default CallsTab;
