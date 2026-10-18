'use client';

// =====================================================================
// الإحصائيات — four tabs (20261018120000)
//
//   نظرة عامة  — the original 0020 screen (KPIs · selected day · timelines ·
//                leaderboard)                                  → OverviewTab
//   الحضور     — attendance analytics over a window: rates, distribution,
//                by event / class / weekday / hour, regulars, absentees
//                                                              → AttendanceTab
//   النقاط     — points analytics: sources, by cause / class / servant,
//                balances, top earners                         → PointsTab
//   الافتقاد   — calls: by servant or by class, coverage of absentees,
//                feedback outcomes, who was / wasn't called    → CallsTab
//
// Shared sticky controls: scope (كنيسة · خدمة · فصل · مناسبة) + the day
// picker + the window bar (اليوم · هذا الأسبوع · هذا الشهر · 30 يوم ·
// 3 أشهر · هذه السنة · مخصص). URL: /stats?tab=overview|attendance|points|calls
//
// Every number is an RPC aggregate. Realtime: one debounced, rate-limited
// listener reloads the ACTIVE tab (≤ once per minute during a burst);
// «تحديث» is instant. Excel exports every table of the active tab.
// =====================================================================

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  BarChart3, CalendarDays, ChevronRight, ChevronLeft, Loader2, RefreshCw, Download, Church, ListChecks,
  LayoutDashboard, CalendarCheck, Star, PhoneCall,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { useAppDate } from '@/lib/app-date-context';
import { createClient } from '@/lib/supabase/client';
import { cachedLookup, ALL, type ScopeSelection } from '@/lib/queries';
import { useDebouncedRealtime, scopeFilter } from '@/lib/realtime';
import { cairoToday } from '@/lib/time';
import type { Church as ChurchT, Service, ClassRoom, AppEvent } from '@/lib/types';
import { shiftDay, formatDay, type Bucket, type Period } from '@/lib/stats';
import { resolveWindow, type StatsFilter, type WindowPreset } from '@/lib/stats-period';
import { TabBar } from '@/components/stats/Charts2';
import { PeriodBar, EventSelect, ErrorBox } from '@/components/stats/StatsControls';
import OverviewTab from '@/components/stats/OverviewTab';
import AttendanceTab from '@/components/stats/AttendanceTab';
import PointsTab from '@/components/stats/PointsTab';
import CallsTab, { type TabHandle } from '@/components/stats/CallsTab';
import { useNavLabel } from '@/lib/customization-context';

type Tab = 'overview' | 'attendance' | 'points' | 'calls';
const TABS: { key: Tab; label: string; icon: typeof BarChart3; tone: string; chip: string }[] = [
  { key: 'overview', label: 'نظرة عامة', icon: LayoutDashboard, tone: 'bg-primary-600', chip: 'bg-primary-600' },
  { key: 'attendance', label: 'الحضور', icon: CalendarCheck, tone: 'bg-emerald-600', chip: 'bg-emerald-600' },
  { key: 'points', label: 'النقاط', icon: Star, tone: 'bg-amber-500', chip: 'bg-amber-500' },
  { key: 'calls', label: 'الافتقاد', icon: PhoneCall, tone: 'bg-teal-600', chip: 'bg-teal-600' },
];
const isTab = (v: string | null): v is Tab => v === 'overview' || v === 'attendance' || v === 'points' || v === 'calls';

export default function StatsPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>}>
        <StatsModule />
      </Suspense>
    </AppShell>
  );
}

function StatsModule() {
  const pageName = useNavLabel('stats');
  const { profile, scopes } = useAuth();
  const { now } = useAppDate();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const router = useRouter();
  const params = useSearchParams();
  const rawTab = params.get('tab');
  const tab: Tab = isTab(rawTab) ? rawTab : 'overview';
  const setTab = (t: Tab) => router.replace(t === 'overview' ? '/stats' : `/stats?tab=${t}`);
  const tabMeta = TABS.find((t) => t.key === tab) ?? TABS[0];

  // ---------- Lookups ----------
  const [churches, setChurches] = useState<ChurchT[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);

  useEffect(() => {
    if (!approved) return;
    (async () => {
      const [c, s, k, e] = await Promise.all([
        cachedLookup<ChurchT>(supabase, 'churches'),
        cachedLookup<Service>(supabase, 'services'),
        cachedLookup<ClassRoom>(supabase, 'classes'),
        cachedLookup<AppEvent>(supabase, 'events'),
      ]);
      setChurches(c); setServices(s); setClasses(k); setEvents(e);
    })();
  }, [approved, supabase]);

  // ---------- Scope selectors (cascading, each with ALL) + event ----------
  const [churchFilter, setChurchFilter] = useState<string>(ALL);
  const [serviceFilter, setServiceFilter] = useState<string>(ALL);
  const [classFilter, setClassFilter] = useState<string>(ALL);
  const [eventFilter, setEventFilter] = useState<string>(ALL);

  const visibleServices = useMemo(() => services.filter((s) => churchFilter === ALL || s.church_id === churchFilter), [services, churchFilter]);
  const visibleClasses = useMemo(
    () => classes.filter((c) => (churchFilter === ALL || c.church_id === churchFilter) && (serviceFilter === ALL || c.service_id === serviceFilter)),
    [classes, churchFilter, serviceFilter]
  );
  const visibleEvents = useMemo(() => {
    const cls = classFilter !== ALL ? classes.find((c) => c.id === classFilter) : null;
    return events.filter((ev) =>
      (churchFilter === ALL || ev.church_id === churchFilter) &&
      (serviceFilter === ALL || ev.service_id === null || ev.service_id === serviceFilter) &&
      (!cls || ev.class_id === null || ev.class_id === cls.id)
    );
  }, [events, churchFilter, serviceFilter, classFilter, classes]);
  useEffect(() => {
    if (eventFilter !== ALL && !visibleEvents.some((e) => e.id === eventFilter)) setEventFilter(ALL);
  }, [visibleEvents, eventFilter]);

  const onChurchChange = (v: string) => { setChurchFilter(v); setServiceFilter(ALL); setClassFilter(ALL); };
  const onServiceChange = (v: string) => { setServiceFilter(v); setClassFilter(ALL); };

  const scope: ScopeSelection = useMemo(() => ({ church: churchFilter, service: serviceFilter, class: classFilter }), [churchFilter, serviceFilter, classFilter]);
  const filter: StatsFilter = useMemo(() => ({ ...scope, event: eventFilter }), [scope, eventFilter]);
  const scopeText = useMemo(() => {
    const parts: string[] = [];
    parts.push(churchFilter === ALL ? 'كل الكنائس' : churches.find((c) => c.id === churchFilter)?.name ?? '');
    parts.push(serviceFilter === ALL ? 'كل الخدمات' : services.find((s) => s.id === serviceFilter)?.name ?? '');
    parts.push(classFilter === ALL ? 'كل الفصول' : classes.find((c) => c.id === classFilter)?.name ?? '');
    if (eventFilter !== ALL) parts.push(events.find((e) => e.id === eventFilter)?.name ?? '');
    return parts.filter(Boolean).join(' › ');
  }, [churchFilter, serviceFilter, classFilter, eventFilter, churches, services, classes, events]);
  const churchNames = useMemo(() => {
    const m: Record<string, string> = {};
    churches.forEach((c) => { m[c.id] = c.name; });
    return m;
  }, [churches]);

  // ---------- Selected day (follows the header working date until touched) ----------
  const workingDay = cairoToday(now());
  const [day, setDay] = useState<string>(workingDay);
  const [dayTouched, setDayTouched] = useState(false);
  useEffect(() => { if (!dayTouched) setDay(workingDay); }, [workingDay, dayTouched]);
  const pickDay = (d: string) => { if (d) { setDay(d); setDayTouched(true); } };
  const liveToday = cairoToday();

  // ---------- Window (period) ----------
  const [preset, setPreset] = useState<WindowPreset>('month');
  const [custom, setCustom] = useState({ from: shiftDay(workingDay, -29), to: workingDay });
  const [bucketOverride, setBucketOverride] = useState<Bucket | null>(null);
  const period: Period = useMemo(() => {
    const p = resolveWindow(preset, day, custom, liveToday);
    return bucketOverride ? { ...p, bucket: bucketOverride } : p;
  }, [preset, day, custom, liveToday, bucketOverride]);
  const choosePreset = (p: WindowPreset) => { setPreset(p); setBucketOverride(null); };
  // the overview keeps a 30-day trailing timeline when the window is a single day
  const overviewPeriod: Period = useMemo(
    () => (period.from === period.to ? { from: shiftDay(day, -29), to: day, bucket: 'day' } : period),
    [period, day]
  );

  // ---------- Status shared by the tabs ----------
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const onError = useCallback((e: string | null) => { setError(e); if (e) setRefreshing(false); }, []);
  const onLoaded = useCallback(() => { setUpdatedAt(new Date()); setRefreshing(false); }, []);

  const tabRef = useRef<TabHandle | null>(null);
  const reloadActive = useCallback(async () => { await tabRef.current?.reload(); }, []);
  const manualRefresh = () => { setRefreshing(true); void reloadActive(); };

  useDebouncedRealtime(
    supabase,
    'stats-page',
    [
      { table: 'attendance_log' },
      { table: 'points_log' },
      { table: 'contact_log' },
      { table: 'enrollments', filter: scopeFilter(profile, scopes) },
    ],
    reloadActive,
    { enabled: approved, delayMs: 2000, minIntervalMs: 60_000 }
  );

  // ---------- Excel (active tab) ----------
  const [exporting, setExporting] = useState(false);
  const exportExcel = async () => {
    const sheets = tabRef.current?.exportSheets() ?? [];
    if (sheets.length === 0) return;
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const used = new Set<string>();
      const head = [{ البند: 'النطاق', القيمة: scopeText }, { البند: 'الفترة', القيمة: `${period.from} → ${period.to}` }, { البند: 'اليوم المحدد', القيمة: day }];
      sheets.forEach((sh, i) => {
        const rows = i === 0 && sh.name.includes('ملخص') ? [...head, ...sh.rows] : sh.rows;
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': 'لا توجد بيانات' }]);
        ws['!views'] = [{ rightToLeft: true }];
        let name = sh.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
        let n = 2;
        while (used.has(name)) name = `${name.slice(0, 28)} ${n++}`;
        used.add(name);
        XLSX.utils.book_append_sheet(wb, ws, name);
      });
      XLSX.writeFile(wb, `احصائيات_${tabMeta.label}_${period.from}_${period.to}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  const selectCls = 'input-field appearance-none !px-2 !py-2.5 text-xs font-bold';
  const migration = tab === 'overview' ? '0020_statistics_rpcs.sql' : '20261018120000_stats_tabs_calls_attendance_points.sql';

  return (
    <>
      {/* ---------- Header ---------- */}
      <section id="stats-header" className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <BarChart3 className="h-5 w-5 text-primary-600" />
          {pageName}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold text-white ${tabMeta.chip}`}>{tabMeta.label}</span>
        </h2>
        <div className="flex items-center gap-1.5">
          <button id="stats-export" onClick={exportExcel} disabled={exporting} className="btn-secondary flex items-center gap-1 !px-3 !py-2 text-xs" aria-label="تصدير Excel">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Excel
          </button>
          <button id="stats-refresh" onClick={manualRefresh} disabled={refreshing} className="btn-secondary flex items-center gap-1 !px-3 !py-2 text-xs" aria-label="تحديث">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </section>

      {/* ---------- Tabs ---------- */}
      <div className="mb-3">
        <TabBar id="stats-tabs" tabs={TABS} value={tab} onChange={setTab} />
      </div>

      {/* ---------- Sticky control zone: scope + event + day ---------- */}
      <div id="stats-controls" className="sticky top-[71px] z-30 -mx-4 mb-4 bg-slate-50/95 px-4 pb-3 pt-1 backdrop-blur-md">
        <div className="grid grid-cols-3 gap-2">
          <select id="stats-church" aria-label="اختيار الكنيسة" className={selectCls} value={churchFilter} onChange={(e) => onChurchChange(e.target.value)} disabled={churches.length <= 1}>
            <option value={ALL}>{churches.length === 1 ? churches[0].name : 'كل الكنائس'}</option>
            {churches.length > 1 && churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select id="stats-service" aria-label="اختيار الخدمة" className={selectCls} value={serviceFilter} onChange={(e) => onServiceChange(e.target.value)} disabled={visibleServices.length <= 1}>
            <option value={ALL}>{visibleServices.length === 1 ? visibleServices[0].name : 'كل الخدمات'}</option>
            {visibleServices.length > 1 && visibleServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select id="stats-class" aria-label="اختيار الفصل" className={selectCls} value={classFilter} onChange={(e) => setClassFilter(e.target.value)} disabled={visibleClasses.length <= 1}>
            <option value={ALL}>{visibleClasses.length === 1 ? visibleClasses[0].name : 'كل الفصول'}</option>
            {visibleClasses.length > 1 && visibleClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
          {/* Day picker */}
          <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white px-1.5 py-1">
            <button type="button" aria-label="اليوم السابق" onClick={() => pickDay(shiftDay(day, -1))} className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 active:scale-95">
              <ChevronRight className="h-5 w-5" />
            </button>
            <label className="flex min-w-0 flex-1 items-center gap-1.5">
              <CalendarDays className="h-4 w-4 shrink-0 text-primary-600" />
              <input id="stats-day" type="date" value={day} max={liveToday} onChange={(e) => pickDay(e.target.value)} className="min-w-0 flex-1 bg-transparent text-xs font-extrabold tabular-nums text-slate-800 outline-none" />
            </label>
            <button type="button" onClick={() => { setDay(workingDay); setDayTouched(false); }} className={`rounded-lg px-2 py-1 text-[10px] font-extrabold transition active:scale-95 ${day === workingDay ? `${tabMeta.chip} text-white` : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
              {workingDay === liveToday ? 'اليوم' : 'تاريخ العمل'}
            </button>
            <button type="button" aria-label="اليوم التالي" onClick={() => pickDay(shiftDay(day, 1))} disabled={day >= liveToday} className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 active:scale-95 disabled:opacity-30">
              <ChevronLeft className="h-5 w-5" />
            </button>
          </div>
          {/* Event */}
          <div className="w-[7.5rem] xs:w-40">
            <EventSelect id="stats-event" events={visibleEvents} value={eventFilter} onChange={setEventFilter} />
          </div>
        </div>
        <p className="mt-1.5 truncate px-1 text-[11px] font-bold text-slate-400">{formatDay(day)} · {scopeText}</p>
      </div>

      {/* ---------- Window bar (period) ---------- */}
      <div className="mb-4">
        <PeriodBar
          id="stats-window"
          preset={preset}
          onPreset={choosePreset}
          period={period}
          custom={custom}
          onCustom={setCustom}
          bucket={period.bucket}
          onBucket={setBucketOverride}
          today={liveToday}
          tone={tabMeta.chip}
          showBucket={tab !== 'overview' || period.from !== period.to}
        />
      </div>

      {error && <ErrorBox error={error} migration={migration} />}

      {!approved ? null : tab === 'overview' ? (
        <OverviewTab key="overview" ref={tabRef} supabase={supabase} scope={scope} scopeText={scopeText} day={day} period={overviewPeriod} churchNames={churchNames} onError={onError} onLoaded={onLoaded} />
      ) : tab === 'attendance' ? (
        <AttendanceTab key="attendance" ref={tabRef} supabase={supabase} period={period} filter={filter} churchNames={churchNames} onError={onError} onLoaded={onLoaded} />
      ) : tab === 'points' ? (
        <PointsTab key="points" ref={tabRef} supabase={supabase} period={period} filter={filter} churchNames={churchNames} onError={onError} onLoaded={onLoaded} />
      ) : (
        <CallsTab key="calls" ref={tabRef} supabase={supabase} period={period} filter={filter} onError={onError} onLoaded={onLoaded} />
      )}

      {/* ---------- Footer ---------- */}
      <p className="mt-4 flex items-center justify-center gap-1.5 pb-2 text-[10px] font-bold text-slate-400">
        <Church className="h-3 w-3" />
        {updatedAt
          ? `آخر تحديث ${new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(updatedAt)} · يتحدث تلقائياً`
          : ''}
        <ListChecks className="h-3 w-3" />
      </p>
    </>
  );
}
