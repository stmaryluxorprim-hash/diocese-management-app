'use client';

// ---------- POINTS STORE — CHILD REQUESTS of ONE shop (طلبات الشراء) ----------
// 20261002120000: the shop is the container — the carts the children sent
// from their portal for /store/[shop] (store_requests), live.
// Flow for the servant:
//   1. list (pending first; status filter; search)
//   2. tap a request → detail sheet: child, shop, lines, total, balance
//   3. «امسح كارت المخدوم للتأكيد» — the camera reads the child's QR; the
//      code must be the child's own (the DB re-checks: card_mismatch)
//   4. «اعتماد وتسليم» → store_request_approve → the sale runs through the
//      same checkout rules (stock · scope · balance) → receipt; or
//      «رفض» with an optional reason.
// Realtime on store_requests (broadcast bus, 0046).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2, Inbox, Star, X, Receipt, Clock, User, Ban, Check, School, ScanLine, ShieldCheck, AlertTriangle,
  Search, Hourglass, ChevronLeft, MessageSquare,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { PersonAvatar } from '@/components/CallFeedback';
import QrScanner from '@/components/store/QrScanner';
import {
  StoreHeader, ItemThumb, ShopThumb, ShopMissing, useStoreShop, useStoreLookups, Toast,
} from '@/components/store/StoreBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime, scopeFilter } from '@/lib/realtime';
import {
  fetchStoreRequests, fetchStoreRequestDetail, storeRequestApprove, storeRequestReject, storeErrorMessage,
  isShopsMigrationMissing, SHOPS_MIGRATION_HINT, type StoreRequestWithPerson,
} from '@/lib/store';
import { STORE_REQUEST_STATUS_LABELS, type StoreRequestDetail, type StoreRequestStatus, type StoreCheckoutResult } from '@/lib/types';
import { APP_TZ } from '@/lib/time';

const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('ar-EG', { timeZone: APP_TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

type StatusFilter = 'pending' | 'all' | StoreRequestStatus;
const STATUS_STYLE: Record<StoreRequestStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-600',
  cancelled: 'bg-slate-200 text-slate-600',
};

export default function RequestsPage() {
  const { shop: shopId } = useParams<{ shop: string }>();
  const { profile, scopes } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { services, classes } = useStoreLookups(supabase, approved);
  const { shop, loading: shopLoading, missing, error: shopError } = useStoreShop(supabase, shopId ?? null, approved);
  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? '';

  const [status, setStatus] = useState<StatusFilter>('pending');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<StoreRequestWithPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async () => {
    try {
      if (!shopId) return;
      const list = await fetchStoreRequests(supabase, {}, { status: status === 'all' ? 'all' : status, shopId });
      setRows(list);
      setMigrationMissing(false);
    } catch (err) {
      if (isShopsMigrationMissing(err)) setMigrationMissing(true);
    } finally { setLoading(false); }
  }, [supabase, status, shopId]);

  useEffect(() => { if (approved && shop) load(); }, [approved, shop, load]);
  useDebouncedRealtime(supabase, `store-requests-${shopId}`, [{ table: 'store_requests', filter: scopeFilter(profile, scopes) }], load, { enabled: approved && !!shop, delayMs: 500 });

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => !s || (r.person?.name ?? '').toLowerCase().includes(s) || (r.person?.national_id ?? '').includes(s));
  }, [rows, search]);
  const pendingCount = rows.filter((r) => r.status === 'pending').length;

  // ---------- detail / decision ----------
  const [detailRow, setDetailRow] = useState<StoreRequestWithPerson | null>(null);
  const [detail, setDetail] = useState<StoreRequestDetail | null>(null);
  const [confirmed, setConfirmed] = useState(false);       // card scanned & matched
  const [scannedCode, setScannedCode] = useState('');
  const [note, setNote] = useState('');
  const [working, setWorking] = useState<'approve' | 'reject' | null>(null);
  const [receipt, setReceipt] = useState<(StoreRequestDetail & StoreCheckoutResult) | null>(null);
  const [rejecting, setRejecting] = useState(false);

  const openDetail = (r: StoreRequestWithPerson) => {
    setDetailRow(r); setDetail(null); setConfirmed(false); setScannedCode(''); setNote(''); setReceipt(null); setRejecting(false);
    fetchStoreRequestDetail(supabase, r.id).then(setDetail).catch((e) => flash(storeErrorMessage(e)));
  };
  const closeDetail = () => { setDetailRow(null); setDetail(null); };

  const onCard = useCallback(async (code: string) => {
    if (!detailRow?.person) return;
    const clean = code.trim();
    if (clean.toLowerCase() === detailRow.person.national_id.trim().toLowerCase()) {
      setScannedCode(clean);
      setConfirmed(true);
      flash(`✅ كارت ${detailRow.person.name} — مطابق`);
    } else {
      setConfirmed(false);
      flash('هذا ليس كارت هذا المخدوم — امسح كارته هو');
    }
  }, [detailRow]);

  const approve = async () => {
    if (!detailRow || !confirmed) return;
    setWorking('approve');
    try {
      const res = await storeRequestApprove(supabase, detailRow.id, scannedCode, note);
      setReceipt(res);
      setRows((l) => l.map((r) => (r.id === detailRow.id ? { ...r, status: 'approved', order_id: res.order_id, decided_at: new Date().toISOString() } : r)));
      flash(`تم التسليم — خُصم ${res.total_points} نقطة (الرصيد الآن ${res.balance_after})`);
    } catch (err) {
      flash(storeErrorMessage(err, 'تعذر اعتماد الطلب'));
      if (String((err as { message?: string })?.message ?? '').includes('card_mismatch')) setConfirmed(false);
    } finally { setWorking(null); }
  };

  const reject = async () => {
    if (!detailRow) return;
    setWorking('reject');
    try {
      const res = await storeRequestReject(supabase, detailRow.id, note);
      setDetail(res);
      setRows((l) => l.map((r) => (r.id === detailRow.id ? { ...r, status: 'rejected', decision_note: res.decision_note, decided_at: new Date().toISOString() } : r)));
      setRejecting(false);
      flash('تم رفض الطلب — لم تُخصم أي نقاط');
    } catch (err) { flash(storeErrorMessage(err, 'تعذر الرفض')); }
    finally { setWorking(null); }
  };

  const isPending = detailRow?.status === 'pending' && !receipt;

  if (shopLoading) {
    return <AppShell><StoreHeader /><div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-orange-500" /></div></AppShell>;
  }
  if (missing || !shop) {
    return <AppShell><StoreHeader /><ShopMissing migrationHint={isShopsMigrationMissing(shopError) ? SHOPS_MIGRATION_HINT : null} /></AppShell>;
  }

  return (
    <AppShell>
      <StoreHeader
        shop={shop}
        title="الطلبات"
        badge={pendingCount > 0 ? <span className="badge bg-red-100 text-red-600 tabular-nums">{pendingCount}</span> : undefined}
        info="طلبات الشراء التي أرسلها المخدومون من هذا المتجر في بوابتهم. افتح الطلب، امسح كارت المخدوم بالكاميرا كتأكيد أنه أمامك، ثم اعتمد التسليم فتُخصم النقاط وتُحفظ الفاتورة في الأرشيف — أو ارفض الطلب."
      />
      {migrationMissing && <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">⚠️ {SHOPS_MIGRATION_HINT}</p>}

      <div className="relative mb-2">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input id="req-search" className="input-field pr-9" placeholder="ابحث باسم المخدوم أو الكود..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="mb-3 grid grid-cols-5 gap-1.5">
        {([['pending', 'بانتظار'], ['approved', 'تم التسليم'], ['rejected', 'مرفوض'], ['cancelled', 'ملغي'], ['all', 'الكل']] as [StatusFilter, string][]).map(([v, l]) => (
          <button key={v} id={`req-status-${v}`} type="button" onClick={() => setStatus(v)}
            className={`rounded-xl px-1 py-2 text-[11px] font-extrabold transition ${status === v ? 'bg-orange-600 text-white shadow' : 'border border-slate-200 bg-white text-slate-500'}`}>
            {l}
          </button>
        ))}
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-orange-500" /></div>
      ) : visible.length === 0 ? (
        <div className="card py-12 text-center text-slate-400">
          <Inbox className="mx-auto mb-3 h-10 w-10 text-orange-200" />
          <p className="font-bold">{status === 'pending' ? 'لا طلبات بانتظار القرار' : 'لا طلبات'}</p>
          <p className="mt-1 text-xs">المخدوم يرسل طلبه من متجر مفعّل في بوابته</p>
        </div>
      ) : (
        <ul id="req-list" className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
          {visible.map((r) => (
            <li key={r.id}>
              <button id={`req-${r.id}`} type="button" onClick={() => openDetail(r)} className={`flex w-full items-center gap-3 px-4 py-3 text-right hover:bg-orange-50/50 ${r.status !== 'pending' ? 'opacity-75' : ''}`}>
                <PersonAvatar name={r.person?.name ?? '—'} imageUrl={r.person?.image_url ?? null} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-extrabold">{r.person?.name ?? 'مخدوم محذوف'}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] font-bold text-slate-400">
                    <span className="flex items-center gap-1"><School className="h-3 w-3" /> {className(r.class_id)}</span>
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtDateTime(r.created_at)}</span>
                    <span>{r.items_count} قطعة</span>
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span className={`badge ${STATUS_STYLE[r.status]}`}>
                    {r.status === 'pending' && <Hourglass className="h-3 w-3" />}
                    {STORE_REQUEST_STATUS_LABELS[r.status]}
                  </span>
                  <span className="badge bg-orange-100 text-orange-700 tabular-nums"><Star className="h-3 w-3" /> {r.total_points}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ---------- detail sheet ---------- */}
      {detailRow && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={() => !working && closeDetail()}>
          <div id="req-detail" className="max-h-[94vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-extrabold"><Inbox className="h-5 w-5 text-orange-600" /> طلب شراء</h3>
              <button type="button" onClick={closeDetail} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>

            {/* child + shop */}
            <div className="mb-3 flex items-center gap-3">
              <PersonAvatar name={detailRow.person?.name ?? '—'} imageUrl={detailRow.person?.image_url ?? null} size={52} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-extrabold">{detailRow.person?.name ?? 'مخدوم محذوف'}</p>
                <p className="truncate text-xs font-bold text-slate-400">{services.find((s) => s.id === detailRow.service_id)?.name} · {className(detailRow.class_id)} · <span dir="ltr">{detailRow.person?.national_id}</span></p>
              </div>
              <span className={`badge ${STATUS_STYLE[detailRow.status]}`}>{STORE_REQUEST_STATUS_LABELS[receipt ? 'approved' : detailRow.status]}</span>
            </div>
            <div className="mb-3 flex items-center gap-2 rounded-xl bg-orange-50 px-3 py-2">
              <ShopThumb url={detailRow.shop?.image_url ?? null} name={detailRow.shop?.name ?? ''} size={32} />
              <span className="text-sm font-extrabold text-orange-800">{detailRow.shop?.name ?? '—'}</span>
              <span className="mr-auto text-[11px] font-bold text-slate-500"><Clock className="inline h-3 w-3" /> {fmtDateTime(detailRow.created_at)}</span>
            </div>

            <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs font-bold">
              <div className="rounded-xl bg-slate-50 py-2"><p className="text-lg font-extrabold tabular-nums text-slate-500">{detailRow.balance_at_request}</p>الرصيد عند الطلب</div>
              <div className="rounded-xl bg-orange-50 py-2"><p className="text-lg font-extrabold tabular-nums text-orange-600">−{detailRow.total_points}</p>قيمة الطلب</div>
              <div className="rounded-xl bg-emerald-50 py-2"><p className="text-lg font-extrabold tabular-nums text-emerald-600">{receipt ? receipt.balance_after : detailRow.balance_at_request - detailRow.total_points}</p>{receipt ? 'الرصيد بعد' : 'المتبقي المتوقع'}</div>
            </div>

            {detail === null ? (
              <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>
            ) : (
              <ul className="mb-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-100">
                {detail.items.map((l) => (
                  <li key={l.id} className="flex items-center gap-2.5 px-3 py-2">
                    <ItemThumb url={l.image_url} name={l.item_name} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-extrabold">{l.item_name}</p>
                      <p className="text-[11px] font-bold text-slate-400"><span dir="ltr" className="font-mono">{l.item_code}</span> · {l.unit_price} × {l.qty}</p>
                    </div>
                    <span className="tabular-nums text-sm font-extrabold text-orange-700">{l.line_total}</span>
                  </li>
                ))}
              </ul>
            )}
            {detailRow.note && <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600"><MessageSquare className="inline h-3.5 w-3.5" /> ملاحظة المخدوم: {detailRow.note}</p>}

            {/* decided */}
            {(detailRow.status !== 'pending' || receipt) && (
              <div className="space-y-1 text-[11px] font-bold text-slate-500">
                {(receipt || detailRow.status === 'approved') && (
                  <p className="flex items-center gap-1 text-emerald-700"><Check className="h-3.5 w-3.5" /> تم التسليم وخصم النقاط — الفاتورة في الأرشيف
                    <Link href={`/store/${shop.id}/archive`} className="mr-auto flex items-center gap-1 underline">الأرشيف <ChevronLeft className="h-3 w-3" /></Link>
                  </p>
                )}
                {detailRow.status === 'rejected' && !receipt && <p className="flex items-center gap-1 text-red-500"><Ban className="h-3.5 w-3.5" /> مرفوض{(detail?.decision_note ?? detailRow.decision_note) ? ` — ${detail?.decision_note ?? detailRow.decision_note}` : ''}</p>}
                {detailRow.status === 'cancelled' && <p className="flex items-center gap-1"><X className="h-3.5 w-3.5" /> ألغاه المخدوم بنفسه</p>}
                {(detail?.decided_by_name || detailRow.decided_at) && !receipt && (
                  <p className="flex items-center gap-1"><User className="h-3 w-3" /> {detail?.decided_by_name ?? '—'}{detailRow.decided_at ? ` · ${fmtDateTime(detailRow.decided_at)}` : ''}</p>
                )}
              </div>
            )}

            {/* pending → confirm by card, then decide */}
            {isPending && (
              <div className="space-y-3">
                <div className={`rounded-2xl border-2 p-3 ${confirmed ? 'border-emerald-400 bg-emerald-50' : 'border-dashed border-orange-300 bg-orange-50/40'}`}>
                  <p className={`mb-2 flex items-center gap-2 text-sm font-extrabold ${confirmed ? 'text-emerald-700' : 'text-orange-800'}`}>
                    {confirmed ? <><ShieldCheck className="h-5 w-5" /> تم التأكيد — كارت {detailRow.person?.name} مطابق</> : <><ScanLine className="h-5 w-5" /> امسح كارت المخدوم للتأكيد</>}
                  </p>
                  {!confirmed && (
                    <>
                      <QrScanner onCode={onCard} idPrefix="req" hint="وجّه الكاميرا إلى QR كارت المخدوم" autoStart />
                      <p className="mt-2 text-[11px] font-bold text-slate-500">
                        الاعتماد لا يُقبل إلا بكارت هذا المخدوم نفسه — هذا هو التأكيد أنه أمامك وأنه استلم أصنافه.
                      </p>
                    </>
                  )}
                </div>

                <input className="input-field" placeholder={rejecting ? 'سبب الرفض (اختياري) — يراه المخدوم' : 'ملاحظة على الفاتورة (اختياري)'} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />

                {rejecting ? (
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" disabled={!!working} onClick={() => setRejecting(false)} className="btn-secondary">رجوع</button>
                    <button id="req-reject-yes" type="button" disabled={!!working} onClick={reject} className="flex items-center justify-center gap-2 rounded-xl bg-red-600 py-3 text-sm font-extrabold text-white hover:bg-red-700 disabled:opacity-50">
                      {working === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} تأكيد الرفض
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    <button id="req-reject" type="button" disabled={!!working} onClick={() => setRejecting(true)} className="flex items-center justify-center gap-1 rounded-xl bg-red-50 py-3 text-sm font-extrabold text-red-600 hover:bg-red-100 disabled:opacity-50">
                      <Ban className="h-4 w-4" /> رفض
                    </button>
                    <button id="req-approve" type="button" disabled={!confirmed || !!working} onClick={approve}
                      className="btn-primary col-span-2 flex items-center justify-center gap-2 !from-emerald-600 !to-emerald-500 disabled:opacity-40">
                      {working === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
                      اعتماد وتسليم — {detailRow.total_points} نقطة
                    </button>
                  </div>
                )}
                {!confirmed && <p className="flex items-center justify-center gap-1 text-[11px] font-bold text-slate-400"><AlertTriangle className="h-3 w-3" /> زر الاعتماد يُفتح بعد مسح كارت المخدوم</p>}
              </div>
            )}
          </div>
        </div>
      )}
      <Toast msg={toast} />
    </AppShell>
  );
}
