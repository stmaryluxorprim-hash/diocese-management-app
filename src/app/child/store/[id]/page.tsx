'use client';

// ---------- Child portal — a shop (متجر) : items → cart → send ----------
// The child browses the items of one active shop, adds them to his cart
// (never more than the stock, never above his balance), then «أرسل الطلب»
// creates a PENDING request. Nothing is deducted yet: the servant scans the
// child's card to confirm and approves → receipt. While a request is
// pending in this shop the cart is locked (one open request per shop).

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowRight, Star, Loader2, ShoppingCart, Plus, Minus, Trash2, Send, Check, Search, Hourglass, AlertTriangle, Package, Layers, ScanLine,
} from 'lucide-react';
import ChildShell, { useChildShops } from '@/components/child/ChildShell';
import { EmptyState } from '@/components/child/ChildBits';
import { ShopPicture, ItemPicture, RequestSheet } from '@/components/child/StoreBits';
import { useChild } from '@/lib/child-context';
import { createClient } from '@/lib/supabase/client';
import {
  fetchChildShopItems, sendChildStoreRequest, cancelChildStoreRequest, childErrorMessage,
  type ChildShopItem, type ChildStoreRequest,
} from '@/lib/child-portal';

export default function ChildShopPage() {
  return (
    <ChildShell>
      <ShopContent />
    </ChildShell>
  );
}

interface Line { item: ChildShopItem; qty: number }

function ShopContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token, profile, reloadShops } = useChild();
  const supabase = useMemo(() => createClient(), []);
  const { shops, requests } = useChildShops();
  const shop = shops?.find((s) => s.id === id) ?? null;

  // the enrollment(s) the shop is connected to → balance to spend
  const enrollments = useMemo(() => {
    const ids = new Set(shop?.enrollment_ids ?? []);
    return (profile?.enrollments ?? []).filter((e) => ids.has(e.id));
  }, [shop, profile]);
  const [enrollmentId, setEnrollmentId] = useState<string | null>(null);
  useEffect(() => { if (!enrollmentId && enrollments.length > 0) setEnrollmentId(enrollments[0].id); }, [enrollments, enrollmentId]);
  const enrollment = enrollments.find((e) => e.id === enrollmentId) ?? enrollments[0] ?? null;
  const balance = enrollment?.points ?? 0;

  const pendingReq = (requests ?? []).find((r) => r.shop_id === id && r.status === 'pending') ?? null;

  const [items, setItems] = useState<ChildShopItem[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!token || !id) return;
    try { setItems(await fetchChildShopItems(supabase, token, id)); setError(''); }
    catch (e) { setItems([]); setError(childErrorMessage(e)); }
  }, [supabase, token, id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  // ---- cart ----
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState('');
  const [note, setNote] = useState('');
  const [toast, setToast] = useState('');
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); };
  // refresh cart lines with fresh stock / price
  useEffect(() => {
    if (!items) return;
    setLines((ls) => ls.map((l) => { const f = items.find((i) => i.id === l.item.id); return f ? { item: f, qty: Math.min(l.qty, f.stock) } : null; })
      .filter((l): l is Line => !!l && l.qty > 0));
  }, [items]);

  const total = lines.reduce((s, l) => s + l.item.price * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const remaining = balance - total;
  const qtyOf = (iid: string) => lines.find((l) => l.item.id === iid)?.qty ?? 0;
  const add = (it: ChildShopItem, d = 1) => {
    const cur = qtyOf(it.id);
    const next = cur + d;
    if (next <= 0) { setLines((ls) => ls.filter((l) => l.item.id !== it.id)); return; }
    if (next > it.stock) { flash(it.stock === 0 ? `«${it.name}» نفذت كميته` : `المتاح من «${it.name}» ${it.stock} فقط`); return; }
    if (d > 0 && total + it.price * d > balance) { flash(`رصيدك لا يكفي — المتبقي ${remaining} نقطة و«${it.name}» سعره ${it.price}`); return; }
    setLines((ls) => (cur === 0 ? [...ls, { item: it, qty: next }] : ls.map((l) => (l.item.id === it.id ? { ...l, qty: next } : l))));
  };

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (items ?? []).filter((it) => !s || it.name.toLowerCase().includes(s));
  }, [items, search]);

  // ---- send ----
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<ChildStoreRequest | null>(null);
  const send = async () => {
    if (!token || !id || lines.length === 0) return;
    setSending(true);
    setError('');
    try {
      const r = await sendChildStoreRequest(supabase, token, id, lines.map((l) => ({ item_id: l.item.id, qty: l.qty })), enrollment?.id ?? null, note);
      setSent(r);
      setLines([]);
      setNote('');
      setConfirming(false);
      reloadShops();
    } catch (e) { setError(childErrorMessage(e)); setConfirming(false); load(); }
    finally { setSending(false); }
  };

  const [openReq, setOpenReq] = useState<ChildStoreRequest | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const cancelReq = async (r: ChildStoreRequest) => {
    if (!token || !confirm('إلغاء هذا الطلب؟')) return;
    setCancelling(true);
    try { const res = await cancelChildStoreRequest(supabase, token, r.id); setOpenReq(res); setSent(null); reloadShops(); }
    catch (e) { setError(childErrorMessage(e)); }
    finally { setCancelling(false); }
  };

  if (shops !== null && !shop) {
    return (
      <>
        <BackBar title="المتجر" />
        <EmptyState text="هذا المتجر غير متاح لك الآن" />
      </>
    );
  }
  if (!shop) return <div className="flex justify-center py-10"><Loader2 className="h-7 w-7 animate-spin text-orange-500" /></div>;

  const locked = !!pendingReq || !!sent;

  return (
    <>
      <BackBar title={shop.name} />

      {/* shop header + balance */}
      <section className="card mb-4 overflow-hidden !p-0">
        <div className="flex items-center gap-3 bg-gradient-to-l from-orange-500 to-amber-400 p-4 text-white">
          <ShopPicture url={shop.image_url} name={shop.name} size={56} className="ring-2 ring-white/60" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-extrabold">{shop.name}</h2>
            {shop.description && <p className="truncate text-xs font-bold text-orange-50">{shop.description}</p>}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 p-3 text-center">
          <div className="rounded-xl bg-gold-50 py-2"><p className="text-xl font-extrabold tabular-nums text-gold-700">{balance}</p><p className="text-[11px] font-bold text-slate-500">رصيدك</p></div>
          <div className="rounded-xl bg-orange-50 py-2"><p className="text-xl font-extrabold tabular-nums text-orange-600">−{total}</p><p className="text-[11px] font-bold text-slate-500">السلة ({count})</p></div>
          <div className={`rounded-xl py-2 ${remaining < 0 ? 'bg-red-100' : 'bg-emerald-50'}`}><p className={`text-xl font-extrabold tabular-nums ${remaining < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{remaining}</p><p className="text-[11px] font-bold text-slate-500">المتبقي بعد الشراء</p></div>
        </div>
        {enrollments.length > 1 && (
          <div className="flex items-center gap-2 border-t border-orange-50 px-3 py-2 text-xs font-bold text-slate-500">
            <Layers className="h-4 w-4 text-primary-600" /> من رصيد:
            <select className="input-field !py-1 flex-1 text-xs font-bold" value={enrollment?.id ?? ''} onChange={(e) => { setEnrollmentId(e.target.value); setLines([]); }}>
              {enrollments.map((e) => <option key={e.id} value={e.id}>{e.class_name} — {e.points} نقطة</option>)}
            </select>
          </div>
        )}
      </section>

      {/* sent / pending banner */}
      {(sent || pendingReq) && (
        <button id="child-shop-pending" type="button" onClick={() => setOpenReq(sent ?? pendingReq)} className="card mb-4 flex w-full items-center gap-3 !p-3 text-right ring-2 ring-amber-300">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500 text-white">{sent ? <Check className="h-6 w-6" /> : <Hourglass className="h-6 w-6" />}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold">{sent ? 'تم إرسال طلبك ✅' : 'لديك طلب بانتظار الخادم'}</span>
            <span className="block text-xs text-slate-500"><ScanLine className="inline h-3 w-3" /> اذهب إلى الخادم ومعك كارتك — يمسحه ويسلّمك الأصناف ({(sent ?? pendingReq)!.total_points} نقطة)</span>
          </span>
        </button>
      )}

      {/* cart */}
      {!locked && (
        <section id="child-cart" className="card mb-4 !p-0 overflow-hidden">
          <div className="flex items-center gap-2 bg-orange-50/70 px-4 py-2 text-sm font-extrabold text-orange-800">
            <ShoppingCart className="h-4 w-4" /> سلتي
            <span className="badge bg-white text-orange-700 tabular-nums">{count} قطعة</span>
            <span className="mr-auto tabular-nums">{total} <Star className="inline h-3.5 w-3.5 text-gold-500" /></span>
          </div>
          {lines.length === 0 ? (
            <p className="px-4 py-5 text-center text-xs font-bold text-slate-400">السلة فارغة — اختر أصنافاً من القائمة بالأسفل</p>
          ) : (
            <ul className="divide-y divide-orange-50">
              {lines.map((l) => (
                <li key={l.item.id} className="flex items-center gap-2.5 px-3 py-2.5">
                  <ItemPicture url={l.item.image_url} name={l.item.name} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold">{l.item.name}</p>
                    <p className="text-[11px] font-bold text-slate-400">{l.item.price} × {l.qty} = <span className="text-orange-700">{l.item.price * l.qty}</span></p>
                  </div>
                  <span className="inline-flex items-center overflow-hidden rounded-lg ring-1 ring-slate-200">
                    <button type="button" aria-label="إنقاص" onClick={() => add(l.item, -1)} className="px-2.5 py-1.5 text-slate-600 hover:bg-slate-100"><Minus className="h-4 w-4" /></button>
                    <span className="min-w-[2rem] text-center text-sm font-extrabold tabular-nums">{l.qty}</span>
                    <button type="button" aria-label="زيادة" onClick={() => add(l.item, +1)} disabled={l.qty >= l.item.stock || total + l.item.price > balance} className="px-2.5 py-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30"><Plus className="h-4 w-4" /></button>
                  </span>
                  <button type="button" aria-label="حذف" onClick={() => setLines((ls) => ls.filter((x) => x.item.id !== l.item.id))} className="rounded-full bg-red-50 p-2 text-red-500 hover:bg-red-100"><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="p-3">
            <button id="child-cart-send" type="button" disabled={lines.length === 0 || remaining < 0} onClick={() => setConfirming(true)}
              className="btn-primary flex w-full items-center justify-center gap-2 !from-orange-600 !to-orange-500 disabled:opacity-40">
              <Send className="h-5 w-5" /> أرسل الطلب للخادم {total > 0 && `— ${total} نقطة`}
            </button>
          </div>
        </section>
      )}

      {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}

      {/* items */}
      <div className="relative mb-2">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input id="child-shop-search" className="input-field pr-9" placeholder="ابحث عن صنف..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {items === null ? (
        <div className="flex justify-center py-10"><Loader2 className="h-7 w-7 animate-spin text-orange-500" /></div>
      ) : visible.length === 0 ? (
        <div className="card py-10 text-center text-slate-400">
          <Package className="mx-auto mb-2 h-9 w-9 text-orange-200" />
          <p className="text-sm font-bold">{items.length === 0 ? 'لا أصناف في هذا المتجر الآن' : 'لا نتائج'}</p>
        </div>
      ) : (
        <div id="child-shop-items" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {visible.map((it) => {
            const q = qtyOf(it.id);
            const out = it.stock - q <= 0;
            const tooPricey = total + it.price > balance;
            const disabled = locked || out || tooPricey;
            return (
              <button key={it.id} id={`child-item-${it.id}`} type="button" onClick={() => !locked && add(it, 1)} aria-disabled={disabled}
                className={`relative flex flex-col overflow-hidden rounded-2xl border bg-white text-right shadow-card transition active:scale-[0.98] ${
                  q > 0 ? 'border-orange-400 ring-2 ring-orange-200' : 'border-indigo-50'} ${disabled ? 'opacity-60' : 'hover:border-orange-300'}`}>
                <div className="relative aspect-square w-full bg-orange-50">
                  <ItemPicture url={it.image_url} name={it.name} fill />
                  {q > 0 && <span className="absolute right-2 top-2 flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-orange-600 px-1.5 text-xs font-extrabold text-white shadow">× {q}</span>}
                  {out && <span className="absolute inset-x-0 bottom-0 bg-red-600/90 py-0.5 text-center text-[11px] font-extrabold text-white">نفذت الكمية</span>}
                  {!out && tooPricey && !locked && <span className="absolute inset-x-0 bottom-0 bg-slate-700/85 py-0.5 text-center text-[11px] font-extrabold text-white"><AlertTriangle className="inline h-3 w-3" /> رصيدك لا يكفي</span>}
                </div>
                <div className="flex w-full items-center gap-1 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs font-extrabold">{it.name}</span>
                  <span className="badge bg-gold-100 text-gold-700 !px-1.5"><Star className="h-3 w-3" /> {it.price}</span>
                </div>
                {it.description && <p className="w-full truncate px-2 text-[10px] font-bold text-slate-400">{it.description}</p>}
                <p className="w-full px-2 pb-1.5 text-[10px] font-bold text-slate-400">متاح: {it.stock - q}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* confirm sheet */}
      {confirming && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6" onClick={() => !sending && setConfirming(false)}>
          <div id="child-cart-confirm" className="w-full max-w-md rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 flex items-center gap-2 text-lg font-extrabold"><Send className="h-5 w-5 text-orange-600" /> إرسال الطلب للخادم؟</h3>
            <p className="mb-3 text-xs font-bold text-slate-500">
              سيصل طلبك للخادم فوراً. <span className="text-slate-800">لن تُخصم نقاطك الآن</span> — تُخصم ({total} نقطة) عندما يمسح الخادم كارتك ويسلّمك الأصناف.
            </p>
            <ul className="mb-3 max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-100 text-sm">
              {lines.map((l) => (
                <li key={l.item.id} className="flex items-center justify-between px-3 py-1.5">
                  <span className="font-bold">{l.item.name} <span className="text-slate-400">× {l.qty}</span></span>
                  <span className="tabular-nums font-extrabold text-orange-700">{l.item.price * l.qty}</span>
                </li>
              ))}
            </ul>
            <input className="input-field mb-3" placeholder="ملاحظة للخادم (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={sending} onClick={() => setConfirming(false)} className="btn-secondary">رجوع</button>
              <button id="child-cart-confirm-yes" type="button" disabled={sending} onClick={send} className="btn-primary flex items-center justify-center gap-2 !from-orange-600 !to-orange-500">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} نعم، أرسل
              </button>
            </div>
          </div>
        </div>
      )}

      {openReq && (
        <RequestSheet r={openReq} onClose={() => setOpenReq(null)}
          onCancel={openReq.status === 'pending' ? () => cancelReq(openReq) : undefined} cancelling={cancelling} />
      )}

      {toast && (
        <div role="status" className="fixed inset-x-4 bottom-24 z-[70] mx-auto max-w-md rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white shadow-xl">{toast}</div>
      )}

      {sent && (
        <p className="mt-4 text-center text-xs font-bold text-slate-400">
          <Link href="/child/store" className="text-orange-600 underline">كل طلباتي وفواتيري</Link>
          <button type="button" onClick={() => router.push('/child/store')} className="sr-only">رجوع</button>
        </p>
      )}
    </>
  );
}

function BackBar({ title }: { title: string }) {
  return (
    <section className="mb-3 flex items-center gap-2">
      <Link href="/child/store" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100"><ArrowRight className="h-5 w-5" /></Link>
      <h2 className="truncate text-lg font-extrabold">{title}</h2>
    </section>
  );
}
