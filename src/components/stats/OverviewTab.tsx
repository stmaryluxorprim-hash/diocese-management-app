'use client';

// =====================================================================
// نظرة عامة — overview tab of the statistics page.
// This is the original 0020 الإحصائيات screen, unchanged in content,
// now rendered as a tab: headline KPIs, gender split, the selected day
// (by event / by cause / by class), timelines, weekday profile and the
// leaderboard. Scope / day / period come from the parent page.
// =====================================================================

import { useCallback, useEffect, useImperativeHandle, useMemo, useState, forwardRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  Users, Star, CalendarCheck, CalendarDays, Trophy, TrendingUp, Layers, Flag, Tag, Rows3, Columns3,
  Sparkles, Clock, Percent, UserRound, Sigma, Activity, BookOpen, Loader2,
} from 'lucide-react';
import { WEEKDAY_LABELS, WEEKDAY_SHORT } from '@/lib/time';
import {
  fetchScopeSummary, fetchDaySummary, fetchAttendanceByEvent, fetchPointsByCause,
  fetchAttendanceTimeline, fetchPointsTimeline, fetchAttendanceByClass, fetchLeaderboard,
  fetchWeekdayProfile, buildSeries, bucketKeys, bucketLabel, bucketLongLabel,
  formatDay, formatClock, pct, BUCKET_LABELS,
  type ScopeSummary, type DaySummary, type EventDayRow, type CauseDayRow,
  type AttendanceTimelineRow, type PointsTimelineRow, type ClassDayRow, type LeaderRow,
  type WeekdayRow, type Period,
} from '@/lib/stats';
import type { ScopeSelection } from '@/lib/queries';
import {
  SectionCard, KpiTile, StackedBarChart, RankedBars, DonutRing, MiniStat, fmtNum, fmtSigned,
} from '@/components/stats/Charts';
import type { TabHandle } from '@/components/stats/CallsTab';

const SCOPE_LABEL: Record<'church' | 'service' | 'class', string> = {
  church: 'كل الكنيسة',
  service: 'كل الخدمة',
  class: 'فصل',
};

interface Props {
  supabase: SupabaseClient;
  scope: ScopeSelection;
  scopeText: string;
  day: string;
  period: Period;
  churchNames: Record<string, string>;
  onError: (e: string | null) => void;
  onLoaded: () => void;
}

const OverviewTab = forwardRef<TabHandle, Props>(function OverviewTab({ supabase, scope, scopeText, day, period, churchNames, onError, onLoaded }, ref) {
  const [chartMode, setChartMode] = useState<'stacked' | 'grouped'>('stacked');
  // ---------- Leaderboard mode ----------
  const [leaderBy, setLeaderBy] = useState<'points' | 'attendance'>('points');

  // ---------- Data ----------
  const [summary, setSummary] = useState<ScopeSummary | null>(null);
  const [daySum, setDaySum] = useState<DaySummary | null>(null);
  const [byEvent, setByEvent] = useState<EventDayRow[]>([]);
  const [byCause, setByCause] = useState<CauseDayRow[]>([]);
  const [byClass, setByClass] = useState<ClassDayRow[]>([]);
  const [attTimeline, setAttTimeline] = useState<AttendanceTimelineRow[]>([]);
  const [ptsTimeline, setPtsTimeline] = useState<PointsTimelineRow[]>([]);
  const [weekdays, setWeekdays] = useState<WeekdayRow[]>([]);
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Day-bound + scope-bound data (one round trip each, in parallel)
  const loadDay = useCallback(async () => {
    const [sum, ds, ev, ca, cl] = await Promise.all([
      fetchScopeSummary(supabase, scope),
      fetchDaySummary(supabase, day, scope),
      fetchAttendanceByEvent(supabase, day, scope),
      fetchPointsByCause(supabase, day, scope),
      fetchAttendanceByClass(supabase, day, scope),
    ]);
    setSummary(sum); setDaySum(ds); setByEvent(ev); setByCause(ca); setByClass(cl);
  }, [supabase, scope, day]);

  const loadPeriod = useCallback(async () => {
    const [a, p, w] = await Promise.all([
      fetchAttendanceTimeline(supabase, period, scope),
      fetchPointsTimeline(supabase, period, scope),
      fetchWeekdayProfile(supabase, period, scope),
    ]);
    setAttTimeline(a); setPtsTimeline(p); setWeekdays(w);
  }, [supabase, period, scope]);

  const loadLeaders = useCallback(async () => {
    setLeaders(await fetchLeaderboard(supabase, leaderBy, 10, scope));
  }, [supabase, leaderBy, scope]);

  const loadAll = useCallback(async () => {
    onError(null);
    try {
      await Promise.all([loadDay(), loadPeriod(), loadLeaders()]);
      onLoaded();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'تعذر تحميل الإحصائيات');
    } finally {
      setLoading(false);
    }
  }, [loadDay, loadPeriod, loadLeaders, onError, onLoaded]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ---------- Derived: chart series ----------
  const keys = useMemo(() => bucketKeys(period), [period]);
  const labels = useMemo(() => keys.map((k) => bucketLabel(k, period.bucket)), [keys, period.bucket]);
  const longLabels = useMemo(() => keys.map((k) => bucketLongLabel(k, period.bucket)), [keys, period.bucket]);
  const attSeries = useMemo(
    () => buildSeries(attTimeline, keys, (r) => ({ id: r.event_id, name: r.event_name, value: r.attendance }), churchNames),
    [attTimeline, keys, churchNames]
  );
  const ptsSeries = useMemo(
    () => buildSeries(ptsTimeline, keys, (r) => ({ id: r.cause_id, name: r.cause_name, value: r.net }), churchNames),
    [ptsTimeline, keys, churchNames]
  );
  const periodAttendance = useMemo(() => attTimeline.reduce((a, r) => a + r.attendance, 0), [attTimeline]);
  const periodPoints = useMemo(() => ptsTimeline.reduce((a, r) => a + r.net, 0), [ptsTimeline]);
  const periodDaysWithAttendance = useMemo(() => weekdays.reduce((a, r) => a + r.days_with_attendance, 0), [weekdays]);
  const bestBucket = useMemo(() => {
    let best = -1, idx = -1;
    keys.forEach((_, i) => {
      const t = attSeries.reduce((a, s) => a + (s.values[i] ?? 0), 0);
      if (t > best) { best = t; idx = i; }
    });
    return idx >= 0 && best > 0 ? { label: longLabels[idx], value: best } : null;
  }, [keys, attSeries, longLabels]);

  const weekdayMax = Math.max(1, ...weekdays.map((w) => w.attendance));

  // Same-named events / causes from different churches → disambiguate
  const eventLabel = (r: EventDayRow) => {
    const dup = byEvent.filter((x) => x.event_name === r.event_name).length > 1;
    return dup && r.church_id ? `${r.event_name} — ${churchNames[r.church_id] ?? ''}` : r.event_name;
  };
  const causeLabel = (r: CauseDayRow) => {
    const dup = byCause.filter((x) => x.cause_name === r.cause_name).length > 1;
    return dup && r.church_id ? `${r.cause_name} — ${churchNames[r.church_id] ?? ''}` : r.cause_name;
  };

  // ---------- Export (collected by the page into one workbook) ----------
  const exportSheets = useCallback((): { name: string; rows: Record<string, unknown>[] }[] => [
    { name: 'ملخص', rows: [
      { البند: 'النطاق', القيمة: scopeText },
      { البند: 'اليوم المحدد', القيمة: day },
      { البند: 'إجمالي المخدومين', القيمة: summary?.persons ?? 0 },
      { البند: 'إجمالي التسجيلات', القيمة: summary?.enrollments ?? 0 },
      { البند: 'ذكور', القيمة: summary?.males ?? 0 },
      { البند: 'إناث', القيمة: summary?.females ?? 0 },
      { البند: 'إجمالي النقاط (الرصيد)', القيمة: summary?.total_points ?? 0 },
      { البند: 'إجمالي الحضور', القيمة: summary?.total_attendance ?? 0 },
      { البند: 'نقاط الحضور', القيمة: summary?.attendance_points ?? 0 },
      { البند: 'نقاط الأسباب (إضافة)', القيمة: summary?.cause_points_added ?? 0 },
      { البند: 'نقاط الأسباب (خصم)', القيمة: summary?.cause_points_removed ?? 0 },
      { البند: 'عدد الفصول', القيمة: summary?.classes_count ?? 0 },
      { البند: 'عدد المناسبات', القيمة: summary?.events_count ?? 0 },
      { البند: 'عدد الأسباب', القيمة: summary?.causes_count ?? 0 },
      { البند: 'حضور اليوم', القيمة: daySum?.attendance ?? 0 },
      { البند: 'الحاضرون اليوم (أفراد)', القيمة: daySum?.attendees ?? 0 },
      { البند: 'نقاط اليوم (حضور)', القيمة: daySum?.attendance_points ?? 0 },
      { البند: 'نقاط اليوم (أسباب +)', القيمة: daySum?.cause_points_added ?? 0 },
      { البند: 'نقاط اليوم (أسباب −)', القيمة: daySum?.cause_points_removed ?? 0 },
    ] },
    { name: 'حضور اليوم حسب المناسبة', rows: byEvent.map((r) => ({
      المناسبة: eventLabel(r), النطاق: SCOPE_LABEL[r.event_scope], الحضور: r.attendance,
      'الحاضرون (أفراد)': r.attendees, المؤهلون: r.eligible, 'نسبة الحضور %': pct(r.attendees, r.eligible),
      النقاط: r.points, 'أول تسجيل': formatClock(r.first_at), 'آخر تسجيل': formatClock(r.last_at),
    })) },
    { name: 'نقاط اليوم حسب السبب', rows: byCause.map((r) => ({
      السبب: causeLabel(r), النطاق: SCOPE_LABEL[r.cause_scope], 'عدد المرات': r.entries,
      'المستفيدون (أفراد)': r.recipients, إضافة: r.added, خصم: r.removed, الصافي: r.net,
      'أول تسجيل': formatClock(r.first_at), 'آخر تسجيل': formatClock(r.last_at),
    })) },
    { name: 'حضور اليوم حسب الفصل', rows: byClass.map((r) => ({
      الكنيسة: r.church_name, الخدمة: r.service_name, الفصل: r.class_name, المسجلون: r.enrolled,
      الحاضرون: r.attendees, 'نسبة الحضور %': pct(r.attendees, r.enrolled), 'مرات الحضور': r.attendance, النقاط: r.points,
    })) },
    { name: 'الحضور عبر الفترة', rows: keys.map((k, i) => {
      const row: Record<string, unknown> = { الفترة: k };
      attSeries.forEach((s) => { row[s.label] = s.values[i] ?? 0; });
      row['الإجمالي'] = attSeries.reduce((a, s) => a + (s.values[i] ?? 0), 0);
      return row;
    }) },
    { name: 'النقاط عبر الفترة', rows: keys.map((k, i) => {
      const row: Record<string, unknown> = { الفترة: k };
      ptsSeries.forEach((s) => { row[s.label] = s.values[i] ?? 0; });
      row['الصافي'] = ptsSeries.reduce((a, s) => a + (s.values[i] ?? 0), 0);
      return row;
    }) },
    { name: 'أيام الأسبوع', rows: weekdays.map((w) => ({
      اليوم: WEEKDAY_LABELS[w.weekday], الحضور: w.attendance, 'أيام بها حضور': w.days_with_attendance,
    })) },
    { name: 'الأعلى', rows: leaders.map((l, i) => ({
      الترتيب: i + 1, الاسم: l.name, الفصل: l.class_name ?? '', النقاط: l.points, الحضور: l.attendance_count,
    })) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [scopeText, day, summary, daySum, byEvent, byCause, byClass, keys, attSeries, ptsSeries, weekdays, leaders]);

  useImperativeHandle(ref, () => ({ reload: loadAll, exportSheets }), [loadAll, exportSheets]);

  // =====================================================================
  // Render
  // =====================================================================
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <>
        <div className="space-y-4">
          {/* ---------- 1. Headline KPIs ---------- */}
          <section id="stats-kpis" className="grid grid-cols-2 gap-3">
            <KpiTile id="kpi-children" icon={Users} value={summary?.persons ?? 0} label="إجمالي المخدومين"
              hint={summary && summary.enrollments !== summary.persons ? `${fmtNum(summary.enrollments)} تسجيل` : undefined} tone="primary" />
            <KpiTile id="kpi-points" icon={Star} value={summary?.total_points ?? 0} label="إجمالي النقاط"
              hint={summary ? `${fmtNum(summary.attendance_points)} حضور · ${fmtSigned(summary.cause_points_added - summary.cause_points_removed)} أسباب` : undefined} tone="gold" />
            <KpiTile id="kpi-attendance" icon={CalendarCheck} value={summary?.total_attendance ?? 0} label="إجمالي مرات الحضور"
              hint={summary?.first_attendance ? `منذ ${summary.first_attendance}` : undefined} tone="emerald" />
            <KpiTile id="kpi-structure" icon={Layers} value={summary?.classes_count ?? 0} label="فصول في النطاق"
              hint={summary ? `${fmtNum(summary.events_count)} مناسبة · ${fmtNum(summary.causes_count)} سبب` : undefined} tone="sky" />
          </section>

          {/* Gender split */}
          {summary && summary.persons > 0 && (
            <section id="stats-gender" className="card !py-3">
              <div className="mb-2 flex items-center justify-between text-xs font-extrabold text-slate-600">
                <span className="flex items-center gap-1.5"><UserRound className="h-4 w-4 text-primary-600" /> توزيع المخدومين</span>
                <span className="tabular-nums text-slate-400">{fmtNum(summary.persons)} مخدوم</span>
              </div>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="bg-sky-500 transition-all" style={{ width: `${pct(summary.males, summary.persons)}%` }} />
                <div className="bg-pink-500 transition-all" style={{ width: `${pct(summary.females, summary.persons)}%` }} />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] font-bold">
                <span className="flex items-center gap-1 text-sky-700"><span className="h-2 w-2 rounded-full bg-sky-500" /> ذكور {fmtNum(summary.males)} ({pct(summary.males, summary.persons)}%)</span>
                <span className="flex items-center gap-1 text-pink-700"><span className="h-2 w-2 rounded-full bg-pink-500" /> إناث {fmtNum(summary.females)} ({pct(summary.females, summary.persons)}%)</span>
                {summary.persons - summary.males - summary.females > 0 && (
                  <span className="text-slate-400">غير محدد {fmtNum(summary.persons - summary.males - summary.females)}</span>
                )}
              </div>
            </section>
          )}

          {/* ---------- 2. Selected day summary ---------- */}
          <SectionCard id="stats-day" icon={CalendarDays} title="ملخص اليوم المحدد" subtitle={formatDay(day)} tone="emerald">
            <div className="flex items-start gap-4">
              <DonutRing
                value={daySum?.attendees ?? 0}
                total={daySum?.scope_persons ?? 0}
                label="نسبة الحضور"
                color="#10b981"
              />
              <div className="grid flex-1 grid-cols-2 gap-2">
                <MiniStat label="مرات الحضور" value={daySum?.attendance ?? 0} tone="emerald" />
                <MiniStat label="حاضرون (أفراد)" value={daySum?.attendees ?? 0} tone="emerald" />
                <MiniStat label="مناسبات بها حضور" value={daySum?.events_attended ?? 0} tone="primary" />
                <MiniStat label="غائبون" value={Math.max(0, (daySum?.scope_persons ?? 0) - (daySum?.attendees ?? 0))} tone="rose" />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <MiniStat label="نقاط الحضور" value={daySum?.attendance_points ?? 0} tone="gold" />
              <MiniStat label="نقاط أسباب +" value={fmtSigned(daySum?.cause_points_added ?? 0)} tone="gold" />
              <MiniStat label="نقاط أسباب −" value={daySum?.cause_points_removed ? `−${fmtNum(daySum.cause_points_removed)}` : '0'} tone="rose" />
            </div>
            <p className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs font-extrabold text-slate-600">
              <span className="flex items-center gap-1.5"><Sigma className="h-4 w-4 text-gold-500" /> إجمالي نقاط اليوم</span>
              <span className="tabular-nums text-base text-gold-700">
                {fmtSigned((daySum?.attendance_points ?? 0) + (daySum?.cause_points_added ?? 0) - (daySum?.cause_points_removed ?? 0))}
              </span>
            </p>
          </SectionCard>

          {/* ---------- 3. Attendance by event (selected day) ---------- */}
          <SectionCard
            id="stats-by-event"
            icon={Flag}
            title="الحضور حسب المناسبة"
            subtitle={`${formatDay(day)} · مرتب حسب المناسبة`}
            tone="primary"
            actions={<span className="badge bg-primary-100 text-primary-700">{fmtNum(byEvent.length)} مناسبة</span>}
          >
            <RankedBars
              items={byEvent.map((r, i) => ({
                key: r.event_id ?? `none-${i}`,
                label: eventLabel(r),
                value: r.attendance,
                sublabel: `${SCOPE_LABEL[r.event_scope]} · ${fmtNum(r.points)} نقطة${r.first_at ? ` · ${formatClock(r.first_at)} → ${formatClock(r.last_at)}` : ''}`,
                secondary: r.eligible > 0 ? `${fmtNum(r.attendees)} من ${fmtNum(r.eligible)} · ${pct(r.attendees, r.eligible)}%` : `${fmtNum(r.attendees)} فرد`,
                badge: r.eligible > 0 ? (
                  <span className={`badge ${pct(r.attendees, r.eligible) >= 75 ? 'bg-emerald-100 text-emerald-700' : pct(r.attendees, r.eligible) >= 50 ? 'bg-gold-100 text-gold-700' : 'bg-rose-100 text-rose-700'}`}>
                    <Percent className="h-3 w-3" /> {pct(r.attendees, r.eligible)}
                  </span>
                ) : undefined,
              }))}
              emptyText="لا يوجد حضور مسجّل في هذا اليوم"
            />
          </SectionCard>

          {/* ---------- 4. Points by cause (selected day) ---------- */}
          <SectionCard
            id="stats-by-cause"
            icon={Tag}
            title="النقاط الممنوحة حسب السبب"
            subtitle={`${formatDay(day)} · مرتب حسب السبب`}
            tone="gold"
            actions={<span className="badge bg-gold-100 text-gold-700">{fmtNum(byCause.length)} سبب</span>}
          >
            <RankedBars
              items={byCause.map((r, i) => ({
                key: r.cause_id ?? `none-${i}`,
                label: causeLabel(r),
                value: r.net,
                color: r.net < 0 ? '#ef4444' : '#f59e0b',
                sublabel: `${SCOPE_LABEL[r.cause_scope]} · ${fmtNum(r.entries)} مرة · ${fmtNum(r.recipients)} فرد`,
                secondary: `+${fmtNum(r.added)}${r.removed ? ` / −${fmtNum(r.removed)}` : ''}`,
              }))}
              valueLabel={fmtSigned}
              emptyText="لم تُمنح نقاط بسبب في هذا اليوم"
            />
          </SectionCard>

          {/* ---------- 5. Attendance by class (selected day) ---------- */}
          {byClass.length > 1 && (
            <SectionCard
              id="stats-by-class"
              icon={BookOpen}
              title="الحضور حسب الفصل"
              subtitle={`${formatDay(day)} · نسبة الحاضرين من المسجلين`}
              tone="violet"
              actions={<span className="badge bg-violet-100 text-violet-700">{fmtNum(byClass.length)} فصل</span>}
            >
              <RankedBars
                items={[...byClass]
                  .sort((a, b) => pct(b.attendees, b.enrolled) - pct(a.attendees, a.enrolled) || b.attendees - a.attendees)
                  .map((r) => ({
                    key: r.class_id,
                    label: r.class_name,
                    value: pct(r.attendees, r.enrolled),
                    color: pct(r.attendees, r.enrolled) >= 75 ? '#10b981' : pct(r.attendees, r.enrolled) >= 50 ? '#f59e0b' : '#ef4444',
                    sublabel: `${r.church_name} › ${r.service_name}`,
                    secondary: `${fmtNum(r.attendees)} من ${fmtNum(r.enrolled)} · ${fmtNum(r.points)} نقطة`,
                  }))}
                valueLabel={(v) => `${v}%`}
              />
            </SectionCard>
          )}

          {/* ---------- 6. Attendance timeline ---------- */}
          <SectionCard
            id="stats-timeline"
            icon={TrendingUp}
            title="الحضور عبر الفترة حسب المناسبة"
            subtitle={`${period.from} → ${period.to} · ${BUCKET_LABELS[period.bucket]}`}
            tone="primary"
            actions={
              <button
                type="button"
                onClick={() => setChartMode((m) => (m === 'stacked' ? 'grouped' : 'stacked'))}
                className="flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-extrabold text-slate-600 active:scale-95"
                aria-label="تبديل نمط الرسم"
              >
                {chartMode === 'stacked' ? <Rows3 className="h-3.5 w-3.5" /> : <Columns3 className="h-3.5 w-3.5" />}
                {chartMode === 'stacked' ? 'متراكم' : 'متجاور'}
              </button>
            }
          >
            <StackedBarChart
              id="attendance-chart"
              series={attSeries}
              labels={labels}
              longLabels={longLabels}
              mode={chartMode}
            />

            <div className="mt-3 grid grid-cols-3 gap-2">
              <MiniStat label="حضور الفترة" value={periodAttendance} tone="emerald" />
              <MiniStat label="أيام بها حضور" value={periodDaysWithAttendance} tone="primary" />
              <MiniStat label="متوسط / يوم حضور" value={periodDaysWithAttendance ? Math.round(periodAttendance / periodDaysWithAttendance) : 0} tone="slate" />
            </div>
            {bestBucket && (
              <p className="mt-2 flex items-center gap-1.5 rounded-xl bg-gold-50 px-3 py-2 text-[11px] font-extrabold text-gold-700">
                <Sparkles className="h-3.5 w-3.5" /> أعلى حضور: {bestBucket.label} — {fmtNum(bestBucket.value)}
              </p>
            )}
          </SectionCard>

          {/* ---------- 7. Points timeline ---------- */}
          <SectionCard
            id="stats-points-timeline"
            icon={Activity}
            title="النقاط عبر الفترة حسب السبب"
            subtitle={`صافي نقاط الأسباب · ${BUCKET_LABELS[period.bucket]}`}
            tone="gold"
            actions={<span className="badge bg-gold-100 text-gold-700">{fmtSigned(periodPoints)}</span>}
          >
            <StackedBarChart
              id="points-chart"
              series={ptsSeries.map((s) => ({ ...s, values: s.values.map((v) => Math.max(0, v)) }))}
              labels={labels}
              longLabels={longLabels}
              mode={chartMode}
              height={150}
              emptyText="لم تُمنح نقاط بسبب في هذه الفترة"
            />
          </SectionCard>

          {/* ---------- 8. Weekday profile ---------- */}
          <SectionCard id="stats-weekdays" icon={Clock} title="الحضور حسب أيام الأسبوع" subtitle="خلال الفترة المحددة" tone="sky">
            {weekdays.length === 0 ? (
              <div className="flex h-20 items-center justify-center rounded-xl bg-slate-50 text-sm font-bold text-slate-400">لا توجد بيانات</div>
            ) : (
              <div className="grid grid-cols-7 gap-1.5">
                {[0, 1, 2, 3, 4, 5, 6].map((wd) => {
                  const w = weekdays.find((x) => x.weekday === wd);
                  const v = w?.attendance ?? 0;
                  const h = Math.max(4, (v / weekdayMax) * 72);
                  return (
                    <div key={wd} className="flex flex-col items-center gap-1">
                      <span className="text-[10px] font-extrabold tabular-nums text-slate-500">{v ? fmtNum(v) : ''}</span>
                      <div className="flex h-[76px] w-full items-end">
                        <div
                          className={`w-full rounded-t-md ${v ? 'bg-gradient-to-t from-sky-600 to-sky-400' : 'bg-slate-100'}`}
                          style={{ height: `${h}px` }}
                          title={w ? `${WEEKDAY_LABELS[wd]}: ${v} حضور في ${w.days_with_attendance} يوم` : WEEKDAY_LABELS[wd]}
                        />
                      </div>
                      <span className="text-[10px] font-bold text-slate-400">{WEEKDAY_SHORT[wd]}</span>
                      {w && <span className="text-[9px] font-bold text-slate-300">{fmtNum(w.days_with_attendance)} يوم</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* ---------- 9. Leaderboard ---------- */}
          <SectionCard
            id="stats-leaders"
            icon={Trophy}
            title={leaderBy === 'points' ? 'الأعلى نقاطاً' : 'الأكثر حضوراً'}
            subtitle="أعلى 10 في النطاق المحدد"
            tone="gold"
            actions={
              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-0.5">
                <button
                  type="button"
                  onClick={() => setLeaderBy('points')}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-extrabold ${leaderBy === 'points' ? 'bg-white text-gold-700 shadow-sm' : 'text-slate-500'}`}
                >
                  <Star className="h-3 w-3" /> نقاط
                </button>
                <button
                  type="button"
                  onClick={() => setLeaderBy('attendance')}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-extrabold ${leaderBy === 'attendance' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`}
                >
                  <CalendarCheck className="h-3 w-3" /> حضور
                </button>
              </div>
            }
          >
            <ul className="space-y-2">
              {leaders.map((c, i) => (
                <li key={c.enrollment_id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
                      i === 0 ? 'bg-gold-100 text-gold-600' : i === 1 ? 'bg-slate-200 text-slate-600' : i === 2 ? 'bg-orange-100 text-orange-600' : 'bg-primary-50 text-primary-600'
                    }`}
                  >
                    {i + 1}
                  </span>
                  {c.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.image_url} alt="" className="h-9 w-9 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-600 to-accent-600 text-white">
                      <UserRound className="h-4 w-4" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold">{c.name}</p>
                    {c.class_name && <p className="truncate text-[10px] font-bold text-slate-400">{c.class_name}</p>}
                  </div>
                  <span className="badge bg-gold-100 text-gold-600"><Star className="h-3 w-3" /> {fmtNum(c.points)}</span>
                  <span className="badge bg-emerald-100 text-emerald-700"><CalendarCheck className="h-3 w-3" /> {fmtNum(c.attendance_count)}</span>
                </li>
              ))}
              {leaders.length === 0 && (
                <li className="py-8 text-center text-sm font-bold text-slate-400">لا توجد بيانات بعد</li>
              )}
            </ul>
          </SectionCard>

        </div>
    </>
  );
});

export default OverviewTab;
