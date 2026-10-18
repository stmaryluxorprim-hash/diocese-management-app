'use client';

// =====================================================================
// الحضور — attendance tab of the statistics page (20261018120000)
//
//   1. KPIs         — attendance · attendees % · never attended · days
//   2. Rate ring    — attendees / scope, attendance / expected seats,
//                     gender split of the attendees
//   3. Timeline     — attendance per bucket stacked by event (0020) +
//                     the «unique persons» line
//   4. Distribution — how many persons attended 0,1,2,… times
//   5. By class     — attendees / enrolled over the period, avg per day
//   6. Weekday + hour profiles
//   7. Regulars & absentees — top 10 each
//   8. Excel sheets — via exportSheets()
// =====================================================================

import { useCallback, useEffect, useImperativeHandle, useMemo, useState, forwardRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CalendarCheck, Users, UserX, CalendarDays, TrendingUp, BarChart3, BookOpen, Clock, Trophy, Star, Sparkles, Percent, Timer,
} from 'lucide-react';
import { SectionCard, KpiTile, MiniStat, DonutRing, StackedBarChart, fmtNum } from '@/components/stats/Charts';
import { LineAreaChart, Histogram, HourProfile, PersonRow, ProgressTable, EmptyState } from '@/components/stats/Charts2';
import { WEEKDAY_LABELS, WEEKDAY_SHORT } from '@/lib/time';
import {
  bucketKeys, bucketLabel, bucketLongLabel, buildSeries, fetchAttendanceTimeline, fetchWeekdayProfile, formatDay, pct,
  type Period, type AttendanceTimelineRow, type WeekdayRow,
} from '@/lib/stats';
import {
  fetchAttendancePeriodSummary, fetchAttendanceDistribution, fetchAttendanceHourProfile, fetchAttendanceByClassPeriod, fetchAttendancePersons,
  alignToKeys, type StatsFilter, type AttendancePeriodSummary, type DistributionRow, type HourRow, type ClassPeriodRow, type AttendancePersonRow,
} from '@/lib/stats-period';
import type { TabHandle } from '@/components/stats/CallsTab';

interface Props {
  supabase: SupabaseClient;
  period: Period;
  filter: StatsFilter;
  churchNames: Record<string, string>;
  onError: (e: string | null) => void;
  onLoaded: () => void;
}

const AttendanceTab = forwardRef<TabHandle, Props>(function AttendanceTab({ supabase, period, filter, churchNames, onError, onLoaded }, ref) {
  const [summary, setSummary] = useState<AttendancePeriodSummary | null>(null);
  const [timeline, setTimeline] = useState<AttendanceTimelineRow[]>([]);
  const [dist, setDist] = useState<DistributionRow[]>([]);
  const [hours, setHours] = useState<HourRow[]>([]);
  const [weekdays, setWeekdays] = useState<WeekdayRow[]>([]);
  const [byClass, setByClass] = useState<ClassPeriodRow[]>([]);
  const [most, setMost] = useState<AttendancePersonRow[]>([]);
  const [least, setLeast] = useState<AttendancePersonRow[]>([]);
  const [chartMode, setChartMode] = useState<'stacked' | 'grouped'>('stacked');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    onError(null);
    try {
      // the 0020 timeline RPC has no p_event → filter rows client-side
      const [s, tl, d, h, w, c, m, l] = await Promise.all([
        fetchAttendancePeriodSummary(supabase, period, filter),
        fetchAttendanceTimeline(supabase, period, filter),
        fetchAttendanceDistribution(supabase, period, filter),
        fetchAttendanceHourProfile(supabase, period, filter),
        fetchWeekdayProfile(supabase, period, filter),
        fetchAttendanceByClassPeriod(supabase, period, filter),
        fetchAttendancePersons(supabase, period, filter, 'most', 10),
        fetchAttendancePersons(supabase, period, filter, 'least', 10),
      ]);
      setSummary(s);
      setTimeline(filter.event && filter.event !== 'all' ? tl.filter((r) => r.event_id === filter.event) : tl);
      setDist(d); setHours(h); setWeekdays(w); setByClass(c); setMost(m); setLeast(l);
      onLoaded();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'تعذر تحميل إحصائيات الحضور');
    } finally {
      setLoading(false);
    }
  }, [supabase, period, filter, onError, onLoaded]);

  useEffect(() => { reload(); }, [reload]);

  const keys = useMemo(() => bucketKeys(period), [period]);
  const labels = useMemo(() => keys.map((k) => bucketLabel(k, period.bucket)), [keys, period.bucket]);
  const longLabels = useMemo(() => keys.map((k) => bucketLongLabel(k, period.bucket)), [keys, period.bucket]);
  const series = useMemo(
    () => buildSeries(timeline, keys, (r) => ({ id: r.event_id, name: r.event_name, value: r.attendance }), churchNames),
    [timeline, keys, churchNames]
  );
  const attendeesLine = useMemo(() => [
    { key: 'att', label: 'مرات الحضور', color: '#10b981', values: alignToKeys(timeline, keys, (r) => r.attendance) },
    { key: 'persons', label: 'أفراد', color: '#4f46e5', values: alignToKeys(timeline, keys, (r) => r.attendees), dashed: true },
  ], [timeline, keys]);
  const bestBucket = useMemo(() => {
    const v = attendeesLine[0].values; let bi = -1, bv = 0;
    v.forEach((x, i) => { if (x > bv) { bv = x; bi = i; } });
    return bi >= 0 ? { label: longLabels[bi], value: bv } : null;
  }, [attendeesLine, longLabels]);
  const weekdayMax = Math.max(1, ...weekdays.map((w) => w.attendance));

  const s = summary;
  const seats = s ? s.expected_occurrences * s.scope_persons : 0;
  const rate = s ? pct(s.attendees, s.scope_persons) : 0;
  const seatRate = seats > 0 && s ? Math.min(100, Math.round((s.attendance / seats) * 100)) : 0;

  useImperativeHandle(ref, () => ({
    reload,
    exportSheets: () => [
      { name: 'الحضور — ملخص', rows: s ? [
        { البند: 'مرات الحضور', القيمة: s.attendance },
        { البند: 'الحاضرون (أفراد)', القيمة: s.attendees },
        { البند: 'المخدومون في النطاق', القيمة: s.scope_persons },
        { البند: 'نسبة من حضر ولو مرة %', القيمة: rate },
        { البند: 'لم يحضر إطلاقاً', القيمة: s.never_attended },
        { البند: 'أيام بها حضور', القيمة: s.days_with_attendance },
        { البند: 'المناسبات المتوقعة', القيمة: s.expected_occurrences },
        { البند: 'نسبة شغل المقاعد %', القيمة: seatRate },
        { البند: 'متوسط الحضور / يوم', القيمة: s.avg_per_day },
        { البند: 'متوسط الحضور / فرد', القيمة: s.avg_per_person },
        { البند: 'أعلى يوم', القيمة: s.best_day ? `${s.best_day} (${s.best_day_count})` : '' },
        { البند: 'أقل يوم', القيمة: s.worst_day ? `${s.worst_day} (${s.worst_day_count})` : '' },
        { البند: 'نقاط الحضور', القيمة: s.points },
        { البند: 'ذكور حضروا', القيمة: s.males_attended },
        { البند: 'إناث حضرن', القيمة: s.females_attended },
        { البند: 'مناسبات بها حضور', القيمة: s.events_used },
        { البند: 'خدام سجّلوا الحضور', القيمة: s.servants },
      ] : [] },
      { name: 'الحضور عبر الفترة', rows: keys.map((k, i) => {
        const row: Record<string, unknown> = { الفترة: k };
        series.forEach((x) => { row[x.label] = x.values[i] ?? 0; });
        row['الإجمالي'] = attendeesLine[0].values[i];
        row['أفراد'] = attendeesLine[1].values[i];
        return row;
      }) },
      { name: 'توزيع مرات الحضور', rows: dist.map((d) => ({ 'مرات الحضور': d.times, 'عدد المخدومين': d.persons })) },
      { name: 'الحضور حسب الفصل', rows: byClass.map((r) => ({
        الكنيسة: r.church_name, الخدمة: r.service_name, الفصل: r.class_name, المسجلون: r.enrolled, 'حضروا (أفراد)': r.attendees,
        'نسبة %': pct(r.attendees, r.enrolled), 'مرات الحضور': r.attendance, 'أيام': r.days, 'متوسط / يوم': r.avg_per_day, النقاط: r.points,
      })) },
      { name: 'أيام الأسبوع', rows: weekdays.map((w) => ({ اليوم: WEEKDAY_LABELS[w.weekday], الحضور: w.attendance, 'أيام بها حضور': w.days_with_attendance })) },
      { name: 'ساعات اليوم', rows: hours.map((h) => ({ الساعة: h.hour, الحضور: h.attendance, 'أيام': h.days })) },
      { name: 'المنتظمون', rows: most.map((p, i) => ({ الترتيب: i + 1, الاسم: p.name, الفصل: p.class_name ?? '', 'حضور الفترة': p.attendance, 'آخر حضور': p.last_day ?? '', 'الإجمالي': p.total_attendance, النقاط: p.points })) },
      { name: 'الأكثر غياباً', rows: least.map((p, i) => ({ الترتيب: i + 1, الاسم: p.name, الفصل: p.class_name ?? '', 'حضور الفترة': p.attendance, 'آخر حضور': p.last_day ?? 'لم يحضر', 'أيام منذ آخر حضور': p.days_since_last ?? '', 'الإجمالي': p.total_attendance })) },
    ],
  }), [reload, s, rate, seatRate, keys, series, attendeesLine, dist, byClass, weekdays, hours, most, least]);

  if (loading) return <div className="flex justify-center py-16"><span className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" /></div>;

  return (
    <div className="space-y-4">
      {/* ---------- 1. KPIs ---------- */}
      <section id="att-kpis" className="grid grid-cols-2 gap-3">
        <KpiTile icon={CalendarCheck} value={s?.attendance ?? 0} label="مرات الحضور" tone="emerald" hint={`${fmtNum(s?.days_with_attendance ?? 0)} يوم · ${fmtNum(s?.events_used ?? 0)} مناسبة`} />
        <KpiTile icon={Users} value={`${rate}%`} label="حضروا ولو مرة" tone={rate >= 75 ? 'primary' : rate >= 50 ? 'sky' : 'rose'} hint={`${fmtNum(s?.attendees ?? 0)} من ${fmtNum(s?.scope_persons ?? 0)}`} />
        <KpiTile icon={UserX} value={s?.never_attended ?? 0} label="لم يحضروا إطلاقاً" tone="rose" hint={`${pct(s?.never_attended ?? 0, s?.scope_persons ?? 0)}% من النطاق`} />
        <KpiTile icon={Timer} value={s?.avg_per_day ?? 0} label="متوسط الحضور / يوم" tone="sky" hint={`${s?.avg_per_person ?? 0} مرة لكل حاضر`} />
      </section>

      {/* ---------- 2. Rates ---------- */}
      <SectionCard id="att-rates" icon={Percent} title="نسب الحضور" subtitle="الأفراد · المقاعد · النوع" tone="emerald">
        <div className="flex items-start justify-around gap-2">
          <DonutRing value={s?.attendees ?? 0} total={s?.scope_persons ?? 0} label="حضروا ولو مرة" color="#10b981" size={88} />
          <DonutRing value={s?.attendance ?? 0} total={seats} label="شغل المقاعد" color="#4f46e5" size={88} />
          <DonutRing value={s?.males_attended ?? 0} total={(s?.males_attended ?? 0) + (s?.females_attended ?? 0)} label="ذكور من الحاضرين" color="#0ea5e9" size={88} />
        </div>
        <p className="mt-1 text-center text-[10px] font-bold text-slate-400">
          شغل المقاعد = مرات الحضور ÷ (المناسبات المتوقعة {fmtNum(s?.expected_occurrences ?? 0)} × المخدومون {fmtNum(s?.scope_persons ?? 0)})
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MiniStat label="أعلى يوم" value={s?.best_day ? `${fmtNum(s.best_day_count)}` : '—'} tone="emerald" />
          <MiniStat label="أقل يوم" value={s?.worst_day ? `${fmtNum(s.worst_day_count)}` : '—'} tone="rose" />
        </div>
        {s?.best_day && (
          <div className="mt-1.5 flex flex-col gap-0.5 text-[10px] font-bold text-slate-400">
            <span>أعلى: {formatDay(s.best_day)}</span>
            {s.worst_day && s.worst_day !== s.best_day && <span>أقل: {formatDay(s.worst_day)}</span>}
          </div>
        )}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <MiniStat label="نقاط الحضور" value={s?.points ?? 0} tone="gold" />
          <MiniStat label="ذكور / إناث" value={`${fmtNum(s?.males_attended ?? 0)} / ${fmtNum(s?.females_attended ?? 0)}`} tone="primary" />
          <MiniStat label="خدام سجّلوا" value={s?.servants ?? 0} tone="slate" />
        </div>
      </SectionCard>

      {/* ---------- 3. Timeline ---------- */}
      <SectionCard id="att-timeline" icon={TrendingUp} title="الحضور عبر الفترة" subtitle="مرات الحضور وعدد الأفراد" tone="primary"
        actions={bestBucket ? <span className="badge bg-emerald-100 text-emerald-700"><Sparkles className="h-3 w-3" /> {fmtNum(bestBucket.value)}</span> : undefined}>
        <LineAreaChart id="att-line" series={attendeesLine} labels={labels} longLabels={longLabels} height={150} emptyText="لا يوجد حضور في هذه الفترة" />
        {bestBucket && <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-1.5 text-[11px] font-extrabold text-emerald-700">أعلى حضور: {bestBucket.label} — {fmtNum(bestBucket.value)}</p>}
      </SectionCard>

      <SectionCard id="att-by-event" icon={BarChart3} title="الحضور حسب المناسبة" subtitle="كل مناسبة بلون" tone="violet"
        actions={
          <button type="button" onClick={() => setChartMode((m) => (m === 'stacked' ? 'grouped' : 'stacked'))} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-extrabold text-slate-600 active:scale-95">
            {chartMode === 'stacked' ? 'متراكم' : 'متجاور'}
          </button>
        }>
        <StackedBarChart id="att-stacked" series={series} labels={labels} longLabels={longLabels} mode={chartMode} height={160} />
      </SectionCard>

      {/* ---------- 4. Distribution ---------- */}
      <SectionCard id="att-dist" icon={BarChart3} title="توزيع مرات الحضور" subtitle="كم مخدوم حضر 0 · 1 · 2 … مرة في الفترة" tone="sky">
        <Histogram
          id="att-hist"
          bars={dist.map((d) => ({
            label: d.times === 0 ? 'لم يحضر' : `${fmtNum(d.times)} ${d.times === 1 ? 'مرة' : d.times === 2 ? 'مرتين' : 'مرات'}`,
            value: d.persons,
            color: d.times === 0 ? '#ef4444' : d.times >= (s?.expected_occurrences ?? 1) ? '#10b981' : '#0ea5e9',
            hint: `${d.persons} مخدوم حضروا ${d.times} مرة`,
          }))}
          unit=" مخدوم"
        />
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold text-slate-400">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> لم يحضر</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" /> حضر جزئياً</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> حضر كل المناسبات ({fmtNum(s?.expected_occurrences ?? 0)}+)</span>
        </div>
      </SectionCard>

      {/* ---------- 5. By class ---------- */}
      {byClass.length > 0 && (
        <SectionCard id="att-by-class" icon={BookOpen} title="الحضور حسب الفصل" subtitle="نسبة من حضروا ولو مرة من المسجلين" tone="violet"
          actions={<span className="badge bg-violet-100 text-violet-700">{fmtNum(byClass.length)} فصل</span>}>
          <ProgressTable
            rows={[...byClass].sort((a, b) => pct(b.attendees, b.enrolled) - pct(a.attendees, a.enrolled) || b.attendance - a.attendance).map((r) => ({
              key: r.class_id, label: r.class_name,
              sublabel: `${r.church_name} › ${r.service_name} · ${fmtNum(r.attendance)} مرة في ${fmtNum(r.days)} يوم · متوسط ${r.avg_per_day}/يوم · ${fmtNum(r.points)} نقطة`,
              num: r.attendees, den: r.enrolled,
            }))}
          />
        </SectionCard>
      )}

      {/* ---------- 6. Weekday + hour ---------- */}
      <SectionCard id="att-weekdays" icon={CalendarDays} title="الحضور حسب أيام الأسبوع" subtitle="خلال الفترة المحددة" tone="sky">
        {weekdays.length === 0 ? <EmptyState text="لا توجد بيانات" /> : (
          <div className="grid grid-cols-7 gap-1.5">
            {[0, 1, 2, 3, 4, 5, 6].map((wd) => {
              const w = weekdays.find((x) => x.weekday === wd);
              const v = w?.attendance ?? 0;
              const h = Math.max(4, (v / weekdayMax) * 72);
              return (
                <div key={wd} className="flex flex-col items-center gap-1">
                  <span className="text-[10px] font-extrabold tabular-nums text-slate-500">{v ? fmtNum(v) : ''}</span>
                  <div className="flex h-[76px] w-full items-end">
                    <div className={`w-full rounded-t-md ${v ? 'bg-gradient-to-t from-sky-600 to-sky-400' : 'bg-slate-100'}`} style={{ height: `${h}px` }} title={w ? `${WEEKDAY_LABELS[wd]}: ${v} حضور في ${w.days_with_attendance} يوم` : WEEKDAY_LABELS[wd]} />
                  </div>
                  <span className="text-[10px] font-bold text-slate-400">{WEEKDAY_SHORT[wd]}</span>
                  {w && <span className="text-[9px] font-bold text-slate-300">{fmtNum(w.days_with_attendance)} يوم</span>}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard id="att-hours" icon={Clock} title="ساعات تسجيل الحضور" subtitle="متى يُسجَّل الحضور خلال اليوم (توقيت القاهرة)" tone="sky">
        <HourProfile id="att-hour-profile" rows={hours} />
      </SectionCard>

      {/* ---------- 7. Persons ---------- */}
      <SectionCard id="att-regulars" icon={Trophy} title="المنتظمون في الحضور" subtitle="أعلى 10 حضوراً في الفترة" tone="gold">
        {most.length === 0 ? <EmptyState text="لا توجد بيانات" /> : (
          <ul className="space-y-1.5">
            {most.map((p, i) => (
              <PersonRow key={p.enrollment_id} rank={i + 1} url={p.image_url} name={p.name} highlight={i === 0 ? 'gold' : null}
                sub={<>{p.class_name ?? ''}{p.last_day ? ` · آخر حضور ${p.last_day}` : ''} · الإجمالي {fmtNum(p.total_attendance)}</>}
                badges={<>
                  <span className="badge bg-emerald-100 text-emerald-700"><CalendarCheck className="h-3 w-3" /> {fmtNum(p.attendance)}</span>
                  <span className="badge bg-gold-100 text-gold-700"><Star className="h-3 w-3" /> {fmtNum(p.points)}</span>
                </>} />
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard id="att-absentees" icon={UserX} title="الأكثر غياباً" subtitle="أقل 10 حضوراً في الفترة — يحتاجون افتقاداً" tone="rose">
        {least.length === 0 ? <EmptyState text="لا توجد بيانات" /> : (
          <ul className="space-y-1.5">
            {least.map((p, i) => (
              <PersonRow key={p.enrollment_id} rank={i + 1} url={p.image_url} name={p.name} highlight={p.attendance === 0 ? 'rose' : null}
                sub={<>{p.class_name ?? ''}{p.last_day ? ` · آخر حضور ${p.last_day} (منذ ${fmtNum(p.days_since_last ?? 0)} يوم)` : ' · لم يحضر في الفترة'}</>}
                badges={<span className={`badge ${p.attendance === 0 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}><CalendarCheck className="h-3 w-3" /> {fmtNum(p.attendance)}</span>} />
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
});

export default AttendanceTab;
