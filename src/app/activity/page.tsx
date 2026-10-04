'use client';

// ---------- ACTIVITY LOG (سجل النشاط) ----------
// ONE page, four tabs:
//   السجل       — the live timeline (newest first). Filters: search · scope
//                 (church → service → class) · period · actor kind · op.
//                 Loads 10 / 100 / 1000 rows per «dig» and keeps digging
//                 with keyset pagination (never skips / repeats rows).
//   بالمستخدم   — every actor (servant · child · system) with counts; tap
//                 one → his timeline.
//   بالعملية    — operations grouped by module (حضور · نقاط · بيانات …)
//                 with counts; tap one → its timeline.
//   نظرة عامة   — KPIs + 30-day bars + hour histogram (owner also sees
//                 the retention settings and the prune button).
// Every row opens a details sheet with the full diff (قبل ← بعد) and quick
// «filter by this actor / target / batch / action» buttons.
// URL params keep the view shareable: ?tab=&actor=&kind=&action=&person=&batch=

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Loader2, Search, X, History, Users, ListTree, PieChart, RefreshCw, FileSpreadsheet, Radio, SlidersHorizontal,
  Cpu, User, Trash2, Save, Clock, Database, ChevronLeft,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import {
  ActivityHeader, ActivityItem, ActivityDetails, LoadMoreBar, Toast, Empty, ActorChip, ActorAvatar,
} from '@/components/activity/ActivityBits';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { useDebouncedRealtime } from '@/lib/realtime';
import { cachedLookup, ALL } from '@/lib/queries';
import type { Church, Service, ClassRoom } from '@/lib/types';
import {
  fetchFeed, fetchSummary, fetchActors, fetchPermissions, fetchSettings, saveSettings, prune, exportRowsToExcel,
  activityErrorMessage, actionLabel, groupOf, ACTIVITY_GROUPS, ROLE_LABELS, ACTOR_KIND_LABELS, OP_LABELS, fmtDateTime, relTime,
  type ActivityRow, type ActivityFilters, type ActivityActor, type ActivitySummary, type ActivityPermissions,
  type ActivitySettings, type PageSize, type ActorKind, type ActivityOp,
} from '@/lib/activity';

type Tab = 'feed' | 'users' | 'ops' | 'overview';
type Period = 'today' | '7d' | '30d' | 'all';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'اليوم' }, { value: '7d', label: '٧ أيام' }, { value: '30d', label: '٣٠ يومًا' }, { value: 'all', label: 'الكل' },
];

function periodFrom(p: Period): string | undefined {
  if (p === 'all') return undefined;
  const now = new Date();
  if (p === 'today') {
    // Cairo midnight
    const cairo = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
    cairo.setHours(0, 0, 0, 0);
    const offset = now.getTime() - new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' })).getTime();
    return new Date(cairo.getTime() + offset).toISOString();
  }
  const days = p === '7d' ? 7 : 30;
  return new Date(now.getTime() - days * 86400_000).toISOString();
}

export default function ActivityPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>}>
        <ActivityInner />
      </Suspense>
    </AppShell>
  );
}

function ActivityInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());

  // ---- URL state ----
  const tab = (params.get('tab') as Tab) || 'feed';
  const actorId = params.get('actor');
  const actorKind = (params.get('kind') as ActorKind | null);
  const action = params.get('action');
  const actionPrefix = params.get('group');
  const personId = params.get('person');
  const batchId = params.get('batch');
  const setParams = useCallback((patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    Object.entries(patch).forEach(([k, v]) => { if (v === null || v === '') p.delete(k); else p.set(k, v); });
    router.replace(`/activity${p.toString() ? `?${p}` : ''}`, { scroll: false });
  }, [params, router]);

  // ---- local filters ----
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setQDebounced(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const [period, setPeriod] = useState<Period>('7d');
  const [kindF, setKindF] = useState<ActorKind | 'all'>('all');
  const [opF, setOpF] = useState<ActivityOp | 'all'>('all');
  const [church, setChurch] = useState<string>(ALL);
  const [service, setService] = useState<string>(ALL);
  const [klass, setKlass] = useState<string>(ALL);
  const [showFilters, setShowFilters] = useState(false);
  const [pageSize, setPageSize] = useState<PageSize>(100);

  // ---- lookups ----
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  useEffect(() => {
    (async () => {
      const [c, s, k] = await Promise.all([
        cachedLookup<Church>(supabase, 'churches'), cachedLookup<Service>(supabase, 'services'), cachedLookup<ClassRoom>(supabase, 'classes'),
      ]);
      setChurches(c); setServices(s); setClasses(k);
    })();
  }, [supabase]);
  const scopeNames = useCallback((r: ActivityRow) => {
    const parts = [
      r.church_id ? churches.find((x) => x.id === r.church_id)?.name : null,
      r.service_id ? services.find((x) => x.id === r.service_id)?.name : null,
      r.class_id ? classes.find((x) => x.id === r.class_id)?.name : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' ← ') : null;
  }, [churches, services, classes]);

  const filters = useMemo<ActivityFilters>(() => {
    const f: ActivityFilters = {};
    if (qDebounced) f.q = qDebounced;
    const from = periodFrom(period); if (from) f.from = from;
    if (kindF !== 'all') f.actor_kind = kindF;
    if (opF !== 'all') f.op = opF;
    if (church !== ALL) f.church_id = church;
    if (service !== ALL) f.service_id = service;
    if (klass !== ALL) f.class_id = klass;
    if (actorId) { f.actor_id = actorId; if (actorKind) f.actor_kind = actorKind; }
    else if (actorKind === 'system') { f.actor_kind = 'system'; }
    if (action) f.action = action;
    if (actionPrefix) f.action_prefix = actionPrefix;
    if (personId) f.target_person_id = personId;
    if (batchId) f.batch_id = batchId;
    return f;
  }, [qDebounced, period, kindF, opF, church, service, klass, actorId, actorKind, action, actionPrefix, personId, batchId]);
  const filterKey = JSON.stringify(filters);

  // ---- permissions / data ----
  const [perms, setPerms] = useState<ActivityPermissions | null>(null);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [done, setDone] = useState(false);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [actors, setActors] = useState<ActivityActor[]>([]);
  const [detail, setDetail] = useState<ActivityRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [fresh, setFresh] = useState(0);            // rows that arrived since the last manual refresh
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  useEffect(() => { fetchPermissions(supabase).then(setPerms); }, [supabase]);

  // The feed and the summary load INDEPENDENTLY: a slow / failing summary
  // (big logs) must not take the timeline down with it, and vice versa.
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true); setSummaryError(null);
    try { setSummary(await fetchSummary(supabase, filters)); }
    catch (e) { setSummaryError(activityErrorMessage(e, 'تعذر تحميل الإحصائيات')); }
    finally { setSummaryLoading(false); }
  }, [supabase, filters]);

  const loadFirst = useCallback(async () => {
    setLoading(true);
    loadSummary();
    try {
      const r = await fetchFeed(supabase, filters, pageSize);
      setRows(r); setDone(r.length < pageSize); setFresh(0);
    } catch (e) { flash(activityErrorMessage(e, 'تعذر تحميل السجل')); }
    finally { setLoading(false); }
  }, [supabase, filters, pageSize, loadSummary]);

  useEffect(() => { loadFirst(); }, [loadFirst]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = async () => {
    if (!rows.length || more) return;
    setMore(true);
    try {
      const last = rows[rows.length - 1];
      const r = await fetchFeed(supabase, filters, pageSize, { created_at: last.created_at, id: last.id });
      setRows((prev) => [...prev, ...r]); setDone(r.length < pageSize);
    } catch (e) { flash(activityErrorMessage(e, 'تعذر التحميل')); }
    finally { setMore(false); }
  };

  useEffect(() => {
    if (tab !== 'users') return;
    fetchActors(supabase, filters).then(setActors).catch(() => setActors([]));
  }, [tab, supabase, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // live: new rows on top (only when nothing is scrolled/loaded beyond the first page)
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const filtersRef = useRef(filters); filtersRef.current = filters;
  const onRealtime = useCallback(async () => {
    setLive(true); setTimeout(() => setLive(false), 1500);
    try {
      const head = rowsRef.current[0];
      const newest = await fetchFeed(supabase, filtersRef.current, 50);
      if (!head) { setRows(newest); setDone(newest.length < 50); return; }
      const add = newest.filter((r) => r.created_at > head.created_at || (r.created_at === head.created_at && r.id > head.id));
      if (add.length) { setRows((prev) => [...add, ...prev]); setFresh((n) => n + add.length); }
      fetchSummary(supabase, filtersRef.current).then(setSummary).catch(() => {});
    } catch { /* ignore */ }
  }, [supabase]);
  useDebouncedRealtime(supabase, 'activity-log', [{ table: 'activity_log' }], onRealtime, { enabled: !!perms?.view, delayMs: 800 });

  // ---- navigation helpers ----
  const goActor = (r: ActivityRow) => setParams({ tab: 'feed', actor: r.actor_id, kind: r.actor_kind, action: null, group: null, person: null, batch: null });
  const goTarget = (r: ActivityRow) => setParams({ tab: 'feed', person: r.target_person_id, actor: null, kind: null, batch: null });
  const goBatch = (r: ActivityRow) => setParams({ tab: 'feed', batch: r.batch_id, actor: null, kind: null, person: null, action: null, group: null });
  const goAction = (r: ActivityRow) => setParams({ tab: 'feed', action: r.action, group: null, batch: null });
  const clearPins = () => setParams({ actor: null, kind: null, action: null, group: null, person: null, batch: null });
  const pinned = actorId || actorKind || action || actionPrefix || personId || batchId;

  const pinnedLabel = useMemo(() => {
    const parts: string[] = [];
    if (actorId) { const a = rows.find((r) => r.actor_id === actorId) ?? null; parts.push(`الفاعل: ${a?.actor_name ?? actors.find((x) => x.actor_id === actorId)?.actor_name ?? '…'}`); }
    else if (actorKind === 'system') parts.push('الفاعل: النظام');
    if (action) parts.push(`العملية: ${actionLabel(action)}`);
    if (actionPrefix) parts.push(`المجموعة: ${groupOf(actionPrefix + '.x').label}`);
    if (personId) { const t = rows.find((r) => r.target_person_id === personId); parts.push(`الشخص: ${t?.target_name ?? '…'}`); }
    if (batchId) parts.push('عملية جماعية واحدة');
    return parts;
  }, [actorId, actorKind, action, actionPrefix, personId, batchId, rows, actors]);

  const TABS: { value: Tab; label: string; icon: ReactNode }[] = [
    { value: 'feed', label: 'السجل', icon: <History className="h-4 w-4" /> },
    { value: 'users', label: 'بالمستخدم', icon: <Users className="h-4 w-4" /> },
    { value: 'ops', label: 'بالعملية', icon: <ListTree className="h-4 w-4" /> },
    { value: 'overview', label: 'نظرة عامة', icon: <PieChart className="h-4 w-4" /> },
  ];

  if (perms && !perms.view) {
    return (
      <>
        <ActivityHeader />
        <Empty icon={<History className="h-7 w-7" />} text="ليست لديك صلاحية عرض سجل النشاط — اطلب من مسؤولك صلاحية «عرض سجل النشاط»" />
      </>
    );
  }

  const svcOptions = services.filter((s) => church === ALL || s.church_id === church);
  const clsOptions = classes.filter((c) => (church === ALL || c.church_id === church) && (service === ALL || c.service_id === service));

  return (
    <>
      <ActivityHeader
        badge={summary ? <span className="badge bg-slate-100 text-slate-600 tabular-nums">{Number(summary.total).toLocaleString('ar-EG')}</span> : undefined}
        right={
          <div className="flex items-center gap-1">
            <span title={live ? 'وصلت عمليات جديدة' : 'مباشر'} className={`flex h-8 w-8 items-center justify-center rounded-full ${live ? 'bg-emerald-100 text-emerald-600' : 'text-slate-300'}`}>
              <Radio className={`h-4 w-4 ${live ? 'animate-pulse' : ''}`} />
            </span>
            <button type="button" onClick={loadFirst} aria-label="تحديث" className="rounded-full p-1.5 hover:bg-slate-100"><RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} /></button>
            <button type="button" onClick={() => rows.length && exportRowsToExcel(rows)} aria-label="تصدير Excel" disabled={!rows.length} className="rounded-full p-1.5 hover:bg-slate-100 disabled:opacity-40"><FileSpreadsheet className="h-5 w-5 text-green-700" /></button>
          </div>
        }
      />

      {/* tabs */}
      <div id="activity-tabs" className="mb-3 grid grid-cols-4 gap-1 rounded-2xl bg-slate-100 p-1">
        {TABS.map((t) => (
          <button key={t.value} type="button" onClick={() => setParams({ tab: t.value })}
            className={`flex items-center justify-center gap-1 rounded-xl px-1 py-2 text-xs font-extrabold transition ${tab === t.value ? 'bg-white text-primary-700 shadow' : 'text-slate-500'}`}>
            {t.icon}<span className="truncate">{t.label}</span>
          </button>
        ))}
      </div>

      {/* search + filters (shared by all tabs) */}
      <div className="mb-3 space-y-2">
        <div className="flex items-center gap-2">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="activity-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث باسم الخادم أو المخدوم أو العملية…"
              className="input-field !ps-9 !py-2.5" />
            {q && <button type="button" onClick={() => setQ('')} aria-label="مسح" className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>}
          </label>
          <button type="button" onClick={() => setShowFilters((v) => !v)} aria-label="فلاتر"
            className={`rounded-xl border p-2.5 ${showFilters || church !== ALL || kindF !== 'all' || opF !== 'all' ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-500'}`}>
            <SlidersHorizontal className="h-5 w-5" />
          </button>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {PERIODS.map((p) => (
            <button key={p.value} type="button" onClick={() => setPeriod(p.value)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-extrabold ${period === p.value ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>{p.label}</button>
          ))}
          <span className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
          {(['all', 'servant', 'child', 'system'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKindF(k)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-extrabold ${kindF === k ? 'bg-primary-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>
              {k === 'all' ? 'كل الفاعلين' : k === 'servant' ? 'الخدام' : k === 'child' ? 'المخدومين' : 'النظام'}
            </button>
          ))}
        </div>
        {showFilters && (
          <div id="activity-filters" className="card grid grid-cols-2 gap-2 !p-3 sm:grid-cols-4">
            <select value={church} onChange={(e) => { setChurch(e.target.value); setService(ALL); setKlass(ALL); }} className="input-field !py-2 text-xs">
              <option value={ALL}>كل الكنائس</option>{churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={service} onChange={(e) => { setService(e.target.value); setKlass(ALL); }} className="input-field !py-2 text-xs">
              <option value={ALL}>كل الخدمات</option>{svcOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={klass} onChange={(e) => setKlass(e.target.value)} className="input-field !py-2 text-xs">
              <option value={ALL}>كل الفصول</option>{clsOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={opF} onChange={(e) => setOpF(e.target.value as ActivityOp | 'all')} className="input-field !py-2 text-xs">
              <option value="all">كل الأنواع</option>
              {(Object.keys(OP_LABELS) as ActivityOp[]).map((o) => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
            </select>
          </div>
        )}
        {pinned && (
          <div id="activity-pinned" className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-primary-50 px-3 py-2 text-xs font-bold text-primary-800 ring-1 ring-primary-100">
            <span className="text-primary-500">مُقيَّد بـ:</span>
            {pinnedLabel.map((l) => <span key={l} className="badge bg-white text-primary-700">{l}</span>)}
            <button type="button" onClick={clearPins} className="ms-auto inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-primary-700 hover:bg-primary-100"><X className="h-3 w-3" /> إزالة</button>
          </div>
        )}
      </div>

      {tab === 'feed' && (
        <FeedTab rows={rows} loading={loading} more={more} done={done} pageSize={pageSize} total={summary?.total ?? null} fresh={fresh}
          onPageSize={setPageSize} onMore={loadMore} onOpen={setDetail} onActor={goActor} onTarget={goTarget} showActor={!actorId} />
      )}
      {tab === 'users' && (
        <UsersTab actors={actors} loading={loading} onPick={(a) => setParams({ tab: 'feed', actor: a.actor_id, kind: a.actor_kind, person: null, batch: null })} />
      )}
      {tab === 'ops' && (summary ? (
        <OpsTab summary={summary} onPick={(a) => setParams({ tab: 'feed', action: a, group: null, batch: null })} onGroup={(g) => setParams({ tab: 'feed', group: g, action: null, batch: null })} />
      ) : (
        <SummaryState loading={summaryLoading} error={summaryError} onRetry={loadSummary} />
      ))}
      {tab === 'overview' && (summary ? (
        <OverviewTab summary={summary} isOwner={profile?.role === 'owner'} supabase={supabase} flash={flash} onPruned={loadFirst} />
      ) : (
        <SummaryState loading={summaryLoading} error={summaryError} onRetry={loadSummary} />
      ))}

      <ActivityDetails row={detail} onClose={() => setDetail(null)} scopeNames={scopeNames}
        onFilterActor={(r) => { setDetail(null); goActor(r); }} onFilterTarget={(r) => { setDetail(null); goTarget(r); }}
        onFilterBatch={(r) => { setDetail(null); goBatch(r); }} onFilterAction={(r) => { setDetail(null); goAction(r); }} />
      <Toast msg={toast} />
    </>
  );
}

// ---------- Feed ----------
function FeedTab({ rows, loading, more, done, pageSize, total, fresh, onPageSize, onMore, onOpen, onActor, onTarget, showActor }: {
  rows: ActivityRow[]; loading: boolean; more: boolean; done: boolean; pageSize: PageSize; total: number | null; fresh: number;
  onPageSize: (n: PageSize) => void; onMore: () => void; onOpen: (r: ActivityRow) => void;
  onActor: (r: ActivityRow) => void; onTarget: (r: ActivityRow) => void; showActor: boolean;
}) {
  if (loading && !rows.length) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>;
  if (!rows.length) return <Empty icon={<History className="h-7 w-7" />} text="لا توجد عمليات مطابقة في هذه الفترة" />;

  // group by Cairo day
  const days: { day: string; items: ActivityRow[] }[] = [];
  for (const r of rows) {
    const day = new Date(r.created_at).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const last = days[days.length - 1];
    if (last && last.day === day) last.items.push(r); else days.push({ day, items: [r] });
  }

  return (
    <>
      {fresh > 0 && <p className="mb-2 text-center text-xs font-extrabold text-emerald-600">وصلت {fresh.toLocaleString('ar-EG')} عملية جديدة</p>}
      <div id="activity-feed" className="space-y-4">
        {days.map((d) => (
          <section key={d.day}>
            <h3 className="sticky top-0 z-[1] mb-2 inline-block rounded-full bg-slate-800 px-3 py-1 text-xs font-extrabold text-white shadow">{d.day} <span className="text-slate-300">· {d.items.length}</span></h3>
            <ul className="space-y-2">
              {d.items.map((r) => <ActivityItem key={r.id} row={r} onOpen={onOpen} onActor={onActor} onTarget={onTarget} showActor={showActor} />)}
            </ul>
          </section>
        ))}
      </div>
      <LoadMoreBar pageSize={pageSize} onPageSize={onPageSize} onMore={onMore} loading={more} done={done} loaded={rows.length} total={total} />
    </>
  );
}

// ---------- By user ----------
function UsersTab({ actors, loading, onPick }: { actors: ActivityActor[]; loading: boolean; onPick: (a: ActivityActor) => void }) {
  if (loading && !actors.length) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>;
  if (!actors.length) return <Empty icon={<Users className="h-7 w-7" />} text="لا يوجد مستخدمون فعلوا شيئًا في هذه الفترة" />;
  const groups: { kind: ActorKind; label: string; icon: ReactNode; list: ActivityActor[] }[] = [
    { kind: 'servant', label: 'الخدام', icon: <User className="h-4 w-4" />, list: actors.filter((a) => a.actor_kind === 'servant') },
    { kind: 'child', label: 'المخدومون (بوابة المخدوم)', icon: <Users className="h-4 w-4" />, list: actors.filter((a) => a.actor_kind === 'child') },
    { kind: 'system', label: 'النظام', icon: <Cpu className="h-4 w-4" />, list: actors.filter((a) => a.actor_kind === 'system') },
  ];
  const max = Math.max(...actors.map((a) => Number(a.n)), 1);
  return (
    <div id="activity-users" className="space-y-4">
      {groups.filter((g) => g.list.length).map((g) => (
        <section key={g.kind}>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-slate-500">{g.icon} {g.label} <span className="badge bg-slate-100 text-slate-500">{g.list.length}</span></h3>
          <ul className="card divide-y divide-slate-100 !p-0">
            {g.list.map((a) => (
              <li key={`${a.actor_kind}:${a.actor_id ?? 'sys'}`}>
                <button type="button" onClick={() => onPick(a)} className="flex w-full items-center gap-3 px-3 py-2.5 text-start hover:bg-slate-50">
                  <ActorAvatar kind={a.actor_kind} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-extrabold text-slate-800">{a.actor_name ?? (a.actor_kind === 'system' ? 'النظام' : ACTOR_KIND_LABELS[a.actor_kind])}</p>
                      <span className="badge bg-slate-100 text-slate-500">{ROLE_LABELS[a.actor_role ?? ''] ?? a.actor_role ?? ''}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.max(3, (Number(a.n) / max) * 100)}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] font-bold text-slate-400">آخر عملية {relTime(a.last_at)} · أولها {fmtDateTime(a.first_at)}</p>
                  </div>
                  <span className="shrink-0 text-lg font-extrabold tabular-nums text-slate-800">{Number(a.n).toLocaleString('ar-EG')}</span>
                  <ChevronLeft className="h-4 w-4 shrink-0 text-slate-300" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------- By operation ----------
function OpsTab({ summary, onPick, onGroup }: { summary: ActivitySummary; onPick: (a: string) => void; onGroup: (g: string) => void }) {
  const byGroup = new Map<string, { n: number; actions: ActivitySummary['by_action'] }>();
  for (const a of summary.by_action) {
    const g = groupOf(a.action).key;
    const cur = byGroup.get(g) ?? { n: 0, actions: [] };
    cur.n += Number(a.n); cur.actions.push(a); byGroup.set(g, cur);
  }
  const ordered = [...ACTIVITY_GROUPS.map((g) => g.key), 'other'].filter((k) => byGroup.has(k));
  if (!ordered.length) return <Empty icon={<ListTree className="h-7 w-7" />} text="لا توجد عمليات في هذه الفترة" />;
  const max = Math.max(...Array.from(byGroup.values()).map((x) => x.n), 1);
  return (
    <div id="activity-ops" className="space-y-3">
      {ordered.sort((a, b) => byGroup.get(b)!.n - byGroup.get(a)!.n).map((k) => {
        const g = groupOf(k + '.x'); const G = g.icon; const data = byGroup.get(k)!;
        return (
          <section key={k} className="card !p-0">
            <button type="button" onClick={() => onGroup(k)} className="flex w-full items-center gap-3 px-3 py-3 text-start hover:bg-slate-50">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${g.bg} ${g.color}`}><G className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-extrabold text-slate-800">{g.label}</p>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${g.bg.replace('-50', '-400').replace('-100', '-400')}`} style={{ width: `${Math.max(3, (data.n / max) * 100)}%` }} /></div>
              </div>
              <span className="text-lg font-extrabold tabular-nums text-slate-800">{data.n.toLocaleString('ar-EG')}</span>
            </button>
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {data.actions.sort((a, b) => Number(b.n) - Number(a.n)).map((a) => (
                <li key={a.action}>
                  <button type="button" onClick={() => onPick(a.action)} className="flex w-full items-center gap-2 px-4 py-2 text-start hover:bg-slate-50">
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-700">{actionLabel(a.action)}</span>
                    <span className="text-[11px] font-bold text-slate-400">{relTime(a.last_at)}</span>
                    <span className="w-14 text-end text-sm font-extrabold tabular-nums text-slate-800">{Number(a.n).toLocaleString('ar-EG')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ---------- Summary placeholder (loading / failed) ----------
function SummaryState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading || !error) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>;
  return (
    <div id="activity-summary-error" className="card flex flex-col items-center gap-3 py-8 text-center">
      <PieChart className="h-7 w-7 text-slate-300" />
      <p className="text-sm font-extrabold text-slate-600">{error}</p>
      <button type="button" onClick={onRetry} className="btn-secondary inline-flex items-center gap-1 !py-2 !px-3 text-sm"><RefreshCw className="h-4 w-4" /> إعادة المحاولة</button>
    </div>
  );
}

// ---------- Overview ----------
function OverviewTab({ summary, isOwner, supabase, flash, onPruned }: {
  summary: ActivitySummary; isOwner: boolean;
  supabase: ReturnType<typeof createClient>; flash: (m: string) => void; onPruned: () => void;
}) {
  const [settings, setSettings] = useState<ActivitySettings | null>(null);
  const [keep, setKeep] = useState(365);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (isOwner) fetchSettings(supabase).then((s) => { setSettings(s); setKeep(s.keep_days); }).catch(() => {}); }, [isOwner, supabase]);

  const days = [...summary.by_day].sort((a, b) => a.day.localeCompare(b.day));
  const maxD = Math.max(...days.map((d) => Number(d.n)), 1);
  const hours = Array.from({ length: 24 }, (_, h) => Number(summary.by_hour.find((x) => x.hour === h)?.n ?? 0));
  const maxH = Math.max(...hours, 1);
  const ops = summary.by_op;

  const save = async () => {
    setBusy(true);
    try { await saveSettings(supabase, { keep_days: keep, enabled: true }); flash('تم حفظ الإعدادات'); setSettings((s) => (s ? { ...s, keep_days: keep } : s)); }
    catch (e) { flash(activityErrorMessage(e, 'تعذر الحفظ')); } finally { setBusy(false); }
  };
  const doPrune = async () => {
    if (!confirm(`حذف كل العمليات الأقدم من ${keep} يومًا نهائيًا؟`)) return;
    setBusy(true);
    try { const n = await prune(supabase, keep); flash(`تم حذف ${n.toLocaleString('ar-EG')} عملية قديمة`); onPruned(); fetchSettings(supabase).then(setSettings).catch(() => {}); }
    catch (e) { flash(activityErrorMessage(e, 'تعذر التنظيف')); } finally { setBusy(false); }
  };

  return (
    <div id="activity-overview" className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="إجمالي العمليات" value={Number(summary.total)} icon={<History className="h-4 w-4" />} />
        <Kpi label="اليوم" value={Number(summary.today)} icon={<Clock className="h-4 w-4" />} tone="text-emerald-600" />
        <Kpi label="مستخدمون فاعلون" value={summary.by_actor.length} icon={<Users className="h-4 w-4" />} tone="text-primary-600" />
        <Kpi label="أنواع العمليات" value={summary.by_action.length} icon={<ListTree className="h-4 w-4" />} tone="text-violet-600" />
      </div>

      <section className="card">
        <h3 className="mb-2 text-sm font-extrabold text-slate-600">آخر ٣٠ يومًا</h3>
        {days.length ? (
          <div className="flex h-28 items-end gap-[2px]">
            {days.map((d) => (
              <div key={d.day} title={`${d.day}: ${d.n}`} className="flex-1 rounded-t bg-primary-500/80 hover:bg-primary-600" style={{ height: `${Math.max(2, (Number(d.n) / maxD) * 100)}%` }} />
            ))}
          </div>
        ) : <p className="text-xs font-bold text-slate-400">لا بيانات</p>}
        <div className="mt-1 flex justify-between text-[10px] font-bold text-slate-400"><span>{days[0]?.day ?? ''}</span><span>{days[days.length - 1]?.day ?? ''}</span></div>
      </section>

      <section className="card">
        <h3 className="mb-2 text-sm font-extrabold text-slate-600">ساعات النشاط (آخر ٧ أيام · توقيت القاهرة)</h3>
        <div className="flex h-20 items-end gap-[2px]">
          {hours.map((n, h) => <div key={h} title={`${h}:00 — ${n}`} className="flex-1 rounded-t bg-amber-400/80" style={{ height: `${Math.max(2, (n / maxH) * 100)}%` }} />)}
        </div>
        <div className="mt-1 flex justify-between text-[10px] font-bold text-slate-400"><span>٠٠</span><span>٠٦</span><span>١٢</span><span>١٨</span><span>٢٣</span></div>
      </section>

      <section className="card">
        <h3 className="mb-2 text-sm font-extrabold text-slate-600">حسب النوع</h3>
        <div className="grid grid-cols-4 gap-2">
          {(Object.keys(OP_LABELS) as ActivityOp[]).map((o) => {
            const n = Number(ops.find((x) => x.op === o)?.n ?? 0);
            return <div key={o} className="rounded-xl bg-slate-50 p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-slate-800">{n.toLocaleString('ar-EG')}</p><p className="text-[11px] font-bold text-slate-500">{OP_LABELS[o]}</p></div>;
          })}
        </div>
      </section>

      <section className="card">
        <h3 className="mb-2 text-sm font-extrabold text-slate-600">الأكثر نشاطًا</h3>
        <ul className="space-y-1.5">
          {summary.by_actor.slice(0, 5).map((a) => (
            <li key={`${a.actor_kind}:${a.actor_id}`} className="flex items-center gap-2">
              <ActorChip kind={a.actor_kind} name={a.actor_name} role={a.actor_role} />
              <span className="ms-auto text-sm font-extrabold tabular-nums text-slate-800">{Number(a.n).toLocaleString('ar-EG')}</span>
            </li>
          ))}
        </ul>
      </section>

      {isOwner && (
        <section id="activity-settings" className="card">
          <h3 className="mb-1 flex items-center gap-1.5 text-sm font-extrabold text-slate-600"><Database className="h-4 w-4" /> الاحتفاظ بالسجل (المالك)</h3>
          <p className="mb-3 text-xs font-bold text-slate-400">
            السجل يحتوي {Number(settings?.rows ?? summary.total).toLocaleString('ar-EG')} عملية{settings?.oldest ? ` · أقدمها ${fmtDateTime(settings.oldest)}` : ''}.
            العمليات الأقدم من المدة تُحذف عند الضغط على «تنظيف الآن».
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
              احتفظ بآخر
              <input type="number" min={7} max={3650} value={keep} onChange={(e) => setKeep(Math.max(7, Math.min(3650, Number(e.target.value) || 7)))} className="input-field !w-24 !py-2 text-center tabular-nums" />
              يومًا
            </label>
            <button type="button" onClick={save} disabled={busy} className="btn-secondary inline-flex items-center gap-1 !py-2 !px-3 text-sm"><Save className="h-4 w-4" /> حفظ</button>
            <button type="button" onClick={doPrune} disabled={busy} className="btn-primary inline-flex items-center gap-1 !py-2 !px-3 text-sm !from-rose-600 !to-rose-500"><Trash2 className="h-4 w-4" /> تنظيف الآن</button>
          </div>
        </section>
      )}
    </div>
  );
}

function Kpi({ label, value, icon, tone = 'text-slate-700' }: { label: string; value: number; icon: ReactNode; tone?: string }) {
  return (
    <div className="card !p-3">
      <p className={`flex items-center gap-1 text-[11px] font-bold text-slate-400`}>{icon} {label}</p>
      <p className={`mt-1 text-2xl font-extrabold tabular-nums ${tone}`}>{value.toLocaleString('ar-EG')}</p>
    </div>
  );
}
