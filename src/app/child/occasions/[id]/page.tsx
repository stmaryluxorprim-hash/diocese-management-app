'use client';

// ---------- Child portal — one occasion ----------
// Cover · details · «أنا مشارك» (register) / «إلغاء مشاركتي» · my e-ticket
// (QR) when confirmed · my checklist progress · announcements + my status
// notifications. Data: child_portal_occasion RPC (token = card QR),
// re-fetched on realtime bumps from the shared provider.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight, Loader2, Sparkles, XCircle, Ticket, ListChecks, Megaphone, BellRing, Info, Check, Hourglass, Star, Download, CalendarCheck,
} from 'lucide-react';
import ChildShell from '@/components/child/ChildShell';
import { useChild } from '@/lib/child-context';
import { createClient } from '@/lib/supabase/client';
import { onAppResume } from '@/lib/realtime';
import {
  OccasionCover, KindBadge, OccasionStatusBadge, OccasionInfoList, TicketCard, RegStatusBadge, whenLabel, useQrDataUrl,
} from '@/components/occasions/OccasionBits';
import {
  fetchChildOccasion, childRegister, childCancel, occasionErrorMessage, occasionPhase, fmtDateTime, relativeDay,
  type ChildOccasionDetail,
} from '@/lib/occasions';

export default function ChildOccasionPage() {
  return (
    <ChildShell>
      <Content />
    </ChildShell>
  );
}

function Content() {
  const { id } = useParams<{ id: string }>();
  const { token, profile, occasions, reloadOccasions } = useChild();
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<ChildOccasionDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try { setData(await fetchChildOccasion(supabase, token, id)); setError(''); }
    catch (e) { setError(occasionErrorMessage(e, 'تعذر تحميل الفعالية')); }
  }, [supabase, token, id]);

  // initial + whenever the shared list changes (realtime bump) + on focus
  useEffect(() => { load(); }, [load, occasions]);
  useEffect(() => onAppResume(load), [load]); // 20261017120000: real resume only

  const say = (ok: boolean, text: string) => { setFlash({ ok, text }); setTimeout(() => setFlash(null), 3000); };

  const register = async () => {
    if (!token || !data) return;
    setBusy(true);
    try {
      const r = await childRegister(supabase, token, data.id);
      setData((d) => (d ? { ...d, ...r } : d));
      say(true, r.my_registration?.status === 'confirmed' ? 'تم تأكيد مشاركتك 🎟️ تذكرتك جاهزة' : 'تم استلام طلبك — بانتظار تأكيد الخادم');
      reloadOccasions();
      load();
    } catch (e) { say(false, occasionErrorMessage(e, 'تعذر التسجيل')); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!token || !data) return;
    setBusy(true); setConfirmCancel(false);
    try {
      const r = await childCancel(supabase, token, data.id);
      setData((d) => (d ? { ...d, ...r } : d));
      say(true, 'تم إلغاء مشاركتك');
      reloadOccasions();
      load();
    } catch (e) { say(false, occasionErrorMessage(e, 'تعذر الإلغاء')); }
    finally { setBusy(false); }
  };

  const qr = useQrDataUrl(data?.my_registration && data.my_registration.status !== 'cancelled' ? data.my_registration.ticket_code : null);
  const downloadTicket = () => {
    if (!qr || !data) return;
    const a = document.createElement('a');
    a.href = qr; a.download = `ticket-${data.my_registration!.ticket_code}.png`; a.click();
  };

  if (error && !data) {
    return (
      <div className="card py-12 text-center text-slate-400">
        <p className="font-bold">{error}</p>
        <Link href="/child/occasions" className="btn-primary mt-4 inline-flex !py-2 !px-4 text-sm !from-cyan-600 !to-cyan-500">رجوع إلى الفعاليات</Link>
      </div>
    );
  }
  if (!data) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-cyan-500" /></div>;

  const reg = data.my_registration && data.my_registration.status !== 'cancelled' ? data.my_registration : null;
  const phase = occasionPhase(data);
  const canCancel = reg && reg.status !== 'checked_in' && phase === 'upcoming';
  const done = data.checklist.filter((c) => c.done).length;
  const announcements = data.notifications.filter((n) => !n.mine);
  const mine = data.notifications.filter((n) => n.mine);

  return (
    <>
      <section className="mb-3 flex items-center gap-2">
        <Link href="/child/occasions" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100"><ArrowRight className="h-5 w-5" /></Link>
        <h2 className="min-w-0 flex-1 truncate text-lg font-extrabold">{data.title}</h2>
      </section>

      <OccasionCover url={data.image_url} title={data.title} kind={data.kind} className="mb-3 h-44 w-full rounded-3xl shadow-card">
        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3">
          <KindBadge kind={data.kind} />
          <OccasionStatusBadge status={data.status} o={data} />
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-4 pb-3 pt-10 text-white">
          <p className="text-xl font-extrabold drop-shadow">{data.title}</p>
          <p className="truncate text-xs text-white/80">{[data.church_name, data.service_name, data.class_name].filter(Boolean).join(' ← ')}{phase === 'upcoming' ? ` · ${relativeDay(data.starts_at)}` : ''}</p>
        </div>
      </OccasionCover>

      {flash && (
        <p id="child-occ-flash" className={`mb-3 rounded-2xl px-4 py-3 text-sm font-bold ${flash.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{flash.text}</p>
      )}

      {/* my status / action */}
      <section id="child-occ-action" className="mb-3">
        {reg ? (
          <div className="card !p-3">
            <div className="flex items-center gap-3">
              <span className={`rounded-xl p-2.5 text-white ${reg.status === 'checked_in' ? 'bg-cyan-600' : reg.status === 'confirmed' ? 'bg-emerald-600' : 'bg-amber-500'}`}>
                {reg.status === 'checked_in' ? <CalendarCheck className="h-6 w-6" /> : reg.status === 'confirmed' ? <Ticket className="h-6 w-6" /> : <Hourglass className="h-6 w-6" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-extrabold">
                  {reg.status === 'checked_in' ? 'سجّلت الدخول — استمتع! ✅' : reg.status === 'confirmed' ? 'مشاركتك مؤكدة 🎉' : 'طلبك قيد المراجعة'}
                </p>
                <p className="truncate text-xs font-bold text-slate-500">
                  {reg.status === 'pending' ? 'سيؤكد الخادم مشاركتك وتظهر تذكرتك هنا' : reg.status === 'confirmed' ? 'اعرض التذكرة للخادم عند الدخول' : reg.checked_in_at ? `الدخول: ${fmtDateTime(reg.checked_in_at)}` : ''}
                </p>
              </div>
              <RegStatusBadge status={reg.status} />
            </div>
            {canCancel && (
              confirmCancel ? (
                <div className="mt-3 flex gap-2">
                  <button type="button" disabled={busy} onClick={cancel} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-600 py-2.5 text-sm font-extrabold text-white">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} نعم، ألغِ مشاركتي
                  </button>
                  <button type="button" onClick={() => setConfirmCancel(false)} className="btn-secondary flex-1 !py-2.5 text-sm">تراجع</button>
                </div>
              ) : (
                <button id="child-occ-cancel" type="button" disabled={busy} onClick={() => setConfirmCancel(true)} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-red-50 py-2.5 text-sm font-extrabold text-red-600 hover:bg-red-100">
                  <XCircle className="h-4 w-4" /> إلغاء مشاركتي
                </button>
              )
            )}
          </div>
        ) : data.can_register ? (
          <button id="child-occ-join" type="button" disabled={busy} onClick={register}
            className="btn-primary flex w-full items-center justify-center gap-2 !from-cyan-600 !to-primary-600 !py-4 text-lg">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />} أنا مشارك!
            {data.remaining !== null && <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{data.remaining} متاح</span>}
          </button>
        ) : (
          <div className="card flex items-center gap-3 !p-3 text-slate-500">
            <Info className="h-5 w-5 shrink-0 text-slate-400" />
            <p className="text-sm font-bold">
              {data.status !== 'published' ? 'هذه الفعالية غير متاحة للتسجيل' :
                phase !== 'upcoming' ? 'بدأت الفعالية — التسجيل مغلق' :
                data.registration_deadline && new Date(data.registration_deadline) < new Date() ? 'انتهى آخر موعد للتسجيل' :
                data.remaining === 0 ? 'اكتمل العدد — لا توجد أماكن متاحة' :
                data.my_registration?.status === 'cancelled' ? 'ألغيت مشاركتك من قبل' : 'التسجيل غير متاح حالياً'}
            </p>
          </div>
        )}
      </section>

      {/* ticket */}
      {reg && (reg.status === 'confirmed' || reg.status === 'checked_in') && profile && (
        <section id="child-occ-ticket" className="mb-3">
          <TicketCard code={reg.ticket_code} personName={profile.person.name} title={data.title} when={whenLabel(data)} place={data.location} status={reg.status} />
          {qr && (
            <button type="button" onClick={downloadTicket} className="btn-secondary mt-2 flex w-full items-center justify-center gap-1.5 !py-2 text-sm">
              <Download className="h-4 w-4" /> حفظ التذكرة كصورة
            </button>
          )}
        </section>
      )}

      {/* details */}
      <section className="mb-3">
        <OccasionInfoList o={data} remaining={data.remaining} active={data.active_count} />
        {data.description && <p className="card mt-2 whitespace-pre-wrap text-sm font-bold text-slate-600">{data.description}</p>}
        {data.checkin_points > 0 && !reg && (
          <p className="mt-2 flex items-center gap-1.5 rounded-xl bg-gold-50 px-3 py-2 text-xs font-bold text-gold-700"><Star className="h-4 w-4" /> احصل على +{data.checkin_points} نقطة عند تسجيل دخولك للفعالية</p>
        )}
      </section>

      {/* checklist */}
      {reg && data.checklist.length > 0 && (
        <section id="child-occ-checklist" className="mb-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-slate-500"><ListChecks className="h-4 w-4" /> قائمة التحقق · {done} / {data.checklist.length}</h3>
          <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
            {data.checklist.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 ${c.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white'}`}>{c.done && <Check className="h-4 w-4" />}</span>
                <span className={`flex-1 text-sm font-bold ${c.done ? 'text-slate-500 line-through' : 'text-slate-700'}`}>{c.label}</span>
                {c.required && !c.done && <span className="badge bg-amber-50 text-amber-700">مطلوب</span>}
              </div>
            ))}
          </div>
          <p className="mt-1 text-[11px] font-bold text-slate-400">الخادم يعلّم العناصر عند استلامها منك.</p>
        </section>
      )}

      {/* notifications */}
      {(announcements.length > 0 || mine.length > 0) && (
        <section id="child-occ-notifications" className="mb-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-slate-500"><Megaphone className="h-4 w-4" /> الإشعارات</h3>
          <div className="space-y-2">
            {announcements.map((n) => (
              <div key={n.id} className={`card flex items-start gap-3 !p-3 ${n.kind === 'reminder' ? 'ring-1 ring-amber-100' : ''}`}>
                <span className={`rounded-xl p-2 ${n.kind === 'reminder' ? 'bg-amber-50 text-amber-600' : 'bg-cyan-50 text-cyan-600'}`}>{n.kind === 'reminder' ? <BellRing className="h-5 w-5" /> : <Megaphone className="h-5 w-5" />}</span>
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap text-sm font-bold text-slate-700">{n.body}</p>
                  <p className="mt-1 text-[11px] font-bold text-slate-400">{n.by_name ? `${n.by_name} · ` : ''}{fmtDateTime(n.created_at)}</p>
                </div>
              </div>
            ))}
            {mine.length > 0 && (
              <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
                {mine.map((n) => (
                  <div key={n.id} className="flex items-start gap-2 px-3 py-2">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                    <p className="min-w-0 flex-1 text-xs font-bold text-slate-600">{n.body}</p>
                    <span className="shrink-0 text-[10px] font-bold text-slate-400">{fmtDateTime(n.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
