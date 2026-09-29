'use client';

// ---------- POINTS STORE — module entry = the SHOPS (المتاجر) ----------
// 20261002120000: the shop is the container. Everything of the module —
// inventory, cashier, child requests, archive — lives INSIDE a shop
// (/store/[shop]/…). This page lists the shops the caller can see with
// their places, counters and the activation switch; tapping a shop opens
// its hub. Add / edit / delete shops here.
// A shop: name · picture · description · ACTIVATION switch · connected to
// one or many places (church → service → class, or «الكل»). Active shops
// appear in the child portal (cart → request → card scan → approval).

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Plus, Loader2, Pencil, Trash2, Store, Power, PowerOff, MapPin, Globe, Package, Inbox, ChevronLeft, Search, Archive,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { StoreHeader, ShopThumb, useStoreLookups, targetLabel, Toast } from '@/components/store/StoreBits';
import ShopFormModal from '@/components/store/ShopFormModal';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import {
  fetchStoreShops, fetchStoreShopStats, setStoreShopActive, deleteStoreShop, storeErrorMessage,
  isShopsMigrationMissing, SHOPS_MIGRATION_HINT, type StoreShopWithTargets, type StoreShopStats,
} from '@/lib/store';

export default function StoreShopsPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { churches, services, classes } = useStoreLookups(supabase, approved);

  const [shops, setShops] = useState<StoreShopWithTargets[]>([]);
  const [counts, setCounts] = useState<Map<string, StoreShopStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<{ open: boolean; shop: StoreShopWithTargets | null }>({ open: false, shop: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  const load = useCallback(async () => {
    try {
      const rows = await fetchStoreShops(supabase);
      setShops(rows);
      setMigrationMissing(false);
      const stats = await Promise.all(rows.map((r) => fetchStoreShopStats(supabase, r.id).catch(() => null)));
      const m = new Map<string, StoreShopStats>();
      rows.forEach((r, i) => { if (stats[i]) m.set(r.id, stats[i] as StoreShopStats); });
      setCounts(m);
    } catch (err) {
      if (isShopsMigrationMissing(err)) setMigrationMissing(true);
    } finally { setLoading(false); }
  }, [supabase]);

  useEffect(() => { if (approved) load(); }, [approved, load]);
  useDebouncedRealtime(supabase, 'store-shops', [{ table: 'store_shops' }, { table: 'store_shop_targets' }, { table: 'store_requests' }, { table: 'store_items' }, { table: 'store_orders' }], load, { enabled: approved, delayMs: 600 });

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return shops.filter((sh) => !s || sh.name.toLowerCase().includes(s));
  }, [shops, search]);

  const patch = (id: string, p: Partial<StoreShopWithTargets>) =>
    setShops((l) => l.map((s) => (s.id === id ? { ...s, ...p } : s)));

  const toggle = async (s: StoreShopWithTargets) => {
    setBusy(s.id);
    patch(s.id, { is_active: !s.is_active });
    try {
      await setStoreShopActive(supabase, s.id, !s.is_active);
      flash(!s.is_active ? `تم تفعيل «${s.name}» — يظهر الآن في بوابة المخدوم` : `تم إيقاف «${s.name}» — اختفى من بوابة المخدوم`);
    } catch (err) {
      patch(s.id, { is_active: s.is_active });
      flash(storeErrorMessage(err, 'تعذر التعديل'));
    } finally { setBusy(null); }
  };

  const remove = async (s: StoreShopWithTargets) => {
    if (!confirm(`حذف المتجر «${s.name}» وكل أصنافه؟\nالفواتير القديمة تحتفظ ببياناتها.`)) return;
    setBusy(s.id);
    try {
      await deleteStoreShop(supabase, s.id);
      setShops((l) => l.filter((x) => x.id !== s.id));
    } catch (err) { flash(storeErrorMessage(err, 'تعذر الحذف')); }
    finally { setBusy(null); }
  };

  const activeCount = shops.filter((s) => s.is_active).length;

  return (
    <AppShell>
      <StoreHeader
        badge={<span className="badge bg-orange-100 text-orange-700 tabular-nums">{shops.length}</span>}
        info="كل شيء داخل المتجر: المخزون والكاشير وطلبات المخدومين وأرشيف الفواتير. المتجر يُربط بكنيسة أو خدمة أو فصل — أو أكثر من مكان، أو الكل. عند تفعيله يظهر للمخدومين في بوابتهم: يختارون الأصناف ويرسلون طلب شراء، ثم يمسح الخادم كارت المخدوم كتأكيد ويعتمد الطلب فتُخصم النقاط وتُحفظ الفاتورة."
      />
      {migrationMissing && <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">⚠️ {SHOPS_MIGRATION_HINT}</p>}

      <section className="mb-3 grid grid-cols-3 gap-2">
        <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-slate-700">{shops.length}</p><p className="text-[10px] font-bold text-slate-400">متجر</p></div>
        <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-emerald-600">{activeCount}</p><p className="text-[10px] font-bold text-slate-400">مفعّل</p></div>
        <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-orange-600">{Array.from(counts.values()).reduce((a, c) => a + c.pending, 0)}</p><p className="text-[10px] font-bold text-slate-400">طلب بانتظار</p></div>
      </section>

      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input id="shops-search" className="input-field pr-9" placeholder="ابحث باسم المتجر..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button id="shops-add" type="button" onClick={() => setForm({ open: true, shop: null })}
          className="btn-primary flex items-center gap-1.5 !py-2.5 !px-3 text-sm !from-orange-600 !to-orange-500">
          <Plus className="h-4 w-4" /> إضافة متجر
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-orange-500" /></div>
      ) : visible.length === 0 ? (
        <div className="card py-12 text-center text-slate-400">
          <Store className="mx-auto mb-3 h-10 w-10 text-orange-200" />
          <p className="font-bold">{shops.length === 0 ? 'لا متاجر بعد — أضف أول متجر واربطه بكنيسة أو خدمة أو فصل، ثم أضف أصنافه من داخله' : 'لا نتائج'}</p>
        </div>
      ) : (
        <div id="shops-list" className="space-y-2">
          {visible.map((s) => {
            const c = counts.get(s.id) ?? { items: 0, stock: 0, pending: 0, orders: 0, points: 0 };
            return (
              <article key={s.id} id={`shop-${s.id}`} className={`card !p-3 ${s.is_active ? 'border-emerald-100' : 'opacity-80'}`}>
                <div className="flex items-start gap-3">
                  <Link href={`/store/${s.id}`} aria-label={`فتح ${s.name}`}><ShopThumb url={s.image_url} name={s.name} size={56} /></Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link href={`/store/${s.id}`} className="truncate font-extrabold hover:text-orange-700">{s.name}</Link>
                      <span className={`badge ${s.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                        {s.is_active ? <><Power className="h-3 w-3" /> مفعّل</> : <><PowerOff className="h-3 w-3" /> موقوف</>}
                      </span>
                    </div>
                    {s.description && <p className="truncate text-xs text-slate-500">{s.description}</p>}
                    <ul className="mt-1.5 flex flex-wrap gap-1">
                      {s.targets.length === 0 && <li className="badge bg-red-50 text-red-500">غير مرتبط بأي مكان</li>}
                      {s.targets.map((t) => (
                        <li key={t.id} className="badge bg-orange-50 text-orange-700">
                          {t.church_id === null ? <Globe className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                          {targetLabel(t, churches, services, classes)}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                      <Link href={`/store/${s.id}/inventory`} className="flex items-center gap-1 rounded-lg bg-primary-50 px-2 py-1 text-primary-700 hover:bg-primary-100">
                        <Package className="h-3.5 w-3.5" /> {c.items} صنف
                      </Link>
                      <Link href={`/store/${s.id}/requests`} className={`flex items-center gap-1 rounded-lg px-2 py-1 ${c.pending ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-slate-100 text-slate-500'}`}>
                        <Inbox className="h-3.5 w-3.5" /> {c.pending} طلب
                      </Link>
                      <Link href={`/store/${s.id}/archive`} className="flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-slate-600 hover:bg-slate-200">
                        <Archive className="h-3.5 w-3.5" /> {c.orders} فاتورة · {c.points} نقطة
                      </Link>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Link href={`/store/${s.id}`} aria-label="فتح المتجر" className="rounded-full bg-orange-50 p-2 text-orange-600 hover:bg-orange-100"><ChevronLeft className="h-4 w-4" /></Link>
                    <button type="button" aria-label="تعديل" onClick={() => setForm({ open: true, shop: s })} className="rounded-full bg-primary-50 p-2 text-primary-600 hover:bg-primary-100"><Pencil className="h-4 w-4" /></button>
                    <button type="button" aria-label="حذف" disabled={busy === s.id} onClick={() => remove(s)} className="rounded-full bg-red-50 p-2 text-red-500 hover:bg-red-100">
                      {busy === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <button id={`shop-toggle-${s.id}`} type="button" disabled={busy === s.id} onClick={() => toggle(s)}
                  className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-extrabold transition active:scale-[0.99] ${
                    s.is_active ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-gradient-to-l from-emerald-600 to-emerald-500 text-white shadow'}`}>
                  {s.is_active ? <><PowerOff className="h-4 w-4" /> إيقاف المتجر — إخفاؤه من بوابة المخدوم</> : <><Power className="h-4 w-4" /> تفعيل المتجر — إظهاره في بوابة المخدوم</>}
                </button>
              </article>
            );
          })}
        </div>
      )}

      {form.open && (
        <ShopFormModal
          shop={form.shop} churches={churches} services={services} classes={classes}
          onClose={() => setForm({ open: false, shop: null })}
          onSaved={(saved) => {
            setForm({ open: false, shop: null });
            setShops((l) => (l.some((x) => x.id === saved.id) ? l.map((x) => (x.id === saved.id ? saved : x)) : [...l, saved]));
            flash(form.shop ? 'تم حفظ التعديلات' : `تمت إضافة «${saved.name}»`);
          }}
        />
      )}
      <Toast msg={toast} />
    </AppShell>
  );
}
