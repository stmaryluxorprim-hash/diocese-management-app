'use client';

// ---------- Call feedback UI (migration 0023 + 20261012120000) ----------
// CallFeedbackIcon        — maps a stored icon key → lucide icon
// CallFeedbackBadge       — the badge shown AFTER the status badge on a
//                           child's card: «لم يُفتقد بعد» / «لم يُفتقد» /
//                           the recorded feedback (its color + icon + name)
//                           / «أخرى» (!) for a hand-written cause.
//                           Tapping it opens the HISTORY modal.
// useCallFeedbackStates   — per-enrollment badge state for the rows on
//                           screen: the WORKING date picks the occurrence,
//                           the REAL date decides whether its cycle is open.
//
// TWO SEPARATE DIALOGS (split on purpose):
// CallFeedbackPickerModal — «ماذا كانت نتيجة المكالمة؟» — the colored
//                           feedback buttons + a fixed «أخرى» (!) choice
//                           that asks the servant to WRITE the cause.
//                           Opened AUTOMATICALLY when the servant comes
//                           back to the app after pressing the call button
//                           (useAfterCallPrompt), or from the history.
// CallFeedbackHistoryModal — «سجل الافتقاد» — the call + feedback log of
//                           the child for the event: every dial, every
//                           recorded outcome (an «أخرى» row shows what was
//                           written), who recorded it and when. Lets the
//                           servant call again / record / delete the
//                           current occurrence's feedback.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import type { LucideIcon } from 'lucide-react';
import {
  Phone, PhoneCall, PhoneMissed, PhoneOff, Voicemail,
  Check, X, CircleHelp, TriangleAlert, Ban, Clock, Hourglass, RefreshCw,
  ThumbsUp, ThumbsDown, Heart, Smile, Meh, Frown,
  Thermometer, Stethoscope, Pill, Bed, Hospital,
  Plane, Car, Bus, MapPin, House, Moon,
  GraduationCap, BookOpen, Briefcase, Users, Baby,
  Church, Gift, PartyPopper, Sparkles, MessageCircle,
  Loader2, PhoneForwarded, PhoneOutgoing, Trash2, CalendarDays, User, CircleAlert, History, PenLine, ChevronRight,
} from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { ModalFrame } from '@/components/PersonDataModals';
import { feedbackApplies, CONTACT_KIND_LABELS, type AppEvent, type CallFeedback, type ContactKind, type EnrollmentWithPerson } from '@/lib/types';
import { cairoToday, APP_TZ } from '@/lib/time';
import {
  followUpCycle, callFeedbackState, indexFeedbackRows, feedbackStyle, feedbackTintStyle, isFeedbackRow,
  canRecordFeedback, callStateLabel, CALL_STATE_SHORT_LABELS,
  OTHER_FEEDBACK_LABEL, OTHER_FEEDBACK_COLOR, OTHER_NOTE_MAX,
  type CallFeedbackIconKey, type CallFeedbackState, type EnrollmentFeedbackDays, type FollowUpCycle, type RecordedFeedback,
} from '@/lib/call-feedback';

// ---------- Icon map ----------
export const CALL_FEEDBACK_ICONS: Record<CallFeedbackIconKey, LucideIcon> = {
  'phone': Phone, 'phone-call': PhoneCall, 'phone-missed': PhoneMissed, 'phone-off': PhoneOff, 'voicemail': Voicemail,
  'check': Check, 'x': X, 'circle-help': CircleHelp, 'triangle-alert': TriangleAlert, 'ban': Ban,
  'clock': Clock, 'hourglass': Hourglass, 'refresh-cw': RefreshCw,
  'thumbs-up': ThumbsUp, 'thumbs-down': ThumbsDown, 'heart': Heart, 'smile': Smile, 'meh': Meh, 'frown': Frown,
  'thermometer': Thermometer, 'stethoscope': Stethoscope, 'pill': Pill, 'bed': Bed, 'hospital': Hospital,
  'plane': Plane, 'car': Car, 'bus': Bus, 'map-pin': MapPin, 'house': House, 'moon': Moon,
  'graduation-cap': GraduationCap, 'book-open': BookOpen, 'briefcase': Briefcase, 'users': Users, 'baby': Baby,
  'church': Church, 'gift': Gift, 'party-popper': PartyPopper, 'sparkles': Sparkles, 'message-circle': MessageCircle,
};

export function CallFeedbackIcon({ icon, className }: { icon: string; className?: string }) {
  const Cmp = (CALL_FEEDBACK_ICONS as Record<string, LucideIcon>)[icon] ?? Phone;
  return <Cmp className={className ?? 'h-3.5 w-3.5'} />;
}

/** The «!» icon of the «أخرى» choice / badge / history rows */
export function OtherFeedbackIcon({ className }: { className?: string }) {
  return <CircleAlert className={className ?? 'h-3.5 w-3.5'} strokeWidth={2.75} />;
}

// ---------- Card avatar (children page + scanner card header) ----------
export function PersonAvatar({ name, imageUrl, size = 44 }: { name: string; imageUrl: string | null; size?: number }) {
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 text-white ring-2 ring-white shadow-sm"
      style={{ width: size, height: size }}
    >
      {imageUrl ? (
        <Image src={imageUrl} alt={name} fill sizes={`${size}px`} className="object-cover" />
      ) : (
        <User className="absolute inset-0 m-auto" style={{ width: size * 0.5, height: size * 0.5 }} />
      )}
    </div>
  );
}

// ---------- Badge ----------
export function CallFeedbackBadge({
  id, state, onClick, disabled, full,
}: {
  id?: string;
  state: CallFeedbackState;
  onClick?: () => void;
  disabled?: boolean;
  /** show the full label (modal header); the card badge uses the compact one */
  full?: boolean;
}) {
  const label = callStateLabel(state);
  const shown = state.kind === 'feedback' || state.kind === 'other' || full ? label : CALL_STATE_SHORT_LABELS[state.kind];
  const cls =
    state.kind === 'feedback' || state.kind === 'other'
      ? '!ring-black/10'
      : state.kind === 'wasnt_called'
        ? 'bg-amber-100 text-amber-700 !ring-amber-300'
        : 'bg-slate-100 text-slate-500 !ring-slate-200';
  const style =
    state.kind === 'feedback' ? feedbackStyle(state.feedback.color)
      : state.kind === 'other' ? feedbackStyle(OTHER_FEEDBACK_COLOR)
        : undefined;
  const title = state.kind === 'other' ? `نتيجة الافتقاد: أخرى — ${state.note}` : `نتيجة الافتقاد: ${label}`;
  return (
    <button
      id={id}
      type="button"
      aria-label={title}
      title={`${title} — اضغط لسجل الافتقاد`}
      onClick={onClick}
      disabled={disabled}
      style={style}
      className={`badge-btn disabled:opacity-60 ${cls}`}
    >
      {state.kind === 'feedback' ? (
        <CallFeedbackIcon icon={state.feedback.icon} />
      ) : state.kind === 'other' ? (
        <OtherFeedbackIcon />
      ) : state.kind === 'wasnt_called' ? (
        <PhoneMissed className="h-3.5 w-3.5" />
      ) : (
        <PhoneForwarded className="h-3.5 w-3.5" />
      )}
      <span className="truncate">{shown}</span>
    </button>
  );
}

// ---------- Per-enrollment states for the rows on screen ----------
export interface CallFeedbackStates {
  cycle: FollowUpCycle | null;
  stateOf: (e: EnrollmentWithPerson) => CallFeedbackState | null;
  /** optimistic patch after recording / deleting a feedback */
  setRecorded: (enrollmentId: string, occurrenceOn: string, rec: RecordedFeedback | null) => void;
  /** full reload — every enrollment on screen (used on mount / scope change) */
  reload: () => Promise<void>;
  /**
   * 20261013120000: reload ONLY these enrollments (the ids carried by the
   * realtime broadcast). One tiny request instead of N×100-id batches on
   * every device for every call another servant makes.
   */
  reloadFor: (enrollmentIds: string[]) => Promise<void>;
}

export function useCallFeedbackStates(
  supabase: SupabaseClient,
  rows: EnrollmentWithPerson[],
  selectedEvent: AppEvent | null,
  feedbacks: CallFeedback[],
  /** the app's working date (frozen override or live) — picks the occurrence */
  working: Date,
  /** the REAL clock — decides whether that occurrence's cycle is open or closed */
  real: Date
): CallFeedbackStates {
  const cycle = useMemo(
    () => (selectedEvent ? followUpCycle(selectedEvent, working, real) : null),
    [selectedEvent, working, real]
  );
  const feedbacksById = useMemo(() => new Map(feedbacks.map((f) => [f.id, f])), [feedbacks]);
  const [recorded, setRecordedMap] = useState<Record<string, EnrollmentFeedbackDays>>({});

  const idsKey = rows.map((e) => e.id).join(',');
  const targetDay = cycle?.target ?? '';

  type Row = { enrollment_id: string; occurrence_on: string | null; feedback_id: string | null; note: string | null; created_at: string };
  /** The feedback rows of `ids` for the selected event + occurrence (batches of 100). */
  const fetchRows = useCallback(async (eventId: string, day: string, ids: string[]): Promise<Row[]> => {
    const all: Row[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      // Feedback rows = predefined feedback OR an «أخرى» note (both carry occurrence_on)
      let { data, error } = await supabase
        .from('contact_log')
        .select('enrollment_id, occurrence_on, feedback_id, note, created_at')
        .eq('event_id', eventId)
        .eq('occurrence_on', day)
        .or('feedback_id.not.is.null,note.not.is.null')
        .in('enrollment_id', ids.slice(i, i + 100));
      if (error) {
        // DB without 20261012120000 (no `note` column) → old query
        const old = await supabase
          .from('contact_log')
          .select('enrollment_id, occurrence_on, feedback_id, created_at')
          .eq('event_id', eventId)
          .eq('occurrence_on', day)
          .not('feedback_id', 'is', null)
          .in('enrollment_id', ids.slice(i, i + 100));
        data = ((old.data ?? []) as Omit<Row, 'note'>[]).map((r) => ({ ...r, note: null }));
      }
      all.push(...((data ?? []) as Row[]));
    }
    return all;
  }, [supabase]);

  const load = useCallback(async () => {
    if (!selectedEvent || !idsKey || !targetDay) { setRecordedMap({}); return; }
    setRecordedMap(indexFeedbackRows(await fetchRows(selectedEvent.id, targetDay, idsKey.split(','))));
  }, [selectedEvent, idsKey, targetDay, fetchRows]);

  // Partial reload: only the enrollments named by a realtime message. The
  // rows not on this screen are ignored; the ones on screen are replaced
  // (a deleted feedback disappears too because we overwrite the day).
  const reloadFor = useCallback(async (enrollmentIds: string[]) => {
    if (!selectedEvent || !idsKey || !targetDay) return;
    const onScreen = new Set(idsKey.split(','));
    const ids = Array.from(new Set(enrollmentIds.filter((id) => onScreen.has(id))));
    if (!ids.length) return;
    const fresh = indexFeedbackRows(await fetchRows(selectedEvent.id, targetDay, ids));
    setRecordedMap((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        const cur = { ...(prev[id] ?? {}) };
        const rec = fresh[id]?.[targetDay];
        if (rec) cur[targetDay] = rec; else delete cur[targetDay];
        next[id] = cur;
      }
      return next;
    });
  }, [selectedEvent, idsKey, targetDay, fetchRows]);

  useEffect(() => {
    let cancelled = false;
    load().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [load]);

  const stateOf = useCallback(
    (e: EnrollmentWithPerson): CallFeedbackState | null => {
      if (!cycle || !selectedEvent) return null;
      if (cycle.beforeCreation) return null; // the event didn't exist on that day
      if (selectedEvent.church_id !== e.church_id) return null;
      if (selectedEvent.service_id !== null && selectedEvent.service_id !== e.service_id) return null;
      if (selectedEvent.class_id !== null && selectedEvent.class_id !== e.class_id) return null;
      return callFeedbackState(cycle, recorded[e.id], feedbacksById);
    },
    [cycle, selectedEvent, recorded, feedbacksById]
  );

  const setRecorded = useCallback((enrollmentId: string, occurrenceOn: string, rec: RecordedFeedback | null) => {
    setRecordedMap((prev) => {
      const cur = { ...(prev[enrollmentId] ?? {}) };
      if (rec) cur[occurrenceOn] = rec; else delete cur[occurrenceOn];
      return { ...prev, [enrollmentId]: cur };
    });
  }, []);

  return { cycle, stateOf, setRecorded, reload: load, reloadFor };
}

// ---------- After-call prompt ----------
// The call button dials (`tel:`) — the phone app takes over. When the
// servant COMES BACK to our app (tab visible / window focused again) the
// feedback PICKER opens automatically for the child he just called. The
// pending call survives a page reload / PWA restart through sessionStorage
// (the dialer often suspends the web view), and expires after 2 hours.
const PENDING_CALL_KEY = 'pending_call_feedback';
const PENDING_CALL_TTL_MS = 2 * 60 * 60 * 1000;

interface PendingCall { enrollmentId: string; eventId: string; at: number }

const readPending = (): PendingCall | null => {
  try {
    const raw = sessionStorage.getItem(PENDING_CALL_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingCall;
    if (!p?.enrollmentId || !p?.eventId || Date.now() - p.at > PENDING_CALL_TTL_MS) {
      sessionStorage.removeItem(PENDING_CALL_KEY);
      return null;
    }
    return p;
  } catch { return null; }
};

/**
 * Hook: remember «I am calling this child for this event»; when the app
 * regains focus (the servant is back from the phone app) → `onReturn(…)`
 * fires with the enrollment + event ids so the page opens the picker.
 * `onReturn` returns `true` when it handled the call (picker opened) —
 * `false` keeps the call pending (e.g. the rows are not loaded yet after a
 * PWA restart) and the page calls `check()` again once they are.
 */
export function useAfterCallPrompt(onReturn: (enrollmentId: string, eventId: string) => boolean | void) {
  const cbRef = useRef(onReturn);
  cbRef.current = onReturn;
  const armedAt = useRef(0);

  const fire = useCallback(() => {
    const p = readPending();
    if (!p) return;
    // The dialer opens almost instantly; ignore the focus/visibility events
    // that fire within the first moment after pressing the button.
    if (Date.now() - p.at < 700) return;
    const handled = cbRef.current(p.enrollmentId, p.eventId);
    if (handled !== false) sessionStorage.removeItem(PENDING_CALL_KEY);
  }, []);

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') fire(); };
    const onFocus = () => fire();
    const onShow = () => fire(); // bfcache restore
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onShow);
    // A reload while the call was pending (PWA restarted by the OS)
    const t = setTimeout(fire, 400);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onShow);
      clearTimeout(t);
    };
  }, [fire]);

  /** Call right before `window.location.href = 'tel:…'` */
  const arm = useCallback((enrollmentId: string, eventId: string) => {
    armedAt.current = Date.now();
    try {
      sessionStorage.setItem(PENDING_CALL_KEY, JSON.stringify({ enrollmentId, eventId, at: armedAt.current } satisfies PendingCall));
    } catch { /* private mode — the prompt simply won't auto-open */ }
    // Desktop browsers without a phone app: nothing takes the focus away, so
    // the visibility event never fires — open the picker after a short wait.
    setTimeout(() => {
      if (document.visibilityState === 'visible' && document.hasFocus()) fire();
    }, 2500);
  }, [fire]);

  return { arm, check: fire };
}

/** Start a call for a child as a follow-up of an event: arm the prompt, log the dial, open the dialer. */
export function startCall(
  supabase: SupabaseClient,
  e: EnrollmentWithPerson,
  event: AppEvent,
  recordedBy: string | undefined,
  arm: (enrollmentId: string, eventId: string) => void,
  now: () => Date
) {
  if (!e.person.phone) return;
  arm(e.id, event.id);
  // Fire-and-forget: the dial itself is logged (kind 'call', no feedback) —
  // the outcome comes later from the picker. Never blocks the dialer.
  supabase
    .from('contact_log')
    .insert({ enrollment_id: e.id, event_id: event.id, kind: 'call', message: null, contacted_on: cairoToday(now()), recorded_by: recordedBy })
    .then(({ error }) => { if (error) console.warn('contact_log insert failed', error.message); });
  window.location.href = `tel:${e.person.phone}`;
}

// ---------- Shared bits ----------
const fmtDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(Date.UTC(y, m - 1, d)));
};
const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('ar-EG', {
    timeZone: APP_TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));

function ChildEventHeader({ enrollment, event, day, state }: { enrollment: EnrollmentWithPerson; event: AppEvent; day: string; state?: CallFeedbackState }) {
  return (
    <div className="mb-3 flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2.5">
      <PersonAvatar name={enrollment.person.name} imageUrl={enrollment.person.image_url} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-extrabold">{enrollment.person.name}</p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs font-bold text-slate-500">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          {event.name} — {fmtDay(day)}
        </p>
      </div>
      {state && <CallFeedbackBadge state={state} disabled />}
    </div>
  );
}

/** Insert the feedback row (predefined or «أخرى») — shared by the picker + history */
async function insertFeedback(
  supabase: SupabaseClient,
  args: { enrollment: EnrollmentWithPerson; event: AppEvent; cycle: FollowUpCycle; recordedBy: string | undefined; now: () => Date; feedbackId: string | null; note: string | null }
) {
  const row: Record<string, unknown> = {
    enrollment_id: args.enrollment.id,
    event_id: args.event.id,
    kind: 'call',
    message: null,
    contacted_on: cairoToday(args.now()),
    occurrence_on: args.cycle.target,
    feedback_id: args.feedbackId,
    recorded_by: args.recordedBy,
  };
  // the `note` column exists only from 20261012120000 — send it only for «أخرى»
  if (args.note !== null) row.note = args.note;
  const { error } = await supabase.from('contact_log').insert(row);
  return error;
}

// ---------- 1. PICKER — «ماذا كانت نتيجة المكالمة؟» ----------
export function CallFeedbackPickerModal({
  enrollment, event, cycle, feedbacks, current, now, onRecorded, onClose, onOpenHistory,
}: {
  enrollment: EnrollmentWithPerson;
  event: AppEvent;
  cycle: FollowUpCycle;
  feedbacks: CallFeedback[];
  current: CallFeedbackState;
  now: () => Date;
  onRecorded: (occurrenceOn: string, rec: RecordedFeedback) => void;
  onClose: () => void;
  /** optional: a link to the history modal */
  onOpenHistory?: () => void;
}) {
  const supabase = createClient();
  const { profile } = useAuth();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [otherOpen, setOtherOpen] = useState(current.kind === 'other');
  const [note, setNote] = useState(current.kind === 'other' ? current.note : '');
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const options = useMemo(
    () => feedbacks
      .filter((f) => feedbackApplies(f, enrollment, event.id))
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ar')),
    [feedbacks, enrollment, event.id]
  );

  const editable = canRecordFeedback(cycle);

  useEffect(() => { if (otherOpen) setTimeout(() => noteRef.current?.focus(), 50); }, [otherOpen]);

  const save = async (feedbackId: string | null, noteText: string | null) => {
    if (!editable) return;
    setError('');
    setSaving(feedbackId ?? 'other');
    const err = await insertFeedback(supabase, { enrollment, event, cycle, recordedBy: profile?.id, now, feedbackId, note: noteText });
    setSaving(null);
    if (err) {
      setError(
        noteText !== null && /note/i.test(err.message)
          ? 'تعذر حفظ «أخرى» — شغّل تحديث قاعدة البيانات (20261012120000)'
          : 'تعذر تسجيل النتيجة — تأكد من تشغيل تحديث قاعدة البيانات (0023)'
      );
      return;
    }
    onRecorded(cycle.target, { feedbackId, note: noteText });
    onClose();
  };

  const saveOther = () => {
    const t = note.trim();
    if (!t) { setError('اكتب سبب / نتيجة المكالمة أولاً'); noteRef.current?.focus(); return; }
    if (t.length > OTHER_NOTE_MAX) { setError(`النص طويل — الحد ${OTHER_NOTE_MAX} حرفًا`); return; }
    save(null, t);
  };

  const otherActive = current.kind === 'other';

  return (
    <ModalFrame title="نتيجة المكالمة" icon={<PhoneCall className="h-5 w-5 text-primary-600" />} onClose={onClose}>
      <ChildEventHeader enrollment={enrollment} event={event} day={cycle.target} />

      {!editable ? (
        <p className={`mb-3 rounded-xl px-3 py-2 text-xs font-bold ${cycle.status === 'future' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>
          {cycle.status === 'future'
            ? `⏳ مناسبة ${fmtDay(cycle.target)} لم تبدأ بعد في الوقت الفعلي — يمكن تسجيل النتيجة بعد بدايتها`
            : `🔒 انتهت فترة الافتقاد لمناسبة ${fmtDay(cycle.target)} — لا يمكن تسجيل نتيجة الآن`}
        </p>
      ) : (
        <p className="mb-2 text-sm font-extrabold text-slate-700">ماذا كانت نتيجة المكالمة؟</p>
      )}

      {!otherOpen ? (
        <>
          <div id="call-feedback-options" className="grid grid-cols-2 gap-2">
            {options.map((fb) => {
              const active = current.kind === 'feedback' && current.feedback.id === fb.id;
              return (
                <button
                  key={fb.id}
                  id={`call-fb-${fb.id}`}
                  type="button"
                  disabled={saving !== null || !editable}
                  aria-pressed={active}
                  onClick={() => save(fb.id, null)}
                  style={active ? feedbackStyle(fb.color) : feedbackTintStyle(fb.color)}
                  className={`flex min-h-[3rem] items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm font-extrabold transition active:scale-95 disabled:opacity-60 ${active ? 'shadow ring-2 ring-offset-1' : ''}`}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={active ? { backgroundColor: 'rgba(255,255,255,0.25)' } : feedbackStyle(fb.color)}
                  >
                    {saving === fb.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CallFeedbackIcon icon={fb.icon} className="h-4 w-4" />}
                  </span>
                  <span className="truncate text-right">{fb.name}</span>
                </button>
              );
            })}
            {/* Fixed «أخرى» (!) — write the cause by hand */}
            <button
              id="call-fb-other"
              type="button"
              disabled={saving !== null || !editable}
              aria-pressed={otherActive}
              onClick={() => setOtherOpen(true)}
              style={otherActive ? feedbackStyle(OTHER_FEEDBACK_COLOR) : feedbackTintStyle(OTHER_FEEDBACK_COLOR)}
              className={`flex min-h-[3rem] items-center gap-2 rounded-xl border-2 border-dashed px-3 py-2 text-sm font-extrabold transition active:scale-95 disabled:opacity-60 ${otherActive ? 'shadow ring-2 ring-offset-1' : ''}`}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={otherActive ? { backgroundColor: 'rgba(255,255,255,0.25)' } : feedbackStyle(OTHER_FEEDBACK_COLOR)}
              >
                <OtherFeedbackIcon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 text-right">
                <span className="block truncate">{OTHER_FEEDBACK_LABEL}</span>
                <span className="block truncate text-[10px] font-bold opacity-80">{otherActive ? current.note : 'اكتب السبب بنفسك'}</span>
              </span>
            </button>
          </div>
          {options.length === 0 && (
            <p className="mt-2 rounded-xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-600">
              لا توجد نتائج افتقاد معرّفة لهذا النطاق — أضفها من الإعدادات ← إدارة نتائج الافتقاد، أو اختر «أخرى» واكتب السبب
            </p>
          )}
        </>
      ) : (
        <div id="call-fb-other-form" className="rounded-2xl border-2 border-dashed p-3" style={feedbackTintStyle(OTHER_FEEDBACK_COLOR)}>
          <p className="mb-1.5 flex items-center gap-1.5 text-sm font-extrabold">
            <OtherFeedbackIcon className="h-4 w-4" /> {OTHER_FEEDBACK_LABEL} — اكتب نتيجة / سبب المكالمة
          </p>
          <textarea
            ref={noteRef}
            id="call-fb-other-note"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, OTHER_NOTE_MAX))}
            rows={3}
            maxLength={OTHER_NOTE_MAX}
            disabled={!editable || saving !== null}
            placeholder="مثال: مسافر مع أهله لمدة أسبوع…"
            className="input-field w-full resize-none !bg-white text-sm"
          />
          <div className="mt-1 flex items-center justify-between text-[11px] font-bold text-slate-500">
            <span>{note.trim().length} / {OTHER_NOTE_MAX}</span>
            <button type="button" onClick={() => { setOtherOpen(false); setError(''); }} className="flex items-center gap-0.5 hover:text-slate-700">
              <ChevronRight className="h-3.5 w-3.5" /> رجوع للنتائج
            </button>
          </div>
          <button
            id="call-fb-other-save"
            type="button"
            onClick={saveOther}
            disabled={!editable || saving !== null || !note.trim()}
            className="btn-primary mt-2 flex w-full items-center justify-center gap-2 !py-2.5 text-sm disabled:opacity-60"
          >
            {saving === 'other' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
            حفظ النتيجة
          </button>
        </div>
      )}

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}

      <div className="mt-3 flex gap-2">
        {onOpenHistory && (
          <button type="button" onClick={onOpenHistory} className="btn-secondary flex flex-1 items-center justify-center gap-2 !py-2.5 text-sm">
            <History className="h-4 w-4" /> سجل الافتقاد
          </button>
        )}
        <button type="button" onClick={onClose} className="btn-secondary flex flex-1 items-center justify-center gap-2 !py-2.5 text-sm">
          لاحقًا
        </button>
      </div>
    </ModalFrame>
  );
}

// ---------- 2. HISTORY — «سجل الافتقاد» (calls + feedbacks) ----------
interface HistoryRow {
  id: string;
  kind: ContactKind;
  feedback_id: string | null;
  note: string | null;
  occurrence_on: string | null;
  created_at: string;
  recorded_by: string | null;
}

export function CallFeedbackHistoryModal({
  enrollment, event, cycle, feedbacks, current, now, onRecorded, onClose, onCall, onPick,
}: {
  enrollment: EnrollmentWithPerson;
  event: AppEvent;
  cycle: FollowUpCycle;
  feedbacks: CallFeedback[];
  current: CallFeedbackState;
  now: () => Date;
  onRecorded: (occurrenceOn: string, rec: RecordedFeedback | null) => void;
  onClose: () => void;
  /** «اتصال» — the page dials and arms the after-call prompt */
  onCall?: () => void;
  /** «تسجيل النتيجة» — the page opens the picker */
  onPick?: () => void;
}) {
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const byId = useMemo(() => new Map(feedbacks.map((f) => [f.id, f])), [feedbacks]);

  // Everything of kind 'call' for this child + event: dials AND outcomes (newest first)
  const loadHistory = useCallback(async () => {
    let rows: HistoryRow[];
    const { data, error: err } = await supabase
      .from('contact_log')
      .select('id, kind, feedback_id, note, occurrence_on, created_at, recorded_by')
      .eq('enrollment_id', enrollment.id).eq('event_id', event.id).eq('kind', 'call')
      .order('created_at', { ascending: false }).limit(60);
    if (err) {
      // DB without the `note` column (20261012120000 not applied yet)
      const old = await supabase
        .from('contact_log')
        .select('id, kind, feedback_id, occurrence_on, created_at, recorded_by')
        .eq('enrollment_id', enrollment.id).eq('event_id', event.id).eq('kind', 'call')
        .order('created_at', { ascending: false }).limit(60);
      rows = ((old.data ?? []) as Omit<HistoryRow, 'note'>[]).map((r) => ({ ...r, note: null }));
    } else {
      rows = (data ?? []) as HistoryRow[];
    }
    setHistory(rows);
    const ids = Array.from(new Set(rows.map((r) => r.recorded_by).filter((x): x is string => !!x)));
    if (ids.length) {
      const { data: profs } = await supabase.from('servant_enrollments').select('id, full_name').in('id', ids);
      const map: Record<string, string> = {};
      (profs ?? []).forEach((p: { id: string; full_name: string }) => { map[p.id] = p.full_name; });
      setNames(map);
    }
  }, [supabase, enrollment.id, event.id]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const editable = canRecordFeedback(cycle);
  const hasCurrent = current.kind === 'feedback' || current.kind === 'other';
  const closed = cycle.status === 'closed';

  // Remove the latest feedback of the current occurrence (undo)
  const undo = async () => {
    if (!editable) return;
    const latest = history?.find((h) => isFeedbackRow(h) && h.occurrence_on === cycle.target);
    if (!latest) return;
    if (!confirm('حذف نتيجة الافتقاد المسجلة لهذه المناسبة؟')) return;
    setSaving(true);
    const { error: err } = await supabase.from('contact_log').delete().eq('id', latest.id);
    setSaving(false);
    if (err) { setError('تعذر الحذف'); return; }
    const remaining = (history ?? []).filter((h) => h.id !== latest.id);
    setHistory(remaining);
    const next = remaining.find((h) => isFeedbackRow(h) && h.occurrence_on === cycle.target);
    onRecorded(cycle.target, next ? { feedbackId: next.feedback_id, note: next.feedback_id ? null : next.note } : null);
  };

  const feedbackCount = history?.filter(isFeedbackRow).length ?? 0;
  const dialCount = history ? history.length - feedbackCount : 0;

  return (
    <ModalFrame title="سجل الافتقاد" icon={<History className="h-5 w-5 text-primary-600" />} onClose={onClose}>
      <ChildEventHeader enrollment={enrollment} event={event} day={cycle.target} state={current} />

      {current.kind === 'other' && (
        <div id="call-current-other" className="mb-3 flex items-start gap-2 rounded-2xl border-2 px-3 py-2.5" style={feedbackTintStyle(OTHER_FEEDBACK_COLOR)}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={feedbackStyle(OTHER_FEEDBACK_COLOR)}>
            <OtherFeedbackIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold opacity-80">{OTHER_FEEDBACK_LABEL} — السبب المكتوب</p>
            <p className="whitespace-pre-wrap break-words text-sm font-extrabold">{current.note}</p>
          </div>
        </div>
      )}

      {closed && (
        <p id="call-cycle-closed" className={`mb-3 rounded-xl px-3 py-2 text-xs font-bold ${current.kind === 'wasnt_called' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
          {current.kind === 'wasnt_called' ? '⚠️ لم يُفتقد هذا المخدوم لمناسبة ' : '🔒 نتيجة الافتقاد لمناسبة '}
          {fmtDay(cycle.target)} — انتهت فترة الافتقاد ببداية مناسبة {fmtDay(cycle.realTarget)} في الوقت الفعلي؛ يُعرض السجل فقط
        </p>
      )}
      {cycle.status === 'future' && (
        <p id="call-cycle-future" className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700">
          ⏳ مناسبة {fmtDay(cycle.target)} لم تبدأ بعد في الوقت الفعلي — يمكن تسجيل نتيجة الافتقاد بعد بدايتها
        </p>
      )}

      {/* Actions: call · record / change the outcome · delete */}
      {!closed && (
        <div className="mb-4 flex flex-wrap gap-2">
          {enrollment.person.phone && onCall && (
            <button type="button" onClick={onCall} className="btn-primary flex flex-1 items-center justify-center gap-2 !py-2.5 text-sm">
              <Phone className="h-4 w-4" /> اتصال
            </button>
          )}
          {editable && onPick && (
            <button id="call-history-pick" type="button" onClick={onPick} className="btn-secondary flex flex-1 items-center justify-center gap-2 !py-2.5 text-sm">
              <PhoneCall className="h-4 w-4" /> {hasCurrent ? 'تغيير النتيجة' : 'تسجيل النتيجة'}
            </button>
          )}
          {hasCurrent && editable && (
            <button
              id="call-history-undo"
              type="button"
              onClick={undo}
              disabled={saving}
              aria-label="حذف النتيجة"
              title="حذف النتيجة"
              className="flex items-center justify-center gap-1.5 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-bold text-red-600 hover:bg-red-100 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </button>
          )}
        </div>
      )}
      {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}

      {/* Log */}
      <div>
        <p className="mb-1.5 flex items-center justify-between text-xs font-bold text-slate-500">
          <span>سجل المكالمات والنتائج — {event.name}</span>
          {history && history.length > 0 && (
            <span className="text-[11px] text-slate-400">{feedbackCount} نتيجة · {dialCount} اتصال</span>
          )}
        </p>
        {history === null ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-primary-500" /></div>
        ) : history.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-3 py-3 text-center text-xs font-bold text-slate-400">لا توجد مكالمات أو نتائج مسجلة بعد</p>
        ) : (
          <ul id="call-history-list" className="max-h-72 space-y-1.5 overflow-y-auto no-scrollbar">
            {history.map((h) => {
              const isFb = isFeedbackRow(h);
              const fb = h.feedback_id ? byId.get(h.feedback_id) : undefined;
              const isOther = isFb && !h.feedback_id;
              const color = isOther ? OTHER_FEEDBACK_COLOR : fb?.color ?? '#94a3b8';
              const title = !isFb ? CONTACT_KIND_LABELS.call : isOther ? OTHER_FEEDBACK_LABEL : (fb?.name ?? 'نتيجة محذوفة');
              const isCurrent = isFb && h.occurrence_on === cycle.target && history.find((x) => isFeedbackRow(x) && x.occurrence_on === cycle.target)?.id === h.id;
              return (
                <li
                  key={h.id}
                  className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${isFb ? 'bg-slate-50' : 'bg-white ring-1 ring-slate-100'} ${isCurrent ? 'ring-2 ring-primary-200' : ''}`}
                >
                  <span
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                    style={isFb ? feedbackStyle(color) : { backgroundColor: '#e0f2fe', color: '#0369a1' }}
                  >
                    {!isFb ? <PhoneOutgoing className="h-3.5 w-3.5" />
                      : isOther ? <OtherFeedbackIcon />
                        : <CallFeedbackIcon icon={fb?.icon ?? 'phone'} className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-extrabold">{title}</span>
                      {isCurrent && <span className="rounded-md bg-primary-50 px-1.5 py-0.5 text-[10px] font-bold text-primary-600">الحالية</span>}
                    </span>
                    {isOther && h.note && (
                      <span className="mt-0.5 block whitespace-pre-wrap break-words rounded-lg bg-white/70 px-2 py-1 text-[11px] font-bold text-slate-700">{h.note}</span>
                    )}
                    <span className="block truncate text-[11px] text-slate-500">
                      {isFb ? `مناسبة ${h.occurrence_on ? fmtDay(h.occurrence_on) : '—'} · ` : ''}
                      {fmtDateTime(h.created_at)}
                      {h.recorded_by && names[h.recorded_by] ? ` · ${names[h.recorded_by]}` : ''}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ModalFrame>
  );
}
