'use client';

// ---------- دعوة تسجيل (QR) — 20261004120000 · 20261007120000 ----------
// التسجيل (خادم · مخدوم · كاهن) لا يُفتح إلا برابط يحمل دعوة صالحة تُولَّد هنا.
// الرابط يحمل رمزاً عشوائياً (sha256 + الرمز نفسه في signup_invites — يقرأه
// منشئ الدعوة / المالك فقط) له صلاحية وعدد استخدامات.
// منذ 20261007120000 الرابط لا يختفي عند الرجوع للصفحة: الدعوة النشطة الأحدث
// تُعرض تلقائياً، وكل دعوة في القائمة يمكن عرضها (QR + رابط) وتعديلها
// (الصلاحية · الاستخدامات · الملاحظة · إعادة التفعيل) وإلغاؤها وحذفها.

import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  Copy, Check, Share2, Link2, Ticket, Ban, RefreshCw, Loader2, Eye, Pencil, Trash2, RotateCcw, X, Save,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import type { Church, Service, ClassRoom } from '@/lib/types';
import {
  type AccountKind, type SignupInvite,
  createSignupInvite, fetchMyInvites, revokeSignupInvite, updateSignupInvite, deleteSignupInvite,
  inviteUsable, inviteUrlFor, accountErrorMessage,
} from '@/lib/accounts';

const KIND_LABEL: Record<AccountKind, string> = { servant: 'خادم', child: 'مخدوم', priest: 'كاهن' };
const KIND_COLOR: Record<AccountKind, string> = { servant: '#1e3a8a', child: '#92400e', priest: '#581c87' };

const DAYS_OPTIONS = [1, 3, 7, 14, 30];
const USES_OPTIONS: Array<{ v: number | null; l: string }> = [
  { v: 1, l: 'مرة واحدة' }, { v: 5, l: '٥ مرات' }, { v: 20, l: '٢٠ مرة' }, { v: 100, l: '١٠٠ مرة' }, { v: null, l: 'بلا حد' },
];

const fmtDate = (s: string) => new Date(s).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

interface Props {
  kind: AccountKind;
  /** إخفاء اختيار النطاق (دعوة الكاهن مثلاً) */
  hideScope?: boolean;
}

export default function SignupInvitePanel({ kind, hideScope = false }: Props) {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());

  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);

  const [churchId, setChurchId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [classId, setClassId] = useState('');
  const [days, setDays] = useState(7);
  const [maxUses, setMaxUses] = useState<number | null>(kind === 'priest' ? 1 : 20);
  const [note, setNote] = useState('');

  const [generating, setGenerating] = useState(false);
  // the invite shown in the QR card: the one just generated, the one picked
  // from the list, or (on reopen) the newest usable invite that has a token
  const [shownId, setShownId] = useState<string | null>(null);
  const [autoPicked, setAutoPicked] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const [invites, setInvites] = useState<SignupInvite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [editing, setEditing] = useState<SignupInvite | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const role = profile?.role;
  const canPickChurch = role === 'owner';
  const canPickService = role === 'owner' || role === 'church_manager';
  const canPickClass = role !== 'class_servant';

  useEffect(() => {
    if (!profile) return;
    setChurchId(profile.church_id ?? '');
    setServiceId(profile.service_id ?? '');
    setClassId(profile.class_id ?? '');
  }, [profile]);

  useEffect(() => {
    if (hideScope) return;
    supabase.from('churches').select('*').order('sort_order').order('name').then(({ data }) => setChurches(data ?? []));
    supabase.from('services').select('*').order('sort_order').order('name').then(({ data }) => setServices(data ?? []));
    supabase.from('classes').select('*').order('sort_order').order('name').then(({ data }) => setClasses(data ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideScope]);

  const loadInvites = useCallback(async () => {
    setLoadingInvites(true);
    try { setInvites(await fetchMyInvites(supabase, kind)); } catch { setInvites([]); }
    setLoadingInvites(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  useEffect(() => { loadInvites(); }, [loadInvites]);

  // on (re)open: show the newest active invite that still has its token
  useEffect(() => {
    if (autoPicked || loadingInvites) return;
    setAutoPicked(true);
    if (shownId) return;
    const first = invites.find((i) => inviteUsable(i) && i.token);
    if (first) setShownId(first.id);
  }, [invites, loadingInvites, autoPicked, shownId]);

  const shown = useMemo(() => invites.find((i) => i.id === shownId) ?? null, [invites, shownId]);
  const shownUrl = shown?.token ? inviteUrlFor(kind, shown.token) : '';

  useEffect(() => {
    if (!shownUrl) { setQrDataUrl(''); return; }
    QRCode.toDataURL(shownUrl, { width: 480, margin: 2, color: { dark: KIND_COLOR[kind], light: '#ffffff' } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [shownUrl, kind]);

  const generate = async () => {
    setGenerating(true); setError('');
    try {
      const r = await createSignupInvite(
        supabase, kind,
        hideScope ? {} : { church_id: churchId || null, service_id: serviceId || null, class_id: classId || null },
        { days, max_uses: maxUses, note: note.trim() || null },
      );
      // show immediately (the list refresh brings the stored token too)
      const optimistic: SignupInvite = {
        id: r.id, kind, church_id: hideScope ? null : churchId || null, service_id: hideScope ? null : serviceId || null,
        class_id: hideScope ? null : classId || null, created_by: profile?.id ?? null, created_at: new Date().toISOString(),
        expires_at: r.expires_at, max_uses: maxUses, uses: 0, revoked_at: null, note: note.trim() || null, token: r.token,
      };
      setInvites((prev) => [optimistic, ...prev.filter((i) => i.id !== r.id)]);
      setShownId(r.id);
      setNote('');
      loadInvites();
    } catch (e) {
      setError(accountErrorMessage(e));
    }
    setGenerating(false);
  };

  const revoke = async (i: SignupInvite) => {
    if (!confirm('إلغاء هذه الدعوة؟ لن يعمل رابطها بعد الآن (يمكن إعادة تفعيلها من «تعديل»).')) return;
    setBusyId(i.id); setError('');
    try { await revokeSignupInvite(supabase, i.id); await loadInvites(); } catch (e) { setError(accountErrorMessage(e)); }
    setBusyId(null);
  };

  const reactivate = async (i: SignupInvite) => {
    setBusyId(i.id); setError('');
    try {
      // an expired / exhausted invite needs a fresh validity too
      const expired = new Date(i.expires_at).getTime() <= Date.now();
      const exhausted = i.max_uses != null && i.uses >= i.max_uses;
      await updateSignupInvite(supabase, i.id, {
        reactivate: true, days: expired ? 7 : null, max_uses: exhausted && i.max_uses != null ? i.uses + i.max_uses : null,
      });
      await loadInvites(); setShownId(i.id);
    } catch (e) { setError(accountErrorMessage(e)); }
    setBusyId(null);
  };

  const remove = async (i: SignupInvite) => {
    if (!confirm('حذف هذه الدعوة نهائياً؟ لن يعمل رابطها ولن تظهر في القائمة.')) return;
    setBusyId(i.id); setError('');
    try {
      await deleteSignupInvite(supabase, i.id);
      if (shownId === i.id) setShownId(null);
      await loadInvites();
    } catch (e) { setError(accountErrorMessage(e)); }
    setBusyId(null);
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(shownUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* noop */ }
  };
  const shareLink = async () => {
    try { await navigator.share({ title: `دعوة للانضمام ك${KIND_LABEL[kind]}`, url: shownUrl }); } catch { /* cancelled */ }
  };

  const filteredServices = churchId ? services.filter((s) => s.church_id === churchId) : services;
  const filteredClasses = serviceId ? classes.filter((c) => c.service_id === serviceId) : classes;
  const selectCls = (locked: boolean) => `input-field ${locked ? 'bg-primary-50 text-primary-800 pointer-events-none opacity-80' : ''}`;

  const nameOf = (i: SignupInvite) =>
    [churches.find((c) => c.id === i.church_id)?.name, services.find((s) => s.id === i.service_id)?.name, classes.find((c) => c.id === i.class_id)?.name]
      .filter(Boolean).join(' › ') || (hideScope ? '' : 'بدون تحديد');

  const statusOf = (i: SignupInvite) => {
    if (i.revoked_at) return { label: 'مُلغاة', cls: 'bg-gray-100 text-gray-500' };
    if (new Date(i.expires_at).getTime() <= Date.now()) return { label: 'منتهية', cls: 'bg-amber-50 text-amber-700' };
    if (i.max_uses != null && i.uses >= i.max_uses) return { label: 'استُنفدت', cls: 'bg-amber-50 text-amber-700' };
    return { label: 'نشطة', cls: 'bg-green-50 text-green-700' };
  };

  return (
    <>
      {!hideScope && (
        <section id="invite-scope" className="card space-y-3 mb-4">
          <p className="text-sm font-bold text-gray-600">
            نطاق الدعوة — سيتم تحديد هذه الاختيارات مسبقاً لل{KIND_LABEL[kind]} عند التسجيل:
          </p>
          <div>
            <label className="mb-1 block text-xs font-bold text-gray-500">الكنيسة</label>
            <select value={churchId} onChange={(e) => { setChurchId(e.target.value); setServiceId(''); setClassId(''); }}
              className={selectCls(!canPickChurch)} aria-disabled={!canPickChurch}>
              <option value="">كل الكنائس (بدون تحديد)</option>
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-gray-500">الخدمة</label>
            <select value={serviceId} onChange={(e) => { setServiceId(e.target.value); setClassId(''); }}
              className={selectCls(!canPickService)} aria-disabled={!canPickService}>
              <option value="">كل الخدمات (بدون تحديد)</option>
              {filteredServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-gray-500">الفصل</label>
            <select value={classId} onChange={(e) => setClassId(e.target.value)}
              className={selectCls(!canPickClass)} aria-disabled={!canPickClass}>
              <option value="">كل الفصول (بدون تحديد)</option>
              {filteredClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </section>
      )}

      <section id="invite-options" className="card space-y-3 mb-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-bold text-gray-500">صلاحية الرابط</label>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="input-field">
              {DAYS_OPTIONS.map((d) => <option key={d} value={d}>{d === 1 ? 'يوم واحد' : `${d} أيام`}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-gray-500">عدد الاستخدامات</label>
            <select value={maxUses ?? ''} onChange={(e) => setMaxUses(e.target.value === '' ? null : Number(e.target.value))} className="input-field">
              {USES_OPTIONS.map((o) => <option key={String(o.v)} value={o.v ?? ''}>{o.l}</option>)}
            </select>
          </div>
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} className="input-field" placeholder="ملاحظة (اختياري) — مثلاً: دعوة أبونا يوحنا" maxLength={120} />
        <button onClick={generate} disabled={generating} className="btn-primary w-full flex items-center justify-center gap-2">
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
          {shown ? 'توليد رابط دعوة جديد' : 'توليد رابط الدعوة'}
        </button>
        {error && <p className="text-sm text-red-600 text-center">{error}</p>}
      </section>

      {shown && shownUrl && (
        <section id="invite-qr" className="card flex flex-col items-center gap-4 mb-4">
          <div className="flex w-full items-center justify-between">
            <span className={`badge ${statusOf(shown).cls}`}>{statusOf(shown).label}</span>
            <p className="truncate text-xs font-bold text-gray-500">{shown.note || nameOf(shown) || 'دعوة'}</p>
            <button onClick={() => setShownId(null)} aria-label="إخفاء" className="rounded-full p-1 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" /></button>
          </div>
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt="QR دعوة التسجيل" className={`h-56 w-56 rounded-2xl border-4 border-primary-100 shadow-md ${inviteUsable(shown) ? '' : 'opacity-40 grayscale'}`} />
          ) : (
            <div className="h-56 w-56 animate-pulse rounded-2xl bg-gray-100" />
          )}
          <div className="w-full rounded-xl bg-gray-50 p-3 flex items-center gap-2">
            <Link2 className="h-4 w-4 shrink-0 text-gray-400" />
            <p className="break-all text-xs text-gray-600 leading-relaxed" dir="ltr">{shownUrl}</p>
          </div>
          <p className="text-xs text-gray-500">
            {shown.revoked_at ? 'مُلغاة — الرابط لا يعمل' : `صالح حتى ${fmtDate(shown.expires_at)}`}
            {' · '}استُخدمت {shown.uses}{shown.max_uses != null ? `/${shown.max_uses}` : ''}
          </p>
          <div className="flex w-full gap-3">
            <button onClick={copyLink} className="btn-primary flex-1 flex items-center justify-center gap-2">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'تم النسخ!' : 'نسخ الرابط'}
            </button>
            <button onClick={shareLink} className="btn-secondary flex-1 flex items-center justify-center gap-2">
              <Share2 className="h-4 w-4" /> مشاركة
            </button>
          </div>
          <div className="flex w-full gap-2">
            <button onClick={() => setEditing(shown)} className="btn-secondary flex-1 flex items-center justify-center gap-1 !py-2 text-sm">
              <Pencil className="h-4 w-4" /> تعديل
            </button>
            {inviteUsable(shown) ? (
              <button onClick={() => revoke(shown)} disabled={busyId === shown.id} className="btn-secondary flex-1 flex items-center justify-center gap-1 !py-2 text-sm !text-amber-700">
                <Ban className="h-4 w-4" /> إلغاء
              </button>
            ) : (
              <button onClick={() => reactivate(shown)} disabled={busyId === shown.id} className="btn-secondary flex-1 flex items-center justify-center gap-1 !py-2 text-sm !text-green-700">
                <RotateCcw className="h-4 w-4" /> إعادة تفعيل
              </button>
            )}
            <button onClick={() => remove(shown)} disabled={busyId === shown.id} className="btn-secondary flex-1 flex items-center justify-center gap-1 !py-2 text-sm !text-red-600">
              <Trash2 className="h-4 w-4" /> حذف
            </button>
          </div>
        </section>
      )}

      <section id="invite-list" className="card mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-gray-700">دعوات {KIND_LABEL[kind]} <span className="badge bg-gray-100 text-gray-500">{invites.length}</span></h3>
          <button onClick={loadInvites} className="p-1 text-gray-400 hover:text-gray-600" aria-label="تحديث">
            <RefreshCw className={`h-4 w-4 ${loadingInvites ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {invites.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-3">{loadingInvites ? 'جارٍ التحميل…' : 'لا توجد دعوات بعد'}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {invites.map((i) => {
              const usable = inviteUsable(i);
              const st = statusOf(i);
              const busy = busyId === i.id;
              return (
                <li key={i.id} className={`py-2 flex items-center gap-2 ${shownId === i.id ? 'bg-primary-50/60 -mx-2 px-2 rounded-xl' : ''}`}>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${usable ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <button type="button" onClick={() => i.token && setShownId(i.id)} className="flex-1 min-w-0 text-start" disabled={!i.token}
                    title={i.token ? 'عرض الرابط و QR' : 'دعوة قديمة — رمزها غير محفوظ'}>
                    <p className="text-xs font-bold text-gray-700 truncate">{i.note || nameOf(i) || 'دعوة'}</p>
                    <p className="text-[11px] text-gray-400">
                      <span className={`badge ${st.cls} !px-1.5 !py-0`}>{st.label}</span>
                      {' '}{i.note && nameOf(i) ? `${nameOf(i)} · ` : ''}
                      {i.revoked_at ? '' : `حتى ${fmtDate(i.expires_at)} · `}
                      استُخدمت {i.uses}{i.max_uses != null ? `/${i.max_uses}` : ''}
                      {!i.token && ' · بلا رابط محفوظ'}
                    </p>
                  </button>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : (
                    <div className="flex shrink-0 items-center">
                      {i.token && (
                        <button onClick={() => setShownId(i.id)} className="p-1.5 text-primary-500 hover:text-primary-700" aria-label="عرض الرابط">
                          <Eye className="h-4 w-4" />
                        </button>
                      )}
                      <button onClick={() => setEditing(i)} className="p-1.5 text-gray-400 hover:text-gray-700" aria-label="تعديل الدعوة">
                        <Pencil className="h-4 w-4" />
                      </button>
                      {usable ? (
                        <button onClick={() => revoke(i)} className="p-1.5 text-amber-500 hover:text-amber-700" aria-label="إلغاء الدعوة">
                          <Ban className="h-4 w-4" />
                        </button>
                      ) : (
                        <button onClick={() => reactivate(i)} className="p-1.5 text-green-500 hover:text-green-700" aria-label="إعادة تفعيل الدعوة">
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      )}
                      <button onClick={() => remove(i)} className="p-1.5 text-red-400 hover:text-red-600" aria-label="حذف الدعوة">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="px-2 text-center text-xs text-gray-400 leading-relaxed">
        لا يمكن لأحد فتح صفحة التسجيل إلا من هذا الرابط. من يفتحه يجد النطاق المحدد مقفولاً، ثم يُدخل كوده
        (كتابةً أو بمسح الـ QR) وبياناته وكلمة المرور.
        {kind === 'servant' && ' يصبح شخصاً في «الأشخاص» وتسجيل خادم قيد المراجعة.'}
        {kind === 'child' && ' يظهر طلبه في «الطلبات» ليعتمده خادم الفصل.'}
        {kind === 'priest' && ' يظهر طلبه في «طلبات الكهنة» ليعتمده المالك — ولكل كاهن حساب كاهن واحد فقط.'}
      </p>

      {editing && (
        <EditInviteModal
          invite={editing} kind={kind} scopeName={nameOf(editing)}
          onClose={() => setEditing(null)}
          onSaved={async (id) => { setEditing(null); await loadInvites(); setShownId(id); }}
          supabase={supabase}
        />
      )}
    </>
  );
}

// ---------- تعديل دعوة ----------
function EditInviteModal({ invite, kind, scopeName, onClose, onSaved, supabase }: {
  invite: SignupInvite; kind: AccountKind; scopeName: string; onClose: () => void; onSaved: (id: string) => void;
  supabase: ReturnType<typeof createClient>;
}) {
  const [extend, setExtend] = useState<number | 0>(0);          // 0 = keep the current expiry
  const [usesMode, setUsesMode] = useState<'keep' | 'unlimited' | 'set'>('keep');
  const [maxUses, setMaxUses] = useState<number>(invite.max_uses ?? 20);
  const [note, setNote] = useState(invite.note ?? '');
  const [reactivate, setReactivate] = useState(!!invite.revoked_at);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const expired = new Date(invite.expires_at).getTime() <= Date.now();

  const save = async () => {
    setSaving(true); setErr('');
    try {
      await updateSignupInvite(supabase, invite.id, {
        days: extend || null,
        max_uses: usesMode === 'set' ? maxUses : null,
        clear_max_uses: usesMode === 'unlimited',
        note: note.trim() === (invite.note ?? '') ? null : note,
        reactivate,
      });
      onSaved(invite.id);
    } catch (e) { setErr(accountErrorMessage(e, 'تعذّر حفظ التعديل')); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto no-scrollbar rounded-t-3xl sm:rounded-3xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-extrabold"><Pencil className="h-5 w-5 text-primary-600" /> تعديل دعوة {KIND_LABEL[kind]}</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        {scopeName && <p className="mb-3 text-xs font-bold text-gray-500">النطاق: {scopeName} <span className="text-gray-400">(لا يُعدَّل — أنشئ دعوة جديدة لنطاق آخر)</span></p>}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-bold text-gray-500">صلاحية الرابط</label>
            <select value={extend} onChange={(e) => setExtend(Number(e.target.value))} className="input-field">
              <option value={0}>{expired ? `منتهية منذ ${fmtDate(invite.expires_at)} — اختر مدة جديدة` : `كما هي (حتى ${fmtDate(invite.expires_at)})`}</option>
              {DAYS_OPTIONS.map((d) => <option key={d} value={d}>{d === 1 ? 'يوم واحد من الآن' : `${d} أيام من الآن`}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-gray-500">عدد الاستخدامات (استُخدمت {invite.uses})</label>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => setUsesMode('keep')} className={`rounded-xl px-2 py-2 text-xs font-extrabold ring-1 ${usesMode === 'keep' ? 'bg-primary-600 text-white ring-primary-600' : 'bg-white text-gray-600 ring-gray-200'}`}>
                كما هو ({invite.max_uses ?? 'بلا حد'})
              </button>
              <button type="button" onClick={() => setUsesMode('unlimited')} className={`rounded-xl px-2 py-2 text-xs font-extrabold ring-1 ${usesMode === 'unlimited' ? 'bg-primary-600 text-white ring-primary-600' : 'bg-white text-gray-600 ring-gray-200'}`}>
                بلا حد
              </button>
              <button type="button" onClick={() => setUsesMode('set')} className={`rounded-xl px-2 py-2 text-xs font-extrabold ring-1 ${usesMode === 'set' ? 'bg-primary-600 text-white ring-primary-600' : 'bg-white text-gray-600 ring-gray-200'}`}>
                تحديد
              </button>
            </div>
            {usesMode === 'set' && (
              <input type="number" min={1} max={100000} value={maxUses} onChange={(e) => setMaxUses(Math.max(1, Number(e.target.value) || 1))}
                className="input-field mt-2 text-center tabular-nums" />
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-gray-500">ملاحظة</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="input-field" maxLength={120} placeholder="مثلاً: دعوة أبونا يوحنا" />
          </div>
          {invite.revoked_at && (
            <label className="flex items-center gap-2 rounded-xl bg-green-50 px-3 py-2 text-sm font-bold text-green-800">
              <input type="checkbox" checked={reactivate} onChange={(e) => setReactivate(e.target.checked)} className="h-4 w-4" />
              إعادة تفعيل الدعوة (كانت مُلغاة)
            </label>
          )}
          {err && <p className="text-sm text-red-600 text-center">{err}</p>}
          <button onClick={save} disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ
          </button>
        </div>
      </div>
    </div>
  );
}
