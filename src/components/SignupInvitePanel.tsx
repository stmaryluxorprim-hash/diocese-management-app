'use client';

// ---------- دعوة تسجيل (QR) — 20261004120000 ----------
// التسجيل (خادم · مخدوم · كاهن) لا يُفتح إلا برابط يحمل دعوة صالحة تُولَّد هنا.
// الرابط يحمل رمزاً عشوائياً (sha256 في signup_invites) له صلاحية وعدد استخدامات، ويُمكن إلغاؤه.

import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Check, Share2, Link2, Ticket, Ban, RefreshCw, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import type { Church, Service, ClassRoom } from '@/lib/types';
import {
  type AccountKind, type SignupInvite,
  createSignupInvite, fetchMyInvites, revokeSignupInvite, inviteUsable, accountErrorMessage,
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
  const supabase = createClient();

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
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteExpires, setInviteExpires] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const [invites, setInvites] = useState<SignupInvite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(true);

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

  useEffect(() => {
    if (!inviteUrl) { setQrDataUrl(''); return; }
    QRCode.toDataURL(inviteUrl, { width: 480, margin: 2, color: { dark: KIND_COLOR[kind], light: '#ffffff' } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [inviteUrl, kind]);

  // أي تغيير في النطاق/الصلاحية يُبطل الرابط المعروض — يجب توليد رابط جديد
  useEffect(() => { setInviteUrl(''); setInviteExpires(''); }, [churchId, serviceId, classId, days, maxUses]);

  const generate = async () => {
    setGenerating(true); setError('');
    try {
      const r = await createSignupInvite(
        supabase, kind,
        hideScope ? {} : { church_id: churchId || null, service_id: serviceId || null, class_id: classId || null },
        { days, max_uses: maxUses, note: note.trim() || null },
      );
      setInviteUrl(r.url);
      setInviteExpires(r.expires_at);
      loadInvites();
    } catch (e) {
      setError(accountErrorMessage(e));
    }
    setGenerating(false);
  };

  const revoke = async (id: string) => {
    if (!confirm('إلغاء هذه الدعوة؟ لن يعمل رابطها بعد الآن.')) return;
    try { await revokeSignupInvite(supabase, id); loadInvites(); } catch (e) { setError(accountErrorMessage(e)); }
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* noop */ }
  };
  const shareLink = async () => {
    try { await navigator.share({ title: `دعوة للانضمام ك${KIND_LABEL[kind]}`, url: inviteUrl }); } catch { /* cancelled */ }
  };

  const filteredServices = churchId ? services.filter((s) => s.church_id === churchId) : services;
  const filteredClasses = serviceId ? classes.filter((c) => c.service_id === serviceId) : classes;
  const selectCls = (locked: boolean) => `input-field ${locked ? 'bg-primary-50 text-primary-800 pointer-events-none opacity-80' : ''}`;

  const nameOf = (i: SignupInvite) =>
    [churches.find((c) => c.id === i.church_id)?.name, services.find((s) => s.id === i.service_id)?.name, classes.find((c) => c.id === i.class_id)?.name]
      .filter(Boolean).join(' › ') || (hideScope ? '' : 'بدون تحديد');

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
          {inviteUrl ? 'توليد رابط دعوة جديد' : 'توليد رابط الدعوة'}
        </button>
        {error && <p className="text-sm text-red-600 text-center">{error}</p>}
      </section>

      {inviteUrl && (
        <section id="invite-qr" className="card flex flex-col items-center gap-4 mb-4">
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt="QR دعوة التسجيل" className="h-56 w-56 rounded-2xl border-4 border-primary-100 shadow-md" />
          ) : (
            <div className="h-56 w-56 animate-pulse rounded-2xl bg-gray-100" />
          )}
          <div className="w-full rounded-xl bg-gray-50 p-3 flex items-center gap-2">
            <Link2 className="h-4 w-4 shrink-0 text-gray-400" />
            <p className="break-all text-xs text-gray-600 leading-relaxed" dir="ltr">{inviteUrl}</p>
          </div>
          {inviteExpires && <p className="text-xs text-gray-500">صالح حتى {fmtDate(inviteExpires)}</p>}
          <div className="flex w-full gap-3">
            <button onClick={copyLink} className="btn-primary flex-1 flex items-center justify-center gap-2">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'تم النسخ!' : 'نسخ الرابط'}
            </button>
            <button onClick={shareLink} className="btn-secondary flex-1 flex items-center justify-center gap-2">
              <Share2 className="h-4 w-4" /> مشاركة
            </button>
          </div>
        </section>
      )}

      <section id="invite-list" className="card mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-gray-700">دعوات {KIND_LABEL[kind]} السابقة</h3>
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
              return (
                <li key={i.id} className="py-2 flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${usable ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-gray-700 truncate">{i.note || nameOf(i) || 'دعوة'}</p>
                    <p className="text-[11px] text-gray-400">
                      {i.note && nameOf(i) ? `${nameOf(i)} · ` : ''}
                      {i.revoked_at ? 'مُلغاة' : new Date(i.expires_at).getTime() <= Date.now() ? 'منتهية' : `حتى ${fmtDate(i.expires_at)}`}
                      {' · '}استُخدمت {i.uses}{i.max_uses != null ? `/${i.max_uses}` : ''}
                    </p>
                  </div>
                  {usable && (
                    <button onClick={() => revoke(i.id)} className="p-1.5 text-red-400 hover:text-red-600" aria-label="إلغاء الدعوة">
                      <Ban className="h-4 w-4" />
                    </button>
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
    </>
  );
}
