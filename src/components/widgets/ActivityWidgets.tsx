'use client';

// ---------- CORE home widgets (part 2 — activity) ----------
//   AttendanceTrendWidget  — 14-day mini bars + week-over-week delta
//   WeeklyStreakWidget     — last 7 days lit when attendance happened
//   LeaderboardWidget      — top children by points
//   FollowUpWidget         — absentees of the last occurrence not yet called
//   PendingApprovalsWidget — servant sign-ups + data change requests

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  TrendingUp, TrendingDown, Minus, Flame, Trophy, PhoneCall, Phone, Inbox, UserCheck, UserPlus, ChevronLeft,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { useAppDate } from '@/lib/app-date-context';
import { useCustomization } from '@/lib/customization-context';
import { useDebouncedRealtime, useBusIds } from '@/lib/realtime';
import type { AppEvent } from '@/lib/types';
import { cairoToday, currentOccurrence, previousOccurrenceDate, WEEKDAY_SHORT } from '@/lib/time';
import { cachedLookup } from '@/lib/queries';
import { fetchAttendanceTimeline, fetchLeaderboard, shiftDay, type LeaderRow } from '@/lib/stats';
import { WidgetCard, WidgetEmpty, WidgetSkeleton, Avatar, fmtNum, fmtYmdLong } from './WidgetBits';
import type { WidgetProps } from './CoreWidgets';

/**
 * Attendance per day for the last 14 days — ONE shared fetch for every
 * widget that needs it (trend = 14 bars, streak = last 7).
 *
 * 20261016120000: the trend and streak widgets each called the
 * `stats_attendance_timeline` RPC (6 767 calls / 1.28 s avg in production)
 * on mount and on every attendance burst → two identical aggregate RPCs
 * per dashboard open on every device. Now the 14-day result lives in a
 * module-level store: the first widget to mount loads it, every other one
 * subscribes; a bus burst reloads it once (60 s rate limit) for all.
 */
const DAILY_N = 14;
type DailyState = { today: string; vals: number[] | null };
let dailyState: DailyState = { today: '', vals: null };
let dailyInflight: Promise<void> | null = null;
let dailyLoadedAt = 0;
const DAILY_MIN_RELOAD_MS = 30_000; // two widgets × one burst → still ONE RPC
const dailyListeners = new Set<() => void>();
function dailyNotify() { dailyListeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } }); }
async function loadDaily(supabase: ReturnType<typeof createClient>, today: string, force = false): Promise<void> {
  if (dailyInflight) return dailyInflight;
  const fresh = dailyState.today === today && dailyState.vals;
  if (!force && fresh) return;
  if (force && fresh && Date.now() - dailyLoadedAt < DAILY_MIN_RELOAD_MS) return;
  const days = Array.from({ length: DAILY_N }, (_, i) => shiftDay(today, i - (DAILY_N - 1)));
  dailyInflight = (async () => {
    try {
      const rows = await fetchAttendanceTimeline(supabase, { from: days[0], to: today, bucket: 'day' }, {});
      const map = new Map<string, number>();
      rows.forEach((r) => map.set(r.bucket, (map.get(r.bucket) ?? 0) + r.attendance));
      dailyState = { today, vals: days.map((d) => map.get(d) ?? 0) };
    } catch {
      dailyState = { today, vals: days.map(() => 0) };
    } finally {
      dailyInflight = null;
      dailyLoadedAt = Date.now();
      dailyNotify();
    }
  })();
  return dailyInflight;
}

/** The last `n` (≤ 14) days ending today, from the shared store. */
function useDailyAttendance(n: number) {
  const { now } = useAppDate();
  const [supabase] = useState(() => createClient());
  const today = cairoToday(now());
  const days = useMemo(() => Array.from({ length: n }, (_, i) => shiftDay(today, i - (n - 1))), [today, n]);
  const [, bump] = useState(0);

  useEffect(() => {
    const fn = () => bump((x) => x + 1);
    dailyListeners.add(fn);
    void loadDaily(supabase, today);
    return () => { dailyListeners.delete(fn); };
  }, [supabase, today]);
  const reload = useCallback(() => loadDaily(supabase, today, true), [supabase, today]);
  // a scan burst → one reload shared by the widgets, at most once a minute
  useDebouncedRealtime(supabase, 'w-daily', [{ table: 'attendance_log' }], reload, { delayMs: 3000, minIntervalMs: 60_000 });

  const vals = dailyState.today === today && dailyState.vals ? dailyState.vals.slice(DAILY_N - n) : null;
  return { days, vals };
}

// =====================================================================
// Attendance trend — 14 days
// =====================================================================
export function AttendanceTrendWidget({ title }: WidgetProps) {
  const { days, vals } = useDailyAttendance(14);
  const max = Math.max(1, ...(vals ?? [0]));
  const thisWeek = (vals ?? []).slice(7).reduce((a, b) => a + b, 0);
  const lastWeek = (vals ?? []).slice(0, 7).reduce((a, b) => a + b, 0);
  const delta = thisWeek - lastWeek;
  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const deltaTone = delta > 0 ? 'bg-emerald-100 text-emerald-700' : delta < 0 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500';

  return (
    <WidgetCard id="w-attendance-trend" icon={TrendingUp} title={title} subtitle="هذا الأسبوع مقابل السابق" tone="sky" href="/stats"
      badge={vals ? <span className={`badge ${deltaTone} tabular-nums`}><DeltaIcon className="h-3 w-3" /> {delta > 0 ? '+' : ''}{fmtNum(delta)}</span> : undefined}>
      {!vals ? <WidgetSkeleton rows={2} /> : (
        <>
          <div className="flex h-20 items-end gap-1" dir="ltr">
            {vals.map((v, i) => (
              <div key={days[i]} className="flex-1" title={`${days[i]} · ${v}`}>
                <div className={`w-full rounded-t-md transition-all ${i === 13 ? 'bg-sky-600' : i >= 7 ? 'bg-sky-400' : 'bg-sky-200'}`} style={{ height: `${Math.max(4, Math.round((v / max) * 100))}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] font-bold text-slate-400">
            <span>الأسبوع السابق {fmtNum(lastWeek)}</span>
            <span className="text-sky-700">هذا الأسبوع {fmtNum(thisWeek)}</span>
          </div>
        </>
      )}
    </WidgetCard>
  );
}

// =====================================================================
// Weekly streak — 7 days
// =====================================================================
export function WeeklyStreakWidget({ title, size }: WidgetProps) {
  const { days, vals } = useDailyAttendance(7);
  let streak = 0;
  if (vals) {
    let i = vals.length - 1;
    if (vals[i] === 0) i--;
    for (; i >= 0 && vals[i] > 0; i--) streak++;
  }
  const active = vals ? vals.filter((v) => v > 0).length : 0;

  return (
    <WidgetCard id="w-weekly-streak" icon={Flame} title={title} tone="orange" href="/stats"
      badge={vals ? <span className="badge bg-orange-100 text-orange-700 tabular-nums"><Flame className="h-3 w-3" /> {fmtNum(streak)}</span> : undefined}>
      {!vals ? <WidgetSkeleton rows={1} /> : (
        <>
          <div className="flex justify-between gap-1">
            {days.map((d, i) => {
              const wd = new Date(d + 'T00:00:00Z').getUTCDay();
              const on = vals[i] > 0;
              return (
                <div key={d} className="flex flex-1 flex-col items-center gap-1">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-extrabold tabular-nums transition ${on ? 'bg-gradient-to-br from-orange-500 to-amber-400 text-white shadow' : 'bg-slate-100 text-slate-300'} ${i === days.length - 1 ? 'ring-2 ring-orange-300 ring-offset-1' : ''}`}>
                    {on ? fmtNum(vals[i]) : '·'}
                  </span>
                  <span className="text-[9px] font-bold text-slate-400">{WEEKDAY_SHORT[wd]}</span>
                </div>
              );
            })}
          </div>
          {size === 'full' && <p className="mt-2 text-center text-[11px] font-bold text-slate-400">{fmtNum(active)} أيام نشاط من ٧ · سلسلة {fmtNum(streak)} متتالية</p>}
        </>
      )}
    </WidgetCard>
  );
}

// =====================================================================
// Leaderboard
// =====================================================================
const MEDALS = ['🥇', '🥈', '🥉'];

export function LeaderboardWidget({ title, size }: WidgetProps) {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const limit = size === 'half' ? 5 : 6;

  const load = useCallback(async () => {
    try { setRows(await fetchLeaderboard(supabase, 'points', limit, {})); } catch { setRows([]); }
  }, [supabase, limit]);
  useEffect(() => { load(); }, [load]);
  // 20261014120000: every scan bumps an enrollment's points → the top-6 RPC
  // re-ran once per scan on every device. At most once per minute now.
  useDebouncedRealtime(supabase, 'w-leader', [{ table: 'enrollments' }], load, { enabled: !!profile, delayMs: 2500, minIntervalMs: 60_000 });

  return (
    <WidgetCard id="w-leaderboard" icon={Trophy} title={title} tone="amber" href="/stats" flush>
      {!rows ? <WidgetSkeleton /> : rows.length === 0 ? (
        <WidgetEmpty icon={Trophy} text="لا نقاط بعد" />
      ) : (
        <ul className="divide-y divide-amber-50">
          {rows.map((r, i) => (
            <li key={r.enrollment_id} className={`flex items-center gap-2.5 px-3 py-2 ${i === 0 ? 'bg-amber-50/60' : ''}`}>
              <span className="w-6 text-center text-base leading-none">{MEDALS[i] ?? <span className="text-xs font-extrabold tabular-nums text-slate-400">{fmtNum(i + 1)}</span>}</span>
              <Avatar url={r.image_url} name={r.name} size={size === 'half' ? 28 : 34} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-extrabold text-slate-800">{r.name}</span>
                {r.class_name && size === 'full' && <span className="block truncate text-[10px] font-bold text-slate-400">{r.class_name}</span>}
              </span>
              <span className="badge bg-gold-100 text-gold-700 tabular-nums">{fmtNum(r.points)}</span>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

// =====================================================================
// Follow-up — absentees of the last finished occurrence, not yet called
// =====================================================================
interface AbsentRow { enrollment_id: string; name: string; phone: string | null; image_url: string | null }
/** `absent` = every absentee (kept so a contact_log broadcast can be applied in memory); `contacted` = who was called */
type FollowState =
  | { ev: AppEvent; date: string; absent: AbsentRow[]; contacted: Set<string> }
  | 'none' | null;

export function FollowUpWidget({ title, size }: WidgetProps) {
  const { now } = useAppDate();
  const { label } = useCustomization();
  const [supabase] = useState(() => createClient());
  const [state, setState] = useState<FollowState>(null);
  const shown = size === 'half' ? 3 : 5;

  const load = useCallback(async () => {
    const at = now();
    const events = await cachedLookup<AppEvent>(supabase, 'events', { column: 'event_date', ascending: false, nullsFirst: false });
    // the most recent FINISHED occurrence; the default event wins ties
    let best: { ev: AppEvent; date: string; rank: string } | null = null;
    for (const ev of events) {
      const occ = currentOccurrence(ev, at);
      if (!occ) continue;
      const date = occ.phase === 'after' ? occ.date : ev.recurrence === 'weekly' ? previousOccurrenceDate(ev, occ.date) : null;
      if (!date) continue;
      const rank = `${date}${ev.is_default ? 'z' : 'a'}`;
      if (!best || rank > best.rank) best = { ev, date, rank };
    }
    if (!best) { setState('none'); return; }
    let q = supabase.from('enrollments').select('id, person:persons(name, phone, image_url)').eq('church_id', best.ev.church_id).limit(1000);
    if (best.ev.service_id) q = q.eq('service_id', best.ev.service_id);
    if (best.ev.class_id) q = q.eq('class_id', best.ev.class_id);
    const [{ data: enr }, { data: att }, { data: calls }] = await Promise.all([
      q,
      supabase.from('attendance_log').select('enrollment_id').eq('event_id', best.ev.id).eq('attended_on', best.date).limit(2000),
      supabase.from('contact_log').select('enrollment_id').eq('event_id', best.ev.id).eq('occurrence_on', best.date).limit(2000),
    ]);
    const attended = new Set(((att ?? []) as { enrollment_id: string }[]).map((r) => r.enrollment_id));
    const contacted = new Set(((calls ?? []) as { enrollment_id: string }[]).map((r) => r.enrollment_id));
    type Row = { id: string; person: { name: string; phone: string | null; image_url: string | null } | null };
    const absent = ((enr ?? []) as unknown as Row[])
      .filter((e) => e.person && !attended.has(e.id))
      .map((e) => ({ enrollment_id: e.id, name: e.person!.name, phone: e.person!.phone, image_url: e.person!.image_url }));
    setState({ ev: best.ev, date: best.date, absent, contacted });
  }, [supabase, now]);
  useEffect(() => { load(); }, [load]);
  // attendance / enrollment changes: full reload (3 queries), but on a scan
  // day at most once per minute per device (20261014120000). Enrollment
  // UPDATEs (a scan bumping counters) do not change who is absent → ignored.
  useDebouncedRealtime(supabase, 'w-followup', [{ table: 'attendance_log' }], load, { delayMs: 2500, minIntervalMs: 60_000 });
  useBusIds('enrollments', (ids, op) => { if (op !== 'UPDATE') void load(); }, { delayMs: 2500 });
  // 20261013120000: a call / feedback by any servant → mark those enrollments
  // as contacted IN MEMORY. Zero requests. (This widget used to re-run its
  // 3 queries on every device for every single phone call in the church.)
  useBusIds('contact_log', (ids, op) => {
    if (!ids.length || op === 'DELETE') { void load(); return; }
    setState((prev) => {
      if (!prev || prev === 'none') return prev;
      const contacted = new Set(prev.contacted);
      ids.forEach((id) => contacted.add(id));
      return { ...prev, contacted };
    });
  }, { delayMs: 1500, onVisible: () => { void load(); } });

  const s = state && state !== 'none' ? state : null;
  const notCalled = s ? s.absent.filter((e) => !s.contacted.has(e.enrollment_id)) : [];
  const pending = notCalled.length;
  const total = s ? s.absent.length : 0;
  const rows = notCalled.slice(0, shown);
  return (
    <WidgetCard id="w-follow-up" icon={PhoneCall} title={title} tone="teal" href="/children" flush
      subtitle={s ? `غائبو «${s.ev.name}» · ${fmtYmdLong(s.date)}` : undefined}
      badge={s ? <span className={`badge tabular-nums ${pending > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{fmtNum(pending)} لم يُفتقد</span> : undefined}>
      {state === null ? <WidgetSkeleton /> : state === 'none' ? (
        <WidgetEmpty icon={PhoneCall} text="لا توجد مناسبة منتهية بعد" hint="سيظهر هنا غائبو آخر مناسبة" />
      ) : total === 0 ? (
        <WidgetEmpty icon={UserCheck} text="حضر الجميع 🎉" />
      ) : pending === 0 ? (
        <WidgetEmpty icon={PhoneCall} text={`تم افتقاد كل الغائبين (${fmtNum(total)}) ✓`} />
      ) : (
        <>
          <ul className="divide-y divide-teal-50">
            {rows.map((r) => (
              <li key={r.enrollment_id} className="flex items-center gap-2.5 px-3 py-2">
                <Avatar url={r.image_url} name={r.name} size={32} />
                <span className="min-w-0 flex-1 truncate text-xs font-extrabold text-slate-800">{r.name}</span>
                {r.phone ? (
                  <a href={`tel:${r.phone}`} className="rounded-xl bg-teal-50 p-2 text-teal-700 hover:bg-teal-100" aria-label={`اتصال بـ ${r.name}`}><Phone className="h-4 w-4" /></a>
                ) : <span className="text-[10px] font-bold text-slate-300">بلا هاتف</span>}
              </li>
            ))}
          </ul>
          <Link href="/children" className="flex items-center justify-center gap-1 bg-teal-50/60 py-2 text-[11px] font-extrabold text-teal-700 hover:bg-teal-50">
            {pending > rows.length ? `و${fmtNum(pending - rows.length)} آخرون · ` : ''}{label('children')} <ChevronLeft className="h-3.5 w-3.5" />
          </Link>
        </>
      )}
    </WidgetCard>
  );
}

// =====================================================================
// Pending approvals
// =====================================================================
export function PendingApprovalsWidget({ title, size }: WidgetProps) {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const [n, setN] = useState<{ servants: number; requests: number } | null>(null);

  const load = useCallback(async () => {
    const [{ count }, { data }] = await Promise.all([
      supabase.from('servant_enrollments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.rpc('pending_data_requests_count'),
    ]);
    setN({ servants: count ?? 0, requests: typeof data === 'number' ? data : 0 });
  }, [supabase]);
  useEffect(() => { if (profile) load(); }, [load, profile]);
  useDebouncedRealtime(supabase, 'w-approvals', [{ table: 'servant_enrollments' }, { table: 'data_change_requests' }], load, { delayMs: 1500, minIntervalMs: 30_000 });

  const total = (n?.servants ?? 0) + (n?.requests ?? 0);
  return (
    <WidgetCard id="w-pending-approvals" icon={UserCheck} title={title} tone={total > 0 ? 'red' : 'slate'} href="/servants?tab=approvals" flush
      badge={n ? <span className={`badge tabular-nums ${total > 0 ? 'bg-red-500 text-white' : 'bg-emerald-100 text-emerald-700'}`}>{fmtNum(total)}</span> : undefined}>
      {!n ? <WidgetSkeleton rows={2} /> : (
        <div className={`grid ${size === 'half' ? 'grid-cols-1 divide-y' : 'grid-cols-2 divide-x divide-x-reverse'} divide-slate-100`}>
          <Link href="/servants?tab=approvals" className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50">
            <span className={`rounded-xl p-2 ${n.servants > 0 ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-400'}`}><UserPlus className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-extrabold tabular-nums leading-none">{fmtNum(n.servants)}</span>
              <span className="block truncate text-[10px] font-bold text-slate-400">طلبات انضمام خدام</span>
            </span>
          </Link>
          <Link href="/settings/data-requests" className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50">
            <span className={`rounded-xl p-2 ${n.requests > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-400'}`}><Inbox className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-extrabold tabular-nums leading-none">{fmtNum(n.requests)}</span>
              <span className="block truncate text-[10px] font-bold text-slate-400">طلبات تعديل بيانات</span>
            </span>
          </Link>
        </div>
      )}
    </WidgetCard>
  );
}
