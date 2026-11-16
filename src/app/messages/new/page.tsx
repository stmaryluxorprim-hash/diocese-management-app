'use client';

// ---------- MESSAGES MODULE — NEW MESSAGE (رسالة جديدة) ----------
// Step 1 — who: المخدومين | الخدام
// Step 2 — how:  (children) مخدوم / مخدومون محددون  ·  فصل / خدمة / كنيسة / كل الكنائس
//                (staff)    خدام محددون (below me)  ·  كل خدام فصل / خدمة / كنيسة / الإيبارشية
// Step 3 — text (+ picture) → chat_send (the DB re-checks every permission)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Users, UserCog, Megaphone, UserCheck, Search, Loader2, Check, Send, ImagePlus, X } from 'lucide-react';
import Image from 'next/image';
import AppShell from '@/components/AppShell';
import InfoTip from '@/components/InfoTip';
import { MessagesHeader, ChatAvatar, Toast, compressImage } from '@/components/messages/ChatBits';
import { ScopeSelectors, useScopeState, useStoreLookups } from '@/components/store/StoreBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { fetchEnrollmentsPage, ALL } from '@/lib/queries';
import { uploadPhoto } from '@/lib/upload';
import { ROLE_LABELS, type EnrollmentWithPerson } from '@/lib/types';
import {
  sendMessage, fetchStaffRecipients, fetchAudienceCount, chatErrorMessage,
  type SendTarget, type StaffRecipient,
} from '@/lib/chat';

type Mode = 'selected' | 'scope';

export default function NewMessagePage() {
  const router = useRouter();
  const qs = useSearchParams();
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { churches, services, classes } = useStoreLookups(supabase, approved);
  const scope = useScopeState();

  const [target, setTarget] = useState<SendTarget>((qs.get('target') as SendTarget) || 'children');
  const [mode, setMode] = useState<Mode>(qs.get('enrollment') ? 'selected' : 'scope');
  const [selectedEnr, setSelectedEnr] = useState<Map<string, EnrollmentWithPerson>>(new Map());
  const [selectedStaff, setSelectedStaff] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [enrollments, setEnrollments] = useState<EnrollmentWithPerson[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [staff, setStaff] = useState<StaffRecipient[] | null>(null);
  const [audience, setAudience] = useState<number | null>(null);
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3200); };

  // preselected child from the children page (?enrollment=<id>)
  useEffect(() => {
    const id = qs.get('enrollment');
    if (!id || !approved) return;
    supabase.from('enrollments')
      .select('id, person_id, church_id, service_id, class_id, attendance_count, points, created_at, person:persons(id, national_id, name, birthdate, gender, phone, address, notes, image_url)')
      .eq('id', id).maybeSingle()
      .then(({ data }) => {
        if (data) setSelectedEnr((m) => new Map(m).set(id, data as unknown as EnrollmentWithPerson));
      });
  }, [qs, approved, supabase]);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // children list (server-side scoped + search) for «selected» mode
  const loadEnrollments = useCallback(async () => {
    if (target !== 'children' || mode !== 'selected') return;
    setListLoading(true);
    try {
      const r = await fetchEnrollmentsPage(supabase, { church: scope.church, service: scope.service, classes: scope.classes }, { search, pageSize: 60 });
      setEnrollments(r.rows); setHasMore(r.hasMore);
    } finally {
      setListLoading(false);
    }
  }, [supabase, target, mode, scope.church, scope.service, scope.classes, search]);
  useEffect(() => {
    if (!approved) return;
    const t = setTimeout(loadEnrollments, 250);
    return () => clearTimeout(t);
  }, [approved, loadEnrollments]);

  // staff recipients
  useEffect(() => {
    if (!approved || target !== 'staff' || staff) return;
    fetchStaffRecipients(supabase).then(setStaff).catch(() => setStaff([]));
  }, [approved, target, staff, supabase]);

  // Effective audience scope.
  // The selectors show «ALL» (and are disabled) when only ONE option is
  // visible — e.g. a church manager sees just his church, a service manager
  // just his service. «ALL» used to be sent as NULL (= every church /
  // every service), which the DB rightly refused for non-owners
  // (scope_not_allowed → «خارج صلاحيتك») so they could never send to their
  // whole church / service. Resolve a single visible option to its id; keep
  // NULL only when there really are several (owner → «كل الكنائس»).
  const scopeIds = useMemo(() => {
    const church = scope.church !== ALL ? scope.church
      : churches.length === 1 ? churches[0].id
      : (profile && profile.role !== 'owner' ? profile.church_id : null);
    const visServices = services.filter((s) => !church || s.church_id === church);
    const service = scope.service !== ALL ? scope.service
      : church && visServices.length === 1 ? visServices[0].id
      : (church && profile && profile.role !== 'owner' && profile.service_id) || null;
    const visClasses = classes.filter((c) => (!church || c.church_id === church) && (!service || c.service_id === service));
    // MULTI-select: every chosen class gets the message ([] = the whole service / church)
    const clsList: string[] = scope.classes.length > 0 ? scope.classes
      : service && visClasses.length === 1 ? [visClasses[0].id]
      : (service && profile && profile.role !== 'owner' && profile.class_id) ? [profile.class_id]
      : [];
    return { church, service, classes: clsList, class: clsList.length === 1 ? clsList[0] : null };
  }, [scope.church, scope.service, scope.classes, churches, services, classes, profile]);
  useEffect(() => {
    if (!approved || mode !== 'scope') return;
    setAudience(null);
    // the RPC counts ONE class → sum the chosen classes (a person is in one class of a service per enrollment)
    const targets: (string | null)[] = scopeIds.classes.length > 0 ? scopeIds.classes : [null];
    Promise.all(targets.map((c) => fetchAudienceCount(supabase, target, scopeIds.church, scopeIds.service, c)))
      .then((counts) => setAudience(counts.reduce((a, b) => a + b, 0)))
      .catch(() => setAudience(0));
  }, [approved, mode, target, scopeIds, supabase]);

  const scopeAllowed = useMemo(() => {
    if (!profile) return false;
    if (profile.role === 'owner') return true;
    if (!scopeIds.church || scopeIds.church !== profile.church_id) return false;
    if (profile.role === 'church_manager') return true;
    if (profile.service_id && scopeIds.service !== profile.service_id) return false;
    if (profile.role === 'service_manager') return true;
    if (profile.class_id && scopeIds.classes.some((c) => c !== profile.class_id)) return false;
    if (profile.class_id && scopeIds.classes.length === 0) return false;
    return true;
  }, [profile, scopeIds]);

  const audienceLabel = useMemo(() => {
    if (!scopeIds.church) return 'كل الكنائس';
    const ch = churches.find((c) => c.id === scopeIds.church)?.name ?? '';
    if (!scopeIds.service) return `كنيسة ${ch}`;
    const sv = services.find((s) => s.id === scopeIds.service)?.name ?? '';
    if (scopeIds.classes.length === 0) return `خدمة ${sv} — ${ch}`;
    const cl = scopeIds.classes.map((id) => classes.find((c) => c.id === id)?.name ?? '').filter(Boolean).join('، ');
    return `فصل ${cl} — ${sv}`;
  }, [scopeIds, churches, services, classes]);

  const filteredStaff = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (staff ?? []).filter((t) => !s || [t.full_name, t.class_name, t.service_name, t.church_name].filter(Boolean).join(' ').toLowerCase().includes(s));
  }, [staff, search]);

  const recipientsCount = mode === 'selected'
    ? (target === 'children' ? selectedEnr.size : selectedStaff.size)
    : (audience ?? 0);
  const canSend = !busy && (body.trim().length > 0 || !!file) && (
    mode === 'selected' ? recipientsCount > 0 : scopeAllowed
  );

  const submit = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      let image_url: string | null = null;
      if (file) image_url = await uploadPhoto(supabase, 'messages', await compressImage(file), 'msg.webp');
      const sendOne = (payload: Parameters<typeof sendMessage>[1]) => sendMessage(supabase, payload);
      let res: { sent: number; message_ids: string[] };
      if (mode === 'selected') {
        res = await sendOne(target === 'children'
          ? { target, body: body.trim(), image_url, enrollment_ids: Array.from(selectedEnr.keys()) }
          : { target, body: body.trim(), image_url, profile_ids: Array.from(selectedStaff) });
      } else {
        // the RPC addresses ONE class → one announcement per chosen class
        const targets: (string | null)[] = scopeIds.classes.length > 0 ? scopeIds.classes : [null];
        res = { sent: 0, message_ids: [] };
        for (const c of targets) {
          const r = await sendOne({ target, body: body.trim(), image_url, church_id: scopeIds.church, service_id: scopeIds.service, class_id: c });
          res = { sent: res.sent + r.sent, message_ids: [...res.message_ids, ...r.message_ids] };
        }
      }
      flash(mode === 'scope' ? `تم إرسال الإعلان إلى ${audienceLabel} ✅` : `تم الإرسال إلى ${res.sent} ${target === 'children' ? 'مخدوم' : 'خادم'} ✅`);
      setTimeout(() => {
        if (mode === 'selected' && res.sent === 1) {
          const id = target === 'children' ? Array.from(selectedEnr.keys())[0] : Array.from(selectedStaff)[0];
          router.replace(`/messages/${encodeURIComponent((target === 'children' ? 'e:' : 's:') + id)}`);
        } else {
          router.replace(mode === 'scope' ? '/messages/b' : '/messages');
        }
      }, 700);
    } catch (e) {
      flash(chatErrorMessage(e, 'تعذر الإرسال'));
    } finally {
      setBusy(false);
    }
  };

  const toggleEnr = (e: EnrollmentWithPerson) => setSelectedEnr((m) => { const n = new Map(m); if (n.has(e.id)) n.delete(e.id); else n.set(e.id, e); return n; });
  const toggleStaff = (id: string) => setSelectedStaff((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <AppShell>
      <MessagesHeader title="رسالة جديدة" back="/messages" />

      {/* Step 1 — who */}
      <section className="card mb-3 !p-3">
        <p className="mb-2 text-xs font-extrabold text-slate-500">١ · إلى من؟</p>
        <div className="grid grid-cols-2 gap-2">
          <button id="new-target-children" type="button" onClick={() => { setTarget('children'); setSearch(''); }} aria-pressed={target === 'children'}
            className={`flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-extrabold transition active:scale-95 ${target === 'children' ? 'bg-emerald-600 text-white shadow ring-2 ring-emerald-300' : 'border border-slate-200 bg-white text-slate-600'}`}>
            <Users className="h-5 w-5" /> المخدومين
          </button>
          <button id="new-target-staff" type="button" onClick={() => { setTarget('staff'); setSearch(''); }} aria-pressed={target === 'staff'}
            className={`flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-extrabold transition active:scale-95 ${target === 'staff' ? 'bg-sky-600 text-white shadow ring-2 ring-sky-300' : 'border border-slate-200 bg-white text-slate-600'}`}>
            <UserCog className="h-5 w-5" /> الخدام
          </button>
        </div>
      </section>

      {/* Step 2 — how */}
      <section className="card mb-3 !p-3">
        <p className="mb-2 text-xs font-extrabold text-slate-500">٢ · الطريقة</p>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <button id="new-mode-selected" type="button" onClick={() => setMode('selected')} aria-pressed={mode === 'selected'}
            className={`flex h-11 items-center justify-center gap-2 rounded-xl text-xs font-extrabold transition active:scale-95 ${mode === 'selected' ? 'bg-primary-600 text-white shadow ring-2 ring-primary-300' : 'border border-slate-200 bg-white text-slate-600'}`}>
            <UserCheck className="h-4 w-4" /> {target === 'children' ? 'مخدوم / مخدومون محددون' : 'خادم / خدام محددون'}
          </button>
          <button id="new-mode-scope" type="button" onClick={() => setMode('scope')} aria-pressed={mode === 'scope'}
            className={`flex h-11 items-center justify-center gap-2 rounded-xl text-xs font-extrabold transition active:scale-95 ${mode === 'scope' ? 'bg-violet-600 text-white shadow ring-2 ring-violet-300' : 'border border-slate-200 bg-white text-slate-600'}`}>
            <Megaphone className="h-4 w-4" /> إعلان لنطاق كامل
          </button>
        </div>

        {mode === 'scope' ? (
          <>
            <ScopeSelectors idPrefix="new-scope" scope={scope} churches={churches} services={services} classes={classes} />
            <div className={`-mt-1 flex items-center justify-between rounded-xl px-3 py-2 text-xs font-bold ${scopeAllowed ? 'bg-violet-50 text-violet-800' : 'bg-amber-50 text-amber-700'}`}>
              <span className="flex items-center gap-1.5"><Megaphone className="h-4 w-4" /> {audienceLabel}</span>
              <span className="flex items-center gap-1 tabular-nums">
                {!scopeAllowed ? 'خارج صلاحيتك' : audience === null ? '…' : `${audience} ${target === 'children' ? 'مخدوم' : 'خادم'}`}
                {!scopeAllowed && (
                  <InfoTip size="xs" title="حدود الإرسال" tone="text-amber-600 hover:bg-amber-100">
                    {profile?.role === 'church_manager' ? 'مدير الكنيسة يرسل لكنيسته أو لخدمة / فصل داخلها.' :
                     profile?.role === 'service_manager' ? 'مسؤول الخدمة يرسل لخدمته أو لفصل داخلها.' :
                     'خادم الفصل يرسل لفصله فقط. الإرسال لكل الكنائس لمالك التطبيق.'}
                  </InfoTip>
                )}
              </span>
            </div>
          </>
        ) : (
          <>
            {target === 'children' && (
              <ScopeSelectors idPrefix="new-pick" scope={scope} churches={churches} services={services} classes={classes} />
            )}
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input id="new-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={target === 'children' ? 'بحث بالاسم / الهاتف / الرقم القومي…' : 'بحث باسم الخادم…'} className="input-field !py-2.5 !pr-9" />
            </div>

            {/* selected chips */}
            {recipientsCount > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {target === 'children'
                  ? Array.from(selectedEnr.values()).map((e) => (
                    <button key={e.id} type="button" onClick={() => toggleEnr(e)} className="badge bg-emerald-100 text-emerald-800">
                      {e.person.name} <X className="h-3 w-3" />
                    </button>
                  ))
                  : Array.from(selectedStaff).map((id) => {
                    const t = staff?.find((x) => x.id === id);
                    return (
                      <button key={id} type="button" onClick={() => toggleStaff(id)} className="badge bg-sky-100 text-sky-800">
                        {t?.full_name ?? '…'} <X className="h-3 w-3" />
                      </button>
                    );
                  })}
              </div>
            )}

            <div id="new-picker" className="max-h-72 overflow-y-auto rounded-xl border border-slate-100">
              {target === 'children' ? (
                listLoading && enrollments.length === 0 ? (
                  <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
                ) : enrollments.length === 0 ? (
                  <p className="py-6 text-center text-xs font-bold text-slate-400">لا يوجد مخدومون في هذا النطاق</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {enrollments.length > 1 && (
                      <li>
                        <button type="button" onClick={() => setSelectedEnr((m) => { const n = new Map(m); const allIn = enrollments.every((e) => n.has(e.id)); enrollments.forEach((e) => allIn ? n.delete(e.id) : n.set(e.id, e)); return n; })}
                          className="flex w-full items-center gap-2 px-3 py-2 text-xs font-extrabold text-primary-700 hover:bg-primary-50">
                          <Check className="h-4 w-4" /> {enrollments.every((e) => selectedEnr.has(e.id)) ? 'إلغاء تحديد الكل' : `تحديد الكل (${enrollments.length})`}
                        </button>
                      </li>
                    )}
                    {enrollments.map((e) => {
                      const on = selectedEnr.has(e.id);
                      return (
                        <li key={e.id}>
                          <button type="button" onClick={() => toggleEnr(e)} className={`flex w-full items-center gap-3 px-3 py-2 text-right transition ${on ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
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
                )
              ) : staff === null ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
              ) : filteredStaff.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs font-bold text-slate-400">لا يوجد خدام تابعون لك — يمكنك مراسلة الخدام الذين تحت مسؤوليتك في التسلسل، أو الرد على من راسلك</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {filteredStaff.map((t) => {
                    const on = selectedStaff.has(t.id);
                    return (
                      <li key={t.id}>
                        <button type="button" onClick={() => toggleStaff(t.id)} className={`flex w-full items-center gap-3 px-3 py-2 text-right transition ${on ? 'bg-sky-50' : 'hover:bg-slate-50'}`}>
                          <ChatAvatar url={t.photo_url} name={t.full_name} size={36} tone="sky" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-extrabold text-slate-800">{t.full_name}</span>
                            <span className="block truncate text-[11px] font-bold text-slate-400">{ROLE_LABELS[t.role]} · {t.class_name ?? t.service_name ?? t.church_name ?? ''}</span>
                          </span>
                          <span className={`flex h-6 w-6 items-center justify-center rounded-full border ${on ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300'}`}>{on && <Check className="h-4 w-4" />}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </section>

      {/* Step 3 — text */}
      <section className="card mb-3 !p-3">
        <p className="mb-2 text-xs font-extrabold text-slate-500">٣ · الرسالة</p>
        <textarea
          id="new-body"
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4000}
          placeholder={mode === 'scope' ? 'نص الإعلان…' : 'نص الرسالة…'}
          className="input-field resize-y leading-relaxed"
        />
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
          <span className="mr-auto text-[11px] font-bold text-slate-400 tabular-nums">{body.length}/4000</span>
        </div>
      </section>

      <button
        id="new-send"
        type="button"
        onClick={submit}
        disabled={!canSend}
        className={`btn-primary flex w-full items-center justify-center gap-2 ${mode === 'scope' ? '!from-violet-600 !to-violet-500' : target === 'children' ? '!from-emerald-600 !to-emerald-500' : '!from-sky-600 !to-sky-500'}`}
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : mode === 'scope' ? <Megaphone className="h-5 w-5" /> : <Send className="h-5 w-5 -scale-x-100" />}
        {mode === 'scope'
          ? `إرسال الإعلان إلى ${audienceLabel}${audience !== null && scopeAllowed ? ` (${audience})` : ''}`
          : `إرسال إلى ${recipientsCount} ${target === 'children' ? 'مخدوم' : 'خادم'}`}
      </button>

      <Toast msg={toast} />
    </AppShell>
  );
}
