'use client';

// ---------- Child portal — store shared bits (المتجر) ----------
// ShopCard      : a shop tile (picture · name · items · pending badge)
// RequestCard   : one of my purchase requests with its status
// RequestSheet  : full request (lines · totals · decision) + cancel while pending
// ReceiptSheet  : a receipt (store_orders) with its lines — same look as the
//                 bill in the points page, plus the shop and the source

import Image from 'next/image';
import Link from 'next/link';
import {
  Store, ChevronLeft, Hourglass, Check, Ban, X, Receipt, Clock, User, ImageIcon, Star, MessageSquare, Smartphone, ScanLine,
} from 'lucide-react';
import { fmtDate, fmtTime } from '@/components/child/ChildBits';
import type { ChildShop, ChildStoreRequest, ChildStoreRequestStatus, ChildStoreOrder } from '@/lib/child-portal';

export const REQUEST_STATUS: Record<ChildStoreRequestStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  pending:   { label: 'بانتظار الخادم', cls: 'bg-amber-100 text-amber-700', icon: <Hourglass className="h-3 w-3" /> },
  approved:  { label: 'تم التسليم', cls: 'bg-emerald-100 text-emerald-700', icon: <Check className="h-3 w-3" /> },
  rejected:  { label: 'مرفوض', cls: 'bg-red-100 text-red-600', icon: <Ban className="h-3 w-3" /> },
  cancelled: { label: 'ألغيته', cls: 'bg-slate-200 text-slate-600', icon: <X className="h-3 w-3" /> },
};

export function ShopPicture({ url, name, size = 56, className = '' }: { url: string | null; name: string; size?: number; className?: string }) {
  return (
    <span className={`relative shrink-0 overflow-hidden rounded-2xl bg-orange-100 text-orange-400 ring-1 ring-orange-200 ${className}`} style={{ width: size, height: size }}>
      {url ? <Image src={url} alt={name} fill sizes={`${size}px`} className="object-cover" /> : <Store className="absolute inset-0 m-auto" style={{ width: size * 0.5, height: size * 0.5 }} />}
    </span>
  );
}

export function ItemPicture({ url, name, size = 40, fill = false }: { url: string | null; name: string; size?: number; fill?: boolean }) {
  return (
    <span className={`relative shrink-0 overflow-hidden bg-orange-50 text-orange-300 ${fill ? 'block h-full w-full' : 'rounded-lg ring-1 ring-orange-100'}`} style={fill ? undefined : { width: size, height: size }}>
      {url ? <Image src={url} alt={name} fill sizes={fill ? '50vw' : `${size}px`} className="object-cover" /> : <ImageIcon className="absolute inset-0 m-auto" style={fill ? { width: '40%', height: '40%' } : { width: size * 0.45, height: size * 0.45 }} />}
    </span>
  );
}

export function ShopCard({ shop }: { shop: ChildShop }) {
  return (
    <Link id={`child-shop-${shop.id}`} href={`/child/store/${shop.id}`} className="card flex items-center gap-3 !p-3 transition hover:bg-orange-50/40">
      <ShopPicture url={shop.image_url} name={shop.name} size={56} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-extrabold">{shop.name}</span>
        {shop.description && <span className="block truncate text-xs text-slate-500">{shop.description}</span>}
        <span className="mt-0.5 block text-[11px] font-bold text-slate-400">{shop.items_count} صنف متاح · {shop.church_name}</span>
      </span>
      {shop.pending_requests > 0 && <span className="rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-extrabold text-white"><Hourglass className="inline h-3 w-3" /> طلب بانتظار</span>}
      <ChevronLeft className="h-4 w-4 text-slate-300" />
    </Link>
  );
}

export function RequestCard({ r, onOpen }: { r: ChildStoreRequest; onOpen: () => void }) {
  const st = REQUEST_STATUS[r.status];
  return (
    <button id={`child-req-${r.id}`} type="button" onClick={onOpen} className="card flex w-full items-center gap-3 !p-3 text-right transition hover:bg-orange-50/40">
      <ShopPicture url={r.shop_image_url} name={r.shop_name} size={44} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-extrabold">{r.shop_name}</span>
        <span className="block text-[11px] font-bold text-slate-400"><Clock className="inline h-3 w-3" /> {fmtDate(r.created_at)} · {fmtTime(r.created_at)} · {r.items_count} قطعة</span>
      </span>
      <span className="flex flex-col items-end gap-1">
        <span className={`badge ${st.cls}`}>{st.icon} {st.label}</span>
        <span className="badge bg-orange-100 text-orange-700 tabular-nums"><Star className="h-3 w-3" /> {r.total_points}</span>
      </span>
    </button>
  );
}

function Lines({ items }: { items: { id: string; item_name: string; image_url: string | null; unit_price: number; qty: number; line_total: number }[] }) {
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-100">
      {items.map((l) => (
        <li key={l.id} className="flex items-center gap-2.5 px-3 py-2">
          <ItemPicture url={l.image_url} name={l.item_name} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold">{l.item_name}</p>
            <p className="text-[11px] font-bold text-slate-400">{l.unit_price} × {l.qty}</p>
          </div>
          <span className="tabular-nums text-sm font-extrabold text-orange-700">{l.line_total}</span>
        </li>
      ))}
    </ul>
  );
}

function Sheet({ title, icon, onClose, children }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-extrabold">{icon} {title}</h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function RequestSheet({ r, onClose, onCancel, cancelling, receipt, onOpenReceipt }: {
  r: ChildStoreRequest; onClose: () => void;
  onCancel?: () => void; cancelling?: boolean;
  receipt?: ChildStoreOrder | null; onOpenReceipt?: () => void;
}) {
  const st = REQUEST_STATUS[r.status];
  return (
    <Sheet title="طلب شراء" icon={<Store className="h-5 w-5 text-orange-600" />} onClose={onClose}>
      <div id="child-req-sheet">
        <div className="mb-3 flex items-center gap-3">
          <ShopPicture url={r.shop_image_url} name={r.shop_name} size={48} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-extrabold">{r.shop_name}</p>
            <p className="text-xs font-bold text-slate-400"><Clock className="inline h-3 w-3" /> {fmtDate(r.created_at)} · {fmtTime(r.created_at)}</p>
          </div>
          <span className={`badge ${st.cls}`}>{st.icon} {st.label}</span>
        </div>

        <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs font-bold">
          <div className="rounded-xl bg-slate-50 py-2"><p className="text-lg font-extrabold tabular-nums text-slate-500">{r.balance_at_request}</p>رصيدك عند الطلب</div>
          <div className="rounded-xl bg-orange-50 py-2"><p className="text-lg font-extrabold tabular-nums text-orange-600">{r.total_points}</p>قيمة الطلب</div>
          <div className="rounded-xl bg-emerald-50 py-2"><p className="text-lg font-extrabold tabular-nums text-emerald-600">{r.balance_at_request - r.total_points}</p>{r.status === 'approved' ? 'رصيدك بعد' : 'المتبقي المتوقع'}</div>
        </div>

        <Lines items={r.items} />

        {r.note && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600"><MessageSquare className="inline h-3.5 w-3.5" /> ملاحظتك: {r.note}</p>}

        {r.status === 'pending' && (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
            <p className="flex items-center gap-2 text-sm font-extrabold"><ScanLine className="h-5 w-5" /> اذهب إلى الخادم ومعك كارتك</p>
            <p className="mt-1">الخادم يمسح كارتك كتأكيد ثم يسلّمك الأصناف — عندها فقط تُخصم النقاط وتظهر لك الفاتورة.</p>
            {onCancel && (
              <button id="child-req-cancel" type="button" disabled={cancelling} onClick={onCancel} className="mt-3 flex w-full items-center justify-center gap-1 rounded-xl bg-white py-2 text-xs font-extrabold text-red-600 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50">
                <X className="h-4 w-4" /> إلغاء الطلب
              </button>
            )}
          </div>
        )}
        {r.status === 'approved' && (
          <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
            <p className="flex items-center gap-2 text-sm font-extrabold"><Check className="h-5 w-5" /> تم التسليم — خُصمت النقاط</p>
            <p className="mt-1"><User className="inline h-3 w-3" /> {r.decided_by_name ?? 'الخادم'}{r.decided_at ? ` · ${fmtDate(r.decided_at)} ${fmtTime(r.decided_at)}` : ''}</p>
            {r.decision_note && <p className="mt-1">📝 {r.decision_note}</p>}
            {receipt && onOpenReceipt && (
              <button id="child-req-receipt" type="button" onClick={onOpenReceipt} className="mt-3 flex w-full items-center justify-center gap-1 rounded-xl bg-white py-2 text-xs font-extrabold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100">
                <Receipt className="h-4 w-4" /> عرض الفاتورة
              </button>
            )}
          </div>
        )}
        {r.status === 'rejected' && (
          <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">
            <p className="flex items-center gap-2 text-sm font-extrabold"><Ban className="h-5 w-5" /> رفض الخادم الطلب — لم تُخصم أي نقاط</p>
            {r.decision_note && <p className="mt-1">السبب: {r.decision_note}</p>}
            <p className="mt-1 text-red-500"><User className="inline h-3 w-3" /> {r.decided_by_name ?? 'الخادم'}{r.decided_at ? ` · ${fmtDate(r.decided_at)}` : ''}</p>
          </div>
        )}
        {r.status === 'cancelled' && <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">ألغيت هذا الطلب قبل تسليمه.</p>}
      </div>
    </Sheet>
  );
}

export function ReceiptSheet({ bill, onClose }: { bill: ChildStoreOrder; onClose: () => void }) {
  return (
    <Sheet title="فاتورة إستبدال النقاط" icon={<Receipt className="h-5 w-5 text-orange-600" />} onClose={onClose}>
      <div id="child-receipt-sheet">
        <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-slate-500">
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtDate(bill.created_at)} · {fmtTime(bill.created_at)}</span>
          {bill.shop_name && <span className="flex items-center gap-1 text-orange-600"><Store className="h-3 w-3" /> {bill.shop_name}</span>}
          {bill.source === 'request' && <span className="flex items-center gap-1 text-sky-600"><Smartphone className="h-3 w-3" /> طلب من البوابة</span>}
          {bill.recorded_by_name && <span className="flex items-center gap-1"><User className="h-3 w-3" /> {bill.recorded_by_name}</span>}
          <span className={`badge ${bill.status === 'cancelled' ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-700'}`}>
            {bill.status === 'cancelled' ? <><Ban className="h-3 w-3" /> ملغاة — استُردّت النقاط</> : <><Check className="h-3 w-3" /> مكتملة</>}
          </span>
        </p>
        <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs font-bold">
          <div className="rounded-xl bg-slate-50 py-2"><p className="text-lg font-extrabold tabular-nums text-slate-500">{bill.balance_before}</p>الرصيد قبل</div>
          <div className="rounded-xl bg-orange-50 py-2"><p className="text-lg font-extrabold tabular-nums text-orange-600">−{bill.total_points}</p>المستبدل</div>
          <div className="rounded-xl bg-emerald-50 py-2"><p className="text-lg font-extrabold tabular-nums text-emerald-600">{bill.balance_after}</p>الرصيد بعد</div>
        </div>
        <Lines items={bill.items} />
        {bill.note && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">📝 {bill.note}</p>}
      </div>
    </Sheet>
  );
}
