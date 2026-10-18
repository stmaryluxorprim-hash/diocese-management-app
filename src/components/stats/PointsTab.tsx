'use client';

// =====================================================================
// النقاط — points tab of the statistics page (20261018120000)
//
//   1. KPIs          — net of the period · attendance points · cause +/− ·
//                      recipients
//   2. Sources donut — attendance vs causes (+) vs deductions (−)
//   3. Timeline      — points per bucket by cause (0020) + a net line
//   4. By cause      — ranked (period), with entries / recipients
//   5. Balances      — total / average / max / zero + histogram of balances
//   6. By class      — period net + class balance
//   7. By servant    — who granted (points & attendance scans)
//   8. Persons       — top earners of the period · top balances · most deducted
// =====================================================================

import { useCallback, useEffect, useImperativeHandle, useMemo, useState, forwardRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  Star, Tag, TrendingUp, BarChart3, BookOpen, UserRound, Trophy, Coins, Sigma, MinusCircle, PlusCircle, CalendarCheck, Sparkles, Wallet,
} from 'lucide-react';
import { SectionCard, KpiTile, MiniStat, StackedBarChart, RankedBars, fmtNum, fmtSigned } from '@/components/stats/Charts';
import { SegmentDonut, LineAreaChart, Histogram, PersonRow, ProgressTable, Chips, EmptyState, Avatar } from '@/components/stats/Charts2';
import {
  bucketKeys, bucketLabel, bucketLongLabel, buildSeries, fetchPointsTimeline, formatDay, seriesColor, pct,
  type Period, type PointsTimelineRow,
} from '@/lib/stats';
import {
  fetchPointsPeriodSummary, fetchPointsDistribution, fetchPointsByClassPeriod, fetchPointsByServant, fetchPointsPersons,
  alignToKeys, formatDateTimeShort, ROLE_LABELS,
  type StatsFilter, type PointsPeriodSummary, type PointsBucketRow, type PointsClassPeriodRow, type PointsByServantRow, type PointsPersonRow,
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

type PersonsOrder = 'period' | 'balance' | 'removed';
const ORDERS: { value: PersonsOrder; label: string }[] = [
  { value: 'period', label: 'الأعلى كسباً في الفترة' },
  { value: 'balance', label: 'الأعلى رصيداً' },
  { value: 'removed', label: 'الأكثر خصماً' },
];

const PointsTab = forwardRef<TabHandle, Props>(function PointsTab({ supabase, period, filter, churchNames, onError, onLoaded }, ref) {
  const [summary, setSummary] = useState<PointsPeriodSummary | null>(null);
  const [timeline, setTimeline] = useState<PointsTimelineRow[]>([]);
  const [dist, setDist] = useState<PointsBucketRow[]>([]);
  const [byClass, setByClass] = useState<PointsClassPeriodRow[]>([]);
  const [byServant, setByServant] = useState<PointsByServantRow[]>([]);
  const [persons, setPersons] = useState<PointsPersonRow[]>([]);
  const [order, setOrder] = useState<PersonsOrder>('period');
  const [chartMode, setChartMode] = useState<'stacked' | 'grouped'>('stacked');
  const [loading, setLoading] = useState(true);

  const step = useMemo(() => {
    const mx = summary?.balance_max ?? 0;
    return mx > 1000 ? 100 : mx > 300 ? 50 : mx > 100 ? 20 : mx > 40 ? 10 : 5;
  }, [summary?.balance_max]);

  const loadMain = useCallback(async () => {
    const [s, tl, c, sv] = await Promise.all([
      fetchPointsPeriodSummary(supabase, period, filter),
      fetchPointsTimeline(supabase, period, filter),
      fetchPointsByClassPeriod(supabase, period, filter),
      fetchPointsByServant(supabase, period, filter),
    ]);
    setSummary(s); setTimeline(tl); setByClass(c); setByServant(sv);
    const mx = s.balance_max;
    const st = mx > 1000 ? 100 : mx > 300 ? 50 : mx > 100 ? 20 : mx > 40 ? 10 : 5;
    setDist(await fetchPointsDistribution(supabase, st, filter));
  }, [supabase, period, filter]);

  const loadPersons = useCallback(async () => {
    setPersons(await fetchPointsPersons(supabase, period, filter, order, 10));
  }, [supabase, period, filter, order]);

  const reload = useCallback(async () => {
    onError(null);
    try {
      await Promise.all([loadMain(), loadPersons()]);
      onLoaded();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'تعذر تحميل إحصائيات النقاط');
    } finally {
      setLoading(false);
    }
  }, [loadMain, loadPersons, onError, onLoaded]);

  useEffect(() => { reload(); }, [reload]);

  const keys = useMemo(() => bucketKeys(period), [period]);
  const labels = useMemo(() => keys.map((k) => bucketLabel(k, period.bucket)), [keys, period.bucket]);
  const longLabels = useMemo(() => keys.map((k) => bucketLongLabel(k, period.bucket)), [keys, period.bucket]);
  const causeSeries = useMemo(
    () => buildSeries(timeline, keys, (r) => ({ id: r.cause_id, name: r.cause_name, value: r.net }), churchNames),
    [timeline, keys, churchNames]
  );
  const netLine = useMemo(() => [
    { key: 'added', label: 'إضافة', color: '#10b981', values: alignToKeys(timeline, keys, (r) => r.added) },
    { key: 'removed', label: 'خصم', color: '#ef4444', values: alignToKeys(timeline, keys, (r) => r.removed), dashed: true },
  ], [timeline, keys]);
  const causeTotals = useMemo(() => {
    const m = new Map<string, { id: string | null; name: string; entries: number; added: number; removed: number; net: number }>();
    timeline.forEach((r) => {
      const k = r.cause_id ?? 'none';
      const c = m.get(k) ?? { id: r.cause_id, name: r.cause_name, entries: 0, added: 0, removed: 0, net: 0 };
      c.entries += r.entries; c.added += r.added; c.removed += r.removed; c.net += r.net;
      m.set(k, c);
    });
    return Array.from(m.values()).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }, [timeline]);

  const s = summary;

  useImperativeHandle(ref, () => ({
    reload,
    exportSheets: () => [
      { name: 'النقاط — ملخص', rows: s ? [
        { البند: 'صافي نقاط الفترة', القيمة: s.net },
        { البند: 'نقاط الحضور', القيمة: s.attendance_points },
        { البند: 'نقاط الأسباب (إضافة)', القيمة: s.cause_added },
        { البند: 'نقاط الأسباب (خصم)', القيمة: s.cause_removed },
        { البند: 'عدد عمليات الأسباب', القيمة: s.cause_entries },
        { البند: 'أسباب مستخدمة', القيمة: s.causes_used },
        { البند: 'مستفيدون (أفراد)', القيمة: s.recipients },
        { البند: 'المخدومون في النطاق', القيمة: s.scope_persons },
        { البند: 'إجمالي الأرصدة الحالية', القيمة: s.balance_total },
        { البند: 'متوسط الرصيد', القيمة: s.balance_avg },
        { البند: 'أعلى رصيد', القيمة: s.balance_max },
        { البند: 'رصيد صفر', القيمة: s.zero_balance },
        { البند: 'خدام منحوا نقاطاً', القيمة: s.servants },
        { البند: 'أعلى يوم', القيمة: s.best_day ? `${s.best_day} (${s.best_day_net})` : '' },
      ] : [] },
      { name: 'النقاط عبر الفترة', rows: keys.map((k, i) => {
        const row: Record<string, unknown> = { الفترة: k };
        causeSeries.forEach((x) => { row[x.label] = x.values[i] ?? 0; });
        row['إضافة'] = netLine[0].values[i]; row['خصم'] = netLine[1].values[i];
        return row;
      }) },
      { name: 'النقاط حسب السبب', rows: causeTotals.map((c) => ({ السبب: c.name, 'عدد المرات': c.entries, إضافة: c.added, خصم: c.removed, الصافي: c.net })) },
      { name: 'توزيع الأرصدة', rows: dist.map((d) => ({ 'من': d.bucket_from, 'إلى': d.bucket_to, 'عدد المخدومين': d.persons })) },
      { name: 'النقاط حسب الفصل', rows: byClass.map((r) => ({
        الكنيسة: r.church_name, الخدمة: r.service_name, الفصل: r.class_name, المسجلون: r.enrolled, 'نقاط الحضور': r.attendance_points,
        إضافة: r.cause_added, خصم: r.cause_removed, 'صافي الفترة': r.net, المستفيدون: r.recipients, 'رصيد الفصل': r.balance, 'متوسط الرصيد': r.avg_balance,
      })) },
      { name: 'النقاط حسب الخادم', rows: byServant.map((r, i) => ({
        الترتيب: i + 1, الخادم: r.servant_name, الدور: ROLE_LABELS[r.role ?? ''] ?? r.role ?? '', 'عمليات أسباب': r.entries, إضافة: r.added, خصم: r.removed,
        الصافي: r.net, المستفيدون: r.recipients, 'تسجيلات حضور': r.attendance_scans, 'نقاط حضور': r.attendance_points, 'آخر عملية': formatDateTimeShort(r.last_at),
      })) },
      { name: 'المخدومون — النقاط', rows: persons.map((p, i) => ({
        الترتيب: i + 1, الاسم: p.name, الفصل: p.class_name ?? '', 'نقاط حضور الفترة': p.period_attendance_points, 'إضافة الفترة': p.period_added,
        'خصم الفترة': p.period_removed, 'صافي الفترة': p.period_net, الرصيد: p.balance, 'مرات الحضور': p.attendance_count,
      })) },
    ],
  }), [reload, s, keys, causeSeries, netLine, causeTotals, dist, byClass, byServant, persons]);

  if (loading) return <div className="flex justify-center py-16"><span className="h-8 w-8 animate-spin rounded-full border-4 border-amber-200 border-t-amber-600" /></div>;

  const maxGrant = Math.max(1, ...byServant.map((r) => r.added + r.attendance_points));

  return (
    <div className="space-y-4">
      {/* ---------- 1. KPIs ---------- */}
      <section id="pts-kpis" className="grid grid-cols-2 gap-3">
        <KpiTile icon={Sigma} value={fmtSigned(s?.net ?? 0)} label="صافي نقاط الفترة" tone="gold" hint={`${fmtNum(s?.recipients ?? 0)} مستفيد من ${fmtNum(s?.scope_persons ?? 0)}`} />
        <KpiTile icon={CalendarCheck} value={s?.attendance_points ?? 0} label="نقاط الحضور" tone="emerald" hint={`${pct(s?.attendance_points ?? 0, (s?.attendance_points ?? 0) + (s?.cause_added ?? 0))}% من الإضافات`} />
        <KpiTile icon={PlusCircle} value={s?.cause_added ?? 0} label="إضافة بسبب" tone="primary" hint={`${fmtNum(s?.cause_entries ?? 0)} عملية · ${fmtNum(s?.causes_used ?? 0)} سبب`} />
        <KpiTile icon={MinusCircle} value={s?.cause_removed ?? 0} label="خصم" tone="rose" hint={s?.best_day ? `أعلى يوم ${fmtSigned(s.best_day_net)}` : undefined} />
      </section>

      {/* ---------- 2. Sources ---------- */}
      <SectionCard id="pts-sources" icon={Coins} title="مصادر النقاط" subtitle="من أين جاءت نقاط الفترة" tone="gold">
        <SegmentDonut
          id="pts-donut"
          centerLabel="نقطة"
          centerValue={fmtSigned(s?.net ?? 0)}
          segments={[
            { key: 'att', label: 'حضور', value: s?.attendance_points ?? 0, color: '#10b981', icon: <CalendarCheck className="h-3 w-3" /> },
            { key: 'add', label: 'أسباب (إضافة)', value: s?.cause_added ?? 0, color: '#f59e0b', icon: <PlusCircle className="h-3 w-3" /> },
            { key: 'rem', label: 'خصم', value: s?.cause_removed ?? 0, color: '#ef4444', icon: <MinusCircle className="h-3 w-3" /> },
          ]}
          emptyText="لم تُمنح نقاط في هذه الفترة"
        />
        {s?.best_day && (
          <p className="mt-3 flex items-center gap-1.5 rounded-xl bg-gold-50 px-3 py-2 text-[11px] font-extrabold text-gold-700">
            <Sparkles className="h-3.5 w-3.5" /> أعلى يوم: {formatDay(s.best_day)} — {fmtSigned(s.best_day_net)}
          </p>
        )}
      </SectionCard>

      {/* ---------- 3. Timeline ---------- */}
      <SectionCard id="pts-timeline" icon={TrendingUp} title="النقاط عبر الفترة" subtitle="إضافة وخصم نقاط الأسباب" tone="primary">
        <LineAreaChart id="pts-line" series={netLine} labels={labels} longLabels={longLabels} height={150} emptyText="لم تُمنح نقاط بسبب في هذه الفترة" />
      </SectionCard>

      <SectionCard id="pts-by-cause-chart" icon={BarChart3} title="النقاط حسب السبب عبر الفترة" subtitle="صافي كل سبب" tone="gold"
        actions={
          <button type="button" onClick={() => setChartMode((m) => (m === 'stacked' ? 'grouped' : 'stacked'))} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-extrabold text-slate-600 active:scale-95">
            {chartMode === 'stacked' ? 'متراكم' : 'متجاور'}
          </button>
        }>
        <StackedBarChart id="pts-stacked" series={causeSeries.map((x) => ({ ...x, values: x.values.map((v) => Math.max(0, v)) }))} labels={labels} longLabels={longLabels} mode={chartMode} height={150} emptyText="لم تُمنح نقاط بسبب في هذه الفترة" />
      </SectionCard>

      {/* ---------- 4. By cause ---------- */}
      <SectionCard id="pts-by-cause" icon={Tag} title="الأسباب الأكثر استخداماً" subtitle="صافي النقاط لكل سبب في الفترة" tone="gold"
        actions={<span className="badge bg-gold-100 text-gold-700">{fmtNum(causeTotals.length)} سبب</span>}>
        <RankedBars
          items={causeTotals.map((c, i) => ({
            key: c.id ?? `none-${i}`, label: c.name, value: c.net, color: c.net < 0 ? '#ef4444' : seriesColor(i),
            sublabel: `${fmtNum(c.entries)} مرة`, secondary: `+${fmtNum(c.added)}${c.removed ? ` / −${fmtNum(c.removed)}` : ''}`,
          }))}
          valueLabel={fmtSigned}
          emptyText="لم تُستخدم أسباب في هذه الفترة"
        />
      </SectionCard>

      {/* ---------- 5. Balances ---------- */}
      <SectionCard id="pts-balances" icon={Wallet} title="الأرصدة الحالية" subtitle="توزيع رصيد النقاط بين المخدومين (الآن)" tone="violet">
        <div className="grid grid-cols-4 gap-2">
          <MiniStat label="الإجمالي" value={s?.balance_total ?? 0} tone="gold" />
          <MiniStat label="المتوسط" value={s?.balance_avg ?? 0} tone="primary" />
          <MiniStat label="الأعلى" value={s?.balance_max ?? 0} tone="emerald" />
          <MiniStat label="رصيد صفر" value={s?.zero_balance ?? 0} tone="rose" />
        </div>
        <div className="mt-3">
          <Histogram
            id="pts-hist"
            color="#8b5cf6"
            bars={dist.map((d) => ({ label: d.bucket_from === 0 ? `0–${d.bucket_to}` : `${d.bucket_from}–${d.bucket_to}`, value: d.persons, hint: `${d.persons} مخدوم رصيدهم بين ${d.bucket_from} و ${d.bucket_to}` }))}
            unit=" مخدوم"
          />
        </div>
        <p className="mt-1 text-[10px] font-bold text-slate-400">كل عمود = شريحة {fmtNum(step)} نقطة</p>
      </SectionCard>

      {/* ---------- 6. By class ---------- */}
      {byClass.length > 0 && (
        <SectionCard id="pts-by-class" icon={BookOpen} title="النقاط حسب الفصل" subtitle="صافي الفترة · نسبة المستفيدين · رصيد الفصل" tone="violet"
          actions={<span className="badge bg-violet-100 text-violet-700">{fmtNum(byClass.length)} فصل</span>}>
          <ProgressTable
            rows={[...byClass].sort((a, b) => b.net - a.net).map((r) => ({
              key: r.class_id, label: r.class_name,
              sublabel: `${r.church_name} › ${r.service_name} · حضور ${fmtNum(r.attendance_points)} · إضافة ${fmtNum(r.cause_added)} · خصم ${fmtNum(r.cause_removed)} · رصيد الفصل ${fmtNum(r.balance)} (متوسط ${r.avg_balance})`,
              num: r.recipients, den: r.enrolled, color: '#8b5cf6',
              extra: <span className="badge bg-gold-100 text-gold-700"><Star className="h-3 w-3" /> {fmtSigned(r.net)}</span>,
            }))}
            numLabel={(r) => `${fmtNum(r.num)} مستفيد / ${fmtNum(r.den)}`}
          />
        </SectionCard>
      )}

      {/* ---------- 7. By servant ---------- */}
      <SectionCard id="pts-by-servant" icon={UserRound} title="من منح النقاط" subtitle="نقاط الأسباب وتسجيلات الحضور لكل خادم" tone="sky">
        {byServant.length === 0 ? <EmptyState text="لا توجد عمليات نقاط في الفترة" /> : (
          <ul className="space-y-2">
            {byServant.map((r, i) => (
              <li key={r.servant_id ?? `none-${i}`} className="rounded-xl bg-slate-50 px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${i === 0 ? 'bg-gold-100 text-gold-700' : 'bg-white text-slate-500 ring-1 ring-slate-100'}`}>{i + 1}</span>
                  <Avatar url={r.photo_url} name={r.servant_name} tone="from-sky-600 to-cyan-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-slate-800">{r.servant_name}</p>
                    <p className="truncate text-[10px] font-bold text-slate-400">{ROLE_LABELS[r.role ?? ''] ?? r.role ?? ''} · {fmtNum(r.recipients)} مستفيد · {fmtNum(r.attendance_scans)} تسجيل حضور{r.last_at ? ` · آخر ${formatDateTimeShort(r.last_at)}` : ''}</p>
                  </div>
                  <span className="badge bg-gold-100 text-gold-700"><Star className="h-3 w-3" /> {fmtNum(r.added + r.attendance_points)}</span>
                </div>
                <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-white">
                  <div className="h-full bg-emerald-500" style={{ width: `${(r.attendance_points / maxGrant) * 100}%` }} title="نقاط حضور" />
                  <div className="h-full bg-gold-500" style={{ width: `${(r.added / maxGrant) * 100}%` }} title="إضافة" />
                  <div className="h-full bg-rose-500" style={{ width: `${(r.removed / maxGrant) * 100}%` }} title="خصم" />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] font-bold text-slate-500">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> حضور {fmtNum(r.attendance_points)}</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gold-500" /> إضافة {fmtNum(r.added)}</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> خصم {fmtNum(r.removed)}</span>
                  <span className="mr-auto">{fmtNum(r.entries)} عملية</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* ---------- 8. Persons ---------- */}
      <SectionCard id="pts-persons" icon={Trophy} title={ORDERS.find((o) => o.value === order)?.label ?? ''} subtitle="أعلى 10 في النطاق والفترة" tone="gold">
        <Chips tone="bg-amber-500" value={order} onChange={setOrder} options={ORDERS} />
        {persons.length === 0 ? <div className="mt-3"><EmptyState text="لا توجد بيانات" /></div> : (
          <ul className="mt-3 space-y-1.5">
            {persons.map((p, i) => (
              <PersonRow key={p.enrollment_id} rank={i + 1} url={p.image_url} name={p.name} highlight={i === 0 ? 'gold' : null}
                sub={<>{p.class_name ?? ''} · حضور {fmtNum(p.period_attendance_points)} · إضافة {fmtNum(p.period_added)}{p.period_removed ? ` · خصم ${fmtNum(p.period_removed)}` : ''}</>}
                badges={<>
                  <span className={`badge ${order === 'removed' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{order === 'removed' ? `−${fmtNum(p.period_removed)}` : fmtSigned(p.period_net)}</span>
                  <span className="badge bg-gold-100 text-gold-700"><Star className="h-3 w-3" /> {fmtNum(p.balance)}</span>
                </>} />
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
});

export default PointsTab;
