'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  ScanLine, Camera, CameraOff, CheckCircle2, AlertCircle, Search, Star, Loader2, School,
  Check, X, Plus, Minus, Eye, Database, CalendarCheck, Calculator, History,
  UserCheck, UserX, CircleDashed, Settings2, Ban, UsersRound,
} from 'lucide-react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import {
  scopeApplies,
  type EnrollmentWithPerson, type Person, type ClassRoom, type Church, type Service,
  type AppEvent, type Cause, type CallFeedback,
} from '@/lib/types';
import { CallFeedbackBadge, CallFeedbackModal, PersonAvatar, useCallFeedbackStates } from '@/components/CallFeedback';
import {
  eventAvailability, describeEventSchedule, cairoToday, formatCairoTime,
  childEventStatus, CHILD_STATUS_LABELS, type ChildEventStatus,
} from '@/lib/time';
import { useAppDate } from '@/lib/app-date-context';
import NumPadModal from '@/components/NumPadModal';
import { ViewPersonModal, ModalFrame } from '@/components/PersonDataModals';
import { AttendanceLogModal, PointsLogModal } from '@/components/LogModals';
import { fetchEnrollmentsPage, cachedLookup, ALL } from '@/lib/queries';
import { pickScopedDefault, effectiveScope } from '@/lib/defaults';
import { onBusTable } from '@/lib/realtime';
import { useNavLabel } from '@/lib/customization-context';
import { nativeDetector, decodeVideoFrame } from '@/lib/qr-decode';
import { useModuleVisible } from '@/lib/modules-context';
import { lookupFamily, type FamilyLookup } from '@/lib/families';
import FamilyScanPicker, { useAutoServiceSetting } from '@/components/family/FamilyScanPicker';

// ---------- Scanner jobs — same system as the children page ----------
// Attendance / points / data. Calls, messages and card printing don't make
// sense while scanning, so they're not offered here.
type ScannerJob = 'attendance' | 'points' | 'data';
const SCANNER_JOBS: { value: ScannerJob; label: string }[] = [
  { value: 'attendance', label: 'الحضور' },
  { value: 'points', label: 'النقاط' },
  { value: 'data', label: 'البيانات' },
];

type AttendanceMode = 'add' | 'remove';
// 'manual' = NEW: scanning opens a modal (name + points + number + add/subtract + cause)
type PointsMode = 'add' | 'subtract' | 'manual';
// البيانات job — view only (0043): edit / delete / stop live in إدارة المخدومين

type ScanResult = { type: 'ok' | 'dup' | 'err'; message: string };

// Archive of scan operations shown under the page (newest first)
type HistoryKind = 'att_add' | 'att_remove' | 'pts_add' | 'pts_sub' | 'data' | 'warn';
interface HistoryEntry {
  id: string;
  at: Date;
  kind: HistoryKind;
  name: string;
  scope: string;
  detail: string;       // e.g. event / cause name
  delta?: number;       // points change
  balance?: number;     // points balance after the operation
}
const HISTORY_MAX = 100;

// Visual style of the status badge (present / not registered / absent) —
// same look as the children page
const STATUS_STYLE: Record<ChildEventStatus, { cls: string; icon: React.ReactNode }> = {
  present:        { cls: 'bg-emerald-500 text-white !ring-emerald-600/20', icon: <UserCheck className="h-3.5 w-3.5" /> },
  not_registered: { cls: 'bg-slate-100 text-slate-500 !ring-slate-200',    icon: <CircleDashed className="h-3.5 w-3.5" /> },
  absent:         { cls: 'bg-red-500 text-white !ring-red-600/20',         icon: <UserX className="h-3.5 w-3.5" /> },
};

const HISTORY_STYLE: Record<HistoryKind, { label: string; bg: string; icon: React.ReactNode }> = {
  att_add:    { label: 'تسجيل حضور',  bg: 'bg-emerald-100 text-emerald-600', icon: <Check className="h-4 w-4" /> },
  att_remove: { label: 'إزالة حضور',  bg: 'bg-red-100 text-red-500',         icon: <X className="h-4 w-4" /> },
  pts_add:    { label: 'إضافة نقاط',  bg: 'bg-emerald-100 text-emerald-600', icon: <Plus className="h-4 w-4" /> },
  pts_sub:    { label: 'خصم نقاط',    bg: 'bg-red-100 text-red-500',         icon: <Minus className="h-4 w-4" /> },
  data:       { label: 'البيانات',    bg: 'bg-primary-100 text-primary-600', icon: <Database className="h-4 w-4" /> },
  warn:       { label: 'تنبيه',       bg: 'bg-gold-100 text-gold-600',       icon: <AlertCircle className="h-4 w-4" /> },
};

export default function ScannerPage() {
  const pageName = useNavLabel('scanner');
  const { profile } = useAuth();
  const supabase = createClient();
  const { now } = useAppDate();

  // ---------- Lookups ----------
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [causes, setCauses] = useState<Cause[]>([]);
  const [feedbacks, setFeedbacks] = useState<CallFeedback[]>([]);

  // ---------- Scope selectors: church -> service -> class ----------
  const [churchFilter, setChurchFilter] = useState<string>(ALL);
  const [serviceFilter, setServiceFilter] = useState<string>(ALL);
  const [classFilter, setClassFilter] = useState<string>(ALL);

  // ---------- Job + modes ----------
  const [job, setJob] = useState<ScannerJob>('attendance');
  const [attendanceMode, setAttendanceMode] = useState<AttendanceMode>('add');
  const [pointsMode, setPointsMode] = useState<PointsMode>('add');
  const [eventId, setEventId] = useState<string>('');
  const [causeId, setCauseId] = useState<string>('');
  // true while the event / cause was picked BY THE DEFAULT RESOLVER (not by
  // the servant) — such a pick follows the scope selectors; a manual pick is
  // kept as long as it stays visible in the current scope.
  const eventAutoRef = useRef(true);
  const causeAutoRef = useRef(true);
  const chooseEvent = (id: string) => { eventAutoRef.current = false; setEventId(id); };
  const chooseCause = (id: string) => { causeAutoRef.current = false; setCauseId(id); };

  // Points overrides (numpad) for editable / open modes
  const [eventPtsOverride, setEventPtsOverride] = useState<number | null>(null);
  const [causePtsOverride, setCausePtsOverride] = useState<number | null>(null);
  const [numpadFor, setNumpadFor] = useState<'event' | 'cause' | null>(null);
  useEffect(() => { setEventPtsOverride(null); }, [eventId]);
  useEffect(() => { setCausePtsOverride(null); }, [causeId]);

  // ---------- Camera ----------
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  // Off-screen canvas used by the jsQR fallback (iOS Safari / desktop)
  const decodeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');

  // ---------- Results / lists ----------
  const [result, setResult] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [search, setSearch] = useState('');
  const [searchRows, setSearchRows] = useState<EnrollmentWithPerson[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Family module (العائلات): when the scanned code belongs to a person WITH a
  // family (or is a family code) the family picker opens instead of acting
  // on the scanned person directly. Switchable from the control panel.
  const familyModule = useModuleVisible('family');
  const [familyMode, setFamilyMode] = useState(true);
  const [autoService, setAutoService] = useAutoServiceSetting();
  const [familyPick, setFamilyPick] = useState<FamilyLookup | null>(null);

  // Modals
  const [picker, setPicker] = useState<{ person: Person; options: EnrollmentWithPerson[] } | null>(null);
  const [manualTarget, setManualTarget] = useState<EnrollmentWithPerson | null>(null);
  const [dataTarget, setDataTarget] = useState<EnrollmentWithPerson | null>(null);
  const [logTarget, setLogTarget] = useState<{ kind: 'attendance' | 'points'; e: EnrollmentWithPerson } | null>(null);
  const [callTarget, setCallTarget] = useState<EnrollmentWithPerson | null>(null);

  // ---------- Load lookups (cached 60s) ----------
  const loadLookups = useCallback(async (force = false) => {
    const [chs, svs, cls, evs, cas, fbs] = await Promise.all([
      cachedLookup<Church>(supabase, 'churches', { column: 'name' }, force),
      cachedLookup<Service>(supabase, 'services', { column: 'name' }, force),
      cachedLookup<ClassRoom>(supabase, 'classes', { column: 'name' }, force),
      cachedLookup<AppEvent>(supabase, 'events', { column: 'event_date', ascending: false, nullsFirst: false }, force),
      cachedLookup<Cause>(supabase, 'causes', { column: 'name' }, force),
      cachedLookup<CallFeedback>(supabase, 'call_feedbacks', { column: 'sort_order' }, force),
    ]);
    setChurches(chs);
    setServices(svs);
    setClasses(cls);
    setEvents(evs);
    setCauses(cas);
    setFeedbacks(fbs);
  }, [supabase]);

  useEffect(() => {
    if (profile?.status === 'approved') loadLookups();
  }, [profile?.status, loadLookups]);

  // ---------- Cascading selector options ----------
  const visibleServices = useMemo(
    () => services.filter((s) => churchFilter === ALL || s.church_id === churchFilter),
    [services, churchFilter]
  );
  const visibleClasses = useMemo(
    () =>
      classes.filter(
        (c) =>
          (churchFilter === ALL || c.church_id === churchFilter) &&
          (serviceFilter === ALL || c.service_id === serviceFilter)
      ),
    [classes, churchFilter, serviceFilter]
  );
  const onChurchChange = (v: string) => { setChurchFilter(v); setServiceFilter(ALL); setClassFilter(ALL); };
  const onServiceChange = (v: string) => { setServiceFilter(v); setClassFilter(ALL); };

  const visibleEvents = useMemo(
    () =>
      events.filter(
        (ev) =>
          (churchFilter === ALL || ev.church_id === churchFilter) &&
          (serviceFilter === ALL || ev.service_id === null || ev.service_id === serviceFilter) &&
          (classFilter === ALL || ev.class_id === null || ev.class_id === classFilter)
      ),
    [events, churchFilter, serviceFilter, classFilter]
  );
  const visibleCauses = useMemo(
    () =>
      causes.filter(
        (ca) =>
          (churchFilter === ALL || ca.church_id === churchFilter) &&
          (serviceFilter === ALL || ca.service_id === null || ca.service_id === serviceFilter) &&
          (classFilter === ALL || ca.class_id === null || ca.class_id === classFilter)
      ),
    [causes, churchFilter, serviceFilter, classFilter]
  );
  // Preselect the DEFAULT event / cause of the selected scope (0048):
  // class default → service default → church default. Re-resolved whenever
  // the scope selectors change, unless the servant picked one himself and it
  // is still valid for the scope.
  const oneChurch = churches.length === 1 ? churches[0].id : profile?.church_id ?? null;
  // EFFECTIVE scope: a level with a single option is shown as a disabled
  // selector that still holds ALL — resolve it to that option, so a servant
  // with one church / service / class gets his class (or service) default
  // preselected exactly as if he had picked them by hand.
  const scopeSel = useMemo(
    () => effectiveScope({ church: churchFilter, service: serviceFilter, class: classFilter }, churches, services, classes),
    [churchFilter, serviceFilter, classFilter, churches, services, classes]
  );
  // NOTE: this is the ONLY place that writes the selection automatically.
  // It must use the functional updater (reads the REAL current value) and
  // there must be no second effect doing a plain `setEventId('')` from a
  // stale closure in the same commit — that used to override this update
  // every other scope change (alternating "changes / doesn't change" bug).
  // A pick that is no longer visible in the scope is replaced here too, so
  // no separate "keep valid" effect is needed.
  useEffect(() => {
    const def = pickScopedDefault(events, scopeSel, oneChurch)?.id ?? '';
    setEventId((cur) => {
      if (cur && !eventAutoRef.current && visibleEvents.some((ev) => ev.id === cur)) return cur;
      eventAutoRef.current = true;
      return def;
    });
  }, [events, visibleEvents, scopeSel, oneChurch]);
  useEffect(() => {
    const def = pickScopedDefault(causes, scopeSel, oneChurch)?.id ?? '';
    setCauseId((cur) => {
      if (cur && !causeAutoRef.current && visibleCauses.some((ca) => ca.id === cur)) return cur;
      causeAutoRef.current = true;
      return def;
    });
  }, [causes, visibleCauses, scopeSel, oneChurch]);

  const selectedEvent = useMemo(() => events.find((ev) => ev.id === eventId) ?? null, [events, eventId]);
  const selectedCause = useMemo(() => causes.find((ca) => ca.id === causeId) ?? null, [causes, causeId]);

  // Clock tick so the event day/time window stays fresh
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nowDate = useMemo(() => now(), [now, tick]);
  // REAL clock — decides whether the call follow-up cycle is still open (0023)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const realNow = useMemo(() => new Date(), [tick, now]);
  const eventAvail = useMemo(
    () => (selectedEvent ? eventAvailability(selectedEvent, nowDate) : null),
    [selectedEvent, nowDate]
  );
  const attendanceForbidden = job === 'attendance' && attendanceMode === 'add' && !!eventAvail && !eventAvail.ok;

  // Effective points respecting points_mode (fixed / editable / open)
  const effectiveEventPoints: number | null = selectedEvent
    ? selectedEvent.points_mode === 'fixed'
      ? selectedEvent.points
      : selectedEvent.points_mode === 'editable'
        ? (eventPtsOverride ?? selectedEvent.points)
        : eventPtsOverride
    : null;
  const effectiveCausePoints: number | null = selectedCause
    ? selectedCause.points_mode === 'fixed'
      ? selectedCause.points
      : selectedCause.points_mode === 'editable'
        ? (causePtsOverride ?? selectedCause.points)
        : causePtsOverride
    : null;

  // ---------- Names ----------
  const churchName = useCallback((id: string) => churches.find((c) => c.id === id)?.name ?? 'كنيسة', [churches]);
  const serviceName = useCallback((id: string) => services.find((s) => s.id === id)?.name ?? 'خدمة', [services]);
  const className = useCallback((id: string) => classes.find((c) => c.id === id)?.name ?? 'فصل', [classes]);
  const scopeLabel = useCallback(
    (e: EnrollmentWithPerson) => `${churchName(e.church_id)} › ${serviceName(e.service_id)} › ${className(e.class_id)}`,
    [churchName, serviceName, className]
  );

  // Does this enrollment fall inside the selected scope?
  const inScope = useCallback(
    (e: { church_id: string; service_id: string; class_id: string }) =>
      (churchFilter === ALL || e.church_id === churchFilter) &&
      (serviceFilter === ALL || e.service_id === serviceFilter) &&
      (classFilter === ALL || e.class_id === classFilter),
    [churchFilter, serviceFilter, classFilter]
  );

  // ---------- Debounced, scoped manual search ----------
  useEffect(() => {
    const q = search.trim();
    if (!q) { setSearchRows([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const { rows } = await fetchEnrollmentsPage(
          supabase,
          { church: churchFilter, service: serviceFilter, class: classFilter },
          { page: 0, pageSize: 8, search: q }
        );
        if (!cancelled) setSearchRows(rows);
      } catch {
        if (!cancelled) setSearchRows([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search, supabase, churchFilter, serviceFilter, classFilter]);

  // Rows currently on screen (search results)
  const visibleRows = searchRows;

  // ---------- Attendance of the selected event for the rows on screen ----------
  // attendedDays: enrollment id -> set of attended_on days (for the status badge)
  const [attendedDays, setAttendedDays] = useState<Record<string, Set<string>>>({});
  const [eventCounts, setEventCounts] = useState<Record<string, number>>({});
  const visibleIdsKey = visibleRows.map((e) => e.id).join(',');
  useEffect(() => {
    if (!selectedEvent || !visibleIdsKey) { setAttendedDays({}); setEventCounts({}); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('attendance_log')
        .select('enrollment_id, attended_on')
        .eq('event_id', selectedEvent.id)
        .in('enrollment_id', visibleIdsKey.split(','));
      if (cancelled) return;
      const days: Record<string, Set<string>> = {};
      const counts: Record<string, number> = {};
      ((data ?? []) as { enrollment_id: string; attended_on: string }[]).forEach((r) => {
        counts[r.enrollment_id] = (counts[r.enrollment_id] ?? 0) + 1;
        (days[r.enrollment_id] ??= new Set()).add(r.attended_on);
      });
      setAttendedDays(days);
      setEventCounts(counts);
    })();
    return () => { cancelled = true; };
  }, [selectedEvent, supabase, visibleIdsKey]);

  const attendanceShown = (e: EnrollmentWithPerson): number =>
    selectedEvent ? (eventCounts[e.id] ?? 0) : e.attendance_count;

  // Call-feedback badge state (0023) for the rows on screen
  const callFb = useCallFeedbackStates(supabase, visibleRows, selectedEvent, feedbacks, nowDate, realNow);

  // Status of a person in the selected event at the working date-time
  // (present / not registered / absent). null when no event is selected
  // or the event doesn't cover this person.
  const statusOf = useCallback(
    (e: EnrollmentWithPerson): ChildEventStatus | null => {
      if (!selectedEvent || !scopeApplies(selectedEvent, e)) return null;
      return childEventStatus(selectedEvent, attendedDays[e.id], nowDate).status;
    },
    [selectedEvent, attendedDays, nowDate]
  );

  // Mark / unmark a day as attended for one enrollment (optimistic)
  const markAttended = useCallback((id: string, day: string, on: boolean) =>
    setAttendedDays((prev) => {
      const next = new Set(prev[id] ?? []);
      if (on) next.add(day); else next.delete(day);
      return { ...prev, [id]: next };
    }), []);

  // Patch one enrollment everywhere it is shown (optimistic update)
  const patchEnrollment = useCallback((id: string, patch: Partial<EnrollmentWithPerson>) => {
    const fn = (prev: EnrollmentWithPerson[]) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x));
    setSearchRows(fn);
    // keep the open manual-points modal in sync as well
    setManualTarget((cur) => (cur && cur.id === id ? { ...cur, ...patch } : cur));
  }, []);

  // Append an operation to the archive (newest first)
  const logOp = useCallback(
    (e: EnrollmentWithPerson, kind: HistoryKind, detail: string, delta?: number, balance?: number) => {
      setHistory((prev) =>
        [
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            at: new Date(),
            kind,
            name: e.person.name,
            scope: scopeLabel(e),
            detail,
            delta,
            balance,
          },
          ...prev,
        ].slice(0, HISTORY_MAX)
      );
    },
    [scopeLabel]
  );

  // ---------- Per-person job action (same rules as the children page) ----------
  const doJob = useCallback(
    async (e: EnrollmentWithPerson) => {
      setPicker(null);

      // 0043: a STOPPED person — only viewing his data is allowed here
      if (e.status === 'stopped' && job !== 'data') {
        setResult({ type: 'err', message: `⛔ ${e.person.name} — موقوف. أعد تفعيله من إدارة المخدومين ← المخدومين` });
        return;
      }

      if (job === 'attendance') {
        if (attendanceMode === 'add') {
          const ev = events.find((x) => x.id === eventId);
          if (!ev) { setResult({ type: 'err', message: 'اختر المناسبة أولاً' }); return; }
          if (!scopeApplies(ev, e)) {
            setResult({ type: 'err', message: `المناسبة المختارة لا تشمل ${e.person.name}` });
            return;
          }
          if (effectiveEventPoints === null) {
            setResult({ type: 'err', message: 'حدد عدد النقاط أولاً — اضغط على شارة النقاط ⭐' });
            setNumpadFor('event');
            return;
          }
          const avail = eventAvailability(ev, now());
          if (!avail.ok) {
            setResult({ type: 'err', message: `⛔ ممنوع تسجيل الحضور — ${avail.reason}` });
            return;
          }
          setBusyId(e.id);
          const { error } = await supabase.from('attendance_log').insert({
            enrollment_id: e.id,
            event_id: ev.id,
            points_delta: effectiveEventPoints,
            attended_on: cairoToday(now()),
            recorded_by: profile?.id,
          });
          setBusyId(null);
          if (error?.code === '23505') {
            setResult({ type: 'dup', message: `${e.person.name} — حضوره مسجل بالفعل في هذه المناسبة اليوم` });
            return;
          }
          if (error?.message?.includes('enrollment_stopped')) { setResult({ type: 'err', message: `${e.person.name} — موقوف، لا يمكن تسجيل حضوره` }); return; }
          if (error) { setResult({ type: 'err', message: 'تعذر تسجيل الحضور، حاول مجدداً' }); return; }
          patchEnrollment(e.id, { attendance_count: e.attendance_count + 1, points: e.points + effectiveEventPoints });
          markAttended(e.id, cairoToday(now()), true);
          setEventCounts((c) => ({ ...c, [e.id]: (c[e.id] ?? 0) + 1 }));
          setResult({
            type: 'ok',
            message: `تم تسجيل حضور ${e.person.name} ✔ (${className(e.class_id)}) +${effectiveEventPoints} نقطة`,
          });
          logOp(e, 'att_add', ev.name, effectiveEventPoints, e.points + effectiveEventPoints);
        } else {
          // Remove the attendance entry of the WORKING DATE only
          const workingDay = cairoToday(now());
          setBusyId(e.id);
          let query = supabase
            .from('attendance_log')
            .select('id')
            .eq('enrollment_id', e.id)
            .eq('attended_on', workingDay)
            .order('created_at', { ascending: false })
            .limit(1);
          if (eventId) query = query.eq('event_id', eventId);
          const { data: rows } = await query;
          if (!rows || rows.length === 0) {
            setBusyId(null);
            setResult({
              type: 'dup',
              message: eventId
                ? `${e.person.name} — لا يوجد حضور مسجل في هذه المناسبة في هذا اليوم`
                : `${e.person.name} — لا يوجد حضور مسجل في هذا اليوم`,
            });
            return;
          }
          const { data: removed, error } = await supabase
            .from('attendance_log')
            .delete()
            .eq('id', rows[0].id)
            .select('points_delta')
            .maybeSingle();
          setBusyId(null);
          if (error) { setResult({ type: 'err', message: 'تعذر إزالة الحضور، حاول مجدداً' }); return; }
          const delta = (removed as { points_delta?: number } | null)?.points_delta ?? 0;
          patchEnrollment(e.id, {
            attendance_count: Math.max(0, e.attendance_count - 1),
            points: e.points - delta,
          });
          markAttended(e.id, workingDay, false);
          setEventCounts((c) => ({ ...c, [e.id]: Math.max(0, (c[e.id] ?? 1) - 1) }));
          setResult({ type: 'ok', message: `تمت إزالة حضور ${e.person.name} (${className(e.class_id)})${delta ? ` −${delta} نقطة` : ''}` });
          logOp(e, 'att_remove', selectedEvent?.name ?? 'كل المناسبات', -delta, e.points - delta);
        }
      } else if (job === 'points') {
        if (pointsMode === 'manual') {
          // NEW: open the modal — name + points + number + add / subtract + cause
          setResult(null);
          setManualTarget(e);
          return;
        }
        // Points are given IN an event (4th scope level) — event required
        const ev = events.find((x) => x.id === eventId);
        if (!ev) { setResult({ type: 'err', message: 'اختر المناسبة أولاً' }); return; }
        if (!scopeApplies(ev, e)) {
          setResult({ type: 'err', message: `المناسبة المختارة لا تشمل ${e.person.name}` });
          return;
        }
        const ca = causes.find((x) => x.id === causeId);
        if (!ca) { setResult({ type: 'err', message: 'اختر سبب النقاط أولاً' }); return; }
        if (!scopeApplies(ca, e)) {
          setResult({ type: 'err', message: `السبب المختار لا يشمل ${e.person.name}` });
          return;
        }
        if (effectiveCausePoints === null) {
          setResult({ type: 'err', message: 'حدد عدد النقاط أولاً — اضغط على شارة النقاط ⭐' });
          setNumpadFor('cause');
          return;
        }
        if (effectiveCausePoints === 0) return;
        setBusyId(e.id);
        const delta = (pointsMode === 'add' ? 1 : -1) * effectiveCausePoints;
        const { error } = await supabase.from('points_log').insert({
          enrollment_id: e.id,
          cause_id: ca.id,
          event_id: ev.id,
          delta,
          recorded_by: profile?.id,
        });
        setBusyId(null);
        if (error?.message?.includes('enrollment_stopped')) { setResult({ type: 'err', message: `${e.person.name} — موقوف، لا يمكن تسجيل نقاطه` }); return; }
        if (error) { setResult({ type: 'err', message: 'تعذر تسجيل النقاط، حاول مجدداً (تأكد من تطبيق migration 0022)' }); return; }
        patchEnrollment(e.id, { points: e.points + delta });
        setResult({
          type: 'ok',
          message: `${e.person.name} — ${delta > 0 ? `+${delta}` : delta} نقطة (${ca.name} — ${ev.name}) → الرصيد ${e.points + delta}`,
        });
        logOp(e, delta > 0 ? 'pts_add' : 'pts_sub', `${ca.name} — ${ev.name}`, delta, e.points + delta);
      } else if (job === 'data') {
        setResult(null);
        setDataTarget(e);
        logOp(e, 'data', 'عرض البيانات');
      }
    },
    [
      job, attendanceMode, pointsMode, events, eventId, causes, causeId,
      effectiveEventPoints, effectiveCausePoints, supabase, profile, now,
      className, patchEnrollment, logOp, selectedEvent, markAttended,
    ]
  );

  // ---------- Scan flow: national id (QR) -> RPC -> enrollments in scope ----------
  const handleQr = useCallback(
    async (qrValue: string) => {
      const nationalId = qrValue.trim();

      // ---- Family module: person with a family / family code → picker ----
      if (familyModule && familyMode) {
        try {
          const fam = await lookupFamily(supabase, nationalId, cairoToday(now()));
          if (fam.matched === 'family' || (fam.matched === 'person' && fam.family)) {
            setResult(null);
            setPicker(null);
            setFamilyPick(fam);
            return;
          }
          // matched a lone person (no family) → fall through to the normal flow
        } catch {
          // migration not applied / no permission → normal flow
        }
      }

      const { data, error } = await supabase.rpc('lookup_enrollments_by_national_id', {
        p_national_id: nationalId,
      });
      if (error) {
        setResult({ type: 'err', message: 'تعذر البحث عن الرقم القومي — تأكد من تشغيل تحديث قاعدة البيانات (0019)' });
        return;
      }
      const all = ((data ?? []) as EnrollmentWithPerson[]).filter((e) => e.person);
      if (all.length === 0) {
        setResult({ type: 'err', message: 'رقم قومي غير معروف أو الشخص غير مسجل في نطاق صلاحيتك' });
        return;
      }
      // Narrow to the selected church / service / class
      const mine = all.filter(inScope);
      if (mine.length === 0) {
        setResult({
          type: 'err',
          message: `${all[0].person.name} غير مسجل في النطاق المختار (${all.map(scopeLabel).join(' / ')})`,
        });
        return;
      }
      if (mine.length === 1) {
        await doJob(mine[0]);
        return;
      }
      // Enrolled in several classes / services — let the servant pick
      setResult(null);
      setPicker({ person: mine[0].person, options: mine });
    },
    [supabase, inScope, scopeLabel, doJob, familyModule, familyMode, now]
  );

  // A member / enrollment was chosen in the family picker → run the job on
  // it and close the picker (same path as a single scan)
  const pickFromFamily = useCallback(
    async (e: EnrollmentWithPerson) => {
      setFamilyPick(null);
      await doJob(e);
    },
    [doJob]
  );

  // Keep the scanning loop pointed at the LATEST handler (job / mode may
  // change while the camera is running). While a modal is open the camera
  // keeps running but scans are ignored, so a second QR in frame can never
  // hijack the open modal.
  const modalOpen = !!manualTarget || !!dataTarget || !!picker || !!logTarget || !!callTarget || numpadFor !== null || !!familyPick;
  const handleQrRef = useRef<(v: string) => Promise<void>>(handleQr);
  handleQrRef.current = modalOpen ? async () => {} : handleQr;

  // ---------- Camera (native BarcodeDetector → jsQR fallback) ----------
  // Android Chrome exposes the native BarcodeDetector (fast, GPU-backed).
  // iOS Safari / Chrome-on-iOS / Firefox / desktop Safari do NOT — there we
  // draw each video frame on a canvas and decode it with jsQR so the live
  // scanner works everywhere instead of showing "browser not supported".
  const startCamera = async () => {
    setCameraError('');
    setResult(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('المتصفح لا يدعم الكاميرا — افتح التطبيق عبر HTTPS أو استخدم البحث اليدوي بالأسفل');
      return;
    }
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch {
        // Some iOS devices reject the constraint set — retry with the simplest one
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      streamRef.current = stream;
      if (videoRef.current) {
        const v = videoRef.current;
        v.srcObject = stream;
        // iOS requires these attributes to be set before play() for inline playback
        v.setAttribute('playsinline', 'true');
        v.setAttribute('webkit-playsinline', 'true');
        v.muted = true;
        try {
          await v.play();
        } catch {
          /* autoplay may be blocked until metadata loads — the loop below waits for frames */
        }
      }
      setCameraOn(true);

      const detector = nativeDetector();
      if (!decodeCanvasRef.current) decodeCanvasRef.current = document.createElement('canvas');
      const canvas = decodeCanvasRef.current;

      scanningRef.current = true;
      let lastCode = '';
      let lastAt = 0;
      let handling = false;

      const tickFrame = async () => {
        if (!scanningRef.current || !videoRef.current) return;
        try {
          const video = videoRef.current;
          if (!handling && video.readyState >= 2 && video.videoWidth > 0) {
            let value: string | null = null;
            if (detector) {
              const codes = await detector.detect(video);
              value = codes[0]?.rawValue ?? null;
            } else {
              value = decodeVideoFrame(video, canvas);
            }
            if (value) {
              const t = Date.now();
              if (value !== lastCode || t - lastAt > 4000) {
                lastCode = value;
                lastAt = t;
                handling = true;
                try { await handleQrRef.current(value); } finally { handling = false; }
              }
            }
          }
        } catch {
          /* frame not ready */
        }
        if (scanningRef.current) {
          // Native: every frame. jsQR: ~8 fps to keep the phone cool / responsive.
          if (detector) requestAnimationFrame(tickFrame);
          else setTimeout(tickFrame, 120);
        }
      };
      tickFrame();
    } catch {
      setCameraError('تعذر فتح الكاميرا — تأكد من منح الإذن للكاميرا في إعدادات Safari أو استخدم البحث اليدوي');
    }
  };

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  // ---------- Card tone + per-person job button (mirrors the children page) ----------
  const cardTone = (e: EnrollmentWithPerson): string => {
    if (job !== 'attendance') return 'bg-white';
    const s = statusOf(e);
    if (s === 'present') return 'bg-emerald-50';
    if (s === 'absent') return 'bg-red-50';
    return 'bg-white';
  };

  const jobButton = (e: EnrollmentWithPerson) => {
    if (busyId === e.id) return <Loader2 className="h-6 w-6 animate-spin text-primary-500" />;
    if (job === 'attendance') {
      const present = statusOf(e) === 'present';
      if (attendanceMode === 'add') {
        const forbidden = !!selectedEvent && !!eventAvail && !eventAvail.ok;
        return (
          <button
            id={`job-btn-${e.id}`}
            aria-label={present ? 'حاضر بالفعل' : 'تسجيل حضور'}
            aria-pressed={present}
            onClick={() => doJob(e)}
            disabled={forbidden}
            title={forbidden ? eventAvail?.reason ?? undefined : undefined}
            className={`flex h-10 w-10 items-center justify-center rounded-full shadow transition active:scale-95 ${
              forbidden
                ? 'cursor-not-allowed bg-slate-100 text-slate-300 shadow-none'
                : present
                  ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                  : 'bg-emerald-50 text-emerald-400 hover:bg-emerald-100'
            }`}
          >
            <Check className="h-5 w-5" />
          </button>
        );
      }
      return (
        <button
          id={`job-btn-${e.id}`}
          aria-label={present ? 'إزالة حضور' : 'غير حاضر بالفعل'}
          aria-pressed={!present}
          onClick={() => doJob(e)}
          className={`flex h-10 w-10 items-center justify-center rounded-full shadow transition active:scale-95 ${
            present ? 'bg-red-50 text-red-300 hover:bg-red-100' : 'bg-red-500 text-white hover:bg-red-600'
          }`}
        >
          <X className="h-5 w-5" />
        </button>
      );
    }
    if (job === 'points') {
      if (pointsMode === 'manual') {
        return (
          <button
            id={`job-btn-${e.id}`}
            aria-label="نقاط يدوية"
            onClick={() => doJob(e)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-gold-500 text-white shadow transition hover:bg-gold-600 active:scale-95"
          >
            <Calculator className="h-5 w-5" />
          </button>
        );
      }
      const add = pointsMode === 'add';
      return (
        <button
          id={`job-btn-${e.id}`}
          aria-label={add ? 'إضافة نقاط' : 'خصم نقاط'}
          onClick={() => doJob(e)}
          className={`flex h-10 w-10 items-center justify-center rounded-full text-white shadow transition active:scale-95 ${
            add ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-red-500 hover:bg-red-600'
          }`}
        >
          {add ? <Plus className="h-5 w-5" /> : <Minus className="h-5 w-5" />}
        </button>
      );
    }
    // data — view only
    return (
      <button
        id={`job-btn-${e.id}`}
        aria-label="عرض البيانات"
        onClick={() => doJob(e)}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-600 text-white shadow transition hover:bg-primary-700 active:scale-95"
      >
        <Eye className="h-5 w-5" />
      </button>
    );
  };

  // One person row — identical layout to the children page card
  const personRow = (e: EnrollmentWithPerson, i: number) => (
    <li key={e.id} className={`card relative overflow-hidden !py-3 !border-2 !border-indigo-200 transition-colors duration-300 ${cardTone(e)}`}>
      {/* running number in the corner — follows the current result list */}
      <span className="card-num" aria-label={`رقم ${i + 1}`}>{i + 1}</span>
      {/* TOP: photo · name + scope · job button — BOTTOM: 4 badges in one row */}
      <div className="flex items-center gap-3">
        <PersonAvatar name={e.person.name} imageUrl={e.person.image_url} />
        <div className="min-w-0 flex-1">
          <p className="font-extrabold truncate leading-tight">{e.person.name}</p>
          <p className="mt-0.5 text-[11px] font-bold text-slate-400 truncate">{scopeLabel(e)}</p>
        </div>
        <div className="shrink-0">{jobButton(e)}</div>
      </div>
      <div className="badge-row">
        {/* Status in the selected event right now — BEFORE attendance & points */}
        {(() => {
          const s = statusOf(e);
          if (!s) return null;
          const st = STATUS_STYLE[s];
          return (
            <span
              id={`status-badge-${e.id}`}
              role="status"
              aria-label={`الحالة: ${CHILD_STATUS_LABELS[s]}`}
              title={`الحالة في «${selectedEvent?.name ?? ''}» الآن`}
              className={`badge-btn ${st.cls}`}
            >
              {st.icon} <span className="truncate">{CHILD_STATUS_LABELS[s]}</span>
            </span>
          );
        })()}
        {/* Call feedback badge — AFTER the status badge (0023) */}
        {(() => {
          const cs = callFb.stateOf(e);
          if (!cs) return null;
          return <CallFeedbackBadge id={`call-badge-${e.id}`} state={cs} onClick={() => setCallTarget(e)} />;
        })()}
        <button
          id={`att-badge-${e.id}`}
          type="button"
          aria-label={selectedEvent ? `سجل الحضور — ${selectedEvent.name}` : 'سجل الحضور — كل المناسبات'}
          onClick={() => setLogTarget({ kind: 'attendance', e })}
          className="badge-btn bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
        >
          <CalendarCheck className="h-3.5 w-3.5" /> <span className="truncate">{attendanceShown(e)}</span>
        </button>
        <button
          id={`pts-badge-${e.id}`}
          type="button"
          aria-label="سجل النقاط"
          onClick={() => setLogTarget({ kind: 'points', e })}
          className="badge-btn bg-gold-100 text-gold-600 hover:bg-gold-200"
        >
          <Star className="h-3.5 w-3.5" /> <span className="truncate">{e.points}</span>
        </button>
      </div>
    </li>
  );

  const jobLabel = SCANNER_JOBS.find((j) => j.value === job)?.label ?? '';

  return (
    <AppShell>
      <section id="scanner-header" className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <ScanLine className="h-5 w-5 text-primary-600" />
          {pageName} — {jobLabel}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          اختر النطاق والوظيفة ثم امسح الرقم القومي (QR) أو ابحث يدوياً — تُنفَّذ الوظيفة المختارة على المخدوم فور مسحه
        </p>
      </section>

      {/* ---------- Control panel — same as the children page ---------- */}
      <div id="control-zone" className="mb-4">
        {/* Row 1: scope selectors (church / service / class / event) — event is the 4th level */}
        <div className="mb-2 grid grid-cols-4 gap-2">
          <select
            id="church-selector"
            aria-label="اختيار الكنيسة"
            className="input-field appearance-none !px-2 text-xs font-bold"
            value={churchFilter}
            onChange={(e) => onChurchChange(e.target.value)}
            disabled={churches.length <= 1}
          >
            <option value={ALL}>{churches.length === 1 ? churches[0].name : 'كل الكنائس'}</option>
            {churches.length > 1 && churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            id="service-selector"
            aria-label="اختيار الخدمة"
            className="input-field appearance-none !px-2 text-xs font-bold"
            value={serviceFilter}
            onChange={(e) => onServiceChange(e.target.value)}
            disabled={visibleServices.length <= 1}
          >
            <option value={ALL}>{visibleServices.length === 1 ? visibleServices[0].name : 'كل الخدمات'}</option>
            {visibleServices.length > 1 && visibleServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select
            id="class-selector"
            aria-label="اختيار الفصل"
            className="input-field appearance-none !px-2 text-xs font-bold"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            disabled={visibleClasses.length <= 1}
          >
            <option value={ALL}>{visibleClasses.length === 1 ? visibleClasses[0].name : 'كل الفصول'}</option>
            {visibleClasses.length > 1 && visibleClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            id="event-selector"
            aria-label="اختيار المناسبة"
            className={`input-field appearance-none !px-2 text-xs font-bold ${
              !eventId && job !== 'data' ? '!border-violet-300 !bg-violet-50 text-violet-700' : ''
            }`}
            value={eventId}
            onChange={(e) => { chooseEvent(e.target.value); setResult(null); }}
          >
            <option value="">
              {job === 'attendance' && attendanceMode === 'remove' ? 'كل المناسبات' : 'اختر المناسبة *'}
            </option>
            {visibleEvents.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.name} — {describeEventSchedule(ev)}</option>
            ))}
          </select>
        </div>

        {/* Row 2: job selector */}
        <div className="mb-2">
          <select
            id="job-selector"
            aria-label="اختيار الوظيفة"
            className="input-field appearance-none text-sm font-bold"
            value={job}
            onChange={(e) => { setJob(e.target.value as ScannerJob); setResult(null); }}
          >
            {SCANNER_JOBS.map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
          </select>
        </div>

        {/* Row 3: mode buttons (attendance) / cause selector + mode buttons (points) */}
        <div className="mb-2 flex items-stretch gap-2">
          {job === 'attendance' && (
            <>
              <button
                id="att-mode-add"
                aria-label="وضع تسجيل الحضور"
                aria-pressed={attendanceMode === 'add'}
                onClick={() => setAttendanceMode('add')}
                className={`flex h-10 flex-1 items-center justify-center rounded-xl transition active:scale-95 ${
                  attendanceMode === 'add' ? 'bg-emerald-500 text-white shadow ring-2 ring-emerald-300' : 'bg-emerald-50 text-emerald-500'
                }`}
              >
                <Check className="h-5 w-5" />
              </button>
              <button
                id="att-mode-remove"
                aria-label="وضع إزالة الحضور"
                aria-pressed={attendanceMode === 'remove'}
                onClick={() => setAttendanceMode('remove')}
                className={`flex h-10 flex-1 items-center justify-center rounded-xl transition active:scale-95 ${
                  attendanceMode === 'remove' ? 'bg-red-500 text-white shadow ring-2 ring-red-300' : 'bg-red-50 text-red-500'
                }`}
              >
                <X className="h-5 w-5" />
              </button>
              <button
                id="event-points-badge"
                type="button"
                aria-label="نقاط المناسبة"
                disabled={!selectedEvent || selectedEvent.points_mode === 'fixed'}
                onClick={() => setNumpadFor('event')}
                className={`flex h-10 flex-1 items-center justify-center gap-1 rounded-xl px-2 text-sm font-extrabold transition ${
                  selectedEvent && selectedEvent.points_mode !== 'fixed'
                    ? 'bg-gold-400 text-white shadow ring-2 ring-gold-200 active:scale-95'
                    : 'bg-gold-100 text-gold-600'
                }`}
              >
                <Star className="h-4 w-4" />
                {!selectedEvent ? '—' : effectiveEventPoints === null ? '؟' : effectiveEventPoints}
              </button>
            </>
          )}

          {job === 'points' && (
            <>
              <select
                id="cause-selector"
                aria-label="اختيار سبب النقاط"
                className="input-field !w-1/2 min-w-0 shrink-0 appearance-none !px-2 text-xs font-bold"
                value={causeId}
                onChange={(e) => { chooseCause(e.target.value); setResult(null); }}
              >
                <option value="">{pointsMode === 'manual' ? 'السبب الافتراضي (اختياري)' : 'اختر سبب النقاط *'}</option>
                {visibleCauses.map((ca) => (
                  <option key={ca.id} value={ca.id}>
                    {ca.name}{ca.points_mode !== 'open' ? ` — ${ca.points} نقطة` : ''}
                  </option>
                ))}
              </select>
              <button
                id="pts-mode-add"
                aria-label="وضع إضافة النقاط"
                aria-pressed={pointsMode === 'add'}
                onClick={() => setPointsMode('add')}
                className={`flex h-10 flex-1 items-center justify-center rounded-xl transition active:scale-95 ${
                  pointsMode === 'add' ? 'bg-emerald-500 text-white shadow ring-2 ring-emerald-300' : 'bg-emerald-50 text-emerald-500'
                }`}
              >
                <Plus className="h-5 w-5" />
              </button>
              <button
                id="pts-mode-subtract"
                aria-label="وضع خصم النقاط"
                aria-pressed={pointsMode === 'subtract'}
                onClick={() => setPointsMode('subtract')}
                className={`flex h-10 flex-1 items-center justify-center rounded-xl transition active:scale-95 ${
                  pointsMode === 'subtract' ? 'bg-red-500 text-white shadow ring-2 ring-red-300' : 'bg-red-50 text-red-500'
                }`}
              >
                <Minus className="h-5 w-5" />
              </button>
              {/* NEW: manual mode — scanning opens the points modal */}
              <button
                id="pts-mode-manual"
                aria-label="وضع النقاط اليدوي — نافذة عند المسح"
                aria-pressed={pointsMode === 'manual'}
                onClick={() => setPointsMode('manual')}
                className={`flex h-10 flex-1 items-center justify-center rounded-xl transition active:scale-95 ${
                  pointsMode === 'manual' ? 'bg-gold-500 text-white shadow ring-2 ring-gold-300' : 'bg-gold-50 text-gold-600'
                }`}
              >
                <Calculator className="h-5 w-5" />
              </button>
              {/* Always rendered so the row keeps the same layout in every mode */}
              <button
                id="cause-points-badge"
                type="button"
                aria-label="نقاط السبب"
                disabled={!selectedCause || selectedCause.points_mode === 'fixed'}
                onClick={() => setNumpadFor('cause')}
                className={`flex h-10 flex-1 items-center justify-center gap-1 rounded-xl px-2 text-sm font-extrabold transition ${
                  selectedCause && selectedCause.points_mode !== 'fixed'
                    ? 'bg-gold-400 text-white shadow ring-2 ring-gold-200 active:scale-95'
                    : 'bg-gold-100 text-gold-600'
                }`}
              >
                <Star className="h-4 w-4" />
                {!selectedCause ? '—' : effectiveCausePoints === null ? '؟' : effectiveCausePoints}
              </button>
            </>
          )}

          {job === 'data' && (
            <>
              <button
                id="data-mode-view"
                aria-label="عرض البيانات"
                aria-pressed
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary-600 text-xs font-extrabold text-white shadow ring-2 ring-primary-300"
              >
                <Eye className="h-4 w-4" /> عرض
              </button>
              <Link
                id="data-mode-manage"
                href="/children/manage?tab=people"
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-50 text-xs font-extrabold text-amber-700 transition hover:bg-amber-100 active:scale-95"
              >
                <Settings2 className="h-4 w-4" /> تعديل · حذف · إيقاف
              </Link>
            </>
          )}
        </div>

        {/* Family mode switch (العائلات) */}
        {familyModule && (
          <label
            id="family-mode"
            className={`mb-2 flex cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-bold transition ${
              familyMode ? 'bg-teal-50 text-teal-700' : 'bg-slate-50 text-slate-500'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <UsersRound className="h-4 w-4 shrink-0" />
              <span>
                العائلات: عند مسح كود فرد من عائلة تظهر كل العائلة لاختيار الشخص والخدمة
                <span className="block text-[10px] font-bold opacity-70">
                  {autoService ? 'التعرف على الخدمة التي حضرها اليوم: مفعّل' : 'عند تعدد الخدمات يُسأل دائماً'}
                </span>
              </span>
            </span>
            <input
              id="family-mode-switch"
              type="checkbox"
              className="h-5 w-5 shrink-0 accent-teal-600"
              checked={familyMode}
              onChange={(e) => { setFamilyMode(e.target.checked); setResult(null); }}
            />
          </label>
        )}

        {/* Hints / warnings */}
        {attendanceForbidden && eventAvail && (
          <p id="event-time-warning" className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
            ⛔ ممنوع تسجيل الحضور — {eventAvail.reason}
          </p>
        )}
        {job === 'attendance' && visibleEvents.length === 0 && (
          <p className="mb-2 rounded-xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-600">
            لا توجد مناسبات — أضف مناسبة من الإعدادات ← إدارة المناسبات
          </p>
        )}
        {job === 'points' && visibleCauses.length === 0 && (
          <p className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-600">
            لا توجد أسباب — أضف سبباً من الإعدادات ← إدارة أسباب النقاط
          </p>
        )}
        {job === 'points' && pointsMode === 'manual' && (
          <p id="manual-points-hint" className="mb-2 flex items-center gap-1.5 rounded-xl bg-gold-50 px-3 py-2 text-xs font-bold text-gold-600">
            <Calculator className="h-3.5 w-3.5 shrink-0" />
            عند مسح المخدوم تُفتح نافذة باسمه ورصيده — اكتب عدد النقاط واختر السبب ثم اضغط إضافة أو خصم
          </p>
        )}
        {job === 'data' && (
          <p id="data-mode-hint" className="mb-2 flex items-center gap-1.5 rounded-xl bg-primary-50 px-3 py-2 text-xs font-bold text-primary-600">
            <Database className="h-3.5 w-3.5 shrink-0" />
            امسح المخدوم لعرض بياناته الكاملة مع كود QR وكل تسجيلاته — التعديل والحذف والإيقاف من «إدارة المخدومين ← المخدومين»
          </p>
        )}
      </div>

      {/* ---------- Camera ---------- */}
      <section id="camera-section" className="card mb-4 overflow-hidden !p-0">
        <div className="relative flex aspect-[4/3] items-center justify-center bg-slate-900">
          <video ref={videoRef} className={`h-full w-full object-cover ${cameraOn ? '' : 'hidden'}`} muted playsInline autoPlay />
          {!cameraOn && (
            <div className="text-center text-slate-400">
              <Camera className="mx-auto mb-2 h-10 w-10" />
              <p className="text-sm font-bold">الكاميرا متوقفة</p>
            </div>
          )}
          {cameraOn && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-48 w-48 rounded-2xl border-4 border-gold-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
          )}
        </div>
        <div className="p-3">
          {cameraError && (
            <p className="mb-2 flex items-center gap-1 rounded-xl bg-gold-50 px-3 py-2 text-xs font-bold text-gold-600">
              <AlertCircle className="h-4 w-4 shrink-0" /> {cameraError}
            </p>
          )}
          <button
            id="camera-toggle"
            onClick={cameraOn ? stopCamera : startCamera}
            className={`flex w-full items-center justify-center gap-2 ${cameraOn ? 'btn-secondary' : 'btn-primary'}`}
          >
            {cameraOn ? <CameraOff className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
            {cameraOn ? 'إيقاف الكاميرا' : 'تشغيل الكاميرا'}
          </button>
        </div>
      </section>

      {/* ---------- Result banner ---------- */}
      {result && (
        <div
          id="scan-result"
          className={`mb-4 flex items-center gap-2 rounded-2xl px-4 py-3 font-bold ${
            result.type === 'ok' ? 'bg-emerald-100 text-emerald-700' : result.type === 'dup' ? 'bg-gold-100 text-gold-600' : 'bg-red-100 text-red-600'
          }`}
        >
          {result.type === 'ok' ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertCircle className="h-5 w-5 shrink-0" />}
          <span className="text-sm">{result.message}</span>
        </div>
      )}

      {/* ---------- Multi-enrollment picker ---------- */}
      {picker && (
        <div id="enrollment-picker" className="card mb-4">
          <p className="mb-2 text-sm font-extrabold text-slate-700">
            {picker.person.name} مسجل في أكثر من مكان — اختر التسجيل المطلوب:
          </p>
          <ul className="space-y-2">
            {picker.options.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => doJob(e)}
                  disabled={busyId === e.id || attendanceForbidden}
                  title={attendanceForbidden ? eventAvail?.reason ?? undefined : undefined}
                  className={`flex w-full items-center justify-between !py-2.5 ${
                    attendanceForbidden ? 'btn-secondary opacity-50 !text-slate-400' : 'btn-secondary'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm font-bold">
                    <School className="h-4 w-4 shrink-0 text-primary-600" />
                    <span className="truncate">{scopeLabel(e)}</span>
                  </span>
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                </button>
              </li>
            ))}
          </ul>
          <button onClick={() => setPicker(null)} className="mt-2 w-full text-xs font-bold text-slate-400">إلغاء</button>
        </div>
      )}

      {/* ---------- Manual search (scoped) ---------- */}
      <section id="manual-section">
        <h3 className="mb-2 text-sm font-extrabold text-slate-500">بحث يدوي</h3>
        <div className="relative mb-3">
          {searching ? (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-primary-500" />
          ) : (
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          )}
          <input
            id="manual-search"
            className="input-field pr-9"
            placeholder="ابحث بالاسم أو الهاتف أو الرقم القومي..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {search.trim() && !searching && searchRows.length === 0 && (
          <p className="card py-6 text-center text-sm font-bold text-slate-400">لا توجد نتائج في النطاق المختار</p>
        )}
        <ul className="space-y-2.5">{searchRows.map((e, i) => personRow(e, i))}</ul>
      </section>

      {/* ---------- Archive of scan operations ---------- */}
      <section id="history-section" className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-500">
            <History className="h-4 w-4" /> أرشيف عمليات المسح
            <span className="badge bg-primary-100 text-primary-700">{history.length}</span>
          </h3>
          {history.length > 0 && (
            <button id="history-clear" onClick={() => setHistory([])} className="text-xs font-bold text-slate-400 hover:text-red-500">
              مسح الأرشيف
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="card py-6 text-center text-sm font-bold text-slate-400">لا توجد عمليات بعد — ستظهر هنا كل عملية بعد المسح</p>
        ) : (
          <ul id="history-list" className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
            {history.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${HISTORY_STYLE[h.kind].bg}`}>
                  {HISTORY_STYLE[h.kind].icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold">{h.name}</p>
                  <p className="truncate text-[11px] font-bold text-slate-500">
                    {HISTORY_STYLE[h.kind].label}
                    {h.detail ? ` · ${h.detail}` : ''}
                  </p>
                  <p className="truncate text-[10px] text-slate-400">{h.scope}</p>
                </div>
                <div className="shrink-0 text-left">
                  {typeof h.delta === 'number' && h.delta !== 0 && (
                    <p className={`text-sm font-extrabold tabular-nums ${h.delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {h.delta > 0 ? `+${h.delta}` : h.delta}
                    </p>
                  )}
                  {typeof h.balance === 'number' && (
                    <p className="flex items-center justify-end gap-0.5 text-[11px] font-bold text-gold-600 tabular-nums">
                      <Star className="h-3 w-3" /> {h.balance}
                    </p>
                  )}
                  <p className="text-[10px] text-slate-400 tabular-nums">{formatCairoTime(h.at)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------- NumPads ---------- */}
      {numpadFor === 'event' && selectedEvent && (
        <NumPadModal
          title={`نقاط «${selectedEvent.name}»`}
          initial={effectiveEventPoints ?? selectedEvent.points}
          onConfirm={(v) => { setEventPtsOverride(v); setNumpadFor(null); }}
          onClose={() => setNumpadFor(null)}
        />
      )}
      {numpadFor === 'cause' && selectedCause && (
        <NumPadModal
          title={`نقاط «${selectedCause.name}»`}
          initial={effectiveCausePoints ?? selectedCause.points}
          onConfirm={(v) => { setCausePtsOverride(v); setNumpadFor(null); }}
          onClose={() => setNumpadFor(null)}
        />
      )}

      {/* ---------- NEW: manual points modal ---------- */}
      {manualTarget && (
        <ManualPointsModal
          enrollment={manualTarget}
          event={selectedEvent && scopeApplies(selectedEvent, manualTarget) ? selectedEvent : null}
          causes={visibleCauses.filter((ca) => scopeApplies(ca, manualTarget))}
          defaultCauseId={causeId}
          defaultAmount={effectiveCausePoints ?? 0}
          recorderId={profile?.id ?? null}
          onApplied={(delta, cause) => {
            // Modal STAYS OPEN — the balance updates live (optimistic patch,
            // then realtime confirms it)
            const next = manualTarget.points + delta;
            patchEnrollment(manualTarget.id, { points: next });
            setResult({
              type: 'ok',
              message: `${manualTarget.person.name} — ${delta > 0 ? `+${delta}` : delta} نقطة (${cause.name}) → الرصيد ${next}`,
            });
            logOp(manualTarget, delta > 0 ? 'pts_add' : 'pts_sub', cause.name, delta, next);
          }}
          onBalance={(pts) => patchEnrollment(manualTarget.id, { points: pts })}
          onClose={() => setManualTarget(null)}
        />
      )}

      {/* ---------- Log modals ---------- */}
      {logTarget?.kind === 'attendance' && (
        <AttendanceLogModal enrollment={logTarget.e} events={events} selectedEvent={selectedEvent} onClose={() => setLogTarget(null)} />
      )}
      {logTarget?.kind === 'points' && (
        <PointsLogModal enrollment={logTarget.e} causes={causes} events={events} onClose={() => setLogTarget(null)} />
      )}
      {callTarget && selectedEvent && callFb.cycle && (
        <CallFeedbackModal
          enrollment={callTarget}
          event={selectedEvent}
          cycle={callFb.cycle}
          feedbacks={feedbacks}
          current={callFb.stateOf(callTarget) ?? { kind: 'not_called_yet' }}
          now={now}
          onRecorded={(day, fbId) => callFb.setRecorded(callTarget.id, day, fbId)}
          onClose={() => setCallTarget(null)}
        />
      )}

      {/* ---------- Family picker (العائلات) ---------- */}
      {familyPick && (
        <FamilyScanPicker
          lookup={familyPick}
          inScope={inScope}
          scopeLabel={scopeLabel}
          serviceName={serviceName}
          autoService={autoService}
          onAutoServiceChange={setAutoService}
          busyId={busyId}
          onPick={pickFromFamily}
          onClose={() => setFamilyPick(null)}
        />
      )}

      {/* ---------- البيانات modal (view only) ---------- */}
      {dataTarget && (
        <ViewPersonModal enrollment={dataTarget} churches={churches} services={services} classes={classes} onClose={() => setDataTarget(null)} />
      )}
    </AppShell>
  );
}

// =====================================================================
// Manual points modal — opened when a child is scanned in "يدوي" mode.
// Shows the child's name + LIVE balance, a cause dropdown, a tappable
// number (opens the same NumPad used everywhere) and ADD / SUBTRACT
// buttons that apply the number. The modal STAYS OPEN after applying so
// the servant can keep adjusting; the balance updates instantly
// (optimistic) and is confirmed by a realtime subscription on the
// enrollment row.
// =====================================================================
function ManualPointsModal({
  enrollment, event, causes, defaultCauseId, defaultAmount, recorderId, onApplied, onBalance, onClose,
}: {
  enrollment: EnrollmentWithPerson;
  event: AppEvent | null;   // points are given IN this event (required)
  causes: Cause[];
  defaultCauseId: string;
  defaultAmount: number;
  recorderId: string | null;
  onApplied: (delta: number, cause: Cause) => void;
  onBalance: (points: number) => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const initialCause = causes.find((c) => c.id === defaultCauseId) ?? causes[0] ?? null;
  const [causeId, setCauseId] = useState<string>(initialCause?.id ?? '');
  const cause = causes.find((c) => c.id === causeId) ?? null;
  // Start from the number shown on the points badge in the control row
  // (fixed causes always use their bound number)
  const [amount, setAmount] = useState<number>(
    initialCause && initialCause.points_mode === 'fixed' ? initialCause.points : defaultAmount
  );
  const [numpadOpen, setNumpadOpen] = useState(false);
  const [busy, setBusy] = useState<'add' | 'subtract' | null>(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const [lastOp, setLastOp] = useState<{ delta: number; cause: string } | null>(null);

  // ---- Realtime: keep the balance in sync with the DB row (0046: the
  // enrollments table travels on the broadcast bus — re-read the one row
  // when a message names this enrollment) ----
  useEffect(() => {
    let cancelled = false;
    const readBalance = () => {
      supabase.from('enrollments').select('points').eq('id', enrollment.id).maybeSingle()
        .then(({ data }) => { if (!cancelled && data && typeof data.points === 'number') onBalance(data.points); });
    };
    // re-read once on open so a stale search row gets corrected
    readBalance();
    const off = onBusTable('enrollments', (m) => {
      if (m.op !== 'UPDATE') return;
      if (m.ids && m.ids.length > 0 && !m.ids.includes(enrollment.id)) return;
      readBalance();
    });
    return () => { cancelled = true; off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollment.id]);

  // Flash the balance badge whenever it changes
  const prevPoints = useRef(enrollment.points);
  useEffect(() => {
    if (enrollment.points === prevPoints.current) return;
    setFlash(enrollment.points > prevPoints.current ? 'up' : 'down');
    prevPoints.current = enrollment.points;
    const t = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(t);
  }, [enrollment.points]);

  // Changing the cause pre-fills its bound number (fixed → locked)
  const pickCause = (id: string) => {
    setCauseId(id);
    const c = causes.find((x) => x.id === id);
    setAmount(c && c.points_mode !== 'open' ? c.points : 0);
    setError('');
  };

  const locked = !!cause && cause.points_mode === 'fixed';
  const n = Math.max(0, amount);
  const canSubmit = !!cause && n > 0 && !busy;

  const submit = async (mode: 'add' | 'subtract') => {
    if (!event) { setError('اختر المناسبة أولاً من القائمة (النقاط تُمنح في مناسبة)'); return; }
    if (!cause) { setError('اختر سبب النقاط'); return; }
    if (n <= 0) { setError('اكتب عدد النقاط'); return; }
    setBusy(mode);
    setError('');
    const delta = (mode === 'add' ? 1 : -1) * n;
    const { error: err } = await supabase.from('points_log').insert({
      enrollment_id: enrollment.id,
      cause_id: cause.id,
      event_id: event.id,
      delta,
      recorded_by: recorderId,
    });
    setBusy(null);
    if (err) { setError(err.message?.includes('enrollment_stopped') ? 'هذا الشخص موقوف — لا يمكن تسجيل نقاطه' : 'تعذر تسجيل النقاط، حاول مجدداً'); return; }
    setLastOp({ delta, cause: cause.name });
    onApplied(delta, cause); // parent patches the balance; modal stays open
  };

  return (
    <>
      <ModalFrame title="النقاط" icon={<Calculator className="h-5 w-5 text-gold-500" />} onClose={onClose}>
        {/* Child name + LIVE balance */}
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-600 to-accent-600 text-white">
            <Star className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p id="manual-points-name" className="truncate text-base font-extrabold">{enrollment.person.name}</p>
            <p className="truncate text-[11px] font-bold text-violet-600">
              {event ? `في مناسبة «${event.name}»` : 'لم تُختر مناسبة'}
            </p>
            <p className="flex items-center gap-1 text-xs font-bold text-slate-500">
              الرصيد الحالي
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" title="مباشر" />
            </p>
          </div>
          <span
            id="manual-points-balance"
            className={`badge-btn !h-auto !text-lg !px-3 !py-1.5 transition-all duration-300 ${
              flash === 'up' ? 'bg-emerald-100 text-emerald-600 scale-110'
              : flash === 'down' ? 'bg-red-100 text-red-600 scale-110'
              : 'bg-gold-100 text-gold-600'
            }`}
          >
            <Star className="h-4 w-4" /> {enrollment.points}
          </span>
        </div>

        {/* Number of points — tap to open the NumPad */}
        <label className="mb-1 block text-xs font-bold text-slate-500">عدد النقاط</label>
        <button
          id="manual-points-amount"
          type="button"
          disabled={locked}
          onClick={() => { if (!locked) setNumpadOpen(true); }}
          className={`input-field mb-3 flex w-full items-center justify-center gap-2 !text-2xl font-extrabold tabular-nums ${
            locked ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : 'cursor-pointer hover:border-primary-400 active:scale-[0.98]'
          }`}
        >
          {!locked && <Calculator className="h-5 w-5 text-slate-400" />}
          <span className={n === 0 ? 'text-slate-300' : ''}>{n}</span>
        </button>
        <p className="-mt-2 mb-3 text-[11px] font-bold text-slate-400">
          {locked ? 'هذا السبب نقاطه ثابتة — لا يمكن تغيير العدد' : 'اضغط على الرقم لكتابة عدد النقاط'}
        </p>

        {/* Cause */}
        <label className="mb-1 block text-xs font-bold text-slate-500">سبب النقاط</label>
        <select
          id="manual-points-cause"
          className="input-field mb-4 appearance-none text-sm font-bold"
          value={causeId}
          onChange={(e) => pickCause(e.target.value)}
        >
          <option value="">اختر سبب النقاط *</option>
          {causes.map((ca) => (
            <option key={ca.id} value={ca.id}>
              {ca.name}{ca.points_mode !== 'open' ? ` — ${ca.points} نقطة` : ''}
            </option>
          ))}
        </select>
        {causes.length === 0 && (
          <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-600">
            لا توجد أسباب تشمل هذا المخدوم — أضف سبباً من الإعدادات ← إدارة أسباب النقاط
          </p>
        )}

        {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}

        {/* Add / subtract the number — modal stays open */}
        <div className="grid grid-cols-2 gap-2">
          <button
            id="manual-points-add"
            type="button"
            disabled={!canSubmit}
            onClick={() => submit('add')}
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 font-extrabold text-white shadow transition hover:bg-emerald-600 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy === 'add' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            إضافة {n > 0 ? n : ''}
          </button>
          <button
            id="manual-points-subtract"
            type="button"
            disabled={!canSubmit}
            onClick={() => submit('subtract')}
            className="flex items-center justify-center gap-2 rounded-xl bg-red-500 py-3 font-extrabold text-white shadow transition hover:bg-red-600 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy === 'subtract' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Minus className="h-5 w-5" />}
            خصم {n > 0 ? n : ''}
          </button>
        </div>

        {lastOp && (
          <p
            id="manual-points-last"
            className={`mt-3 flex items-center justify-center gap-1 rounded-xl px-3 py-2 text-xs font-bold ${
              lastOp.delta > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
            }`}
          >
            <CheckCircle2 className="h-4 w-4" />
            تم تسجيل {lastOp.delta > 0 ? `+${lastOp.delta}` : lastOp.delta} نقطة ({lastOp.cause})
          </p>
        )}
        {cause && n > 0 && (
          <p className="mt-3 text-center text-xs font-bold text-slate-400">
            الرصيد بعد الإضافة {enrollment.points + n} · بعد الخصم {Math.max(0, enrollment.points - n)}
          </p>
        )}

        <button
          type="button"
          onClick={onClose}
          className="btn-secondary mt-4 w-full"
        >
          إغلاق
        </button>
      </ModalFrame>

      {numpadOpen && (
        <NumPadModal
          title={`عدد النقاط — ${enrollment.person.name}`}
          initial={n}
          onConfirm={(v) => { setAmount(v); setNumpadOpen(false); setError(''); }}
          onClose={() => setNumpadOpen(false)}
        />
      )}
    </>
  );
}
