'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Users, Search, Plus, Phone, MapPin, Star, CalendarCheck, X, Loader2, GraduationCap,
  SlidersHorizontal, ChevronDown, School, Check, Minus,
  MessageSquare, Inbox, PenSquare, ArrowUpDown, ArrowUp, ArrowDown,
  Eye, Database, Printer, IdCard, CalendarDays, UserCheck, UserX, CircleDashed,
  HeartHandshake, Trophy, Ban, Settings2,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import {
  JOBS, scopeApplies,
  type Job, type EnrollmentWithPerson, type ClassRoom, type Church, type Service,
  type AppEvent, type Cause, type CallFeedback,
} from '@/lib/types';
import {
  eventAvailability, describeEventSchedule, cairoToday,
  childEventStatus, CHILD_STATUS_LABELS, type ChildEventStatus,
} from '@/lib/time';
import {
  CallFeedbackBadge, CallFeedbackModal, CallFeedbackIcon, PersonAvatar, useCallFeedbackStates,
} from '@/components/CallFeedback';
import {
  matchesCallFilter, feedbackStyle, CALL_STATE_LABELS, type CallFeedbackFilter,
} from '@/lib/call-feedback';
import { useAppDate } from '@/lib/app-date-context';
import { useModules } from '@/lib/modules-context';
import NumPadModal from '@/components/NumPadModal';
import { ViewPersonModal } from '@/components/PersonDataModals';
import { AttendanceLogModal, PointsLogModal } from '@/components/LogModals';
import AwardModal from '@/components/achievements/AwardModal';
import { useDebouncedRealtime, scopeFilter } from '@/lib/realtime';
import { sendMessage as sendChatMessage, chatErrorMessage } from '@/lib/chat';
import {
  fetchEnrollmentsPage, fetchMyGroupIds, fetchMyGroupEnrollments, cachedLookup, ALL, PAGE_SIZE, type EnrollmentKind,
} from '@/lib/queries';
import { useNavLabel } from '@/lib/customization-context';
import { pickScopedDefault, effectiveScope } from '@/lib/defaults';

type AttendanceMode = 'add' | 'remove';
type PointsMode = 'add' | 'subtract';
type MessageChannel = 'whatsapp' | 'sms' | 'internal';
// Status filter (الفلاتر) — by the child's status in the selected event
type StatusFilter = 'all' | ChildEventStatus;
const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'present', label: CHILD_STATUS_LABELS.present },
  { value: 'not_registered', label: CHILD_STATUS_LABELS.not_registered },
  { value: 'absent', label: CHILD_STATUS_LABELS.absent },
];

// Visual style of the status badge (present / not registered / absent)
const STATUS_STYLE: Record<ChildEventStatus, { cls: string; icon: React.ReactNode }> = {
  present:        { cls: 'bg-emerald-500 text-white !ring-emerald-600/20', icon: <UserCheck className="h-3.5 w-3.5" /> },
  not_registered: { cls: 'bg-slate-100 text-slate-500 !ring-slate-200',    icon: <CircleDashed className="h-3.5 w-3.5" /> },
  absent:         { cls: 'bg-red-500 text-white !ring-red-600/20',         icon: <UserX className="h-3.5 w-3.5" /> },
};
// البيانات job — VIEW only (0043): editing / deleting / stopping people lives
// in «إدارة المخدومين → المخدومين» (/children/manage?tab=people)

// ---------- Sorting ----------
type SortKey = 'name' | 'age' | 'points' | 'attendance';
type SortDir = 'asc' | 'desc';
const SORT_KEYS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'الاسم' },
  { value: 'age', label: 'العمر' },
  { value: 'points', label: 'النقاط' },
  { value: 'attendance', label: 'الحضور' },
];

// ---------- Message template variables ----------
const MSG_VARS = [
  { token: '[الاسم الأول]', label: 'الاسم الأول' },
  { token: '[الاسم الكامل]', label: 'الاسم الكامل' },
  { token: '[تاريخ الميلاد]', label: 'تاريخ الميلاد' },
  { token: '[رقم الهاتف]', label: 'رقم الهاتف' },
  { token: '[اسم المناسبة]', label: 'اسم المناسبة' },
];

const fillTemplate = (template: string, e: EnrollmentWithPerson, ev?: AppEvent | null) =>
  template
    .replaceAll('[الاسم الأول]', e.person.name.trim().split(/\s+/)[0] ?? '')
    .replaceAll('[الاسم الكامل]', e.person.name)
    .replaceAll('[تاريخ الميلاد]', e.person.birthdate ?? '')
    .replaceAll('[رقم الهاتف]', e.person.phone ?? '')
    .replaceAll('[اسم المناسبة]', ev?.name ?? '');

// WhatsApp brand icon (lucide has no official one)
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

export default function ChildrenPage() {
  const pageName = useNavLabel('children');
  const { profile, scopes } = useAuth();
  const supabase = createClient();
  const router = useRouter();
  const [enrollments, setEnrollments] = useState<EnrollmentWithPerson[]>([]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [causes, setCauses] = useState<Cause[]>([]);
  const [feedbacks, setFeedbacks] = useState<CallFeedback[]>([]);
  const [loading, setLoading] = useState(true);

  // ---------- Search (first row) ----------
  const [search, setSearch] = useState('');

  // ---------- Scope selectors: church -> service -> class ----------
  // RLS already limits each user to their own scope, so every dropdown
  // only contains what the current user is allowed to see.
  const [churchFilter, setChurchFilter] = useState<string>(ALL);
  const [serviceFilter, setServiceFilter] = useState<string>(ALL);
  const [classFilter, setClassFilter] = useState<string>(ALL);

  // ---------- Job selector + activated modes ----------
  const [job, setJob] = useState<Job>('attendance');
  // The "طباعة كارت" job belongs to the CARD MODULE — it exists only when the
  // owner granted that module to my scope (see /owner/modules).
  const { isVisible: moduleVisible } = useModules();
  const cardsModuleOn = moduleVisible('cards');
  // «رسالة داخلية» belongs to the MESSAGES MODULE (migration 0029)
  const messagesModuleOn = moduleVisible('messages');
  // «الإنجازات» job belongs to the ACHIEVEMENTS MODULE (migration 0031)
  const achievementsModuleOn = moduleVisible('achievements');
  const availableJobs = useMemo(
    () => JOBS.filter((j) => (j.value !== 'print_card' || cardsModuleOn) && (j.value !== 'achievement' || achievementsModuleOn)),
    [cardsModuleOn, achievementsModuleOn]
  );
  useEffect(() => {
    if (job === 'print_card' && !cardsModuleOn) setJob('attendance');
    if (job === 'achievement' && !achievementsModuleOn) setJob('attendance');
  }, [job, cardsModuleOn, achievementsModuleOn]);
  const [awardTarget, setAwardTarget] = useState<EnrollmentWithPerson | null>(null);

  // ---------- الأشابين (shepherds module, 0025): «مجموعتي» ----------
  // When the module is granted to my scope a «مجموعتي» button sits under the
  // scope selectors. ON → the list shows ONLY the children of my group
  // (still narrowed by the church / service / class selectors + search);
  // every job / badge / filter / sort works exactly the same.
  const shepherdsModuleOn = moduleVisible('shepherds');
  const [myGroupOnly, setMyGroupOnly] = useState(false);
  // 0042: المخدومين | الخدام — servants are shown as classes too (mirror enrollments)
  const [kind, setKind] = useState<EnrollmentKind>('child');
  const [myGroupIds, setMyGroupIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!shepherdsModuleOn && myGroupOnly) setMyGroupOnly(false);
  }, [shepherdsModuleOn, myGroupOnly]);
  const loadMyGroupIds = useCallback(async () => {
    if (!profile || !shepherdsModuleOn) { setMyGroupIds(null); return; }
    setMyGroupIds(await fetchMyGroupIds(supabase, profile.id));
  }, [supabase, profile, shepherdsModuleOn]);
  useEffect(() => {
    if (profile?.status === 'approved') loadMyGroupIds();
  }, [profile?.status, loadMyGroupIds]);
  // My group changes (from /shepherds, possibly on another device) → refresh
  useDebouncedRealtime(
    supabase, 'children-my-group',
    [{ table: 'shepherd_groups', filter: profile ? `servant_id=eq.${profile.id}` : undefined }],
    loadMyGroupIds,
    { enabled: profile?.status === 'approved' && !!shepherdsModuleOn, delayMs: 600 }
  );
  const [attendanceMode, setAttendanceMode] = useState<AttendanceMode>('add');
  const [pointsMode, setPointsMode] = useState<PointsMode>('add');
  // ---------- 4th scope level: EVENT ----------
  // church → service → class → EVENT. Every job runs INSIDE the selected
  // event: attendance is registered on it, points are given in it, calls
  // and messages are follow-ups for it. Points additionally carry a CAUSE.
  const [eventId, setEventId] = useState<string>('');
  const [causeId, setCauseId] = useState<string>('');
  // true while the event / cause was picked BY THE DEFAULT RESOLVER (not by
  // the servant) — such a pick follows the scope selectors; a manual pick is
  // kept as long as it stays visible in the current scope.
  const eventAutoRef = useRef(true);
  const causeAutoRef = useRef(true);
  const chooseEvent = (id: string) => { eventAutoRef.current = false; setEventId(id); };
  const chooseCause = (id: string) => { causeAutoRef.current = false; setCauseId(id); };
  const [messageChannel, setMessageChannel] = useState<MessageChannel>('whatsapp');
  const [messageTemplate, setMessageTemplate] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  // البيانات job: which person the view modal is open for
  const [dataTarget, setDataTarget] = useState<EnrollmentWithPerson | null>(null);

  // ---------- Filter accordion ----------
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addressFilter, setAddressFilter] = useState('');
  const [minPoints, setMinPoints] = useState('');
  const [minAttendance, setMinAttendance] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  // Call-feedback filter — by the badge state / a specific feedback (0023)
  const [callFilter, setCallFilter] = useState<CallFeedbackFilter>('all');

  // ---------- Sort accordion ----------
  const [sortOpen, setSortOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // ---------- Expandable class groups ----------
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (id: string) =>
    setOpenGroups((g) => ({ ...g, [id]: !g[id] }));

  const [busyChild, setBusyChild] = useState<string | null>(null);

  // Working date (header date button) — ALL date operations use this instant
  const { now } = useAppDate();

  // Points override for editable/open modes (entered via numpad)
  const [eventPtsOverride, setEventPtsOverride] = useState<number | null>(null);
  const [causePtsOverride, setCausePtsOverride] = useState<number | null>(null);
  const [numpadFor, setNumpadFor] = useState<'event' | 'cause' | null>(null);

  // Control panel collapse is MANUAL — toggled only by the button next to
  // the search bar (no scroll listeners, fully predictable)
  const [selectorsCollapsed, setSelectorsCollapsed] = useState(false);

  // Measure the sticky control-zone height so the sticky class headers
  // always freeze exactly below it (works for both collapsed & expanded).
  // BUG FIX: use a CALLBACK REF instead of getElementById-on-mount —
  // AppShell doesn't render children while auth is loading, so the old
  // one-shot effect could run before #control-zone existed; the
  // ResizeObserver was never attached and zoneHeight stayed frozen at
  // the default, so class headers stuck too high and hid behind the panel.
  const [zoneHeight, setZoneHeight] = useState(137);
  const [zoneEl, setZoneEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!zoneEl) return;
    const measure = () => setZoneHeight(zoneEl.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(zoneEl);
    return () => ro.disconnect();
  }, [zoneEl]);

  // ---------- Paging ----------
  // The list is fetched FROM THE SERVER already narrowed to the selected
  // church / service / class and the search text, PAGE_SIZE rows at a time.
  // A class servant transfers ~30 rows instead of the whole diocese.
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const pagesRef = useRef(1); // how many pages are currently shown
  const loadSeq = useRef(0);   // drop stale responses (fast typing / scope change)
  // Debounce the search box so we don't hit the DB on every keystroke
  const [searchQ, setSearchQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearchQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Lookup tables (small, cached 60s across tabs)
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

  // (Re)load the currently visible pages of the scoped list
  const profileId = profile?.id;
  const loadList = useCallback(async () => {
    const seq = ++loadSeq.current;
    const scope = { church: churchFilter, service: serviceFilter, class: classFilter };
    const pages = pagesRef.current;
    try {
      // «مجموعتي» — the whole group at once (small, bounded set), no paging
      if (myGroupOnly) {
        const ids = myGroupIds ?? (profileId ? await fetchMyGroupIds(supabase, profileId) : new Set<string>());
        const rows = await fetchMyGroupEnrollments(supabase, ids, scope, searchQ, kind);
        if (seq !== loadSeq.current) return;
        setEnrollments(rows);
        setHasMore(false);
        return;
      }
      const results = await Promise.all(
        Array.from({ length: pages }, (_, i) =>
          fetchEnrollmentsPage(supabase, scope, { page: i, search: searchQ, kind })
        )
      );
      if (seq !== loadSeq.current) return; // a newer load superseded this one
      setEnrollments(results.flatMap((r) => r.rows));
      setHasMore(results[results.length - 1]?.hasMore ?? false);
    } catch (err) {
      console.error('load enrollments failed', err);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [supabase, churchFilter, serviceFilter, classFilter, searchQ, myGroupOnly, myGroupIds, profileId, kind]);

  // Realtime on the LOOKUP tables only (events / causes / feedbacks) —
  // they change rarely; a scan burst must NOT re-download all six.
  const reloadLookupsOnly = useCallback(async () => { await loadLookups(true); }, [loadLookups]);

  // Scope / search changed → back to page 1
  useEffect(() => {
    if (profile?.status !== 'approved') return;
    pagesRef.current = 1;
    setLoading(true);
    loadList();
  }, [profile?.status, loadList]);

  useEffect(() => {
    if (profile?.status === 'approved') loadLookups();
  }, [profile?.status, loadLookups]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = pagesRef.current;
    try {
      const { rows, hasMore: more } = await fetchEnrollmentsPage(
        supabase,
        { church: churchFilter, service: serviceFilter, class: classFilter },
        { page: nextPage, search: searchQ, kind }
      );
      pagesRef.current = nextPage + 1;
      setEnrollments((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...rows.filter((r) => !seen.has(r.id))];
      });
      setHasMore(more);
    } finally {
      setLoadingMore(false);
    }
  };

  // Realtime sync — debounced (bursts of scans → ONE reload), paused while
  // the tab is hidden. 0046: enrollments / persons arrive on the shared
  // broadcast bus (one message per statement for the whole church) and
  // reload ONLY the list; the lookup tables have their own subscription.
  const rtFilter = scopeFilter(profile, scopes);
  useDebouncedRealtime(
    supabase,
    'persons-list',
    [
      { table: 'enrollments', filter: rtFilter },
      { table: 'persons' },
    ],
    loadList,
    { enabled: profile?.status === 'approved', delayMs: 1500 }
  );
  useDebouncedRealtime(
    supabase,
    'persons-lookups',
    [
      { table: 'events', filter: profile?.church_id && profile.role !== 'owner' ? `church_id=eq.${profile.church_id}` : undefined },
      { table: 'causes', filter: profile?.church_id && profile.role !== 'owner' ? `church_id=eq.${profile.church_id}` : undefined },
      { table: 'call_feedbacks', filter: profile?.church_id && profile.role !== 'owner' ? `church_id=eq.${profile.church_id}` : undefined },
    ],
    reloadLookupsOnly,
    { enabled: profile?.status === 'approved' }
  );

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

  const onChurchChange = (v: string) => {
    setChurchFilter(v);
    setServiceFilter(ALL);
    setClassFilter(ALL);
  };
  const onServiceChange = (v: string) => {
    setServiceFilter(v);
    setClassFilter(ALL);
  };

  // Events / causes narrowed by the current scope selectors
  // null scope means "all services" / "all classes" — always visible within its church
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

  const selectedEvent = useMemo(
    () => events.find((ev) => ev.id === eventId) ?? null,
    [events, eventId]
  );
  const selectedCause = useMemo(
    () => causes.find((ca) => ca.id === causeId) ?? null,
    [causes, causeId]
  );

  // Clock tick (every 30s) so day/time availability stays fresh; respects
  // the working date chosen from the header date button
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nowDate = useMemo(() => now(), [now, tick]);
  // The REAL clock (ignores the frozen working date) — decides whether a
  // follow-up cycle is still open (call feedback, 0023)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const realNow = useMemo(() => new Date(), [tick, now]);
  const eventAvail = useMemo(
    () => (selectedEvent ? eventAvailability(selectedEvent, nowDate) : null),
    [selectedEvent, nowDate]
  );

  // Attendance of the SELECTED EVENT — one fetch gives us both:
  //   attendedDays → the Cairo days each enrollment attended it (→ status
  //                  badge: present / not registered / absent for the
  //                  CURRENT occurrence at the working date-time)
  //   eventCounts  → how many times each enrollment attended it (badge)
  // With no event selected the badge falls back to the enrollment's total
  // attendance_count across all events.
  const [attendedDays, setAttendedDays] = useState<Record<string, Set<string>>>({});
  const [eventCounts, setEventCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!selectedEvent) { setAttendedDays({}); setEventCounts({}); return; }
    let cancelled = false;
    (async () => {
      // Only the enrollments ON SCREEN — not the event's whole history for
      // the entire diocese. Chunked so the request URL stays small.
      const ids = enrollments.map((e) => e.id);
      const rows: { enrollment_id: string; attended_on: string }[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const { data } = await supabase
          .from('attendance_log')
          .select('enrollment_id, attended_on')
          .eq('event_id', selectedEvent.id)
          .in('enrollment_id', ids.slice(i, i + 100));
        if (cancelled) return;
        rows.push(...((data ?? []) as { enrollment_id: string; attended_on: string }[]));
      }
      const days: Record<string, Set<string>> = {};
      const counts: Record<string, number> = {};
      rows.forEach((r) => {
        counts[r.enrollment_id] = (counts[r.enrollment_id] ?? 0) + 1;
        (days[r.enrollment_id] ??= new Set()).add(r.attended_on);
      });
      setAttendedDays(days);
      setEventCounts(counts);
    })();
    return () => { cancelled = true; };
  }, [selectedEvent, supabase, enrollments]);

  // Attendance number shown on a person's badge
  const attendanceShown = (e: EnrollmentWithPerson): number =>
    selectedEvent ? (eventCounts[e.id] ?? 0) : e.attendance_count;

  // ---------- Status of a child in the selected event at the working
  // date-time (present / not registered / absent). null when no event is
  // selected or the event doesn't cover this child. ----------
  const statusOf = useCallback(
    (e: EnrollmentWithPerson): ChildEventStatus | null => {
      if (!selectedEvent || !scopeApplies(selectedEvent, e)) return null;
      return childEventStatus(selectedEvent, attendedDays[e.id], nowDate).status;
    },
    [selectedEvent, attendedDays, nowDate]
  );

  // Mark / unmark a day as attended for one enrollment (optimistic)
  const markAttended = (id: string, day: string, on: boolean) =>
    setAttendedDays((prev) => {
      const next = new Set(prev[id] ?? []);
      if (on) next.add(day); else next.delete(day);
      return { ...prev, [id]: next };
    });

  // Fire-and-forget: record a call / message as a follow-up for the event
  // (contact_log, migration 0022). Never blocks the dialer / WhatsApp.
  const logContact = (e: EnrollmentWithPerson, kind: MessageChannel | 'call', message: string | null) => {
    supabase
      .from('contact_log')
      .insert({
        enrollment_id: e.id,
        event_id: eventId || null,
        kind,
        message,
        contacted_on: cairoToday(now()),
        recorded_by: profile?.id,
      })
      .then(({ error }) => { if (error) console.warn('contact_log insert failed', error.message); });
  };

  // Log modals opened from the badges (سجل الحضور / سجل النقاط)
  const [logTarget, setLogTarget] = useState<{ kind: 'attendance' | 'points'; e: EnrollmentWithPerson } | null>(null);

  // ---------- Call feedback (0023) — badge state per child for the selected
  // event's follow-up cycle at the working date-time; modal target ----------
  const callFb = useCallFeedbackStates(supabase, enrollments, selectedEvent, feedbacks, nowDate, realNow);
  const [callTarget, setCallTarget] = useState<EnrollmentWithPerson | null>(null);
  // Feedbacks offered in the filter: those covering the current scope selectors + event
  const visibleFeedbacks = useMemo(
    () =>
      feedbacks
        .filter(
          (fb) =>
            (churchFilter === ALL || fb.church_id === churchFilter) &&
            (serviceFilter === ALL || fb.service_id === null || fb.service_id === serviceFilter) &&
            (classFilter === ALL || fb.class_id === null || fb.class_id === classFilter) &&
            (!eventId || fb.event_id === null || fb.event_id === eventId)
        )
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ar')),
    [feedbacks, churchFilter, serviceFilter, classFilter, eventId]
  );
  // Realtime: feedbacks recorded by other servants → refresh badge states
  useDebouncedRealtime(
    supabase,
    'call-feedback-log',
    [{ table: 'contact_log' }],
    callFb.reload,
    { enabled: profile?.status === 'approved' && !!selectedEvent }
  );
  // keep the filter valid when the offered feedbacks change
  useEffect(() => {
    if (callFilter.startsWith('fb:') && !visibleFeedbacks.some((f) => `fb:${f.id}` === callFilter)) setCallFilter('all');
  }, [visibleFeedbacks, callFilter]);

  // reset numpad overrides when the selection changes
  useEffect(() => { setEventPtsOverride(null); }, [eventId]);
  useEffect(() => { setCausePtsOverride(null); }, [causeId]);

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

  // Effective points respecting points_mode:
  // fixed -> bound number; editable -> override or bound; open -> override only
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

  // Patch one enrollment in place (optimistic update after a mutation)
  const patchEnrollment = (id: string, patch: Partial<EnrollmentWithPerson>) =>
    setEnrollments((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  // ---------- Per-person job action (single button) ----------
  const doJob = async (e: EnrollmentWithPerson) => {
    if (job === 'attendance') {
      if (attendanceMode === 'add') {
        // Attendance is registered against an EVENT whose scope covers this enrollment
        const ev = events.find((x) => x.id === eventId);
        if (!ev) {
          alert('اختر المناسبة أولاً');
          return;
        }
        if (!scopeApplies(ev, e)) {
          alert('المناسبة المختارة لا تشمل هذا المخدوم');
          return;
        }
        if (effectiveEventPoints === null) {
          alert('حدد عدد النقاط أولاً — اضغط على شارة النقاط ⭐');
          setNumpadFor('event');
          return;
        }
        // Day / time check (Africa/Cairo, working date) — attendance is
        // FORBIDDEN outside the event's scheduled day/time (or its live
        // window, when no working-date override is active). No override.
        const avail = eventAvailability(ev, now());
        if (!avail.ok) {
          alert(`⛔ ممنوع تسجيل الحضور\n\n${avail.reason}`);
          return;
        }
        setBusyChild(e.id);
        const { error } = await supabase.from('attendance_log').insert({
          enrollment_id: e.id,
          event_id: ev.id,
          points_delta: effectiveEventPoints,
          attended_on: cairoToday(now()),
          recorded_by: profile?.id,
        });
        setBusyChild(null);
        if (error?.code === '23505') {
          alert(`${e.person.name} — حضوره مسجل بالفعل في هذه المناسبة اليوم`);
          return;
        }
        if (error?.message?.includes('enrollment_stopped')) { alert(`${e.person.name} — موقوف، لا يمكن تسجيل حضوره`); return; }
        if (error) { alert('تعذر تسجيل الحضور، حاول مجدداً'); return; }
        // Optimistic local patch — no refetch; realtime reconciles later.
        patchEnrollment(e.id, { attendance_count: e.attendance_count + 1, points: e.points + effectiveEventPoints });
        markAttended(e.id, cairoToday(now()), true);
        setEventCounts((c) => ({ ...c, [e.id]: (c[e.id] ?? 0) + 1 }));
      } else {
        // Removal DELETES the attendance entry for the WORKING DATE only
        // (the date/time currently selected via the header date button, or
        // today if following the live clock) — NEVER any other day's
        // attendance for this event. A DB trigger reverts the counters
        // (attendance -1, points -points_delta of that entry).
        const workingDay = cairoToday(now());
        setBusyChild(e.id);
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
          setBusyChild(null);
          alert(
            eventId
              ? `${e.person.name} — لا يوجد حضور مسجل في هذه المناسبة في هذا اليوم`
              : `${e.person.name} — لا يوجد حضور مسجل في هذا اليوم`
          );
          return;
        }
        const { data: removed } = await supabase
          .from('attendance_log')
          .delete()
          .eq('id', rows[0].id)
          .select('points_delta')
          .maybeSingle();
        setBusyChild(null);
        const delta = (removed as { points_delta?: number } | null)?.points_delta ?? 0;
        patchEnrollment(e.id, {
          attendance_count: Math.max(0, e.attendance_count - 1),
          points: e.points - delta,
        });
        markAttended(e.id, workingDay, false);
        setEventCounts((c) => ({ ...c, [e.id]: Math.max(0, (c[e.id] ?? 1) - 1) }));
      }
    } else if (job === 'points') {
      // Points are given INSIDE the selected event, with a CAUSE whose scope
      // covers this enrollment; the amount is BOUND to the cause itself
      const ev = events.find((x) => x.id === eventId);
      if (!ev) {
        alert('اختر المناسبة أولاً — النقاط تُسجَّل داخل مناسبة');
        return;
      }
      if (!scopeApplies(ev, e)) {
        alert('المناسبة المختارة لا تشمل هذا المخدوم');
        return;
      }
      const ca = causes.find((x) => x.id === causeId);
      if (!ca) {
        alert('اختر سبب النقاط أولاً');
        return;
      }
      if (!scopeApplies(ca, e)) {
        alert('السبب المختار لا يشمل هذا المخدوم');
        return;
      }
      if (effectiveCausePoints === null) {
        alert('حدد عدد النقاط أولاً — اضغط على شارة النقاط ⭐');
        setNumpadFor('cause');
        return;
      }
      if (effectiveCausePoints === 0) return;
      setBusyChild(e.id);
      const delta = (pointsMode === 'add' ? 1 : -1) * effectiveCausePoints;
      const { error } = await supabase.from('points_log').insert({
        enrollment_id: e.id,
        cause_id: ca.id,
        event_id: ev.id,
        delta,
        recorded_by: profile?.id,
      });
      setBusyChild(null);
      if (error) {
        alert(error.message?.includes('enrollment_stopped')
          ? `${e.person.name} — موقوف، لا يمكن تسجيل نقاطه`
          : 'تعذر تسجيل النقاط — تأكد من تشغيل تحديث قاعدة البيانات (0022)');
        return;
      }
      patchEnrollment(e.id, { points: e.points + delta });
    } else if (job === 'call') {
      // A call is a FOLLOW-UP for the selected event (e.g. calling the
      // absent children of today's mass) — logged in contact_log
      if (!eventId) { alert('اختر المناسبة أولاً — الاتصال متابعة لمناسبة'); return; }
      if (!e.person.phone) return;
      logContact(e, 'call', null);
      window.location.href = `tel:${e.person.phone}`;
    } else if (job === 'message') {
      if (!eventId) { alert('اختر المناسبة أولاً — الرسالة متابعة لمناسبة'); return; }
      if (messageChannel === 'internal') {
        // In-app message (وحدة الرسائل): the text goes to the child's
        // conversation → he reads it in his portal, every servant of the
        // tenant sees it too. Logged as a follow-up like WhatsApp / SMS.
        const text = messageTemplate.trim() ? fillTemplate(messageTemplate, e, selectedEvent) : '';
        if (!text) { alert('اكتب نص الرسالة أولاً من زر «كتابة الرسالة»'); return; }
        setBusyChild(e.id);
        try {
          await sendChatMessage(supabase, { target: 'children', enrollment_ids: [e.id], body: text });
          logContact(e, 'internal', text);
          alert(`${e.person.name} — تم إرسال الرسالة الداخلية ✅`);
        } catch (err) {
          alert(chatErrorMessage(err, 'تعذر إرسال الرسالة الداخلية'));
        } finally {
          setBusyChild(null);
        }
        return;
      }
      if (!e.person.phone) return;
      const digits = e.person.phone.replace(/\D/g, '');
      const waNumber = digits.startsWith('0') ? `2${digits}` : digits;
      const text = messageTemplate.trim() ? fillTemplate(messageTemplate, e, selectedEvent) : '';
      if (messageChannel === 'whatsapp') {
        logContact(e, 'whatsapp', text || null);
        const url = text
          ? `https://wa.me/${waNumber}?text=${encodeURIComponent(text)}`
          : `https://wa.me/${waNumber}`;
        window.open(url, '_blank', 'noopener,noreferrer');
      } else if (messageChannel === 'sms') {
        logContact(e, 'sms', text || null);
        window.location.href = text
          ? `sms:${e.person.phone}?body=${encodeURIComponent(text)}`
          : `sms:${e.person.phone}`;
      }
    } else if (job === 'data') {
      // Opens the view / edit / delete modal per the armed data mode
      setDataTarget(e);
    } else if (job === 'achievement') {
      // Opens the per-child achievements modal (award / revoke / progress)
      setAwardTarget(e);
    } else if (job === 'print_card') {
      // Send a card print request → appears in the requested list on the
      // print page. Duplicate (already pending) → unique violation 23505.
      setBusyChild(e.id);
      const { error } = await supabase.from('card_print_requests').insert({
        enrollment_id: e.id,
        // scope is re-filled by a DB trigger from the enrollment
        church_id: e.church_id,
        service_id: e.service_id,
        class_id: e.class_id,
        requested_by: profile?.id,
      });
      setBusyChild(null);
      if (error?.code === '23505') {
        alert(`${e.person.name} — طلب طباعة الكارت موجود بالفعل في قائمة الطلبات ⭕`);
        return;
      }
      if (error) {
        alert('تعذر إرسال الطلب — تأكد من تشغيل تحديث قاعدة البيانات (0018)');
        return;
      }
      alert(`${e.person.name} — تم إرسال طلب طباعة الكارت ✅`);
    }
  };

  // ---------- Filters ----------
  // Scope + search are applied ON THE SERVER (see loadList). Only the
  // secondary filters (address / min points / min attendance) run here,
  // over the already-small page.
  const filtered = useMemo(
    () =>
      enrollments.filter((e) => {
        if (addressFilter && !(e.person.address ?? '').includes(addressFilter)) return false;
        if (minPoints && e.points < Number(minPoints)) return false;
        if (minAttendance && e.attendance_count < Number(minAttendance)) return false;
        // Status in the selected event (only meaningful when an event is chosen)
        if (statusFilter !== 'all' && selectedEvent && statusOf(e) !== statusFilter) return false;
        // Call-feedback state in the selected event's follow-up cycle
        if (callFilter !== 'all' && selectedEvent && !matchesCallFilter(callFb.stateOf(e), callFilter)) return false;
        return true;
      }),
    [enrollments, addressFilter, minPoints, minAttendance, statusFilter, selectedEvent, statusOf, callFilter, callFb]
  );

  // ---------- Sorting (name / age / points / attendance) ----------
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let r = 0;
      if (sortKey === 'name') r = a.person.name.localeCompare(b.person.name, 'ar');
      else if (sortKey === 'points') r = a.points - b.points;
      else if (sortKey === 'attendance') r = a.attendance_count - b.attendance_count;
      else {
        // age from birthdate; unknown birthdates ALWAYS go last
        const ba = a.person.birthdate ? new Date(a.person.birthdate).getTime() : null;
        const bb = b.person.birthdate ? new Date(b.person.birthdate).getTime() : null;
        if (ba === null && bb === null) r = 0;
        else if (ba === null) return 1;
        else if (bb === null) return -1;
        else r = bb - ba; // younger (later birthdate) first when ascending
      }
      return sortDir === 'asc' ? r : -r;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  // ---------- Group by class (sorted by class name) ----------
  const groups = useMemo(() => {
    const byClass = new Map<string, EnrollmentWithPerson[]>();
    sorted.forEach((e) => {
      const arr = byClass.get(e.class_id) ?? [];
      arr.push(e);
      byClass.set(e.class_id, arr);
    });
    const list = Array.from(byClass.entries())
      .map(([classId, kids]) => ({
        classId,
        className: classes.find((c) => c.id === classId)?.name ?? 'فصل غير معروف',
        kids,
        offset: 0, // running number of the first child in this group (filled below)
      }))
      .sort((a, b) => a.className.localeCompare(b.className, 'ar'));
    // Card numbering runs across the whole visible list (current filters +
    // sort), group after group: 1 = first card on screen.
    let n = 0;
    list.forEach((g) => { g.offset = n; n += g.kids.length; });
    return list;
  }, [sorted, classes]);

  const activeFilterCount =
    (addressFilter ? 1 : 0) + (minPoints ? 1 : 0) + (minAttendance ? 1 : 0) +
    (statusFilter !== 'all' ? 1 : 0) + (callFilter !== 'all' ? 1 : 0);

  const resetFilters = () => {
    setAddressFilter('');
    setMinPoints('');
    setMinAttendance('');
    setStatusFilter('all');
    setCallFilter('all');
  };

  // ---------- Card tone — follows the child's status in the selected event
  // (every job, since calls / messages / points all happen inside it):
  // pale green = present; white = not registered (occurrence still open);
  // pale red = absent (occurrence over and he never attended) ----------
  const cardTone = (child: EnrollmentWithPerson): string => {
    if (child.status === 'stopped') return 'bg-slate-100/80';
    const s = statusOf(child);
    if (s === 'present') return 'bg-emerald-50';
    if (s === 'absent') return 'bg-red-50';
    return 'bg-white';
  };

  // ---------- Per-person button appearance by job + activated mode ----------
  const childButton = (child: EnrollmentWithPerson) => {
    if (busyChild === child.id) {
      return <Loader2 className="h-6 w-6 animate-spin text-primary-500" />;
    }
    // 0043: a STOPPED person gets no attendance / points / card / achievement —
    // only view, call and message keep working
    if (child.status === 'stopped' && !['data', 'call', 'message'].includes(job)) {
      return (
        <span
          id={`job-btn-${child.id}`}
          aria-label="موقوف"
          title="موقوف — أعد تفعيله من إدارة المخدومين"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-slate-400"
        >
          <Ban className="h-5 w-5" />
        </span>
      );
    }
    if (job === 'attendance') {
      const add = attendanceMode === 'add';
      // Per-child presence in the CURRENT occurrence of the selected event.
      // With no event selected presence can't be determined per child —
      // fall back to the neutral look so the button still shows/works.
      const present = statusOf(child) === 'present';

      if (add) {
        // ADD button: PALE while not present yet, APPARENT (vivid) green
        // once he becomes present. Registering NEW attendance is FORBIDDEN
        // outside the event's scheduled day/time — the button is disabled
        // and shown neutral/pale in that case.
        const forbidden = !!selectedEvent && !!eventAvail && !eventAvail.ok;
        return (
          <button
            id={`job-btn-${child.id}`}
            aria-label={present ? 'حاضر بالفعل' : 'تسجيل حضور'}
            aria-pressed={present}
            onClick={() => doJob(child)}
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
      // REMOVE button: PALE while the child is still present (removable) —
      // APPARENT (vivid) red once he's absent, whether because we just
      // removed his attendance or he was already absent for the day.
      return (
        <button
          id={`job-btn-${child.id}`}
          aria-label={present ? 'إزالة حضور' : 'غير حاضر بالفعل'}
          aria-pressed={!present}
          onClick={() => doJob(child)}
          className={`flex h-10 w-10 items-center justify-center rounded-full shadow transition active:scale-95 ${
            present
              ? 'bg-red-50 text-red-300 hover:bg-red-100'
              : 'bg-red-500 text-white hover:bg-red-600'
          }`}
        >
          <X className="h-5 w-5" />
        </button>
      );
    }
    if (job === 'points') {
      const add = pointsMode === 'add';
      return (
        <button
          id={`job-btn-${child.id}`}
          aria-label={add ? 'إضافة نقاط' : 'خصم نقاط'}
          onClick={() => doJob(child)}
          className={`flex h-10 w-10 items-center justify-center rounded-full text-white shadow transition active:scale-95 ${
            add ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-red-500 hover:bg-red-600'
          }`}
        >
          {add ? <Plus className="h-5 w-5" /> : <Minus className="h-5 w-5" />}
        </button>
      );
    }
    if (job === 'call') {
      return (
        <button
          id={`job-btn-${child.id}`}
          aria-label="اتصال"
          onClick={() => doJob(child)}
          disabled={!child.person.phone}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-600 text-white shadow transition hover:bg-primary-700 active:scale-95 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
        >
          <Phone className="h-5 w-5" />
        </button>
      );
    }
    if (job === 'data') {
      return (
        <button
          id={`job-btn-${child.id}`}
          aria-label="عرض البيانات"
          onClick={() => doJob(child)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-600 text-white shadow transition hover:bg-primary-700 active:scale-95"
        >
          <Eye className="h-5 w-5" />
        </button>
      );
    }
    if (job === 'achievement') {
      return (
        <button
          id={`job-btn-${child.id}`}
          aria-label="الإنجازات"
          onClick={() => doJob(child)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500 text-white shadow transition hover:bg-amber-600 active:scale-95"
        >
          <Trophy className="h-5 w-5" />
        </button>
      );
    }
    if (job === 'print_card') {
      return (
        <button
          id={`job-btn-${child.id}`}
          aria-label="طلب طباعة كارت"
          onClick={() => doJob(child)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500 text-white shadow transition hover:bg-violet-600 active:scale-95"
        >
          <Printer className="h-5 w-5" />
        </button>
      );
    }
    // message
    return (
      <button
        id={`job-btn-${child.id}`}
        aria-label="إرسال رسالة"
        onClick={() => doJob(child)}
        disabled={messageChannel === 'internal' ? (!messagesModuleOn || busyChild === child.id) : !child.person.phone}
        className={`flex h-10 w-10 items-center justify-center rounded-full text-white shadow transition active:scale-95 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none ${
          messageChannel === 'whatsapp'
            ? 'bg-emerald-500 hover:bg-emerald-600'
            : messageChannel === 'internal'
              ? 'bg-sky-600 hover:bg-sky-700'
              : 'bg-primary-600 hover:bg-primary-700'
        }`}
      >
        {messageChannel === 'whatsapp' ? (
          <WhatsAppIcon className="h-5 w-5" />
        ) : messageChannel === 'sms' ? (
          <MessageSquare className="h-5 w-5" />
        ) : (
          <Inbox className="h-5 w-5" />
        )}
      </button>
    );
  };

  return (
    <AppShell>
      <section id="children-header" className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Users className="h-5 w-5 text-primary-600" />
          {pageName}
          <span className="badge bg-primary-100 text-primary-700">{filtered.length}</span>
          {myGroupOnly && (
            <span id="my-group-active" className="badge bg-teal-100 text-teal-700">
              <HeartHandshake className="h-3 w-3" /> مجموعتي
            </span>
          )}
        </h2>
        {/* 0042: المخدومين | الخدام switch (servants shown as classes with every job) */}
        <div id="children-kind-switch" role="tablist" className="grid grid-cols-2 gap-0.5 rounded-xl bg-indigo-50 p-0.5">
          <button
            id="kind-child"
            role="tab"
            aria-selected={kind === 'child'}
            onClick={() => setKind('child')}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-extrabold transition ${
              kind === 'child' ? 'bg-white text-primary-700 shadow' : 'text-slate-500'
            }`}
          >
            <GraduationCap className="h-3.5 w-3.5" /> المخدومين
          </button>
          <button
            id="kind-servant"
            role="tab"
            aria-selected={kind === 'servant'}
            onClick={() => setKind('servant')}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-extrabold transition ${
              kind === 'servant' ? 'bg-white text-emerald-700 shadow' : 'text-slate-500'
            }`}
          >
            <Users className="h-3.5 w-3.5" /> الخدام
          </button>
        </div>
      </section>

      {/* ---------- FROZEN control zone (sticky below the app header) ----------
          The search bar + collapsed pill + control panel stay frozen at the
          top while the children list scrolls underneath. */}
      <div
        id="control-zone"
        ref={setZoneEl}
        className="sticky top-[71px] z-30 -mx-4 px-4 pb-2 bg-slate-50/95 backdrop-blur-md"
      >
      {/* ---------- Row 1: Search + collapse toggle button ---------- */}
      <div className="mb-2 flex items-center gap-2 pt-1">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            id="search-input"
            className="input-field pr-9"
            placeholder="ابحث بالاسم أو الهاتف أو الرقم القومي..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          id="toggle-selectors"
          type="button"
          aria-label={selectorsCollapsed ? 'إظهار أدوات التحكم' : 'إخفاء أدوات التحكم'}
          aria-expanded={!selectorsCollapsed}
          onClick={() => setSelectorsCollapsed((c) => !c)}
          className={`flex h-11 w-11 shrink-0 items-center justify-center gap-0.5 rounded-xl border transition active:scale-95 ${
            selectorsCollapsed
              ? 'border-primary-200 bg-primary-600 text-white shadow'
              : 'border-slate-200 bg-white text-primary-600 shadow-sm'
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <ChevronDown
            className={`h-3 w-3 transition-transform duration-300 ${selectorsCollapsed ? '' : 'rotate-180'}`}
          />
        </button>
      </div>

      {/* ---------- Collapsible control panel — smooth grid-rows animation
          (no max-height jump) ---------- */}
      <div
        id="control-panel"
        className={`grid transition-all duration-300 ease-in-out ${
          selectorsCollapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
        }`}
      >
      <div className={`min-h-0 overflow-hidden ${selectorsCollapsed ? 'pointer-events-none' : ''}`}>
      {/* ---------- Row 2: Scope selectors (church / service / class / event) ---------- */}
      {/* Each dropdown only contains what the current user can see (RLS-scoped). */}
      {/* Event is the 4th level of the hierarchy: attendance, points, calls and messages are all bound to it. */}
      <div className="mb-3 grid grid-cols-4 gap-2">
        <div className="relative">
          <select
            id="church-selector"
            aria-label="اختيار الكنيسة"
            className="input-field appearance-none !px-2 text-xs font-bold"
            value={churchFilter}
            onChange={(e) => onChurchChange(e.target.value)}
            disabled={churches.length <= 1}
          >
            <option value={ALL}>{churches.length === 1 ? churches[0].name : 'كل الكنائس'}</option>
            {churches.length > 1 &&
              churches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </select>
        </div>

        <div className="relative">
          <select
            id="service-selector"
            aria-label="اختيار الخدمة"
            className="input-field appearance-none !px-2 text-xs font-bold"
            value={serviceFilter}
            onChange={(e) => onServiceChange(e.target.value)}
            disabled={visibleServices.length <= 1}
          >
            <option value={ALL}>{visibleServices.length === 1 ? visibleServices[0].name : 'كل الخدمات'}</option>
            {visibleServices.length > 1 &&
              visibleServices.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
          </select>
        </div>

        <div className="relative">
          <select
            id="class-selector"
            aria-label="اختيار الفصل"
            className="input-field appearance-none !px-2 text-xs font-bold"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            disabled={visibleClasses.length <= 1}
          >
            <option value={ALL}>{visibleClasses.length === 1 ? visibleClasses[0].name : 'كل الفصول'}</option>
            {visibleClasses.length > 1 &&
              visibleClasses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </select>
        </div>

        <div className="relative">
          <select
            id="event-selector"
            aria-label="اختيار المناسبة"
            className={`input-field appearance-none !px-2 text-xs font-bold ${
              !eventId && job !== 'print_card' && job !== 'achievement' ? '!border-violet-300 !bg-violet-50 text-violet-700' : ''
            }`}
            value={eventId}
            onChange={(e) => chooseEvent(e.target.value)}
          >
            <option value="">
              {job === 'attendance' && attendanceMode === 'remove' ? 'كل المناسبات' : 'اختر المناسبة *'}
            </option>
            {visibleEvents.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} — {describeEventSchedule(ev)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ---------- Row 2b: «مجموعتي» — shepherds module only (0025) ----------
          Toggles the list to the children of MY group; everything else is
          unchanged. Hidden entirely when the module isn't granted to me. */}
      {shepherdsModuleOn && (
        <button
          id="my-group-toggle"
          type="button"
          aria-pressed={myGroupOnly}
          aria-label={myGroupOnly ? 'عرض كل المخدومين' : 'عرض مجموعتي فقط'}
          onClick={() => setMyGroupOnly((v) => !v)}
          className={`mb-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-extrabold transition active:scale-[0.98] ${
            myGroupOnly
              ? 'bg-teal-600 text-white shadow ring-2 ring-teal-300'
              : 'border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100'
          }`}
        >
          <HeartHandshake className="h-4 w-4" />
          مجموعتي
          <span className={`badge tabular-nums ${myGroupOnly ? 'bg-white/20 text-white' : 'bg-teal-100 text-teal-700'}`}>
            {myGroupIds?.size ?? '…'}
          </span>
          {myGroupOnly && <Check className="h-4 w-4" />}
        </button>
      )}

      {/* ---------- Row 3: Job selector (full width) ---------- */}
      <div className="mb-2">
        <select
          id="job-selector"
          aria-label="اختيار الوظيفة"
          className="input-field appearance-none text-sm font-bold"
          value={job}
          onChange={(e) => setJob(e.target.value as Job)}
        >
          {availableJobs.map((j) => (
            <option key={j.value} value={j.value}>{j.label}</option>
          ))}
        </select>
      </div>

      {/* ---------- Row 4: Mode buttons (attendance) / cause selector + mode buttons (points) ---------- */}
      {job !== 'call' && job !== 'print_card' && job !== 'achievement' && (
      <div className="mb-3 flex items-stretch gap-2">
        {/* Attendance: register / remove / event points buttons (event chosen in Row 2) */}
        {job === 'attendance' && (
          <>
            <button
              id="att-mode-add"
              aria-label="وضع تسجيل الحضور"
              aria-pressed={attendanceMode === 'add'}
              onClick={() => setAttendanceMode('add')}
              className={`flex h-10 flex-1 items-center justify-center rounded-xl transition active:scale-95 ${
                attendanceMode === 'add'
                  ? 'bg-emerald-500 text-white shadow ring-2 ring-emerald-300'
                  : 'bg-emerald-50 text-emerald-500'
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
                attendanceMode === 'remove'
                  ? 'bg-red-500 text-white shadow ring-2 ring-red-300'
                  : 'bg-red-50 text-red-500'
              }`}
            >
              <X className="h-5 w-5" />
            </button>
            {/* Event points — tap opens numpad when editable/open */}
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

        {/* Points: cause dropdown + add / subtract / points buttons */}
        {job === 'points' && (
          <>
            <select
              id="cause-selector"
              aria-label="اختيار سبب النقاط"
              className="input-field !w-1/2 min-w-0 shrink-0 appearance-none !px-2 text-xs font-bold"
              value={causeId}
              onChange={(e) => chooseCause(e.target.value)}
            >
              <option value="">اختر سبب النقاط *</option>
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
                pointsMode === 'add'
                  ? 'bg-emerald-500 text-white shadow ring-2 ring-emerald-300'
                  : 'bg-emerald-50 text-emerald-500'
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
                pointsMode === 'subtract'
                  ? 'bg-red-500 text-white shadow ring-2 ring-red-300'
                  : 'bg-red-50 text-red-500'
              }`}
            >
              <Minus className="h-5 w-5" />
            </button>
            {/* Cause points — tap opens numpad when editable/open */}
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

        {/* Data (البيانات): view only — edit / delete / stop live in إدارة المخدومين (0043) */}
        {job === 'data' && (
          <>
            <button
              id="data-mode-view"
              aria-label="عرض البيانات"
              aria-pressed
              className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary-600 text-xs font-extrabold text-white shadow ring-2 ring-primary-300"
            >
              <Eye className="h-4 w-4" />
              عرض
            </button>
            <Link
              id="data-mode-manage"
              href="/children/manage?tab=people"
              className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-50 text-xs font-extrabold text-amber-700 transition hover:bg-amber-100 active:scale-95"
            >
              <Settings2 className="h-4 w-4" />
              تعديل · حذف · إيقاف
            </Link>
          </>
        )}

        {/* Message: whatsapp / sms / internal channel buttons */}
        {job === 'message' && (
          <>
            <button
              id="msg-mode-whatsapp"
              aria-label="واتساب"
              aria-pressed={messageChannel === 'whatsapp'}
              onClick={() => setMessageChannel('whatsapp')}
              className={`flex h-10 flex-1 items-center justify-center rounded-xl transition active:scale-95 ${
                messageChannel === 'whatsapp'
                  ? 'bg-emerald-500 text-white shadow ring-2 ring-emerald-300'
                  : 'bg-emerald-50 text-emerald-500'
              }`}
            >
              <WhatsAppIcon className="h-5 w-5" />
            </button>
            <button
              id="msg-mode-sms"
              aria-label="رسالة SMS"
              aria-pressed={messageChannel === 'sms'}
              onClick={() => setMessageChannel('sms')}
              className={`flex h-10 flex-1 items-center justify-center rounded-xl transition active:scale-95 ${
                messageChannel === 'sms'
                  ? 'bg-primary-600 text-white shadow ring-2 ring-primary-300'
                  : 'bg-primary-50 text-primary-500'
              }`}
            >
              <MessageSquare className="h-5 w-5" />
            </button>
            <button
              id="msg-mode-internal"
              aria-label={messagesModuleOn ? 'رسالة داخلية في التطبيق' : 'رسالة داخلية — وحدة الرسائل غير مفعّلة'}
              aria-pressed={messageChannel === 'internal'}
              onClick={() => setMessageChannel('internal')}
              className={`flex h-10 flex-1 items-center justify-center rounded-xl transition active:scale-95 ${
                messageChannel === 'internal'
                  ? 'bg-sky-600 text-white shadow ring-2 ring-sky-300'
                  : messagesModuleOn ? 'bg-sky-50 text-sky-500' : 'bg-slate-100 text-slate-400'
              }`}
            >
              <Inbox className="h-5 w-5" />
            </button>
            <button
              id="msg-compose"
              aria-label="كتابة الرسالة"
              onClick={() => setShowCompose(true)}
              className={`flex h-10 flex-1 items-center justify-center rounded-xl transition active:scale-95 ${
                messageTemplate.trim()
                  ? 'bg-gold-500 text-white shadow ring-2 ring-gold-300'
                  : 'bg-gold-100 text-gold-600'
              }`}
            >
              <PenSquare className="h-5 w-5" />
            </button>
          </>
        )}
      </div>
      )}

      {/* Availability warning (working date) — attendance registration is forbidden */}
      {job === 'attendance' && attendanceMode === 'add' && eventAvail && !eventAvail.ok && (
        <p id="event-time-warning" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
          ⛔ ممنوع تسجيل الحضور — {eventAvail.reason}
        </p>
      )}
      {job === 'attendance' && visibleEvents.length === 0 && (
        <p className="mb-3 rounded-xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-600">
          لا توجد مناسبات — أضف مناسبة من الإعدادات ← إدارة المناسبات
        </p>
      )}
      {job === 'points' && visibleCauses.length === 0 && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-600">
          لا توجد أسباب — أضف سبباً من الإعدادات ← إدارة أسباب النقاط
        </p>
      )}

      {/* Data-mode hint */}
      {job === 'data' && (
        <p
          id="data-mode-hint"
          className="mb-3 flex items-center gap-1.5 rounded-xl bg-primary-50 px-3 py-2 text-xs font-bold text-primary-600"
        >
          <Database className="h-3.5 w-3.5 shrink-0" />
          اضغط زر المخدوم لعرض بياناته الكاملة مع كود QR وكل تسجيلاته — التعديل والحذف والإيقاف من «إدارة المخدومين ← المخدومين»
        </p>
      )}

      {/* Achievements job hint */}
      {job === 'achievement' && (
        <p id="achievement-hint" className="mb-3 flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
          <Trophy className="h-3.5 w-3.5 shrink-0" />
          اضغط زر الكأس بجانب المخدوم لمنحه إنجازاً أو متابعة تقدمه — إنجازات الحضور تُمنح تلقائياً عند تسجيل الحضور. إدارة الإنجازات في <Link href="/achievements" className="underline">وحدة الإنجازات</Link>.
        </p>
      )}

      {/* Print-card job hint */}
      {job === 'print_card' && (
        <p
          id="print-card-hint"
          className="mb-3 flex items-center gap-1.5 rounded-xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-600"
        >
          <IdCard className="h-3.5 w-3.5 shrink-0" />
          اضغط زر الطباعة بجانب المخدوم لإرسال طلب طباعة كارته — يظهر الطلب في قائمة «المطلوب طباعتهم» في صفحة طباعة الكروت
        </p>
      )}

      {/* Internal messaging notice */}
      {job === 'message' && messageChannel === 'internal' && (
        messagesModuleOn ? (
          <p className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700">
            رسالة داخلية: تُرسَل إلى محادثة المخدوم في بوابته (يراها هو وخدام فصله) — اكتب النص من زر «كتابة الرسالة» ثم اضغط زر الرسالة بجانب المخدوم. المتابعة الكاملة في <Link href="/messages" className="underline">وحدة الرسائل</Link>.
          </p>
        ) : (
          <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-600">
            الرسائل الداخلية تحتاج تفعيل «وحدة الرسائل» لنطاقك من وحدة المالك → صلاحيات الوحدات
          </p>
        )
      )}

      {/* ---------- Filter accordion ---------- */}
      <div id="filters-accordion" className="card !p-0 mb-2 overflow-hidden">
        <button
          id="filters-toggle"
          onClick={() => setFiltersOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-extrabold text-slate-700"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary-600" />
            الفلاتر
            {activeFilterCount > 0 && (
              <span className="badge bg-primary-100 text-primary-700">{activeFilterCount}</span>
            )}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${filtersOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {filtersOpen && (
          <div id="filters-body" className="space-y-3 border-t border-indigo-100 px-4 py-3">
            <div className="relative">
              <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                id="address-filter"
                className="input-field pr-9"
                placeholder="فلترة بالعنوان..."
                value={addressFilter}
                onChange={(e) => setAddressFilter(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">أقل نقاط</label>
                <input
                  id="min-points"
                  type="number"
                  min={0}
                  className="input-field"
                  placeholder="0"
                  value={minPoints}
                  onChange={(e) => setMinPoints(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">أقل حضور</label>
                <input
                  id="min-attendance"
                  type="number"
                  min={0}
                  className="input-field"
                  placeholder="0"
                  value={minAttendance}
                  onChange={(e) => setMinAttendance(e.target.value)}
                />
              </div>
            </div>
            {/* Status filter — the child's status in the selected event right now */}
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">
                الحالة في المناسبة {selectedEvent ? `«${selectedEvent.name}»` : '(اختر مناسبة أولاً)'}
              </label>
              <div id="status-filter" className="grid grid-cols-4 gap-1.5" role="group" aria-label="فلترة بالحالة">
                {STATUS_FILTERS.map((f) => {
                  const active = statusFilter === f.value;
                  const st = f.value !== 'all' ? STATUS_STYLE[f.value] : null;
                  return (
                    <button
                      key={f.value}
                      type="button"
                      aria-pressed={active}
                      disabled={!selectedEvent && f.value !== 'all'}
                      onClick={() => setStatusFilter(f.value)}
                      className={`flex h-9 items-center justify-center gap-1 rounded-xl text-xs font-bold transition disabled:opacity-40 ${
                        active
                          ? st ? `${st.cls} shadow ring-2` : 'bg-primary-600 text-white shadow ring-2 ring-primary-300'
                          : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {st?.icon}
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Call-feedback filter — badge state / specific feedback (0023) */}
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">
                نتيجة الافتقاد {selectedEvent ? `في «${selectedEvent.name}»` : '(اختر مناسبة أولاً)'}
              </label>
              <div id="call-filter" className="flex flex-wrap gap-1.5" role="group" aria-label="فلترة بنتيجة الافتقاد">
                {([
                  { value: 'all' as CallFeedbackFilter, label: 'الكل', cls: 'bg-primary-600 text-white ring-primary-300' },
                  { value: 'not_called_yet' as CallFeedbackFilter, label: CALL_STATE_LABELS.not_called_yet, cls: 'bg-slate-500 text-white ring-slate-300' },
                  { value: 'wasnt_called' as CallFeedbackFilter, label: CALL_STATE_LABELS.wasnt_called, cls: 'bg-amber-500 text-white ring-amber-300' },
                ]).map((f) => {
                  const active = callFilter === f.value;
                  return (
                    <button
                      key={f.value}
                      type="button"
                      aria-pressed={active}
                      disabled={!selectedEvent && f.value !== 'all'}
                      onClick={() => setCallFilter(f.value)}
                      className={`flex h-9 items-center justify-center gap-1 rounded-xl px-3 text-xs font-bold transition disabled:opacity-40 ${
                        active ? `${f.cls} shadow ring-2` : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {f.label}
                    </button>
                  );
                })}
                {visibleFeedbacks.map((fb) => {
                  const active = callFilter === `fb:${fb.id}`;
                  return (
                    <button
                      key={fb.id}
                      type="button"
                      aria-pressed={active}
                      disabled={!selectedEvent}
                      onClick={() => setCallFilter(`fb:${fb.id}`)}
                      style={active ? feedbackStyle(fb.color) : undefined}
                      className={`flex h-9 items-center justify-center gap-1 rounded-xl px-3 text-xs font-bold transition disabled:opacity-40 ${
                        active ? 'shadow ring-2 ring-black/10' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <CallFeedbackIcon icon={fb.icon} />
                      {fb.name}
                    </button>
                  );
                })}
              </div>
            </div>
            {activeFilterCount > 0 && (
              <button
                id="reset-filters"
                onClick={resetFilters}
                className="flex items-center gap-1 text-xs font-bold text-red-500 hover:text-red-600"
              >
                <X className="h-3.5 w-3.5" />
                مسح الفلاتر
              </button>
            )}
          </div>
        )}
      </div>

      {/* ---------- Sort accordion (like filters): sort by + direction ---------- */}
      <div id="sort-accordion" className="card !p-0 mb-1 overflow-hidden">
        <button
          id="sort-toggle"
          onClick={() => setSortOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-extrabold text-slate-700"
        >
          <span className="flex items-center gap-2">
            <ArrowUpDown className="h-4 w-4 text-primary-600" />
            الترتيب
            <span className="badge bg-primary-100 text-primary-700">
              {SORT_KEYS.find((k) => k.value === sortKey)?.label}
              {sortDir === 'asc' ? ' ↑' : ' ↓'}
            </span>
          </span>
          <ChevronDown
            className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${sortOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {sortOpen && (
          <div id="sort-body" className="space-y-3 border-t border-indigo-100 px-4 py-3">
            <div>
              <p className="mb-1.5 text-xs font-bold text-slate-500">ترتيب حسب</p>
              <div className="grid grid-cols-4 gap-2">
                {SORT_KEYS.map((k) => (
                  <button
                    key={k.value}
                    id={`sort-key-${k.value}`}
                    type="button"
                    aria-pressed={sortKey === k.value}
                    onClick={() => setSortKey(k.value)}
                    className={`rounded-xl py-2 text-xs font-extrabold transition active:scale-95 ${
                      sortKey === k.value
                        ? 'bg-primary-600 text-white shadow'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                id="sort-dir-asc"
                type="button"
                aria-pressed={sortDir === 'asc'}
                onClick={() => setSortDir('asc')}
                className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-extrabold transition active:scale-95 ${
                  sortDir === 'asc'
                    ? 'bg-primary-600 text-white shadow'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                <ArrowUp className="h-4 w-4" />
                تصاعدي
              </button>
              <button
                id="sort-dir-desc"
                type="button"
                aria-pressed={sortDir === 'desc'}
                onClick={() => setSortDir('desc')}
                className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-extrabold transition active:scale-95 ${
                  sortDir === 'desc'
                    ? 'bg-primary-600 text-white shadow'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                <ArrowDown className="h-4 w-4" />
                تنازلي
              </button>
            </div>
          </div>
        )}
      </div>
      {/* end collapsible control panel (inner overflow + grid) */}
      </div>
      </div>
      {/* end frozen control zone */}
      </div>

      {/* ---------- Grouped-by-class expandable view ---------- */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
        </div>
      ) : groups.length === 0 ? (
        <div className="card py-12 text-center text-slate-400">
          {myGroupOnly ? (
            <>
              <HeartHandshake className="mx-auto mb-3 h-10 w-10 text-teal-300" />
              <p className="font-bold">{(myGroupIds?.size ?? 0) === 0 ? 'مجموعتك فارغة' : 'لا أحد من مجموعتك بهذه الفلاتر'}</p>
              <button
                id="go-shepherds"
                type="button"
                onClick={() => router.push('/shepherds')}
                className="btn-primary mt-4 inline-flex items-center gap-1 !py-2 !px-4 text-sm !bg-teal-600 hover:!bg-teal-700"
              >
                <HeartHandshake className="h-4 w-4" /> اختيار مخدومين لمجموعتي
              </button>
            </>
          ) : (
            <>
              <Users className="mx-auto mb-3 h-10 w-10" />
              <p className="font-bold">{kind === 'servant' ? 'لا يوجد خدام في هذا النطاق' : 'لا يوجد مخدومين'}</p>
              <p className="text-sm mt-1">
                {kind === 'servant'
                  ? 'يظهر هنا الخادم المعتمد الذي له كنيسة وخدمة وفصل محددة'
                  : 'جرّب تغيير الفلاتر أو أضف مخدومًا من «إدارة المخدومين» في الإعدادات'}
              </p>
              {kind === 'child' && (
                <button
                  id="go-manage-children"
                  onClick={() => router.push('/children/manage?tab=add')}
                  className="btn-primary mt-4 inline-flex items-center gap-1 !py-2 !px-4 text-sm"
                >
                  <Plus className="h-4 w-4" /> إدارة المخدومين
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <div id="children-groups" className="space-y-3">
          {groups.map(({ classId, className, kids, offset }) => {
            const open = openGroups[classId] ?? false;
            return (
              <div key={classId}>
                {/* Class-name header FREEZES below the control zone while its
                    children scroll. The sticky element is a FULL-BLEED mask
                    (-mx-4, wider than the card so the list's box-shadow can't
                    slide past its corners) painted with the page background,
                    and the rounded white tag sits ON TOP of it. It tucks 2px
                    UNDER the control zone (top - 2 + pt-2px) so subpixel
                    rounding can never open a see-through seam between the
                    sort accordion and the tag. */}
                <div
                  style={{ top: 69 + zoneHeight }}
                  className="sticky z-10 -mx-4 px-4 pt-[2px] bg-slate-50/95 backdrop-blur-md"
                >
                  <button
                    id={`group-${classId}`}
                    onClick={() => toggleGroup(classId)}
                    className={`flex w-full items-center justify-between border border-indigo-50 bg-white px-4 py-3 ${
                      open ? 'rounded-t-2xl border-b-indigo-100' : 'rounded-2xl shadow-card'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-sm font-extrabold text-slate-700">
                      <School className="h-4 w-4 text-primary-600" />
                      {className}
                      <span className="badge bg-primary-100 text-primary-700">{kids.length}</span>
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>

                {open && (
                  <ul className="divide-y-[3px] divide-indigo-200 overflow-hidden rounded-b-2xl border border-t-0 border-indigo-200 bg-white">
                    {kids.map((child, i) => (
                      <li key={child.id} className={`relative px-4 py-3 transition-colors duration-300 ${cardTone(child)}`}>
                        <span className="card-num" aria-label={`رقم ${offset + i + 1}`}>{offset + i + 1}</span>
                        {/* Card layout:
                            TOP    — running number (corner) · photo · name · job button
                            BOTTOM — the 4 badges in ONE row, evenly distributed:
                                     status (حاضر / لم يُسجَّل / غائب) · call
                                     feedback (0023) · attendance · points.
                            Tapping a badge opens its modal / log. */}
                        <div className="flex items-center gap-3">
                          <PersonAvatar name={child.person.name} imageUrl={child.person.image_url} />
                          <div className="min-w-0 flex-1">
                            <p className={`font-extrabold truncate ${child.status === 'stopped' ? 'text-slate-400 line-through decoration-slate-300' : ''}`}>
                              {child.person.name}
                            </p>
                            {child.status === 'stopped' && (
                              <span id={`stopped-badge-${child.id}`} className="badge bg-slate-200 text-slate-600">
                                <Ban className="h-3 w-3" /> موقوف
                              </span>
                            )}
                          </div>
                          {/* Single job button */}
                          <div className="shrink-0">{childButton(child)}</div>
                        </div>
                        <div className="badge-row">
                          {(() => {
                            const s = statusOf(child);
                            if (!s) return null;
                            const st = STATUS_STYLE[s];
                            return (
                              <span
                                id={`status-badge-${child.id}`}
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
                            const cs = callFb.stateOf(child);
                            if (!cs) return null;
                            return (
                              <CallFeedbackBadge
                                id={`call-badge-${child.id}`}
                                state={cs}
                                onClick={() => setCallTarget(child)}
                              />
                            );
                          })()}
                          <button
                            id={`att-badge-${child.id}`}
                            type="button"
                            aria-label={selectedEvent ? `سجل الحضور — ${selectedEvent.name}` : 'سجل الحضور — كل المناسبات'}
                            title={selectedEvent ? `مرات الحضور في «${selectedEvent.name}»` : 'إجمالي الحضور في كل المناسبات'}
                            onClick={() => setLogTarget({ kind: 'attendance', e: child })}
                            className="badge-btn bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                          >
                            <CalendarCheck className="h-3.5 w-3.5" /> <span className="truncate">{attendanceShown(child)}</span>
                          </button>
                          <button
                            id={`pts-badge-${child.id}`}
                            type="button"
                            aria-label="سجل النقاط"
                            title="سجل النقاط"
                            onClick={() => setLogTarget({ kind: 'points', e: child })}
                            className="badge-btn bg-gold-100 text-gold-600 hover:bg-gold-200"
                          >
                            <Star className="h-3.5 w-3.5" /> <span className="truncate">{child.points}</span>
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}

          {/* Server-side paging: pull the next PAGE_SIZE rows on demand */}
          {hasMore && (
            <button
              id="load-more-btn"
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="btn-secondary w-full flex items-center justify-center gap-2"
            >
              {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
              عرض {PAGE_SIZE} مخدوم إضافيين
            </button>
          )}
        </div>
      )}

      {/* NumPad for editable/open points */}
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

      {/* Log modals (from the attendance / points badges) */}
      {logTarget?.kind === 'attendance' && (
        <AttendanceLogModal
          enrollment={logTarget.e}
          events={events}
          selectedEvent={selectedEvent}
          onClose={() => setLogTarget(null)}
        />
      )}
      {awardTarget && (
        <AwardModal
          enrollment={awardTarget}
          onClose={() => setAwardTarget(null)}
          onAwarded={(bal) => patchEnrollment(awardTarget.id, { points: bal })}
        />
      )}
      {logTarget?.kind === 'points' && (
        <PointsLogModal
          enrollment={logTarget.e}
          causes={causes}
          events={events}
          onClose={() => setLogTarget(null)}
        />
      )}

      {/* Call feedback modal (from the call-feedback badge) */}
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

      {/* البيانات job modal (view only) */}
      {dataTarget && (
        <ViewPersonModal
          enrollment={dataTarget}
          churches={churches}
          services={services}
          classes={classes}
          onClose={() => setDataTarget(null)}
        />
      )}

      {showCompose && (
        <ComposeMessageModal
          template={messageTemplate}
          onSave={(t) => {
            setMessageTemplate(t);
            setShowCompose(false);
          }}
          onClose={() => setShowCompose(false)}
        />
      )}
    </AppShell>
  );
}

// ---------- Compose message modal (template + variables) ----------
function ComposeMessageModal({
  template, onSave, onClose,
}: {
  template: string; onSave: (t: string) => void; onClose: () => void;
}) {
  const [text, setText] = useState(template);

  const insertVar = (token: string) => {
    const el = document.getElementById('compose-textarea') as HTMLTextAreaElement | null;
    if (el) {
      const start = el.selectionStart ?? text.length;
      const end = el.selectionEnd ?? text.length;
      const next = text.slice(0, start) + token + text.slice(end);
      setText(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
    } else {
      setText((t) => t + token);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 max-h-[90vh] overflow-y-auto no-scrollbar">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">كتابة الرسالة</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <textarea
          id="compose-textarea"
          className="input-field"
          rows={5}
          placeholder="اكتب نص الرسالة هنا..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <p className="mt-3 mb-1.5 text-xs font-bold text-slate-500">إضافة متغير:</p>
        <div className="flex flex-wrap gap-2">
          {MSG_VARS.map((v) => (
            <button
              key={v.token}
              type="button"
              onClick={() => insertVar(v.token)}
              className="rounded-full bg-primary-50 px-3 py-1.5 text-xs font-bold text-primary-700 transition hover:bg-primary-100 active:scale-95"
            >
              + {v.label}
            </button>
          ))}
        </div>

        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          ستُستبدل المتغيرات ببيانات كل مخدوم عند الإرسال من زر الرسالة في بطاقته
        </p>

        <div className="mt-4 flex gap-2">
          {text.trim() && (
            <button
              type="button"
              onClick={() => {
                setText('');
              }}
              className="btn-secondary flex-none !px-4"
            >
              مسح
            </button>
          )}
          <button
            type="button"
            onClick={() => onSave(text)}
            className="btn-primary flex-1 flex items-center justify-center gap-2"
          >
            <Check className="h-5 w-5" />
            حفظ الرسالة
          </button>
        </div>
      </div>
    </div>
  );
}
