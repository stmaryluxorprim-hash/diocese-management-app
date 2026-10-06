'use client';

// ---------- ONLINE CLASS CONTROL ROOM (غرفة التحكم) ----------
// Header: title, status, live timer, start / end / reopen. Then:
//   • video preview + «إرسال فحص انتباه» panel (live only)
//   • 4 tabs: الحضور (participants evaluated live) · الأسئلة · الدردشة · الإعدادات
// Realtime on participants / checks / responses / questions / answers /
// messages (debounced), plus a 15 s poll of live stats while the class is live
// (presence % moves with the clock, not with DB events).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Loader2, Play, Square, RotateCcw, Users, ListChecks, MessageCircle, Settings2, BellRing, Timer, Radio,
  ShieldCheck, Link2, AlertTriangle, ExternalLink, Wifi, Clock,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { OnlineHeader, StatusBadge, PlatformBadge, StreamPlayer, Toast, scopeLabel, fmtDateTime, fmtTime, elapsedLabel } from '@/components/online/OnlineBits';
import ClassFormModal from '@/components/online/ClassFormModal';
import ParticipantsTab from '@/components/online/ParticipantsTab';
import QuestionsTab from '@/components/online/QuestionsTab';
import SettingsTab from '@/components/online/SettingsTab';
import LiveChat from '@/components/online/LiveChat';
import { useStoreLookups } from '@/components/store/StoreBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime, LIVE_POLL_MS } from '@/lib/realtime';
import {
  fetchOnlineClass, fetchLiveStats, fetchLiveQuestions, fetchLiveAnswers, fetchChecks, fetchCheckResponses, fetchRoomMessages,
  startClass, endClass, reopenClass, sendCheck, updateOnlineClass, deleteOnlineClass, sendServantMessage, deleteRoomMessage,
  onlineErrorMessage, rulesLabel,
  type OnlineClass, type LiveStats, type LiveQuestion, type LiveAnswer, type AttentionCheck, type CheckResponse, type RoomMessage,
} from '@/lib/online-classes';

type Tab = 'participants' | 'questions' | 'chat' | 'settings';

export default function OnlineClassRoomPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { profile, user } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { churches, services, classes } = useStoreLookups(supabase, approved);

  const [cls, setCls] = useState<OnlineClass | null>(null);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [questions, setQuestions] = useState<LiveQuestion[]>([]);
  const [answers, setAnswers] = useState<LiveAnswer[]>([]);
  const [checks, setChecks] = useState<AttentionCheck[]>([]);
  const [responses, setResponses] = useState<CheckResponse[]>([]);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>('participants');
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [checkPrompt, setCheckPrompt] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  const canWrite = useMemo(() => {
    if (!profile || !cls) return false;
    if (profile.role === 'owner') return true;
    if (cls.church_id !== profile.church_id) return false;
    if (profile.role === 'church_manager') return true;
    if (profile.service_id && cls.service_id !== profile.service_id) return false;
    if (profile.role === 'service_manager') return true;
    if (profile.class_id && cls.class_id !== profile.class_id) return false;
    return true;
  }, [profile, cls]);

  // ---------- loaders ----------
  const loadClass = useCallback(async () => {
    try {
      const x = await fetchOnlineClass(supabase, id);
      if (!x) { setNotFound(true); return; }
      setCls(x);
    } catch (e) { flash(onlineErrorMessage(e, 'تعذر التحميل')); } finally { setLoading(false); }
  }, [supabase, id]);
  const loadStats = useCallback(async () => {
    try { setStats(await fetchLiveStats(supabase, id)); } catch { /* ignore */ } finally { setStatsLoading(false); }
  }, [supabase, id]);
  const loadQuestions = useCallback(async () => {
    try {
      const [q, a] = await Promise.all([fetchLiveQuestions(supabase, id), fetchLiveAnswers(supabase, id)]);
      setQuestions(q); setAnswers(a);
    } catch { /* ignore */ }
  }, [supabase, id]);
  const loadChecks = useCallback(async () => {
    try {
      const [k, r] = await Promise.all([fetchChecks(supabase, id), fetchCheckResponses(supabase, id)]);
      setChecks(k); setResponses(r);
    } catch { /* ignore */ }
  }, [supabase, id]);
  const loadMessages = useCallback(async () => { try { setMessages(await fetchRoomMessages(supabase, id)); } catch { /* ignore */ } }, [supabase, id]);

  useEffect(() => { if (approved) { loadClass(); loadStats(); loadQuestions(); loadChecks(); loadMessages(); } }, [approved, loadClass, loadStats, loadQuestions, loadChecks, loadMessages]);
  const live = cls?.status === 'live';

  // 20261016120000: these tables ride the broadcast bus (no server-side
  // filter) — a message means "some online class changed", so the handlers
  // are rate-limited: the heartbeat of every child in every live room is an
  // UPDATE on online_class_participants every 30 s. The stats poll below
  // (15 s while live & visible) already keeps presence % moving, so the
  // participants/checks listener only needs to catch up once a minute.
  useDebouncedRealtime(supabase, `oc-${id}`, [{ table: 'online_classes' }], loadClass, { enabled: approved, delayMs: 500, minIntervalMs: 5_000 });
  useDebouncedRealtime(supabase, `oc-stats-${id}`,
    [{ table: 'online_class_participants' }, { table: 'online_class_check_responses' }, { table: 'online_class_checks' }],
    async () => { await Promise.all([loadStats(), loadChecks()]); }, { enabled: approved && !live, delayMs: 800, minIntervalMs: 60_000 });
  useDebouncedRealtime(supabase, `oc-q-${id}`,
    [{ table: 'online_class_questions' }, { table: 'online_class_answers' }],
    loadQuestions, { enabled: approved, delayMs: 600, minIntervalMs: 10_000 });
  useDebouncedRealtime(supabase, `oc-msg-${id}`, [{ table: 'online_class_messages' }], loadMessages, { enabled: approved, delayMs: 400, minIntervalMs: 3_000 });

  // clock + periodic stats while live (presence % depends on the clock);
  // while live this poll is the ONLY refresh path for stats/checks
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') { loadStats(); loadChecks(); } }, LIVE_POLL_MS.liveRoom); // live room only, visible only
    return () => clearInterval(t);
  }, [live, loadStats, loadChecks]);

  // ---------- actions ----------
  const doStart = async () => {
    if (!cls) return;
    if (!cls.stream_url && !confirm('لم يُضَف رابط البث — بدء الفصل بدون فيديو؟')) return;
    setBusy('start');
    try { setCls(await startClass(supabase, cls.id)); flash('بدأ الفصل — المخدومون يمكنهم الدخول الآن'); loadStats(); }
    catch (e) { flash(onlineErrorMessage(e, 'تعذر البدء')); } finally { setBusy(null); }
  };
  const doEnd = async () => {
    if (!cls || !stats) return;
    let msg = `إنهاء الفصل وحساب الحضور النهائي؟\nدخل ${stats.totals.entered} مخدوم · التقدير الحالي: ${stats.totals.present} حاضر · ${stats.totals.absent} غائب.`;
    if (stats.checks_sent < cls.checks_required) msg += `\n\n⚠️ أُرسل ${stats.checks_sent} فحص فقط من ${cls.checks_required} — سيُحسب الحد الأدنى على ما أُرسل.`;
    if (!confirm(msg)) return;
    setBusy('end');
    try {
      const r = await endClass(supabase, cls.id);
      flash(`انتهى الفصل — ${r.present} حاضر · ${r.absent} غائب`);
      await Promise.all([loadClass(), loadStats()]);
      setTab('participants');
    } catch (e) { flash(onlineErrorMessage(e, 'تعذر الإنهاء')); } finally { setBusy(null); }
  };
  const doReopen = async () => {
    if (!cls || !confirm('إعادة فتح الفصل؟ سيُحذف الحضور المسجَّل ويُعاد حسابه عند الإنهاء مجدداً.')) return;
    setBusy('reopen');
    try { setCls(await reopenClass(supabase, cls.id)); flash('عاد الفصل مباشراً'); loadStats(); }
    catch (e) { flash(onlineErrorMessage(e, 'تعذر إعادة الفتح')); } finally { setBusy(null); }
  };
  const doCheck = async () => {
    if (!cls) return;
    setBusy('check');
    try {
      const k = await sendCheck(supabase, cls.id, checkPrompt || undefined);
      flash(`أُرسل فحص الانتباه #${k.seq} — مهلة ${cls.check_seconds} ثانية`);
      setCheckPrompt('');
      loadChecks();
    } catch (e) { flash(onlineErrorMessage(e, 'تعذر الإرسال')); } finally { setBusy(null); }
  };
  const patch = async (p: Parameters<typeof updateOnlineClass>[2], ok: string) => {
    if (!cls) return;
    try { setCls(await updateOnlineClass(supabase, cls.id, p, user?.id)); if (ok) flash(ok); }
    catch (e) { flash(onlineErrorMessage(e, 'تعذر التغيير')); }
  };
  const remove = async () => {
    if (!cls || !confirm(`حذف الفصل «${cls.title}» نهائياً مع كل بياناته؟\nسجلات الحضور التي كُتبت للمخدومين تبقى.`)) return;
    setBusy('delete');
    try { await deleteOnlineClass(supabase, cls.id); router.replace('/online'); }
    catch (e) { flash(onlineErrorMessage(e, 'تعذر الحذف')); setBusy(null); }
  };
  const sendMsg = async (body: string) => {
    if (!cls || !user) return;
    try { await sendServantMessage(supabase, cls.id, body, user.id); loadMessages(); }
    catch (e) { flash(onlineErrorMessage(e, 'تعذر الإرسال')); }
  };
  const delMsg = async (m: RoomMessage) => {
    try { await deleteRoomMessage(supabase, m.id); setMessages((l) => l.filter((x) => x.id !== m.id)); }
    catch (e) { flash(onlineErrorMessage(e, 'تعذر الحذف')); }
  };

  // ---------- render ----------
  if (loading) return <AppShell><div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-red-500" /></div></AppShell>;
  if (notFound || !cls) {
    return (
      <AppShell>
        <OnlineHeader title="الفصل غير موجود" />
        <div className="card py-10 text-center text-slate-400"><p className="font-bold">ربما حُذف أو ليس في نطاقك</p></div>
      </AppShell>
    );
  }

  const activeCheck = checks.find((k) => new Date(k.expires_at) > now);
  const checkRemaining = activeCheck ? Math.max(0, Math.round((new Date(activeCheck.expires_at).getTime() - now.getTime()) / 1000)) : 0;
  const activeResponses = activeCheck ? responses.filter((r) => r.check_id === activeCheck.id).length : 0;
  const responsesOf = (checkId: string) => responses.filter((r) => r.check_id === checkId && r.ok).length;
  const openQ = questions.filter((q) => q.status === 'open').length;

  return (
    <AppShell>
      <OnlineHeader
        title={cls.title}
        badge={<StatusBadge status={cls.status} />}
        sub={scopeLabel(cls, churches, services, classes)}
        actions={canWrite ? (
          cls.status === 'scheduled' ? (
            <button id="oc-start" type="button" disabled={busy === 'start'} onClick={doStart} className="btn-primary flex items-center gap-1.5 !py-2 !px-3 text-sm !from-red-600 !to-red-500">
              {busy === 'start' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} ابدأ
            </button>
          ) : cls.status === 'live' ? (
            <button id="oc-end" type="button" disabled={busy === 'end'} onClick={doEnd} className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-extrabold text-white active:scale-95">
              {busy === 'end' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />} أنهِ الفصل
            </button>
          ) : cls.status === 'ended' ? (
            <button id="oc-reopen" type="button" disabled={busy === 'reopen'} onClick={doReopen} className="btn-secondary flex items-center gap-1.5 !py-2 !px-3 text-sm">
              {busy === 'reopen' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} إعادة فتح
            </button>
          ) : null
        ) : undefined}
      />

      {/* status strip */}
      <section className={`mb-3 rounded-2xl px-4 py-3 text-white ${cls.status === 'live' ? 'bg-gradient-to-l from-red-700 to-red-500' : cls.status === 'ended' ? 'bg-gradient-to-l from-slate-700 to-slate-500' : 'bg-gradient-to-l from-sky-700 to-sky-500'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-bold text-white/80"><Clock className="h-3.5 w-3.5" /> {fmtDateTime(cls.starts_at)} – {fmtTime(cls.ends_at)}</p>
            {cls.status === 'live' && <p className="mt-0.5 flex items-center gap-1.5 text-2xl font-extrabold tabular-nums"><Radio className="h-5 w-5 animate-pulse" /> {elapsedLabel(cls.started_at, now)}</p>}
            {cls.status === 'ended' && <p className="mt-0.5 text-sm font-extrabold">{fmtTime(cls.started_at)} → {fmtTime(cls.ended_at)} · {stats ? `${stats.totals.present} حاضر · ${stats.totals.absent} غائب` : '…'}</p>}
            {cls.status === 'scheduled' && <p className="mt-0.5 text-sm font-extrabold">{new Date(cls.starts_at) > now ? `يبدأ بعد ${elapsedLabel(now.toISOString(), new Date(cls.starts_at))}` : 'موعد البدء حان — اضغط «ابدأ»'}</p>}
            {cls.status === 'cancelled' && <p className="mt-0.5 text-sm font-extrabold">هذا الفصل ملغي</p>}
          </div>
          <div className="flex shrink-0 gap-3 text-center">
            <div><p className="text-xl font-extrabold tabular-nums">{stats?.totals.online ?? '…'}</p><p className="text-[10px] font-bold text-white/80">متصل</p></div>
            <div><p className="text-xl font-extrabold tabular-nums">{stats?.totals.entered ?? '…'}</p><p className="text-[10px] font-bold text-white/80">دخل</p></div>
            <div><p className="text-xl font-extrabold tabular-nums">{stats?.totals.eligible ?? '…'}</p><p className="text-[10px] font-bold text-white/80">مستحق</p></div>
          </div>
        </div>
      </section>

      {/* video + side panel */}
      <section className="mb-3 grid gap-3 md:grid-cols-2">
        <div>
          <StreamPlayer platform={cls.platform} url={cls.stream_url} title={cls.title} muted />
          <p className="mt-1 flex items-center justify-between text-[11px] font-bold text-slate-400">
            <span className="flex items-center gap-1"><PlatformBadge platform={cls.platform} /> {cls.stream_url ? <a href={cls.stream_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-sky-600"><ExternalLink className="h-3 w-3" /> افتح</a> : 'بدون رابط'}</span>
            {canWrite && <button type="button" onClick={() => setSettings(true)} className="flex items-center gap-1 text-slate-500"><Link2 className="h-3 w-3" /> تعديل الرابط</button>}
          </p>
        </div>

        {canWrite && cls.status === 'live' && (
          <div id="oc-check-panel" className="card border-amber-200 bg-amber-50/50">
            <p className="mb-1 flex items-center gap-1.5 text-sm font-extrabold text-amber-900"><BellRing className="h-4 w-4" /> فحص الانتباه</p>
            <p className="mb-2 text-[11px] font-bold text-amber-800/80">تظهر نافذة للمخدومين المتصلين وعليهم الضغط خلال {cls.check_seconds} ثانية. أُرسل {checks.length} من {cls.checks_required} مطلوب.</p>
            {activeCheck ? (
              <div className="rounded-xl bg-white p-3 text-center ring-1 ring-amber-200">
                <p className="text-xs font-bold text-slate-500">الفحص #{activeCheck.seq} جارٍ</p>
                <p className="text-3xl font-extrabold tabular-nums text-amber-700"><Timer className="inline h-6 w-6" /> {checkRemaining} ث</p>
                <p className="text-[11px] font-bold text-slate-400">{activeResponses} ردّ من {stats?.totals.online ?? 0} متصل</p>
              </div>
            ) : (
              <>
                <input id="oc-check-prompt" className="input-field mb-2 !py-2 text-sm" placeholder="نص اختياري: مثلاً «اضغط إن كنت تتابع»" value={checkPrompt} onChange={(e) => setCheckPrompt(e.target.value)} />
                <button id="oc-send-check" type="button" disabled={busy === 'check'} onClick={doCheck} className="btn-primary flex w-full items-center justify-center gap-2 !from-amber-600 !to-amber-500">
                  {busy === 'check' ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />} إرسال فحص انتباه الآن
                </button>
              </>
            )}
            {checks.length > 0 && (
              <p className="mt-2 flex flex-wrap gap-1">
                {checks.map((k) => <span key={k.id} className="badge bg-white text-amber-800 ring-1 ring-amber-200">#{k.seq} · {fmtTime(k.sent_at)} · {responsesOf(k.id)} ✓</span>)}
              </p>
            )}
          </div>
        )}
        {cls.status === 'scheduled' && (
          <div className="card flex flex-col justify-center text-center text-slate-500">
            <ShieldCheck className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
            <p className="text-sm font-extrabold text-slate-700">قواعد الحضور</p>
            <p className="text-xs font-bold">{rulesLabel(cls)}</p>
            {cls.attendance_points > 0 && <p className="mt-1 text-xs font-bold text-gold-700">+{cls.attendance_points} نقطة للحاضر</p>}
            {!cls.stream_url && <p className="mt-2 flex items-center justify-center gap-1 text-[11px] font-bold text-amber-600"><AlertTriangle className="h-3.5 w-3.5" /> أضف رابط البث قبل البدء</p>}
          </div>
        )}
        {cls.status === 'ended' && stats && (
          <div className="card flex flex-col justify-center">
            <p className="mb-2 text-sm font-extrabold text-slate-700">النتيجة النهائية</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-emerald-50 p-2"><p className="text-2xl font-extrabold text-emerald-700">{stats.totals.present}</p><p className="text-[10px] font-bold text-emerald-800">حاضر</p></div>
              <div className="rounded-xl bg-red-50 p-2"><p className="text-2xl font-extrabold text-red-600">{stats.totals.absent}</p><p className="text-[10px] font-bold text-red-700">غائب</p></div>
              <div className="rounded-xl bg-slate-50 p-2"><p className="text-2xl font-extrabold text-slate-600">{Math.max(0, stats.totals.eligible - stats.totals.entered)}</p><p className="text-[10px] font-bold text-slate-500">لم يدخل</p></div>
            </div>
            <p className="mt-2 text-[11px] font-bold text-slate-400">الحضور سُجِّل في سجل حضور كل مخدوم{cls.event_id ? ' للمناسبة المرتبطة' : ''}{cls.attendance_points ? ` مع +${cls.attendance_points} نقطة` : ''}. يمكنك تعديل حالة أي مخدوم يدوياً من تبويب الحضور.</p>
          </div>
        )}
      </section>

      {/* tabs */}
      <nav id="oc-tabs" className="mb-3 grid grid-cols-4 gap-1.5">
        {([
          ['participants', 'الحضور', Users, stats?.totals.entered],
          ['questions', 'الأسئلة', ListChecks, openQ || undefined],
          ['chat', 'الدردشة', MessageCircle, messages.length || undefined],
          ['settings', 'الإعدادات', Settings2, undefined],
        ] as [Tab, string, React.ComponentType<{ className?: string }>, number | undefined][]).map(([k, label, Icon, n]) => (
          <button key={k} type="button" id={`oc-tab-${k}`} onClick={() => setTab(k)}
            className={`relative flex h-11 items-center justify-center gap-1.5 rounded-xl text-xs font-extrabold transition ${tab === k ? 'bg-red-600 text-white shadow' : 'bg-white text-slate-600 border border-slate-200'}`}>
            <Icon className="h-4 w-4" /> {label}
            {n !== undefined && n > 0 && <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${tab === k ? 'bg-white/25' : 'bg-red-100 text-red-700'}`}>{n}</span>}
          </button>
        ))}
      </nav>

      {tab === 'participants' && (
        <ParticipantsTab cls={cls} stats={stats} loading={statsLoading} canWrite={canWrite} supabase={supabase} onChanged={() => { loadStats(); loadClass(); }} flash={flash} />
      )}
      {tab === 'questions' && (
        <QuestionsTab cls={cls} questions={questions} answers={answers} participants={stats?.participants ?? []} canWrite={canWrite} supabase={supabase} onChanged={loadQuestions} flash={flash} />
      )}
      {tab === 'chat' && (
        <div>
          {canWrite && (
            <div className="mb-2 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
              <span className="flex items-center gap-1"><Wifi className="h-3.5 w-3.5" /> {cls.chat_enabled ? 'الدردشة مفتوحة للمخدومين' : 'الدردشة مغلقة للمخدومين'}</span>
              <button type="button" id="oc-chat-toggle" onClick={() => patch({ chat_enabled: !cls.chat_enabled }, '')} className={`rounded-lg px-2.5 py-1 text-[11px] font-extrabold ${cls.chat_enabled ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{cls.chat_enabled ? 'أغلق الدردشة' : 'افتح الدردشة'}</button>
            </div>
          )}
          <LiveChat messages={messages} meIsServant onSend={sendMsg} onDelete={canWrite ? delMsg : undefined} disabled={cls.status === 'ended' || cls.status === 'cancelled'} disabledText="انتهى الفصل — الدردشة للقراءة فقط" />
        </div>
      )}
      {tab === 'settings' && (
        <SettingsTab
          cls={cls} canWrite={canWrite} busy={busy}
          onEdit={() => setSettings(true)}
          onCancel={() => { if (confirm('إلغاء هذا الفصل؟ لن يظهر للمخدومين.')) patch({ status: 'cancelled' }, 'أُلغي الفصل'); }}
          onUncancel={() => patch({ status: 'scheduled' }, 'عاد الفصل مجدولاً')}
          onDelete={remove}
        />
      )}

      {settings && (
        <ClassFormModal cls={cls} churches={churches} services={services} classes={classes} onClose={() => setSettings(false)} onSaved={(s) => { setCls(s); setSettings(false); flash('تم الحفظ'); }} />
      )}
      <Toast msg={toast} />
    </AppShell>
  );
}
