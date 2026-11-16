'use client';

// ---------- NOTIFICATIONS MODULE — NEW (إشعار جديد) ----------
// 1 · content: title · message · optional image · optional in-app link
// 2 · recipients: كل الكنائس (owner) / كنيسة / خدمة / فصل / مجموعتي / مخدوم محدد
//     (+ audience المخدومين | الخدام) — the recipients count is shown live
// 3 · send now or schedule (date + time) → notif_send (the DB re-checks
//     every permission) → kick the push dispatcher.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import {
  Bell, Send, Clock, Users, UserCog, Church, Layers, School, HeartHandshake, UserCheck, Globe,
  ImagePlus, X, Search, Check, Loader2, Link2, CalendarClock, Eye,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import InfoTip from '@/components/InfoTip';
import { NotifHeader, Toast } from '@/components/notifications/NotifBits';
import { ScopeSelectors, useScopeState, useStoreLookups } from '@/components/store/StoreBits';
import { ChatAvatar, compressImage } from '@/components/messages/ChatBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { fetchEnrollmentsPage, ALL } from '@/lib/queries';
import { uploadPhoto } from '@/lib/upload';
import { kickDispatcher } from '@/lib/push';
import type { EnrollmentWithPerson } from '@/lib/types';
import {
  sendNotification, fetchAudienceCount, notifErrorMessage, localInputToISO, LINK_PRESETS,
  type NotifTargetKind, type NotifAudience,
} from '@/lib/notifications';

type When = 'now' | 'later';

const KINDS: { value: NotifTargetKind; label: string; icon: typeof Users; ownerOnly?: boolean; childrenOnly?: boolean }[] = [
  { value: 'all', label: 'كل الكنائس', icon: Globe, ownerOnly: true },
  { value: 'church', label: 'كنيسة', icon: Church },
  { value: 'service', label: 'خدمة', icon: Layers },
  { value: 'class', label: 'فصل', icon: School },
  { value: 'group', label: 'مجموعتي', icon: HeartHandshake, childrenOnly: true },
  { value: 'person', label: 'مخدوم محدد', icon: UserCheck, childrenOnly: true },
];

function defaultLocalDateTime(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function NewNotificationPage() {
  const router = useRouter();
  const qs = useSearchParams();
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const isOwner = profile?.role === 'owner';
  const { churches, services, classes } = useStoreLookups(supabase, approved);
  const scope = useScopeState();

  // 1 · content
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [linkPreset, setLinkPreset] = useState('');
  const [linkCustom, setLinkCustom] = useState('');

  // 2 · recipients
  const [audience, setAudience] = useState<NotifAudience>('children');
  const [kind, setKind] = useState<NotifTargetKind>(qs.get('enrollment') ? 'person' : 'class');
  const [selected, setSelected] = useState<Map<string, EnrollmentWithPerson>>(new Map());
  const [search, setSearch] = useState('');
  const [enrollments, setEnrollments] = useState<EnrollmentWithPerson[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);

  // 3 · when
  const [when, setWhen] = useState<When>('now');
  const [at, setAt] = useState(defaultLocalDateTime);

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  // preselected child (?enrollment=<id>)
  useEffect(() => {
    const id = qs.get('enrollment');
    if (!id || !approved) return;
    supabase.from('enrollments')
      .select('id, person_id, church_id, service_id, class_id, attendance_count, points, created_at, person:persons(id, national_id, name, birthdate, gender, phone, address, notes, image_url)')
      .eq('id', id).maybeSingle()
      .then(({ data }) => { if (data) setSelected((m) => new Map(m).set(id, data as unknown as EnrollmentWithPerson)); });
  }, [qs, approved, supabase]);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // resolve «ALL» selectors to the single visible option (same rule as the messages module)
  const scopeIds = useMemo(() => {
    const church = scope.church !== ALL ? scope.church
      : churches.length === 1 ? churches[0].id
      : (profile && profile.role !== 'owner' ? profile.church_id : null);
    const visServices = services.filter((s) => !church || s.church_id === church);
    const service = scope.service !== ALL ? scope.service
      : church && visServices.length === 1 ? visServices[0].id
      : (church && profile && profile.role !== 'owner' && profile.service_id) || null;
    const visClasses = classes.filter((c) => (!church || c.church_id === church) && (!service || c.service_id === service));
    // MULTI-select: every chosen class gets the notification
    const clsList: string[] = scope.classes.length > 0 ? scope.classes
      : service && visClasses.length === 1 ? [visClasses[0].id]
      : (service && profile && profile.role !== 'owner' && profile.class_id) ? [profile.class_id]
      : [];
    return { church, service, classes: clsList, class: clsList.length === 1 ? clsList[0] : null };
  }, [scope.church, scope.service, scope.classes, churches, services, classes, profile]);

  // the effective target for the chosen kind
  const target = useMemo(() => {
    const base = { audience, target_kind: kind } as const;
    if (kind === 'all') return { ...base };
    if (kind === 'church') return { ...base, church_id: scopeIds.church };
    if (kind === 'service') return { ...base, church_id: scopeIds.church, service_id: scopeIds.service };
    if (kind === 'class') return { ...base, church_id: scopeIds.church, service_id: scopeIds.service, class_id: scopeIds.classes[0] ?? null };
    if (kind === 'group') return { ...base };
    return { ...base, enrollment_ids: Array.from(selected.keys()) };
  }, [kind, audience, scopeIds, selected]);

  const scopeMissing =
    (kind === 'church' && !scopeIds.church) ||
    (kind === 'service' && !scopeIds.service) ||
    (kind === 'class' && scopeIds.classes.length === 0);

  // live recipients count
  useEffect(() => {
    if (!approved) return;
    if (kind === 'person' && selected.size === 0) { setAudienceCount(0); return; }
    if (scopeMissing) { setAudienceCount(null); return; }
    setAudienceCount(null);
    const t = setTimeout(() => {
      // 'class' kind: the RPC counts ONE class → sum the chosen classes
      const targets = kind === 'class' ? scopeIds.classes.map((c) => ({ ...target, class_id: c })) : [target];
      Promise.all(targets.map((tg) => fetchAudienceCount(supabase, tg)))
        .then((counts) => setAudienceCount(counts.reduce((a, b) => a + b, 0)))
        .catch(() => setAudienceCount(0));
    }, 200);
    return () => clearTimeout(t);
  }, [approved, supabase, target, kind, selected.size, scopeMissing, scopeIds.classes]);

  // children list for «مخدوم محدد»
  const loadEnrollments = useCallback(async () => {
    if (kind !== 'person') return;
    setListLoading(true);
    try {
      const r = await fetchEnrollmentsPage(supabase, { church: scope.church, service: scope.service, classes: scope.classes }, { search, pageSize: 60 });
      setEnrollments(r.rows); setHasMore(r.hasMore);
    } finally { setListLoading(false); }
  }, [supabase, kind, scope.church, scope.service, scope.classes, search]);
  useEffect(() => {
    if (!approved) return;
    const t = setTimeout(loadEnrollments, 250);
    return () => clearTimeout(t);
  }, [approved, loadEnrollments]);

  const targetLabel = useMemo(() => {
    if (kind === 'all') return audience === 'staff' ? 'كل الخدام' : 'كل الكنائس';
    if (kind === 'group') return 'مجموعتي (الأشابين)';
    if (kind === 'person') return selected.size === 1 ? Array.from(selected.values())[0].person.name : `${selected.size} مخدوم`;
    const ch = churches.find((c) => c.id === scopeIds.church)?.name ?? '';
    if (kind === 'church') return ch ? `كنيسة ${ch}` : 'اختر الكنيسة';
    const sv = services.find((s) => s.id === scopeIds.service)?.name ?? '';
    if (kind === 'service') return sv ? `خدمة ${sv}` : 'اختر الخدمة';
    const cl = scopeIds.classes.map((id) => classes.find((c) => c.id === id)?.name ?? '').filter(Boolean).join('، ');
    return cl ? `${scopeIds.classes.length > 1 ? 'فصول' : 'فصل'} ${cl}` : 'اختر الفصل';
  }, [kind, audience, selected, churches, services, classes, scopeIds]);

  const linkValue = linkPreset === 'custom' ? linkCustom.trim() : linkPreset;
  const linkOk = !linkValue || linkValue.startsWith('/') || linkValue.startsWith('https://');
  const canSend = !busy && title.trim().length > 0 && linkOk && !scopeMissing
    && (kind !== 'person' || selected.size > 0)
    && (when === 'now' || !!localInputToISO(at));

  const toggle = (e: EnrollmentWithPerson) => setSelected((m) => { const n = new Map(m); if (n.has(e.id)) n.delete(e.id); else n.set(e.id, e); return n; });

  const submit = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      let image_url: string | null = null;
      if (file) image_url = await uploadPhoto(supabase, 'notifications', await compressImage(file), 'notif.webp');
      const common = {
        title: title.trim(), body: body.trim(), image_url, link_url: linkValue || null,
        scheduled_at: when === 'later' ? localInputToISO(at) : null,
      };
      // 'class' kind: the RPC addresses ONE class → one notification per chosen class
      const targets = kind === 'class' ? scopeIds.classes.map((c) => ({ ...target, class_id: c })) : [target];
      let res = await sendNotification(supabase, { ...common, ...targets[0] });
      let recipientsTotal = res.recipients_count ?? 0;
      for (const tg of targets.slice(1)) {
        const r = await sendNotification(supabase, { ...common, ...tg });
        recipientsTotal += r.recipients_count ?? 0;
        if (r.status === 'failed' && res.status !== 'failed') res = r;
      }
      res = { ...res, recipients_count: recipientsTotal };
      if (res.status === 'scheduled') flash(`تمت الجدولة إلى ${targetLabel} ⏰`);
      else if (res.status === 'failed') flash('لا يوجد مستلمون في هذا النطاق');
      else { flash(`تم الإرسال إلى ${res.recipients_count} مستلم ✅`); kickDispatcher({ force: true }); }
      setTimeout(() => router.replace('/notifications'), 800);
    } catch (e) {
      flash(notifErrorMessage(e, 'تعذر الإرسال'));
    } finally { setBusy(false); }
  };

  const visibleKinds = KINDS.filter((k) => (!k.ownerOnly || isOwner) && (!k.childrenOnly || audience === 'children'));

  return (
    <AppShell>
      <NotifHeader title="إشعار جديد" />

      {/* 1 · content */}
      <section className="card mb-3 !p-3">
        <p className="mb-2 text-xs font-extrabold text-slate-500">١ · محتوى الإشعار</p>
        <input id="notif-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
          placeholder="العنوان (مثال: تذكير بالقداس)" className="input-field mb-2 font-extrabold" />
        <textarea id="notif-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000}
          placeholder="نص الإشعار…" className="input-field resize-y leading-relaxed" />
        <div className="mt-2 flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-600 hover:bg-slate-200">
            <ImagePlus className="h-4 w-4" /> صورة
            <input type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {preview && (
            <div className="flex items-center gap-1.5">
              <div className="relative h-10 w-10 overflow-hidden rounded-lg ring-1 ring-slate-200"><Image src={preview} alt="" fill sizes="40px" className="object-cover" unoptimized /></div>
              <button type="button" onClick={() => setFile(null)} className="rounded-full bg-slate-100 p-1 text-slate-500"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}
          <span className="mr-auto text-[11px] font-bold text-slate-400 tabular-nums">{title.length}/120 · {body.length}/1000</span>
        </div>
        <div className="mt-3">
          <p className="mb-1 flex items-center gap-1 text-[11px] font-extrabold text-slate-500"><Link2 className="h-3.5 w-3.5" /> يفتح صفحة (اختياري)</p>
          <div className="grid grid-cols-2 gap-2">
            <select id="notif-link" value={linkPreset} onChange={(e) => setLinkPreset(e.target.value)} className="input-field appearance-none !py-2.5 text-xs font-bold">
              {LINK_PRESETS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              <option value="custom">رابط آخر…</option>
            </select>
            {linkPreset === 'custom' && (
              <input value={linkCustom} onChange={(e) => setLinkCustom(e.target.value)} placeholder="/child/… أو https://…" dir="ltr"
                className={`input-field !py-2.5 text-xs ${!linkOk ? '!border-red-300' : ''}`} />
            )}
          </div>
          {!linkOk && <p className="mt-1 text-[11px] font-bold text-red-600">الرابط يجب أن يبدأ بـ / أو https://</p>}
        </div>
      </section>

      {/* 2 · recipients */}
      <section className="card mb-3 !p-3">
        <p className="mb-2 text-xs font-extrabold text-slate-500">٢ · إلى من؟</p>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <button id="notif-aud-children" type="button" onClick={() => { setAudience('children'); }} aria-pressed={audience === 'children'}
            className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-extrabold transition active:scale-95 ${audience === 'children' ? 'bg-emerald-600 text-white shadow ring-2 ring-emerald-300' : 'border border-slate-200 bg-white text-slate-600'}`}>
            <Users className="h-5 w-5" /> المخدومين
          </button>
          <button id="notif-aud-staff" type="button" onClick={() => { setAudience('staff'); if (kind === 'group' || kind === 'person') setKind('class'); }} aria-pressed={audience === 'staff'}
            className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-extrabold transition active:scale-95 ${audience === 'staff' ? 'bg-sky-600 text-white shadow ring-2 ring-sky-300' : 'border border-slate-200 bg-white text-slate-600'}`}>
            <UserCog className="h-5 w-5" /> الخدام
          </button>
        </div>

        <div className="mb-3 grid grid-cols-3 gap-2">
          {visibleKinds.map((k) => {
            const Icon = k.icon;
            const on = kind === k.value;
            return (
              <button key={k.value} id={`notif-kind-${k.value}`} type="button" onClick={() => setKind(k.value)} aria-pressed={on}
                className={`flex h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-extrabold transition active:scale-95 ${on ? 'bg-indigo-600 text-white shadow ring-2 ring-indigo-300' : 'border border-slate-200 bg-white text-slate-600'}`}>
                <Icon className="h-5 w-5" /> {k.label}
              </button>
            );
          })}
        </div>

        {(kind === 'church' || kind === 'service' || kind === 'class' || kind === 'person') && (
          <ScopeSelectors idPrefix="notif-scope" scope={scope} churches={churches} services={services} classes={classes} />
        )}

        {kind === 'group' && (
          <p className="mb-3 flex items-center gap-1 px-1 text-[11px] font-bold text-teal-700">
            الإرسال لمجموعتي <InfoTip size="xs" title="مجموعتي" tone="text-teal-500 hover:bg-teal-50">يصل الإشعار إلى المخدومين الذين اخترتهم في مجموعتك من وحدة الأشابين.</InfoTip>
          </p>
        )}

        {kind === 'person' && (
          <>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input id="notif-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم / الهاتف / الرقم القومي…" className="input-field !py-2.5 !pr-9" />
            </div>
            {selected.size > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {Array.from(selected.values()).map((e) => (
                  <button key={e.id} type="button" onClick={() => toggle(e)} className="badge bg-emerald-100 text-emerald-800">
                    {e.person.name} <X className="h-3 w-3" />
                  </button>
                ))}
              </div>
            )}
            <div id="notif-picker" className="max-h-72 overflow-y-auto rounded-xl border border-slate-100">
              {listLoading && enrollments.length === 0 ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
              ) : enrollments.length === 0 ? (
                <p className="py-6 text-center text-xs font-bold text-slate-400">لا يوجد مخدومون في هذا النطاق</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {enrollments.length > 1 && (
                    <li>
                      <button type="button" onClick={() => setSelected((m) => { const n = new Map(m); const allIn = enrollments.every((e) => n.has(e.id)); enrollments.forEach((e) => allIn ? n.delete(e.id) : n.set(e.id, e)); return n; })}
                        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-extrabold text-primary-700 hover:bg-primary-50">
                        <Check className="h-4 w-4" /> {enrollments.every((e) => selected.has(e.id)) ? 'إلغاء تحديد الكل' : `تحديد الكل (${enrollments.length})`}
                      </button>
                    </li>
                  )}
                  {enrollments.map((e) => {
                    const on = selected.has(e.id);
                    return (
                      <li key={e.id}>
                        <button type="button" onClick={() => toggle(e)} className={`flex w-full items-center gap-3 px-3 py-2 text-right transition ${on ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
                          <ChatAvatar url={e.person.image_url} name={e.person.name} size={36} tone="emerald" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-extrabold text-slate-800">{e.person.name}</span>
                            <span className="block truncate text-[11px] font-bold text-slate-400">{classes.find((c) => c.id === e.class_id)?.name ?? ''} · {services.find((s) => s.id === e.service_id)?.name ?? ''}</span>
                          </span>
                          <span className={`flex h-6 w-6 items-center justify-center rounded-full border ${on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300'}`}>{on && <Check className="h-4 w-4" />}</span>
                        </button>
                      </li>
                    );
                  })}
                  {hasMore && <li className="py-2 text-center text-[11px] font-bold text-slate-400">ضيّق البحث لعرض المزيد…</li>}
                </ul>
              )}
            </div>
          </>
        )}

        {/* recipients count */}
        <div id="notif-audience" className={`mt-2 flex items-center justify-between rounded-xl px-3 py-2 text-xs font-bold ${
          scopeMissing ? 'bg-amber-50 text-amber-700' : audienceCount === 0 ? 'bg-red-50 text-red-700' : 'bg-indigo-50 text-indigo-800'}`}>
          <span className="flex items-center gap-1.5"><Users className="h-4 w-4" /> {targetLabel}</span>
          <span className="tabular-nums">
            {scopeMissing ? 'اختر النطاق' : audienceCount === null ? '…' : `سيصل إلى ${audienceCount} ${audience === 'staff' ? 'خادم' : 'مخدوم'}`}
          </span>
        </div>
      </section>

      {/* 3 · when */}
      <section className="card mb-3 !p-3">
        <p className="mb-2 text-xs font-extrabold text-slate-500">٣ · موعد الإرسال</p>
        <div className="grid grid-cols-2 gap-2">
          <button id="notif-when-now" type="button" onClick={() => setWhen('now')} aria-pressed={when === 'now'}
            className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-extrabold transition active:scale-95 ${when === 'now' ? 'bg-indigo-600 text-white shadow ring-2 ring-indigo-300' : 'border border-slate-200 bg-white text-slate-600'}`}>
            <Send className="h-4 w-4 -scale-x-100" /> إرسال الآن
          </button>
          <button id="notif-when-later" type="button" onClick={() => setWhen('later')} aria-pressed={when === 'later'}
            className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-extrabold transition active:scale-95 ${when === 'later' ? 'bg-amber-500 text-white shadow ring-2 ring-amber-300' : 'border border-slate-200 bg-white text-slate-600'}`}>
            <CalendarClock className="h-4 w-4" /> جدولة لاحقاً
          </button>
        </div>
        {when === 'later' && (
          <div className="mt-3">
            <label className="mb-1 block text-[11px] font-extrabold text-slate-500">التاريخ والوقت</label>
            <input id="notif-at" type="datetime-local" value={at} min={defaultLocalDateTime().slice(0, 16)} onChange={(e) => setAt(e.target.value)} className="input-field !py-2.5 text-sm tabular-nums" />
            <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-slate-400"><Clock className="h-3.5 w-3.5" /> بتوقيت جهازك — سيُرسل تلقائياً في موعده</p>
          </div>
        )}
      </section>

      {/* preview */}
      {title.trim() && (
        <section className="mb-3 rounded-2xl border border-dashed border-indigo-200 bg-white/70 p-3">
          <p className="mb-2 flex items-center gap-1 text-[11px] font-extrabold text-slate-400"><Eye className="h-3.5 w-3.5" /> معاينة على الجهاز</p>
          <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 shadow-sm">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white"><Bell className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-extrabold text-slate-900">{title}</p>
              {body && <p className="mt-0.5 whitespace-pre-line text-xs text-slate-600 line-clamp-3">{body}</p>}
              {preview && <div className="relative mt-2 h-24 w-full overflow-hidden rounded-lg"><Image src={preview} alt="" fill sizes="400px" className="object-cover" unoptimized /></div>}
            </div>
          </div>
        </section>
      )}

      <button id="notif-send" type="button" onClick={submit} disabled={!canSend}
        className={`btn-primary flex w-full items-center justify-center gap-2 ${when === 'later' ? '!from-amber-600 !to-amber-500' : '!from-indigo-600 !to-indigo-500'}`}>
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : when === 'later' ? <CalendarClock className="h-5 w-5" /> : <Send className="h-5 w-5 -scale-x-100" />}
        {when === 'later' ? 'جدولة الإشعار' : 'إرسال الآن'}
        {audienceCount !== null && !scopeMissing && <span className="tabular-nums opacity-80">({audienceCount})</span>}
      </button>

      <Toast msg={toast} />
    </AppShell>
  );
}
