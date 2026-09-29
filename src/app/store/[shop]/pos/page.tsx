'use client';

// ---------- POINTS STORE — POS / الكاشير of ONE shop ----------
// 20261002120000: the shop is the container — the basket holds THIS shop's
// items only and the sale is stamped with the shop. The child search /
// scan is limited to the places the shop is connected to.
// Flow:
//   1. No basket: scan the child's QR (national id) or search by name /
//      phone / national id (scoped list, server-side search). A child
//      enrolled in several classes → pick the enrollment.
//   2. Basket open: header card with the child (name · picture · class)
//      and his LIVE balance (realtime on the enrollment row). Add items by
//      scanning their QR label (same camera) or picking from the scoped
//      item grid; +/− quantity per line. Live total, remaining balance.
//      Adding is REFUSED when the total would exceed the balance or the
//      stock — the DB re-checks the same rules in the checkout RPC.
//   3. «إتمام العملية» → confirm sheet → store_checkout → receipt
//      (saved in the archive, deducted from the child's points, visible in
//      the child portal points page) → new basket.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Search, Loader2, Star, Plus, Minus, Trash2, ShoppingCart, X, Check, AlertTriangle,
  UserRound, Package, Receipt, ArrowLeftRight, RotateCcw, Archive, Layers, School,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { PersonAvatar } from '@/components/CallFeedback';
import QrScanner from '@/components/store/QrScanner';
import {
  StoreHeader, ItemThumb, ShopMissing, useStoreShop, useStoreLookups, Toast,
} from '@/components/store/StoreBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime, onBusTable } from '@/lib/realtime';
import { fetchEnrollmentsPage } from '@/lib/queries';
import {
  fetchStoreItems, lookupStoreItem, storeCheckout, storeErrorMessage, isMigrationMissing, MIGRATION_HINT,
  isShopsMigrationMissing, SHOPS_MIGRATION_HINT, basketTotal, basketCount, shopCovers, type BasketLine,
} from '@/lib/store';
import type { EnrollmentWithPerson, StoreItem, StoreCheckoutResult, Person } from '@/lib/types';

type Receipt = StoreCheckoutResult & { person: Person; lines: BasketLine[]; className: string };

export default function PosPage() {
  const { shop: shopId } = useParams<{ shop: string }>();
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { services, classes } = useStoreLookups(supabase, approved);
  const { shop, loading: shopLoading, missing, error: shopError } = useStoreShop(supabase, shopId ?? null, approved);
  // the child must be in a place the shop is connected to
  const covered = useCallback((e: Pick<EnrollmentWithPerson, 'church_id' | 'service_id' | 'class_id'>) =>
    !!shop && shopCovers(shop.targets, e), [shop]);
  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? '';

  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };
  const [migrationMissing, setMigrationMissing] = useState(false);

  // ---------- step 1: child ----------
  const [search, setSearch] = useState('');
  const [searchQ, setSearchQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setSearchQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const [results, setResults] = useState<EnrollmentWithPerson[]>([]);
  const [searching, setSearching] = useState(false);
  const [picker, setPicker] = useState<{ person: Person; options: EnrollmentWithPerson[] } | null>(null);

  const [child, setChild] = useState<EnrollmentWithPerson | null>(null);
  const [balance, setBalance] = useState(0);

  useEffect(() => {
    if (!approved || child || searchQ.length < 2) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    fetchEnrollmentsPage(supabase, {}, { search: searchQ, pageSize: 40 })
      .then(({ rows }) => { if (!cancelled) setResults(rows.filter(covered)); })
      .catch(() => { if (!cancelled) setResults([]); })
      .finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [approved, child, searchQ, supabase, covered]);

  const openBasket = (e: EnrollmentWithPerson) => {
    setChild(e);
    setBalance(e.points);
    setLines([]);
    setPicker(null);
    setSearch('');
    setResults([]);
    setReceipt(null);
  };

  const handleChildCode = useCallback(async (code: string) => {
    const { data, error } = await supabase.rpc('lookup_enrollments_by_national_id', { p_national_id: code.trim() });
    if (error) { flash('تعذر البحث عن الكود'); return false; }
    const all = ((data ?? []) as EnrollmentWithPerson[]).filter((e) => e.person);
    if (all.length === 0) return false;
    const list = all.filter(covered);
    if (list.length === 0) { flash(`«${all[0].person.name}» ليس في الأماكن المرتبطة بهذا المتجر`); return true; }
    if (list.length === 1) openBasket(list[0]);
    else setPicker({ person: list[0].person, options: list });
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, covered]);

  // Live balance while the basket is open (0046: enrollments travel on the
  // broadcast bus — re-read the one row when a message names this child)
  useEffect(() => {
    if (!child) return;
    let cancelled = false;
    const readBalance = () => {
      supabase.from('enrollments').select('points').eq('id', child.id).maybeSingle()
        .then(({ data }) => { if (!cancelled && data && typeof data.points === 'number') setBalance(data.points); });
    };
    readBalance();
    const off = onBusTable('enrollments', (m) => {
      if (m.op !== 'UPDATE') return;
      if (m.ids && m.ids.length > 0 && !m.ids.includes(child.id)) return;
      readBalance();
    });
    return () => { cancelled = true; off(); };
  }, [supabase, child]);

  // ---------- step 2: items + basket ----------
  const [items, setItems] = useState<StoreItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [lines, setLines] = useState<BasketLine[]>([]);

  // the items of THIS shop (active) — realtime on store_items
  const loadItems = useCallback(async () => {
    if (!child || !shopId) return;
    setItemsLoading(true);
    try {
      setItems(await fetchStoreItems(supabase, {}, { activeOnly: true, shopId }));
      setMigrationMissing(false);
    } catch (err) {
      if (isMigrationMissing(err)) setMigrationMissing(true);
    } finally { setItemsLoading(false); }
  }, [supabase, child, shopId]);
  useEffect(() => { loadItems(); }, [loadItems]);
  useDebouncedRealtime(supabase, `pos-items-${shopId}`, [{ table: 'store_items' }], loadItems, { enabled: !!child, delayMs: 600 });

  // keep basket lines in sync with fresh item rows (price / stock changes)
  useEffect(() => {
    if (items.length === 0) return;
    setLines((ls) => ls
      .map((l) => { const fresh = items.find((i) => i.id === l.item.id); return fresh ? { ...l, item: fresh, qty: Math.min(l.qty, fresh.stock) } : null; })
      .filter((l): l is BasketLine => !!l && l.qty > 0));
  }, [items]);

  const total = basketTotal(lines);
  const count = basketCount(lines);
  const remaining = balance - total;
  const qtyOf = (id: string) => lines.find((l) => l.item.id === id)?.qty ?? 0;

  /** Try to add `d` more of an item. Returns an error message or null. */
  const addQty = (it: StoreItem, d = 1): string | null => {
    const cur = qtyOf(it.id);
    const next = cur + d;
    if (next <= 0) { setLines((ls) => ls.filter((l) => l.item.id !== it.id)); return null; }
    if (next > it.stock) return it.stock === 0 ? `«${it.name}» نفذت كميته` : `الكمية المتاحة من «${it.name}» هي ${it.stock} فقط`;
    if (d > 0 && total + it.price * d > balance) return `الرصيد لا يكفي — المتبقي ${remaining} نقطة و«${it.name}» سعره ${it.price}`;
    setLines((ls) => (cur === 0 ? [...ls, { item: it, qty: next }] : ls.map((l) => (l.item.id === it.id ? { ...l, qty: next } : l))));
    return null;
  };
  const tryAdd = (it: StoreItem, d = 1) => { const err = addQty(it, d); if (err) flash(err); };
  const removeLine = (id: string) => setLines((ls) => ls.filter((l) => l.item.id !== id));

  const handleItemCode = useCallback(async (code: string): Promise<boolean> => {
    if (!child) return false;
    // local first (fast), then RPC (RLS-scoped) for codes not yet loaded
    let found = items.find((i) => i.code.toLowerCase() === code.trim().toLowerCase());
    if (!found) {
      try {
        const rows = await lookupStoreItem(supabase, code);
        found = rows.find((r) => r.shop_id === shopId);
        if (!found && rows.length) { flash(`«${rows[0].name}» ليس من أصناف هذا المتجر`); return true; }
      } catch (err) { flash(storeErrorMessage(err)); return true; }
    }
    if (!found) return false;
    if (!found.is_active) { flash(`«${found.name}» غير متاح للبيع`); return true; }
    const err = addQty(found, 1);
    flash(err ?? `＋ ${found.name}`);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [child, items, supabase, lines, total, balance, shopId]);

  // One camera for both: a code is tried as an item first (basket open),
  // then as a child card (switches the basket if the current one is empty).
  const confirmOpen = useRef(false);
  const onCode = useCallback(async (code: string) => {
    if (child) {
      if (await handleItemCode(code)) return;
      if (lines.length === 0) { if (await handleChildCode(code)) return; }
      else {
        const { data } = await supabase.rpc('lookup_enrollments_by_national_id', { p_national_id: code.trim() });
        if ((data ?? []).length) { flash('أتمم أو ألغِ السلة الحالية أولاً قبل مسح مخدوم آخر'); return; }
      }
      flash('كود غير معروف — ليس صنفاً ولا كارت مخدوم');
      return;
    }
    if (!(await handleChildCode(code))) flash('كود غير معروف أو المخدوم خارج نطاق صلاحيتك');
  }, [child, lines.length, handleItemCode, handleChildCode, supabase]);

  const visibleItems = useMemo(() => {
    const s = itemSearch.trim().toLowerCase();
    return items.filter((it) => !s || it.name.toLowerCase().includes(s) || it.code.toLowerCase().includes(s));
  }, [items, itemSearch]);

  // ---------- step 3: checkout ----------
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  confirmOpen.current = confirming;

  const checkout = async () => {
    if (!child || lines.length === 0) return;
    setSubmitting(true);
    try {
      const res = await storeCheckout(supabase, child.id, lines, note, shopId);
      setReceipt({ ...res, person: child.person, lines, className: className(child.class_id) });
      setConfirming(false);
      setNote('');
      setChild(null);
      setLines([]);
    } catch (err) {
      flash(storeErrorMessage(err, 'تعذر إتمام العملية'));
      loadItems(); // refresh stock / prices after a refusal
    } finally { setSubmitting(false); }
  };

  const cancelBasket = () => {
    if (lines.length > 0 && !confirm('إلغاء السلة الحالية؟')) return;
    setChild(null); setLines([]); setNote('');
  };

  // ============================== RENDER ==============================
  if (shopLoading) {
    return <AppShell><StoreHeader /><div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-orange-500" /></div></AppShell>;
  }
  if (missing || !shop) {
    return <AppShell><StoreHeader /><ShopMissing migrationHint={isShopsMigrationMissing(shopError) ? SHOPS_MIGRATION_HINT : null} /></AppShell>;
  }
  return (
    <AppShell>
      <StoreHeader shop={shop} title="الكاشير" />
      {migrationMissing && <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">⚠️ {MIGRATION_HINT}</p>}

      {/* ---------- receipt ---------- */}
      {receipt && (
        <section id="pos-receipt" className="card mb-4 border-emerald-100 bg-emerald-50/60">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-6 w-6" /></span>
            <div className="flex-1">
              <p className="font-extrabold text-emerald-800">تمت العملية وحُفظت الفاتورة</p>
              <p className="text-xs font-bold text-emerald-700">{receipt.person.name} · {receipt.className}</p>
            </div>
            <button type="button" onClick={() => setReceipt(null)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-emerald-100"><X className="h-4 w-4" /></button>
          </div>
          <ul className="mb-2 divide-y divide-emerald-100 rounded-xl bg-white text-sm">
            {receipt.lines.map((l) => (
              <li key={l.item.id} className="flex items-center justify-between px-3 py-1.5">
                <span className="font-bold">{l.item.name} <span className="text-slate-400">× {l.qty}</span></span>
                <span className="tabular-nums font-extrabold text-orange-700">{l.item.price * l.qty}</span>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-3 gap-2 text-center text-xs font-bold">
            <div className="rounded-xl bg-white py-2"><p className="text-lg font-extrabold tabular-nums text-orange-600">−{receipt.total_points}</p>المخصوم</div>
            <div className="rounded-xl bg-white py-2"><p className="text-lg font-extrabold tabular-nums text-slate-500">{receipt.balance_before}</p>الرصيد قبل</div>
            <div className="rounded-xl bg-white py-2"><p className="text-lg font-extrabold tabular-nums text-emerald-600">{receipt.balance_after}</p>الرصيد بعد</div>
          </div>
          <Link href={`/store/${shop.id}/archive`} className="mt-2 flex items-center justify-center gap-1 text-xs font-bold text-emerald-700"><Archive className="h-3.5 w-3.5" /> عرض في الأرشيف</Link>
        </section>
      )}

      {/* ---------- step 1: pick the child ---------- */}
      {!child && (
        <>
          {shop.targets.length === 0 && (
            <p className="mb-3 rounded-2xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600">المتجر غير مرتبط بأي مكان — اربطه بكنيسة / خدمة / فصل من صفحة المتجر ليمكن البيع فيه.</p>
          )}
          <QrScanner onCode={onCode} hint="امسح كارت المخدوم (QR)" className="mb-3" />

          <div className="relative mb-2">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="pos-child-search" className="input-field pr-9" placeholder="أو ابحث عن المخدوم بالاسم أو الهاتف أو الرقم القومي..."
              value={search} onChange={(e) => setSearch(e.target.value)} />
            {searching && <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
          </div>

          {picker && (
            <div id="pos-enrollment-picker" className="card mb-3">
              <p className="mb-2 flex items-center gap-1 text-sm font-extrabold"><Layers className="h-4 w-4 text-primary-600" /> {picker.person.name} مسجل في أكثر من فصل — اختر:</p>
              <div className="space-y-1.5">
                {picker.options.map((o) => (
                  <button key={o.id} type="button" onClick={() => openBasket(o)} className="flex w-full items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-right text-sm font-bold hover:bg-orange-50">
                    <School className="h-4 w-4 text-slate-400" />
                    <span className="flex-1">{services.find((s) => s.id === o.service_id)?.name} · {className(o.class_id)}</span>
                    <span className="badge bg-gold-100 text-gold-700"><Star className="h-3 w-3" /> {o.points}</span>
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setPicker(null)} className="mt-2 text-xs font-bold text-slate-400">إلغاء</button>
            </div>
          )}

          {results.length > 0 && (
            <ul id="pos-child-results" className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
              {results.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => openBasket(e)} className="flex w-full items-center gap-3 px-4 py-3 text-right hover:bg-orange-50/60">
                    <PersonAvatar name={e.person.name} imageUrl={e.person.image_url} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-extrabold">{e.person.name}</span>
                      <span className="block truncate text-xs text-slate-400">{className(e.class_id)} · <span dir="ltr">{e.person.national_id}</span></span>
                    </span>
                    <span className="badge bg-gold-100 text-gold-700"><Star className="h-3 w-3" /> {e.points}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searchQ.length >= 2 && !searching && results.length === 0 && !picker && (
            <p className="card py-6 text-center text-sm font-bold text-slate-400">لا نتائج</p>
          )}
        </>
      )}

      {/* ---------- step 2: basket ---------- */}
      {child && (
        <>
          {/* child card + live balance */}
          <section id="pos-child-card" className="card mb-3 bg-gradient-to-l from-orange-500 to-amber-400 text-white border-0">
            <div className="flex items-center gap-3">
              <PersonAvatar name={child.person.name} imageUrl={child.person.image_url} size={52} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-extrabold">{child.person.name}</p>
                <p className="truncate text-xs font-bold text-orange-50">{services.find((s) => s.id === child.service_id)?.name} · {className(child.class_id)}</p>
              </div>
              <button id="pos-cancel-basket" type="button" onClick={cancelBasket} aria-label="إلغاء السلة" className="rounded-full bg-white/20 p-2 hover:bg-white/30"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-white/20 py-2"><p className="text-xl font-extrabold tabular-nums">{balance}</p><p className="text-[11px] font-bold">الرصيد</p></div>
              <div className="rounded-xl bg-white/20 py-2"><p className="text-xl font-extrabold tabular-nums">−{total}</p><p className="text-[11px] font-bold">السلة ({count})</p></div>
              <div className={`rounded-xl py-2 ${remaining < 0 ? 'bg-red-600' : 'bg-white/30'}`}><p className="text-xl font-extrabold tabular-nums">{remaining}</p><p className="text-[11px] font-bold">المتبقي بعد الشراء</p></div>
            </div>
          </section>

          {/* basket lines */}
          <section id="pos-basket" className="card mb-3 !p-0 overflow-hidden">
            <div className="flex items-center gap-2 bg-orange-50/70 px-4 py-2 text-sm font-extrabold text-orange-800">
              <ShoppingCart className="h-4 w-4" /> السلة
              <span className="badge bg-white text-orange-700 tabular-nums">{count} قطعة</span>
              <span className="mr-auto tabular-nums">{total} <Star className="inline h-3.5 w-3.5 text-gold-500" /></span>
            </div>
            {lines.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs font-bold text-slate-400">السلة فارغة — امسح ملصق الصنف أو اختره من القائمة بالأسفل</p>
            ) : (
              <ul className="divide-y divide-orange-50">
                {lines.map((l) => (
                  <li key={l.item.id} className="flex items-center gap-2.5 px-3 py-2.5">
                    <ItemThumb url={l.item.image_url} name={l.item.name} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-extrabold">{l.item.name}</p>
                      <p className="text-[11px] font-bold text-slate-400">{l.item.price} × {l.qty} = <span className="text-orange-700">{l.item.price * l.qty}</span></p>
                    </div>
                    <span className="inline-flex items-center overflow-hidden rounded-lg ring-1 ring-slate-200">
                      <button type="button" aria-label="إنقاص" onClick={() => tryAdd(l.item, -1)} className="px-2.5 py-1.5 text-slate-600 hover:bg-slate-100"><Minus className="h-4 w-4" /></button>
                      <span className="min-w-[2rem] text-center text-sm font-extrabold tabular-nums">{l.qty}</span>
                      <button type="button" aria-label="زيادة" onClick={() => tryAdd(l.item, +1)} disabled={l.qty >= l.item.stock || total + l.item.price > balance} className="px-2.5 py-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30"><Plus className="h-4 w-4" /></button>
                    </span>
                    <button type="button" aria-label="حذف" onClick={() => removeLine(l.item.id)} className="rounded-full bg-red-50 p-2 text-red-500 hover:bg-red-100"><Trash2 className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2 p-3">
              <button id="pos-checkout" type="button" disabled={lines.length === 0 || remaining < 0} onClick={() => setConfirming(true)}
                className="btn-primary flex flex-1 items-center justify-center gap-2 !from-emerald-600 !to-emerald-500">
                <Receipt className="h-5 w-5" /> إتمام العملية {total > 0 && `— ${total} نقطة`}
              </button>
              {lines.length > 0 && (
                <button type="button" onClick={() => setLines([])} aria-label="تفريغ السلة" title="تفريغ السلة" className="btn-secondary !px-3"><RotateCcw className="h-4 w-4" /></button>
              )}
            </div>
          </section>

          {/* scanner for items */}
          <QrScanner onCode={onCode} paused={confirming} hint="امسح ملصق QR للصنف لإضافته" className="mb-3" />

          {/* item grid */}
          <div className="relative mb-2">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="pos-item-search" className="input-field pr-9" placeholder="ابحث عن صنف بالاسم أو الكود..." value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} />
          </div>
          {itemsLoading && items.length === 0 ? (
            <div className="flex justify-center py-10"><Loader2 className="h-7 w-7 animate-spin text-orange-500" /></div>
          ) : visibleItems.length === 0 ? (
            <div className="card py-10 text-center text-slate-400">
              <Package className="mx-auto mb-2 h-9 w-9 text-orange-200" />
              <p className="text-sm font-bold">{items.length === 0 ? 'لا أصناف متاحة لفصل هذا المخدوم' : 'لا نتائج'}</p>
              {items.length === 0 && <Link href={`/store/${shop.id}/inventory`} className="mt-2 inline-block text-xs font-bold text-orange-600">إدارة مخزون المتجر ←</Link>}
            </div>
          ) : (
            <div id="pos-item-grid" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {visibleItems.map((it) => {
                const q = qtyOf(it.id);
                const out = it.stock - q <= 0;
                const tooPricey = total + it.price > balance;
                const disabled = out || tooPricey;
                return (
                  <button key={it.id} id={`pos-item-${it.id}`} type="button" onClick={() => tryAdd(it, 1)} aria-disabled={disabled}
                    className={`relative flex flex-col overflow-hidden rounded-2xl border bg-white text-right shadow-card transition active:scale-[0.98] ${
                      q > 0 ? 'border-orange-400 ring-2 ring-orange-200' : 'border-indigo-50'} ${disabled ? 'opacity-60' : 'hover:border-orange-300'}`}>
                    <div className="relative aspect-square w-full bg-orange-50">
                      <ItemThumb url={it.image_url} name={it.name} fill />
                      {q > 0 && <span className="absolute right-2 top-2 flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-orange-600 px-1.5 text-xs font-extrabold text-white shadow">× {q}</span>}
                      {out && <span className="absolute inset-x-0 bottom-0 bg-red-600/90 py-0.5 text-center text-[11px] font-extrabold text-white">نفذت الكمية</span>}
                      {!out && tooPricey && <span className="absolute inset-x-0 bottom-0 bg-slate-700/85 py-0.5 text-center text-[11px] font-extrabold text-white"><AlertTriangle className="inline h-3 w-3" /> الرصيد لا يكفي</span>}
                    </div>
                    <div className="flex w-full items-center gap-1 px-2 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs font-extrabold">{it.name}</span>
                      <span className="badge bg-gold-100 text-gold-700 !px-1.5"><Star className="h-3 w-3" /> {it.price}</span>
                    </div>
                    <p className="flex w-full items-center gap-1 px-2 pb-1.5 text-[10px] font-bold text-slate-400">
                      <span>متاح: {it.stock - q}</span>
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          {/* ---------- confirm sheet ---------- */}
          {confirming && (
            <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6" onClick={() => !submitting && setConfirming(false)}>
              <div id="pos-confirm" className="w-full max-w-md rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
                <h3 className="mb-1 flex items-center gap-2 text-lg font-extrabold"><ArrowLeftRight className="h-5 w-5 text-emerald-600" /> هل أنت متأكد من إتمام العملية؟</h3>
                <p className="mb-3 text-xs font-bold text-slate-500">سيُخصم <span className="text-orange-700">{total}</span> نقطة من رصيد <span className="text-slate-800">{child.person.name}</span> ({balance} → {remaining}) وتُحفظ الفاتورة في الأرشيف وتظهر له في بوابة المخدوم.</p>
                <ul className="mb-3 max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-100 text-sm">
                  {lines.map((l) => (
                    <li key={l.item.id} className="flex items-center justify-between px-3 py-1.5">
                      <span className="font-bold">{l.item.name} <span className="text-slate-400">× {l.qty}</span></span>
                      <span className="tabular-nums font-extrabold text-orange-700">{l.item.price * l.qty}</span>
                    </li>
                  ))}
                </ul>
                <input className="input-field mb-3" placeholder="ملاحظة على الفاتورة (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" disabled={submitting} onClick={() => setConfirming(false)} className="btn-secondary">رجوع</button>
                  <button id="pos-confirm-yes" type="button" disabled={submitting} onClick={checkout} className="btn-primary flex items-center justify-center gap-2 !from-emerald-600 !to-emerald-500">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} نعم، إتمام
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {!child && !receipt && (
        <p className="mt-4 flex items-center gap-2 px-1 text-xs font-bold text-slate-400">
          <UserRound className="h-3.5 w-3.5" /> امسح كارت المخدوم أو ابحث عنه لفتح سلة جديدة — ثم امسح ملصقات الأصناف.
        </p>
      )}
      <Toast msg={toast} />
    </AppShell>
  );
}
