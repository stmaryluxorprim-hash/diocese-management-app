'use client';

// ---------- POINTS STORE — ARCHIVE of ONE shop (أرشيف الفواتير) ----------
// 20261002120000: the shop is the container — every saved bill of
// /store/[shop] (RLS), newest first, server-paged, search by child name /
// national id, status filter.
// Tapping a bill opens its detail (lines, balance before / after, seller,
// note). Managers (owner / church / service) can CANCEL a completed bill:
// points are refunded + stock restored (store_cancel_order RPC).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Search, Loader2, Archive, Star, ChevronDown, X, Receipt, Clock, User, Ban, Check, School, AlertTriangle, Smartphone,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { PersonAvatar } from '@/components/CallFeedback';
import { StoreHeader, ItemThumb, ShopMissing, useStoreShop, useStoreLookups, Toast } from '@/components/store/StoreBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime, scopeFilter } from '@/lib/realtime';
import {
  fetchStoreOrders, fetchStoreOrderItems, fetchRecorderNames, storeCancelOrder, storeErrorMessage,
  isMigrationMissing, MIGRATION_HINT, ORDERS_PAGE_SIZE, isShopsMigrationMissing, SHOPS_MIGRATION_HINT, type StoreOrderWithPerson,
} from '@/lib/store';
import { STORE_ORDER_STATUS_LABELS, type StoreOrderItem, type StoreOrderStatus } from '@/lib/types';
import { APP_TZ } from '@/lib/time';

const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('ar-EG', { timeZone: APP_TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
const dayKey = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat('ar-EG', { timeZone: APP_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

type StatusFilter = 'all' | StoreOrderStatus;

export default function ArchivePage() {
  const { shop: shopId } = useParams<{ shop: string }>();
  const { profile, scopes } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const isManager = !!profile && ['owner', 'church_manager', 'service_manager'].includes(profile.role);
  const { services, classes } = useStoreLookups(supabase, approved);
  const { shop, loading: shopLoading, missing, error: shopError } = useStoreShop(supabase, shopId ?? null, approved);
  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? '';

  const [search, setSearch] = useState('');
  const [searchQ, setSearchQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setSearchQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const [status, setStatus] = useState<StatusFilter>('all');

  const [orders, setOrders] = useState<StoreOrderWithPerson[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async (p: number, append: boolean) => {
    setLoading(true);
    try {
      const { rows, hasMore: more } = await fetchStoreOrders(
        supabase, {}, { page: p, search: searchQ, shopId: shopId ?? undefined });
      setOrders((prev) => {
        if (!append) return rows;
        const seen = new Set(prev.map((o) => o.id));
        return [...prev, ...rows.filter((r) => !seen.has(r.id))];
      });
      setHasMore(more);
      setPage(p);
      setMigrationMissing(false);
      const nm = await fetchRecorderNames(supabase, rows.flatMap((r) => [r.recorded_by, r.cancelled_by]));
      setNames((prev) => { const n = new Map(prev); nm.forEach((v, k) => n.set(k, v)); return n; });
    } catch (err) {
      if (isMigrationMissing(err)) setMigrationMissing(true);
    } finally { setLoading(false); }
  }, [supabase, shopId, searchQ]);

  useEffect(() => { if (approved && shop) load(0, false); }, [approved, shop, load]);
  useDebouncedRealtime(
    supabase, `store-archive-${shopId}`, [{ table: 'store_orders', filter: scopeFilter(profile, scopes) }],
    () => load(0, false), { enabled: approved && !!shop, delayMs: 800 }
  );

  const visible = useMemo(() => orders.filter((o) => status === 'all' || o.status === status), [orders, status]);
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; list: StoreOrderWithPerson[] }>();
    visible.forEach((o) => {
      const k = dayKey(o.created_at);
      const g = m.get(k) ?? { label: dayLabel(o.created_at), list: [] };
      g.list.push(o); m.set(k, g);
    });
    return Array.from(m.values());
  }, [visible]);

  const totals = useMemo(() => {
    const done = visible.filter((o) => o.status === 'completed');
    return { bills: done.length, points: done.reduce((s, o) => s + o.total_points, 0), items: done.reduce((s, o) => s + o.items_count, 0) };
  }, [visible]);

  // ---------- detail ----------
  const [detail, setDetail] = useState<StoreOrderWithPerson | null>(null);
  const [detailLines, setDetailLines] = useState<StoreOrderItem[] | null>(null);
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => {
    if (!detail) { setDetailLines(null); return; }
    let cancelled = false;
    fetchStoreOrderItems(supabase, detail.id).then((rows) => { if (!cancelled) setDetailLines(rows); }).catch(() => { if (!cancelled) setDetailLines([]); });
    return () => { cancelled = true; };
  }, [supabase, detail]);

  const cancelOrder = async (o: StoreOrderWithPerson) => {
    if (!confirm(`إلغاء هذه الفاتورة؟\nسيُستردّ ${o.total_points} نقطة لرصيد ${o.person?.name ?? 'المخدوم'} وتُعاد الكمية إلى المخزون.`)) return;
    setCancelling(true);
    try {
      const res = await storeCancelOrder(supabase, o.id);
      const patched: StoreOrderWithPerson = { ...o, status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: profile?.id ?? null };
      setOrders((l) => l.map((x) => (x.id === o.id ? patched : x)));
      setDetail(patched);
      flash(`تم الإلغاء — استُردّ ${res.refunded} نقطة (الرصيد الآن ${res.balance_after})`);
    } catch (err) { flash(storeErrorMessage(err, 'تعذر الإلغاء')); }
    finally { setCancelling(false); }
  };

  if (shopLoading) {
    return <AppShell><StoreHeader /><div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-orange-500" /></div></AppShell>;
  }
  if (missing || !shop) {
    return <AppShell><StoreHeader /><ShopMissing migrationHint={isShopsMigrationMissing(shopError) ? SHOPS_MIGRATION_HINT : null} /></AppShell>;
  }

  return (
    <AppShell>
      <StoreHeader shop={shop} title="الأرشيف" />
      {migrationMissing && <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">⚠️ {MIGRATION_HINT}</p>}

      <section className="mb-3 grid grid-cols-3 gap-2">
        <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-slate-700">{totals.bills}</p><p className="text-[10px] font-bold text-slate-400">فاتورة</p></div>
        <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-orange-600">{totals.points}</p><p className="text-[10px] font-bold text-slate-400">نقطة مُستبدلة</p></div>
        <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-primary-600">{totals.items}</p><p className="text-[10px] font-bold text-slate-400">قطعة</p></div>
      </section>

      <div className="relative mb-2">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input id="arch-search" className="input-field pr-9" placeholder="ابحث باسم المخدوم أو الرقم القومي..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="mb-3 flex gap-2">
        {([['all', 'الكل'], ['completed', 'مكتملة'], ['cancelled', 'ملغاة']] as [StatusFilter, string][]).map(([v, l]) => (
          <button key={v} id={`arch-status-${v}`} type="button" onClick={() => setStatus(v)}
            className={`flex-1 rounded-xl px-3 py-2 text-xs font-extrabold transition ${status === v ? 'bg-orange-600 text-white shadow' : 'border border-slate-200 bg-white text-slate-500'}`}>
            {l}
          </button>
        ))}
      </div>

      {loading && orders.length === 0 ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-orange-500" /></div>
      ) : groups.length === 0 ? (
        <div className="card py-12 text-center text-slate-400">
          <Archive className="mx-auto mb-3 h-10 w-10 text-orange-200" />
          <p className="font-bold">لا فواتير بعد</p>
        </div>
      ) : (
        <div id="arch-list" className="space-y-4">
          {groups.map((g, i) => (
            <section key={i}>
              <h3 className="mb-1.5 flex items-center justify-between text-xs font-extrabold text-slate-500">
                <span>{g.label}</span>
                <span className="badge bg-orange-100 text-orange-700 tabular-nums">−{g.list.filter((o) => o.status === 'completed').reduce((s, o) => s + o.total_points, 0)}</span>
              </h3>
              <ul className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
                {g.list.map((o) => (
                  <li key={o.id}>
                    <button id={`arch-order-${o.id}`} type="button" onClick={() => setDetail(o)} className={`flex w-full items-center gap-3 px-4 py-3 text-right hover:bg-orange-50/50 ${o.status === 'cancelled' ? 'opacity-60' : ''}`}>
                      <PersonAvatar name={o.person?.name ?? '—'} imageUrl={o.person?.image_url ?? null} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate font-extrabold ${o.status === 'cancelled' ? 'line-through' : ''}`}>{o.person?.name ?? 'مخدوم محذوف'}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] font-bold text-slate-400">
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtDateTime(o.created_at)}</span>
                          <span className="flex items-center gap-1"><School className="h-3 w-3" /> {className(o.class_id)}</span>
                          <span>{o.items_count} قطعة</span>
                          {o.source === 'request' && <span className="flex items-center gap-1 text-sky-600"><Smartphone className="h-3 w-3" /> طلب من البوابة</span>}
                        </span>
                      </span>
                      {o.status === 'cancelled'
                        ? <span className="badge bg-slate-200 text-slate-600"><Ban className="h-3 w-3" /> ملغاة</span>
                        : <span className="badge bg-orange-100 text-orange-700 tabular-nums"><Star className="h-3 w-3" /> −{o.total_points}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {hasMore && (
            <button id="arch-load-more" type="button" disabled={loading} onClick={() => load(page + 1, true)} className="btn-secondary flex w-full items-center justify-center gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />} عرض {ORDERS_PAGE_SIZE} فاتورة إضافية
            </button>
          )}
        </div>
      )}

      {/* ---------- detail modal ---------- */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={() => setDetail(null)}>
          <div id="arch-detail" className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-extrabold"><Receipt className="h-5 w-5 text-orange-600" /> فاتورة إستبدال</h3>
              <button type="button" onClick={() => setDetail(null)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>

            <div className="mb-3 flex items-center gap-3">
              <PersonAvatar name={detail.person?.name ?? '—'} imageUrl={detail.person?.image_url ?? null} size={52} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-extrabold">{detail.person?.name ?? 'مخدوم محذوف'}</p>
                <p className="truncate text-xs font-bold text-slate-400">{services.find((s) => s.id === detail.service_id)?.name} · {className(detail.class_id)} · <span dir="ltr">{detail.person?.national_id}</span></p>
              </div>
              <span className={`badge ${detail.status === 'cancelled' ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-700'}`}>
                {detail.status === 'cancelled' ? <Ban className="h-3 w-3" /> : <Check className="h-3 w-3" />} {STORE_ORDER_STATUS_LABELS[detail.status]}
              </span>
            </div>

            <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs font-bold">
              <div className="rounded-xl bg-slate-50 py-2"><p className="text-lg font-extrabold tabular-nums text-slate-500">{detail.balance_before}</p>الرصيد قبل</div>
              <div className="rounded-xl bg-orange-50 py-2"><p className="text-lg font-extrabold tabular-nums text-orange-600">−{detail.total_points}</p>المخصوم</div>
              <div className="rounded-xl bg-emerald-50 py-2"><p className="text-lg font-extrabold tabular-nums text-emerald-600">{detail.balance_after}</p>الرصيد بعد</div>
            </div>

            {detailLines === null ? (
              <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>
            ) : (
              <ul className="mb-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-100">
                {detailLines.map((l) => (
                  <li key={l.id} className="flex items-center gap-2.5 px-3 py-2">
                    <ItemThumb url={l.image_url} name={l.item_name} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-extrabold">{l.item_name}</p>
                      <p className="text-[11px] font-bold text-slate-400"><span dir="ltr" className="font-mono">{l.item_code}</span> · {l.unit_price} × {l.qty}</p>
                    </div>
                    <span className="tabular-nums text-sm font-extrabold text-orange-700">{l.line_total}</span>
                  </li>
                ))}
                {detailLines.length === 0 && <li className="px-3 py-4 text-center text-xs font-bold text-slate-400">بدون بنود</li>}
              </ul>
            )}

            <div className="space-y-1 text-[11px] font-bold text-slate-500">
              <p className="flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtDateTime(detail.created_at)}</p>
              <p className="flex items-center gap-1">
                {detail.source === 'request' ? <><Smartphone className="h-3 w-3 text-sky-600" /> طلب أرسله المخدوم من بوابته واعتمده بعد مسح الكارت:</> : <><User className="h-3 w-3" /> الكاشير:</>}
                {' '}{names.get(detail.recorded_by ?? '') ?? '—'}
              </p>
              {detail.note && <p className="rounded-lg bg-slate-50 px-2 py-1">📝 {detail.note}</p>}
              {detail.status === 'cancelled' && detail.cancelled_at && (
                <p className="flex items-center gap-1 text-red-500"><Ban className="h-3 w-3" /> أُلغيت {fmtDateTime(detail.cancelled_at)} بواسطة {names.get(detail.cancelled_by ?? '') ?? '—'} — استُردّت النقاط والكمية</p>
              )}
            </div>

            {isManager && detail.status === 'completed' && (
              <button id="arch-cancel-order" type="button" disabled={cancelling} onClick={() => cancelOrder(detail)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 py-3 text-sm font-extrabold text-red-600 hover:bg-red-100 disabled:opacity-50">
                {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />} إلغاء الفاتورة واسترداد النقاط
              </button>
            )}
          </div>
        </div>
      )}
      <Toast msg={toast} />
    </AppShell>
  );
}
