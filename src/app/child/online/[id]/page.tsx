'use client';

// ---------- Child portal — the LIVE ROOM (غرفة الفصل) ----------
// • scheduled → info + countdown; live → «ادخل الفصل» records the join
//   timestamp, then a 30 s heartbeat keeps the session open while this page
//   is visible (the server treats a 90 s gap as "left").
// • ATTENTION CHECK popup — full-screen with a countdown; «أنا هنا ✋» records
//   the response (server-side grace 5 s; late = recorded but not counted).
// • live questions (MCQ graded instantly → points; free text) · live chat
//   (when enabled) · bound exam link · my live stats.
// • ended → final result (حاضر / غائب) with the numbers behind it.
// All clocks are anchored on server_now so the phone's clock cannot cheat.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Video, Play, LogOut, Loader2, BellRing, Clock, ShieldCheck, ListChecks, MessageCircle, GraduationCap,
  CheckCircle2, XCircle, Radio, ChevronRight, Hand, Star, Wifi, User, CalendarClock,
} from 'lucide-react';
import ChildShell from '@/components/child/ChildShell';
import InfoTip from '@/components/InfoTip';
import { fmtDateTime, fmtTime } from '@/components/child/ChildBits';
import { StreamPlayer, PlatformBadge, elapsedLabel } from '@/components/online/OnlineBits';
import LiveChat from '@/components/online/LiveChat';
import ChildQuestionCard from '@/components/online/ChildQuestionCard';
import { useChild } from '@/lib/child-context';
import { createClient } from '@/lib/supabase/client';
import { LIVE_POLL_MS } from '@/lib/realtime';
import {
  fetchChildOnlineClass, joinChildOnlineClass, heartbeatChildOnlineClass, leaveChildOnlineClass,
  respondChildCheck, answerChildLiveQuestion, fetchChildRoomMessages, sendChildRoomMessage, childErrorMessage,
  type ChildOnlineClass, type ChildLiveQuestion,
} from '@/lib/child-portal';
import { fmtPercent, type RoomMessage } from '@/lib/online-classes';

const HEARTBEAT_MS = 30_000;
// 20261011120000: the heartbeat (30 s) is what the attendance rule counts —
// it stays. The data poll runs only while the class is LIVE and the tab is
// visible (LIVE_POLL_MS.liveRoom); 2 RPCs per tick.

export default function ChildOnlineRoomPage() {
  return (
    <ChildShell>
      <Room />
    </ChildShell>
  );
}

function Room() {
  const { id } = useParams<{ id: string }>();
  const { token, refresh, reloadOnline } = useChild();
  const supabase = useMemo(() => createClient(), []);

  const [cls, setCls] = useState<ChildOnlineClass | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [panel, setPanel] = useState<'questions' | 'chat'>('questions');
  const [now, setNow] = useState(() => new Date());
  const [toast, setToast] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const joinedRef = useRef(false);
  const clockOffset = useRef(0); // serverNow - clientNow (ms)

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const apply = useCallback((c: ChildOnlineClass) => {
    clockOffset.current = new Date(c.server_now).getTime() - Date.now();
    setCls(c);
  }, []);

  const inside = joined && cls?.status === 'live' && !!cls.participant;

  // ---------- load ----------
  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      apply(await fetchChildOnlineClass(supabase, token, id));
      setError('');
    } catch (e) {
      setError(childErrorMessage(e, 'تعذّر تحميل الفصل'));
    }
  }, [supabase, token, id, apply]);

  useEffect(() => { load(); }, [load]);

  // ---------- join / resume ----------
  const join = useCallback(async () => {
    if (!token || !id) return;
    setBusy(true);
    try {
      apply(await joinChildOnlineClass(supabase, token, id));
      joinedRef.current = true;
      setJoined(true);
      reloadOnline();
    } catch (e) {
      flash(childErrorMessage(e, 'تعذّر الدخول إلى الفصل'));
    } finally {
      setBusy(false);
    }
  }, [supabase, token, id, apply, reloadOnline, flash]);

  // Auto-resume: if the server already has an open session for me (page reload), re-join silently.
  useEffect(() => {
    if (!cls || joinedRef.current) return;
    if (cls.status === 'live' && cls.participant && !cls.participant.left_at) {
      join();
    }
  }, [cls, join]);

  // ---------- heartbeat while inside & visible ----------
  useEffect(() => {
    if (!inside || !token || !id) return;
    let timer: number | null = null;
    const beat = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        apply(await heartbeatChildOnlineClass(supabase, token, id));
      } catch { /* transient — the next beat will retry */ }
    };
    const start = () => {
      if (timer !== null) return;
      timer = window.setInterval(beat, HEARTBEAT_MS);
    };
    const stop = () => {
      if (timer !== null) { window.clearInterval(timer); timer = null; }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { beat(); start(); } else { stop(); }
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [inside, supabase, token, id, apply]);

  // ---------- leave on unmount ----------
  useEffect(() => {
    return () => {
      if (joinedRef.current && token && id) {
        joinedRef.current = false;
        leaveChildOnlineClass(supabase, token, id).catch(() => undefined);
      }
    };
  }, [supabase, token, id]);

  const leave = useCallback(async () => {
    if (!token || !id) return;
    setBusy(true);
    try {
      joinedRef.current = false;
      setJoined(false);
      apply(await leaveChildOnlineClass(supabase, token, id));
      reloadOnline();
    } catch (e) {
      flash(childErrorMessage(e, 'تعذّر الخروج'));
    } finally {
      setBusy(false);
    }
  }, [supabase, token, id, apply, reloadOnline, flash]);

  // ---------- chat ----------
  const hasParticipant = !!cls?.participant;
  const loadMessages = useCallback(async () => {
    if (!token || !id || !hasParticipant) return;
    try {
      setMessages(await fetchChildRoomMessages(supabase, token, id));
    } catch { /* ignore */ }
  }, [supabase, token, id, hasParticipant]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  // ---------- keeping the room fresh ----------
  // 20261016120000: the child portal has no auth session, so it cannot
  // join the private broadcast topics, and the `postgres_changes`
  // publication is now empty (it cost a continuously-polled subscription
  // per open room). The room therefore refreshes itself:
  //   • every LIVE_POLL_MS.liveRoom while the class is LIVE and the tab is
  //     visible (checks · questions · chat) — the heartbeat (30 s) already
  //     carries the class state as well,
  //   • every LIVE_POLL_MS.signup while the class is SCHEDULED so the child
  //     sees it start (the teacher's «ابدأ» flips status → live),
  //   • once whenever the tab comes back to the foreground,
  //   • nothing when the class has ended.
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000); // 1 s clock (countdowns)
    return () => window.clearInterval(t);
  }, []);
  const status = cls?.status;
  useEffect(() => {
    if (!id || !status || status === 'ended') return;
    const live = status === 'live';
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      load();
      if (live) loadMessages();
    };
    const every = live ? LIVE_POLL_MS.liveRoom : LIVE_POLL_MS.signup;
    const t = window.setInterval(tick, every);
    const onVis = () => { if (document.visibilityState === 'visible') { load(); if (live) loadMessages(); reloadOnline(); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [id, status, load, loadMessages, reloadOnline]);

  // ---------- actions ----------
  const respond = useCallback(async (checkId: string) => {
    if (!token || !id) return;
    setBusy(true);
    try {
      apply(await respondChildCheck(supabase, token, checkId));
      flash('تم تسجيل حضورك ✋');
    } catch (e) {
      flash(childErrorMessage(e, 'تعذّر تسجيل الرد'));
      load();
    } finally {
      setBusy(false);
    }
  }, [supabase, token, id, apply, flash, load]);

  const answer = useCallback(async (q: ChildLiveQuestion, selected: number | null, text: string | null) => {
    if (!token) return;
    setBusy(true);
    try {
      const next = await answerChildLiveQuestion(supabase, token, q.id, selected, text);
      apply(next);
      const mine = next.questions?.find((x) => x.id === q.id)?.my_answer;
      if (mine?.is_correct === true) flash(`إجابة صحيحة 🎉${mine.points_granted > 0 ? ` +${mine.points_granted} نقطة` : ''}`);
      else if (mine?.is_correct === false) flash('إجابة غير صحيحة — حاول في السؤال القادم');
      else flash('تم إرسال إجابتك');
      if (mine && mine.points_granted > 0) refresh();
    } catch (e) {
      flash(childErrorMessage(e, 'تعذّر إرسال الإجابة'));
    } finally {
      setBusy(false);
    }
  }, [supabase, token, apply, flash, refresh]);

  const sendMsg = useCallback(async (body: string) => {
    if (!token || !id) return;
    try {
      await sendChildRoomMessage(supabase, token, id, body);
      await loadMessages();
    } catch (e) {
      flash(childErrorMessage(e, 'تعذّر إرسال الرسالة'));
    }
  }, [supabase, token, id, loadMessages, flash]);

  // ---------- derived ----------
  const serverNow = new Date(now.getTime() + clockOffset.current);
  const pending = cls?.pending_check ?? null;
  const checkLeft = pending ? Math.max(0, Math.ceil((new Date(pending.expires_at).getTime() - serverNow.getTime()) / 1000)) : 0;
  const alreadyResponded = false; // the server omits pending_check once I've responded
  const showCheck = inside && !!pending && checkLeft > 0 && !alreadyResponded;

  const questions = cls?.questions ?? [];
  const openQs = questions.filter((q) => q.status === 'open');
  const closedQs = questions.filter((q) => q.status === 'closed');
  const unanswered = openQs.filter((q) => !q.my_answer).length;
  const pt = cls?.participant ?? null;
  const needChecks = cls ? Math.min(cls.checks_min_success, Math.max(pt?.checks_total ?? 0, 0)) : 0;

  // ---------- render ----------
  if (error && !cls) {
    return (
      <div className="card py-10 text-center">
        <XCircle className="mx-auto mb-2 h-8 w-8 text-red-400" />
        <p className="text-sm font-bold text-slate-600">{error}</p>
        <Link href="/child/online" className="mt-4 inline-block text-sm font-extrabold text-red-600">← الرجوع للفصول</Link>
      </div>
    );
  }
  if (!cls) return <div className="card py-10 text-center text-sm font-bold text-slate-400"><Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />جارٍ التحميل…</div>;

  const startsIn = Math.max(0, Math.floor((new Date(cls.starts_at).getTime() - serverNow.getTime()) / 1000));

  return (
    <div id="child-online-room" className="space-y-3">
      {/* header */}
      <div className="flex items-start gap-2">
        <Link href="/child/online" className="mt-1 rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="رجوع"><ChevronRight className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-lg font-extrabold leading-tight">
            {cls.status === 'live' ? <Radio className="h-5 w-5 shrink-0 animate-pulse text-red-600" /> : <Video className="h-5 w-5 shrink-0 text-red-600" />}
            <span className="truncate">{cls.title}</span>
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-bold text-slate-500">
            <span><CalendarClock className="inline h-3 w-3" /> {fmtDateTime(cls.starts_at)} – {fmtTime(cls.ends_at)}</span>
            {cls.teacher_name && <span><User className="inline h-3 w-3" /> {cls.teacher_name}</span>}
            <span>{cls.service_name} · {cls.class_name}</span>
            <PlatformBadge platform={cls.platform} />
          </p>
        </div>
      </div>

      {cls.description && <p className="card !py-2 text-xs font-bold text-slate-600">{cls.description}</p>}

      {/* scheduled */}
      {cls.status === 'scheduled' && (
        <div className="card text-center">
          <Clock className="mx-auto mb-2 h-8 w-8 text-slate-400" />
          <p className="text-sm font-extrabold">الفصل لم يبدأ بعد</p>
          <p className="mt-1 text-xs font-bold text-slate-500">
            {startsIn > 0 ? <>يبدأ بعد <span className="text-red-600">{fmtCountdown(startsIn)}</span></> : 'ينتظر أن يبدأه الخادم — ابقَ هنا وستفتح الغرفة تلقائياً'}
          </p>
          <RulesLine cls={cls} />
        </div>
      )}

      {/* cancelled */}
      {cls.status === 'cancelled' && (
        <div className="card text-center">
          <XCircle className="mx-auto mb-2 h-8 w-8 text-slate-400" />
          <p className="text-sm font-extrabold">أُلغي هذا الفصل</p>
        </div>
      )}

      {/* ended */}
      {cls.status === 'ended' && (
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-extrabold">نتيجتك في هذا الفصل</p>
            {pt?.final_status === 'present' && <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-extrabold text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> حاضر</span>}
            {pt?.final_status === 'absent' && <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-extrabold text-red-700"><XCircle className="h-3.5 w-3.5" /> غائب</span>}
            {!pt && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-extrabold text-slate-500">لم تدخل</span>}
          </div>
          {pt ? (
            <div className="grid grid-cols-3 gap-2">
              <Stat label="من الوقت" value={fmtPercent(pt.final_percent ?? pt.percent)} ok={(pt.final_percent ?? pt.percent) >= cls.min_time_percent} sub={`المطلوب ${cls.min_time_percent}٪`} />
              <Stat label="فحوص الانتباه" value={`${pt.checks_ok}/${pt.checks_total}`} ok={pt.checks_ok >= needChecks} sub={`المطلوب ${needChecks}`} />
              <Stat label="إجابات" value={String(pt.answers_count)} ok={pt.answers_count >= cls.min_answers} sub={cls.min_answers > 0 ? `المطلوب ${cls.min_answers}` : `${pt.correct_count} صحيحة`} />
            </div>
          ) : (
            <p className="text-xs font-bold text-slate-500">لم تُسجَّل مشاركة لك في هذا الفصل.</p>
          )}
          {pt?.final_status === 'present' && cls.attendance_points > 0 && (
            <p className="mt-3 flex items-center gap-1 text-xs font-extrabold text-gold-700"><Star className="h-3.5 w-3.5" /> حصلت على +{cls.attendance_points} نقطة حضور</p>
          )}
          {cls.exam_id && <ExamLink cls={cls} />}
        </div>
      )}

      {/* live */}
      {cls.status === 'live' && !inside && (
        <div className="card text-center">
          <Radio className="mx-auto mb-2 h-8 w-8 animate-pulse text-red-600" />
          <p className="text-sm font-extrabold">الفصل مباشر الآن</p>
          {cls.started_at && <p className="mt-1 text-xs font-bold text-slate-500">بدأ منذ {elapsedLabel(cls.started_at, serverNow)}</p>}
          <RulesLine cls={cls} />
          <button id="child-oc-join" type="button" onClick={join} disabled={busy}
            className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-red-600 px-6 py-3 text-base font-extrabold text-white shadow-lg shadow-red-200 disabled:opacity-60">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
            {pt ? 'ارجع للفصل' : 'ادخل الفصل'}
          </button>
        </div>
      )}

      {cls.status === 'live' && inside && pt && (
        <>
          <StreamPlayer platform={cls.platform} url={cls.stream_url} title={cls.title} />

          <div className="grid grid-cols-4 gap-1.5">
            <Mini icon={<Wifi className="h-3.5 w-3.5" />} label="متصل منذ" value={elapsedLabel(pt.first_joined_at, serverNow)} tone="text-green-600" />
            <Mini icon={<Clock className="h-3.5 w-3.5" />} label="من الوقت" value={fmtPercent(pt.percent)} tone={pt.percent >= cls.min_time_percent ? 'text-green-600' : 'text-amber-600'} />
            <Mini icon={<ShieldCheck className="h-3.5 w-3.5" />} label="فحوص" value={`${pt.checks_ok}/${pt.checks_total}`} tone={pt.checks_ok >= needChecks ? 'text-green-600' : 'text-amber-600'} />
            <Mini icon={<ListChecks className="h-3.5 w-3.5" />} label="إجابات" value={String(pt.answers_count)} tone="text-slate-700" />
          </div>
          <RulesLine cls={cls} compact />
          {cls.exam_id && <ExamLink cls={cls} />}

          {/* panel nav */}
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
            <button type="button" onClick={() => setPanel('questions')}
              className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-extrabold ${panel === 'questions' ? 'bg-white text-red-600 shadow' : 'text-slate-500'}`}>
              <ListChecks className="h-4 w-4" /> الأسئلة
              {unanswered > 0 && <span className="absolute -top-1 right-2 rounded-full bg-red-600 px-1.5 text-[10px] text-white">{unanswered}</span>}
            </button>
            <button type="button" onClick={() => setPanel('chat')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-extrabold ${panel === 'chat' ? 'bg-white text-red-600 shadow' : 'text-slate-500'}`}>
              <MessageCircle className="h-4 w-4" /> الدردشة
            </button>
          </div>

          {panel === 'questions' && (
            <div className="space-y-2">
              {questions.length === 0 && <p className="card py-6 text-center text-xs font-bold text-slate-400">لا توجد أسئلة الآن — انتظر الخادم</p>}
              {openQs.map((q) => <ChildQuestionCard key={q.id} q={q} busy={busy} onAnswer={(s, t) => answer(q, s, t)} />)}
              {closedQs.map((q) => <ChildQuestionCard key={q.id} q={q} busy={busy} onAnswer={(s, t) => answer(q, s, t)} />)}
            </div>
          )}
          {panel === 'chat' && (
            <LiveChat messages={messages} disabled={!cls.chat_enabled} disabledText="الدردشة مغلقة في هذا الفصل" onSend={sendMsg} height="h-[40vh]" />
          )}

          <button id="child-oc-leave" type="button" onClick={leave} disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-extrabold text-slate-600 disabled:opacity-60">
            <LogOut className="h-4 w-4" /> خروج من الفصل
          </button>
          <p className="flex items-center justify-center gap-1 px-1 text-[11px] font-bold text-slate-400">
            أبقِ الصفحة مفتوحة <InfoTip size="xs" title="لماذا أبقيها مفتوحة؟">أبقِ هذه الصفحة مفتوحة وظاهرة — إغلاقها أو تركها في الخلفية طويلاً يُحسب خروجاً من الفصل.</InfoTip>
          </p>
        </>
      )}

      {/* attention check popup */}
      {showCheck && pending && (
        <div id="child-oc-check" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
            <BellRing className="mx-auto mb-3 h-12 w-12 animate-bounce text-red-600" />
            <p className="text-xs font-extrabold text-slate-400">فحص انتباه رقم {pending.seq}</p>
            <p className="mt-1 text-lg font-extrabold">{pending.prompt || 'هل ما زلت معنا؟'}</p>
            <p className="mt-3 text-4xl font-black tabular-nums text-red-600">{checkLeft}</p>
            <p className="text-[11px] font-bold text-slate-400">ثانية متبقية</p>
            <button id="child-oc-check-ok" type="button" onClick={() => respond(pending.id)} disabled={busy}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 py-4 text-lg font-extrabold text-white shadow-lg shadow-red-200 disabled:opacity-60">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Hand className="h-5 w-5" />} أنا هنا ✋
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-xs font-extrabold text-white shadow-lg">{toast}</div>
      )}
    </div>
  );
}

// ---------- small pieces ----------
function Mini({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return (
    <div className="card !p-2 text-center">
      <p className={`flex items-center justify-center gap-1 text-[10px] font-bold text-slate-400`}>{icon} {label}</p>
      <p className={`mt-0.5 text-sm font-extrabold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

function Stat({ label, value, ok, sub }: { label: string; value: string; ok: boolean; sub?: string }) {
  return (
    <div className={`rounded-xl p-2 text-center ${ok ? 'bg-green-50' : 'bg-red-50'}`}>
      <p className="text-[10px] font-bold text-slate-500">{label}</p>
      <p className={`text-base font-extrabold tabular-nums ${ok ? 'text-green-700' : 'text-red-700'}`}>{value}</p>
      {sub && <p className="text-[10px] font-bold text-slate-400">{sub}</p>}
    </div>
  );
}

function RulesLine({ cls, compact = false }: { cls: ChildOnlineClass; compact?: boolean }) {
  return (
    <p className={`${compact ? '' : 'mt-3'} flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-bold text-slate-500`}>
      <ShieldCheck className="h-3.5 w-3.5 text-slate-400" />
      <span className="rounded-full bg-slate-100 px-2 py-0.5">حضور {cls.min_time_percent}٪ من الوقت</span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5">الرد على {cls.checks_min_success} من {cls.checks_required} فحوص</span>
      {cls.min_answers > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5">{cls.min_answers} إجابات على الأقل</span>}
      {cls.attendance_points > 0 && <span className="rounded-full bg-gold-100 px-2 py-0.5 text-gold-700">+{cls.attendance_points} نقطة</span>}
    </p>
  );
}

function ExamLink({ cls }: { cls: ChildOnlineClass }) {
  return (
    <Link href={`/child/exams/${cls.exam_id}`} className="mt-3 flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-extrabold text-indigo-700">
      <GraduationCap className="h-4 w-4" /> امتحان الفصل: {cls.exam_title ?? 'افتح الامتحان'} <ChevronRight className="mr-auto h-4 w-4 rotate-180" />
    </Link>
  );
}

function fmtCountdown(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d > 0) return `${d} يوم و ${h} ساعة`;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
