'use client';

// ---------- CORE home widgets (part 1 — no module required) ----------
//   WelcomeWidget      — greeting · role · Gregorian + Coptic date · verse
//   VerseWidget        — standalone verse of the day
//   TodayPulseWidget   — attendance ring for today + points of the day
//   CountersWidget     — the classic stat cards
//   QuickActionsWidget — big buttons to the most used destinations
//   NextEventWidget    — the event happening now / next, with a countdown
// Every widget loads its own data (RLS-scoped RPCs) and refreshes in realtime.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Sparkles, Gauge, Users, UserCheck, Church, Layers, School, ScanLine, BarChart3, UserPlus, Zap,
  CalendarClock, BookOpenText, Clock, CalendarDays, type LucideIcon,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { useAppDate } from '@/lib/app-date-context';
import { useCustomization } from '@/lib/customization-context';
import { useDebouncedRealtime, useBusIds } from '@/lib/realtime';
import { ROLE_LABELS, type AppEvent } from '@/lib/types';
import { cairoToday, cairoDayStartISO, formatCairoDate, currentOccurrence, formatTimeHM, describeEventSchedule, type EventOccurrence } from '@/lib/time';
import { copticOf, formatCoptic } from '@/lib/coptic';
import { verseOfDay } from '@/lib/verses';
import { cachedLookup, invalidateLookup } from '@/lib/queries';
import { fetchDaySummary, shiftDay } from '@/lib/stats';
import { DEST_BY_KEY } from '@/lib/navigation';
import { WidgetCard, WidgetEmpty, WidgetSkeleton, fmtNum, fmtDur, fmtYmdLong } from './WidgetBits';

export interface WidgetProps {
  title?: string;
  size: 'full' | 'half';
}

// =====================================================================
// Welcome
// =====================================================================
export function WelcomeWidget() {
  const { profile } = useAuth();
  const { now, isOverridden } = useAppDate();
  const at = now();
  const today = cairoToday(at);
  const coptic = formatCoptic(copticOf(today));
  const verse = verseOfDay(today);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: 'numeric', hour12: false }).format(at));
  const greeting = hour < 12 ? 'صباح الخير' : hour < 18 ? 'مساء الخير' : 'مساء النور';

  return (
    <section id="w-welcome" className="relative overflow-hidden rounded-2xl bg-gradient-to-l from-primary-700 via-primary-600 to-accent-600 p-4 text-white shadow-card">
      <Sparkles className="absolute -left-4 -top-4 h-28 w-28 text-white/10" />
      <div className="relative flex items-start gap-3">
        <span className="rounded-2xl bg-white/15 p-2.5"><Sparkles className="h-6 w-6 text-gold-300" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-indigo-100">{greeting}،</p>
          <h2 className="truncate text-lg font-extrabold leading-tight">{profile?.full_name} 👋</h2>
          <p className="text-xs text-indigo-100">{profile ? ROLE_LABELS[profile.role] : ''}</p>
        </div>
      </div>
      <div className="relative mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold">
        <span className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1"><CalendarDays className="h-3.5 w-3.5" /> {formatCairoDate(at)}</span>
        <span className="flex items-center gap-1 rounded-full bg-gold-400/25 px-2.5 py-1 text-gold-100">☦ {coptic}</span>
        {isOverridden && <span className="rounded-full bg-amber-400/30 px-2.5 py-1 text-amber-100">تاريخ مجمّد</span>}
      </div>
      <blockquote className="relative mt-3 rounded-xl bg-white/10 px-3 py-2">
        <p className="text-sm font-bold leading-relaxed">«{verse.text}»</p>
        <footer className="mt-1 text-[11px] font-bold text-indigo-100">— {verse.ref}</footer>
      </blockquote>
    </section>
  );
}

export function VerseWidget({ title }: WidgetProps) {
  const { now } = useAppDate();
  const verse = verseOfDay(cairoToday(now()));
  return (
    <section id="w-verse" className="relative overflow-hidden rounded-2xl border border-gold-200 bg-gradient-to-br from-gold-50 to-amber-50 p-4 shadow-card">
      <BookOpenText className="absolute -bottom-3 -left-3 h-20 w-20 text-gold-200/60" />
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-extrabold text-gold-700"><BookOpenText className="h-3.5 w-3.5" /> {title ?? 'آية اليوم'}</p>
      <p className="relative text-sm font-bold leading-relaxed text-slate-800">«{verse.text}»</p>
      <p className="mt-1.5 text-[11px] font-extrabold text-gold-700">— {verse.ref}</p>
    </section>
  );
}

// =====================================================================
// Today pulse — attendance ring
// =====================================================================
export function TodayPulseWidget({ title, size }: WidgetProps) {
  const { profile } = useAuth();
  const { now } = useAppDate();
  const [supabase] = useState(() => createClient());
  const today = cairoToday(now());
  const [d, setD] = useState<{ attendees: number; persons: number; points: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await fetchDaySummary(supabase, today, {});
      setD({ attendees: s.attendees, persons: s.scope_persons, points: s.attendance_points + s.cause_points_added - s.cause_points_removed });
    } catch { setD({ attendees: 0, persons: 0, points: 0 }); }
  }, [supabase, today]);
  useEffect(() => { load(); }, [load]);
  // 20261014120000: an aggregate RPC per message on every device was one
  // request per scan per phone. Rate-limited to one reload per 30 s during
  // a burst (trailing run keeps the ring exact once the burst ends).
  useDebouncedRealtime(supabase, 'w-pulse', [{ table: 'attendance_log' }, { table: 'points_log' }, { table: 'enrollments' }], load, { enabled: !!profile, delayMs: 1500, minIntervalMs: 30_000 });

  const pct = d && d.persons > 0 ? Math.min(100, Math.round((d.attendees / d.persons) * 100)) : 0;
  const r = 40, c = 2 * Math.PI * r;
  const half = size === 'half';

  return (
    <WidgetCard id="w-today-pulse" icon={Gauge} title={title} subtitle={half ? undefined : 'نسبة حضور اليوم من مخدومي نطاقك'} tone="emerald" href="/stats">
      {!d ? <WidgetSkeleton rows={2} /> : (
        <div className={`flex items-center ${half ? 'flex-col gap-2' : 'gap-4'}`}>
          <div className="relative shrink-0" style={{ width: half ? 84 : 96, height: half ? 84 : 96 }}>
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
              <circle cx={50} cy={50} r={r} fill="none" stroke="#d1fae5" strokeWidth={11} />
              <circle cx={50} cy={50} r={r} fill="none" stroke="#10b981" strokeWidth={11} strokeLinecap="round"
                strokeDasharray={`${c * pct / 100} ${c * (1 - pct / 100)}`} className="transition-all duration-700" />
            </svg>
            <span className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-extrabold tabular-nums leading-none text-emerald-700">{fmtNum(pct)}٪</span>
              <span className="text-[9px] font-bold text-slate-400">حضور</span>
            </span>
          </div>
          <div className="grid w-full flex-1 grid-cols-3 gap-2">
            <Pill label="حاضر" value={d.attendees} tone="bg-emerald-50 text-emerald-700" />
            <Pill label="من" value={d.persons} tone="bg-slate-50 text-slate-700" />
            <Pill label="نقاط اليوم" value={d.points} tone="bg-gold-50 text-gold-700" signed />
          </div>
        </div>
      )}
    </WidgetCard>
  );
}

function Pill({ label, value, tone, signed }: { label: string; value: number; tone: string; signed?: boolean }) {
  return (
    <div className={`rounded-xl px-2 py-1.5 text-center ${tone}`}>
      <p className="text-base font-extrabold tabular-nums leading-none">{signed && value > 0 ? '+' : ''}{fmtNum(value)}</p>
      <p className="mt-0.5 text-[10px] font-bold opacity-80">{label}</p>
    </div>
  );
}

// =====================================================================
// Counters
// =====================================================================
interface Counts { persons: number; enrollments: number; todayAttendance: number; pendingServants: number; churches: number; services: number; classes: number }

export function CountersWidget() {
  const { profile } = useAuth();
  const { now } = useAppDate();
  const [supabase] = useState(() => createClient());
  const [counts, setCounts] = useState<Counts | null>(null);
  const isManager = profile && ['owner', 'church_manager', 'service_manager'].includes(profile.role);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('dashboard_counts', { p_today_start: cairoDayStartISO(now()) });
    const r = ((data as Record<string, number>[] | null)?.[0]) ?? {};
    const n = (k: string) => Number(r[k] ?? 0);
    setCounts({ persons: n('persons'), enrollments: n('enrollments'), todayAttendance: n('today_attendance'), pendingServants: n('pending_servants'), churches: n('churches'), services: n('services'), classes: n('classes') });
  }, [supabase, now]);
  useEffect(() => { load(); }, [load]);
  // 20261014120000: the bus message says «n attendance rows in this church»
  // but not which class / event, and dashboard_counts is RLS-scoped — so the
  // count cannot be patched in memory for a class servant. Instead: an
  // enrollment UPDATE (a scan bumping counters) changes nothing here →
  // ignored; the rest reloads the RPC at most once per 30 s during a burst.
  useBusIds('enrollments', (ids, op) => { if (op !== 'UPDATE') void load(); }, { delayMs: 2000 });
  useDebouncedRealtime(supabase, 'w-counters', [{ table: 'attendance_log' }, { table: 'servant_enrollments' }], load, { delayMs: 2000, minIntervalMs: 30_000 });

  const c = counts;
  return (
    <section id="w-counters" className="grid grid-cols-2 gap-3">
      <StatCard icon={Users} label="الأشخاص" value={c?.persons} color="bg-primary-100 text-primary-700" href="/children" />
      <StatCard icon={UserCheck} label="حضور اليوم" value={c?.todayAttendance} color="bg-emerald-100 text-emerald-700" href="/stats" />
      <StatCard icon={Layers} label="التسجيلات" value={c?.enrollments} color="bg-sky-100 text-sky-700" />
      {profile?.role === 'owner' && <StatCard icon={Church} label="الكنائس" value={c?.churches} color="bg-gold-100 text-gold-600" href="/settings/churches" />}
      {isManager && (
        <>
          <StatCard icon={Layers} label="الخدمات" value={c?.services} color="bg-accent-100 text-accent-700" href="/settings/services" />
          <StatCard icon={School} label="الفصول" value={c?.classes} color="bg-sky-100 text-sky-700" href="/settings/classes" />
          <StatCard icon={UserCheck} label="طلبات معلقة" value={c?.pendingServants} color="bg-red-100 text-red-600" href="/servants?tab=approvals" />
        </>
      )}
    </section>
  );
}

function StatCard({ icon: Icon, label, value, color, href }: { icon: LucideIcon; label: string; value: number | undefined; color: string; href?: string }) {
  const content = (
    <div className="card flex items-center gap-3 transition hover:bg-slate-50/60">
      <span className={`rounded-xl p-2.5 ${color}`}><Icon className="h-6 w-6" /></span>
      <div className="min-w-0">
        {value === undefined ? <div className="h-6 w-10 animate-pulse rounded bg-slate-100" /> : <p className="text-2xl font-extrabold leading-none tabular-nums">{fmtNum(value)}</p>}
        <p className="mt-1 truncate text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

// =====================================================================
// Quick actions
// =====================================================================
export function QuickActionsWidget({ title }: WidgetProps) {
  const { label, allowed } = useCustomization();
  const actions: { href: string; icon: LucideIcon; label: string; tone: string }[] = [
    { href: '/scanner', icon: ScanLine, label: label('scanner'), tone: 'text-primary-600 bg-primary-50' },
    { href: '/children/add', icon: UserPlus, label: 'إضافة مخدوم', tone: 'text-emerald-600 bg-emerald-50' },
    { href: '/children', icon: Users, label: label('children'), tone: 'text-sky-600 bg-sky-50' },
    { href: '/stats', icon: BarChart3, label: label('stats'), tone: 'text-violet-600 bg-violet-50' },
  ];
  for (const k of ['birthdays', 'messages', 'store', 'occasions', 'exams', 'results', 'online', 'achievements', 'notifications']) {
    if (actions.length >= 8) break;
    if (!allowed.has(k)) continue;
    const d = DEST_BY_KEY[k];
    actions.push({ href: d.href, icon: d.icon, label: label(k), tone: `${d.color ?? 'text-slate-600'} bg-slate-50` });
  }
  return (
    <section id="w-quick-actions">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-slate-500"><Zap className="h-4 w-4 text-accent-600" /> {title ?? 'إجراءات سريعة'}</h3>
      <div className="grid grid-cols-4 gap-2">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <Link key={a.href} href={a.href} className="card flex flex-col items-center gap-1.5 !px-1 !py-3 transition hover:-translate-y-0.5 hover:shadow-md">
              <span className={`rounded-xl p-2 ${a.tone}`}><Icon className="h-5 w-5" /></span>
              <span className="max-w-full truncate text-[11px] font-bold text-slate-600">{a.label}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// =====================================================================
// Next event — now / upcoming with countdown
// =====================================================================
interface EventPick { ev: AppEvent; occ: EventOccurrence; startsAt: Date; endsAt: Date }

/** Cairo wall clock (day + 'HH:MM[:SS]') → instant. */
function cairoInstant(date: string, hms: string | null, fallback: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (hms ?? fallback).split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm, 0);
  const probe = new Date(wall);
  const cairoHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: 'numeric', hour12: false }).format(probe)) % 24;
  const offset = ((cairoHour - probe.getUTCHours()) + 24) % 24;
  return new Date(wall - offset * 3_600_000);
}

export function NextEventWidget({ title, size }: WidgetProps) {
  const { profile } = useAuth();
  const { now } = useAppDate();
  const { label } = useCustomization();
  const [supabase] = useState(() => createClient());
  const [events, setEvents] = useState<AppEvent[] | null>(null);
  const [attended, setAttended] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);

  // 20261016120000: use the shared lookup cache (was `force = true` →
  // one `events` request per dashboard open on every device, 5.9 k / month);
  // the bus message for `events` invalidates it and reloads.
  const load = useCallback(async (force = false) => {
    if (force) invalidateLookup('events');
    setEvents(await cachedLookup<AppEvent>(supabase, 'events', { column: 'event_date', ascending: false, nullsFirst: false }));
  }, [supabase]);
  useEffect(() => { load(); }, [load]);
  useDebouncedRealtime(supabase, 'w-events', [{ table: 'events' }], () => load(true), { enabled: !!profile });

  // pick: happening now → soonest upcoming (incl. next weekly occurrence) → latest past
  const pick = useMemo<EventPick | null>(() => {
    void tick;
    if (!events || events.length === 0) return null;
    const at = now();
    const scored: { p: EventPick; rank: number; t: number }[] = [];
    for (const ev of events) {
      const occ = currentOccurrence(ev, at);
      if (!occ) continue;
      const p: EventPick = { ev, occ, startsAt: cairoInstant(occ.date, ev.start_time, '00:00'), endsAt: cairoInstant(occ.date, ev.end_time, '23:59') };
      if (occ.phase === 'during') scored.push({ p, rank: 0, t: p.endsAt.getTime() });
      else if (occ.phase === 'upcoming') scored.push({ p, rank: 1, t: p.startsAt.getTime() });
      else if (ev.recurrence === 'weekly') {
        const days = ev.weekdays ?? [];
        for (let k = 1; k <= 7; k++) {
          const d = shiftDay(cairoToday(at), k);
          const wd = new Date(d + 'T00:00:00Z').getUTCDay();
          if (days.length === 0 || days.includes(wd)) {
            const s = cairoInstant(d, ev.start_time, '00:00');
            scored.push({ p: { ev, occ: { date: d, phase: 'upcoming' }, startsAt: s, endsAt: cairoInstant(d, ev.end_time, '23:59') }, rank: 2, t: s.getTime() });
            break;
          }
        }
      } else scored.push({ p, rank: 3, t: -p.startsAt.getTime() });
    }
    scored.sort((a, b) => a.rank - b.rank || a.t - b.t);
    return scored[0]?.p ?? null;
  }, [events, now, tick]);

  const loadAttended = useCallback(async () => {
    if (!pick) { setAttended(null); return; }
    const { count } = await supabase.from('attendance_log').select('id', { count: 'exact', head: true }).eq('event_id', pick.ev.id).eq('attended_on', pick.occ.date);
    setAttended(count ?? 0);
  }, [supabase, pick]);
  useEffect(() => { loadAttended(); }, [loadAttended]);
  // 20261014120000: the message does not say which event the scan was for,
  // so the count is re-read (a tiny HEAD count) at most once per 20 s during
  // a burst instead of once per scan on every device.
  useDebouncedRealtime(supabase, 'w-event-att', [{ table: 'attendance_log' }], loadAttended, { delayMs: 1500, minIntervalMs: 20_000, enabled: !!pick });

  const at = now();
  let state: ReactNode = null;
  if (pick) {
    if (pick.occ.phase === 'during') {
      const left = Math.max(0, Math.round((pick.endsAt.getTime() - at.getTime()) / 60000));
      state = <span className="badge animate-pulse bg-emerald-100 text-emerald-700">● جارية الآن{pick.ev.end_time ? ` · تنتهي بعد ${fmtDur(left)}` : ''}</span>;
    } else if (pick.occ.phase === 'upcoming') {
      const inMin = Math.max(0, Math.round((pick.startsAt.getTime() - at.getTime()) / 60000));
      state = <span className="badge bg-violet-100 text-violet-700">تبدأ بعد {fmtDur(inMin)}</span>;
    } else {
      state = <span className="badge bg-slate-100 text-slate-500">انتهت</span>;
    }
  }

  return (
    <WidgetCard id="w-next-event" icon={CalendarClock} title={title} tone="violet" href="/settings/events"
      badge={events && events.length > 0 ? <span className="badge bg-slate-100 text-slate-500 tabular-nums">{fmtNum(events.length)}</span> : undefined}>
      {!events ? <WidgetSkeleton rows={2} /> : !pick ? (
        <WidgetEmpty icon={CalendarClock} text="لا توجد مناسبات" hint={`أضف مناسبة من ${label('settings')} ← إدارة المناسبات`} />
      ) : (
        <div className={`flex ${size === 'half' ? 'flex-col' : 'items-center'} gap-3`}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-extrabold text-slate-800">{pick.ev.name}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-bold text-slate-400">
              <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {fmtYmdLong(pick.occ.date)}</span>
              {(pick.ev.start_time || pick.ev.end_time) && (
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {pick.ev.start_time ? formatTimeHM(pick.ev.start_time) : ''}{pick.ev.end_time ? ` – ${formatTimeHM(pick.ev.end_time)}` : ''}</span>
              )}
              {size === 'full' && <span className="hidden sm:inline">· {describeEventSchedule(pick.ev)}</span>}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {state}
              {pick.ev.points > 0 && <span className="badge bg-gold-100 text-gold-700">+{fmtNum(pick.ev.points)} نقطة</span>}
              <span className="badge bg-emerald-50 text-emerald-700 tabular-nums"><UserCheck className="h-3 w-3" /> {attended === null ? '…' : fmtNum(attended)} حضروا</span>
            </div>
          </div>
          <Link href="/scanner" className="btn-primary flex shrink-0 items-center justify-center gap-1.5 !px-3 !py-2 text-xs">
            <ScanLine className="h-4 w-4" /> {label('scanner')}
          </Link>
        </div>
      )}
    </WidgetCard>
  );
}
