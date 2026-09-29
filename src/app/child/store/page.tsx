'use client';

// ---------- Child portal — المتجر ----------
// The ACTIVE shops connected to my places (church / service / class) →
// tap one to browse its items and send a request. Below: my requests
// (pending · delivered · rejected · cancelled) and my receipts.

import { useMemo, useState } from 'react';
import { ShoppingBag, Star, Store, Loader2, Hourglass, Receipt } from 'lucide-react';
import ChildShell, { useChildShops } from '@/components/child/ChildShell';
import { EmptyState, PageTitle, usePortalList, fmtDateTime } from '@/components/child/ChildBits';
import { ShopCard, RequestCard, RequestSheet, ReceiptSheet } from '@/components/child/StoreBits';
import { useChild } from '@/lib/child-context';
import { createClient } from '@/lib/supabase/client';
import {
  cancelChildStoreRequest, childErrorMessage, fetchChildStoreOrders, sumBy, type ChildStoreOrder, type ChildStoreRequest,
} from '@/lib/child-portal';

export default function ChildStorePage() {
  return (
    <ChildShell>
      <StoreContent />
    </ChildShell>
  );
}

type Tab = 'requests' | 'receipts';

function StoreContent() {
  const { token, profile, reloadShops } = useChild();
  const supabase = useMemo(() => createClient(), []);
  const { shops, requests, pending } = useChildShops();
  const balance = sumBy(profile?.enrollments ?? [], (e) => e.points);
  const approvedCount = (requests ?? []).filter((r) => r.status === 'approved').length;
  const { rows: orders, reload: reloadOrders } = usePortalList<ChildStoreOrder>(
    token ? () => fetchChildStoreOrders(supabase, token) : null, `orders-${token}-${approvedCount}-${balance}`
  );

  const [tab, setTab] = useState<Tab>('requests');
  const [open, setOpen] = useState<ChildStoreRequest | null>(null);
  const [bill, setBill] = useState<ChildStoreOrder | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');

  const cancel = async (r: ChildStoreRequest) => {
    if (!token || !confirm('إلغاء هذا الطلب؟')) return;
    setCancelling(true);
    setError('');
    try {
      const res = await cancelChildStoreRequest(supabase, token, r.id);
      setOpen(res);
      reloadShops();
    } catch (e) { setError(childErrorMessage(e)); }
    finally { setCancelling(false); }
  };

  const receiptOf = (r: ChildStoreRequest) => orders?.find((o) => o.request_id === r.id || o.id === r.order_id) ?? null;

  return (
    <>
      <PageTitle
        icon={<ShoppingBag className="h-5 w-5 text-orange-600" />}
        title="المتجر"
        sub="اختر متجراً، ضع الأصناف في سلتك وأرسل الطلب — ثم اذهب إلى الخادم بكارتك لاستلامها"
        info="الطلب لا يخصم نقاطك فوراً: يمسح الخادم كارتك كتأكيد ثم يعتمد التسليم، عندها تُخصم النقاط وتظهر لك الفاتورة هنا وفي صفحة النقاط."
      />

      <section className="card mb-4 flex items-center gap-3 bg-gradient-to-l from-gold-500 to-gold-400 text-white border-0">
        <Star className="h-8 w-8" />
        <div className="flex-1">
          <p className="text-xs font-bold text-gold-50">رصيدك المتاح للإستبدال</p>
          <p className="text-3xl font-extrabold tabular-nums">{balance}</p>
        </div>
        {pending > 0 && <span className="rounded-full bg-white/25 px-3 py-1 text-xs font-extrabold"><Hourglass className="inline h-3 w-3" /> {pending} طلب بانتظار</span>}
      </section>

      {/* shops */}
      <section className="mb-5">
        <h3 className="mb-2 flex items-center gap-1 text-sm font-extrabold text-slate-500"><Store className="h-4 w-4" /> المتاجر المتاحة لك</h3>
        {shops === null ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>
        ) : shops.length === 0 ? (
          <EmptyState text="لا متاجر مفعّلة لفصلك الآن" />
        ) : (
          <div id="child-shops" className="space-y-2">{shops.map((s) => <ShopCard key={s.id} shop={s} />)}</div>
        )}
      </section>

      {/* my requests / receipts */}
      <section className="mb-3 grid grid-cols-2 gap-2">
        {([['requests', 'طلباتي', requests?.length ?? 0], ['receipts', 'فواتيري', orders?.length ?? 0]] as [Tab, string, number][]).map(([v, l, n]) => (
          <button key={v} id={`child-store-tab-${v}`} type="button" onClick={() => setTab(v)}
            className={`flex items-center justify-center gap-1 rounded-xl px-3 py-2 text-xs font-extrabold transition ${tab === v ? 'bg-orange-600 text-white shadow' : 'border border-slate-200 bg-white text-slate-500'}`}>
            {v === 'requests' ? <Hourglass className="h-3.5 w-3.5" /> : <Receipt className="h-3.5 w-3.5" />} {l} <span className="tabular-nums opacity-70">({n})</span>
          </button>
        ))}
      </section>

      {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}

      {tab === 'requests' && (
        requests === null ? <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>
        : requests.length === 0 ? <EmptyState text="لم ترسل أي طلب بعد" />
        : <div id="child-requests" className="space-y-2">{requests.map((r) => <RequestCard key={r.id} r={r} onOpen={() => setOpen(r)} />)}</div>
      )}
      {tab === 'receipts' && (
        orders === null ? <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>
        : orders.length === 0 ? <EmptyState text="لا فواتير بعد" />
        : (
          <div id="child-receipts" className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
            {orders.map((o) => (
              <button key={o.id} id={`child-receipt-${o.id}`} type="button" onClick={() => setBill(o)} className={`flex w-full items-center gap-3 px-4 py-3 text-right hover:bg-orange-50/50 ${o.status === 'cancelled' ? 'opacity-60' : ''}`}>
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${o.status === 'cancelled' ? 'bg-slate-200 text-slate-500' : 'bg-orange-500 text-white'}`}><Receipt className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm font-extrabold ${o.status === 'cancelled' ? 'line-through' : ''}`}>{o.shop_name ?? 'الكاشير'} — {o.items_count} قطعة</span>
                  <span className="block text-[11px] font-bold text-slate-400">{fmtDateTime(o.created_at)}</span>
                </span>
                <span className="badge bg-orange-100 text-orange-700 tabular-nums"><Star className="h-3 w-3" /> −{o.total_points}</span>
              </button>
            ))}
          </div>
        )
      )}

      {open && (
        <RequestSheet
          r={open} onClose={() => setOpen(null)}
          onCancel={open.status === 'pending' ? () => cancel(open) : undefined} cancelling={cancelling}
          receipt={receiptOf(open)} onOpenReceipt={() => { const b = receiptOf(open); if (b) { setOpen(null); setBill(b); } else reloadOrders(); }}
        />
      )}
      {bill && <ReceiptSheet bill={bill} onClose={() => setBill(null)} />}
    </>
  );
}
