'use client';

// ---------- POINTS STORE — ONE SHOP (hub) ----------
// 20261002120000: the shop is the container. This hub shows the shop's
// picture · description · places · activation switch, its numbers, and the
// four parts that live inside it:
//   الكاشير  — scan / search a child → basket of THIS shop's items → checkout
//   الطلبات  — carts the children sent from their portal → scan card → approve
//   المخزون  — the shop's items (code · name · picture · price · stock) + QR labels
//   الأرشيف  — the shop's bills

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Package, ScanLine, Archive, ChevronLeft, Star, Inbox, Power, PowerOff, MapPin, Globe, Pencil, Loader2 } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { StoreHeader, ShopThumb, ShopMissing, useStoreShop, useStoreLookups, targetLabel, Toast } from '@/components/store/StoreBits';
import ShopFormModal from '@/components/store/ShopFormModal';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { fetchStoreShopStats, setStoreShopActive, storeErrorMessage, isShopsMigrationMissing, SHOPS_MIGRATION_HINT, type StoreShopStats } from '@/lib/store';

export default function ShopHubPage() {
  const { shop: shopId } = useParams<{ shop: string }>();
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { shop, loading, missing, error, reload } = useStoreShop(supabase, shopId ?? null, approved);
  const { churches, services, classes } = useStoreLookups(supabase, approved);

  const [stats, setStats] = useState<StoreShopStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  const loadStats = useCallback(async () => {
    if (!shopId) return;
    try { setStats(await fetchStoreShopStats(supabase, shopId)); } catch { /* shown as … */ }
  }, [supabase, shopId]);
  useEffect(() => { if (approved && shop) loadStats(); }, [approved, shop, loadStats]);
  useDebouncedRealtime(
    supabase, `store-hub-${shopId}`, [{ table: 'store_items' }, { table: 'store_orders' }, { table: 'store_requests' }], loadStats,
    { enabled: approved && !!shop }
  );

  const toggle = async () => {
    if (!shop) return;
    setBusy(true);
    try {
      await setStoreShopActive(supabase, shop.id, !shop.is_active);
      flash(!shop.is_active ? 'تم تفعيل المتجر — يظهر الآن في بوابة المخدوم' : 'تم إيقاف المتجر — اختفى من بوابة المخدوم');
      reload();
    } catch (err) { flash(storeErrorMessage(err, 'تعذر التعديل')); }
    finally { setBusy(false); }
  };

  if (loading) {
    return <AppShell><StoreHeader /><div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-orange-500" /></div></AppShell>;
  }
  if (missing || !shop) {
    return <AppShell><StoreHeader /><ShopMissing migrationHint={isShopsMigrationMissing(error) ? SHOPS_MIGRATION_HINT : null} /></AppShell>;
  }

  const links = [
    { seg: 'pos', id: 'store-link-pos', icon: ScanLine, color: 'text-orange-600 bg-orange-50',
      label: 'الكاشير', desc: 'امسح كارت المخدوم أو ابحث عنه → سلة من أصناف هذا المتجر → إستبدال النقاط' },
    { seg: 'requests', id: 'store-link-requests', icon: Inbox, color: 'text-red-600 bg-red-50', badge: stats?.pending ?? 0,
      label: 'طلبات المخدومين', desc: 'السلات التي أرسلها المخدومون من بوابتهم → امسح كارت المخدوم للتأكيد → اعتماد أو رفض' },
    { seg: 'inventory', id: 'store-link-inventory', icon: Package, color: 'text-primary-600 bg-primary-50',
      label: 'المخزون', desc: 'أصناف هذا المتجر (كود · اسم · صورة · السعر بالنقاط · الكمية) وطباعة ملصقات QR' },
    { seg: 'archive', id: 'store-link-archive', icon: Archive, color: 'text-slate-600 bg-slate-100',
      label: 'أرشيف الفواتير', desc: 'كل عمليات الإستبدال في هذا المتجر — البنود والرصيد قبل وبعد ومصدر العملية' },
  ];

  return (
    <AppShell>
      <StoreHeader shop={shop} info="كل ما يخص هذا المتجر في مكان واحد: أصنافه، الكاشير، طلبات المخدومين من البوابة، وفواتيره. زر التفعيل يُظهر المتجر للمخدومين في بوابتهم." />

      {/* shop card */}
      <section id="shop-card" className={`card mb-3 ${shop.is_active ? 'border-emerald-100' : ''}`}>
        <div className="flex items-start gap-3">
          <ShopThumb url={shop.image_url} name={shop.name} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-base font-extrabold">{shop.name}</p>
              <span className={`badge ${shop.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                {shop.is_active ? <><Power className="h-3 w-3" /> مفعّل</> : <><PowerOff className="h-3 w-3" /> موقوف</>}
              </span>
            </div>
            {shop.description && <p className="text-xs text-slate-500">{shop.description}</p>}
            <ul className="mt-1.5 flex flex-wrap gap-1">
              {shop.targets.length === 0 && <li className="badge bg-red-50 text-red-500">غير مرتبط بأي مكان — لن يراه أي مخدوم</li>}
              {shop.targets.map((t) => (
                <li key={t.id} className="badge bg-orange-50 text-orange-700">
                  {t.church_id === null ? <Globe className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                  {targetLabel(t, churches, services, classes)}
                </li>
              ))}
            </ul>
          </div>
          <button type="button" aria-label="تعديل المتجر" onClick={() => setEditing(true)} className="rounded-full bg-primary-50 p-2 text-primary-600 hover:bg-primary-100"><Pencil className="h-4 w-4" /></button>
        </div>
        <button id="shop-toggle" type="button" disabled={busy} onClick={toggle}
          className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-extrabold transition active:scale-[0.99] ${
            shop.is_active ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-gradient-to-l from-emerald-600 to-emerald-500 text-white shadow'}`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : shop.is_active ? <><PowerOff className="h-4 w-4" /> إيقاف المتجر — إخفاؤه من بوابة المخدوم</> : <><Power className="h-4 w-4" /> تفعيل المتجر — إظهاره في بوابة المخدوم</>}
        </button>
      </section>

      <section id="store-stats" className="mb-4 grid grid-cols-5 gap-1.5">
        {[
          { label: 'صنف متاح', value: stats?.items },
          { label: 'قطعة متاحة', value: stats?.stock },
          { label: 'طلب بانتظار', value: stats?.pending },
          { label: 'فاتورة', value: stats?.orders },
          { label: 'نقطة مُستبدلة', value: stats?.points },
        ].map((k) => (
          <div key={k.label} className="card !p-2 text-center">
            <p className="text-lg font-extrabold tabular-nums text-orange-600">{k.value ?? '…'}</p>
            <p className="text-[10px] font-bold text-slate-400">{k.label}</p>
          </div>
        ))}
      </section>

      <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
        {links.map((l) => {
          const Icon = l.icon;
          return (
            <Link key={l.seg} id={l.id} href={`/store/${shop.id}/${l.seg}`} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-orange-50/50">
              <span className={`rounded-xl p-2 ${l.color}`}><Icon className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{l.label}</span>
                <span className="block truncate text-xs text-slate-400">{l.desc}</span>
              </span>
              {!!l.badge && <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-extrabold text-white tabular-nums">{l.badge}</span>}
              <ChevronLeft className="h-4 w-4 text-slate-300" />
            </Link>
          );
        })}
      </div>

      <p className="mt-4 flex items-center gap-2 px-1 text-xs font-bold text-slate-400">
        <Star className="h-3.5 w-3.5 text-gold-500" />
        الخصم يُسجَّل في سجل النقاط كعملية «إستبدال نقاط» — ويمكن للمسؤولين إلغاء فاتورة من الأرشيف فتُستردّ النقاط والكمية.
      </p>

      {editing && (
        <ShopFormModal
          shop={shop} churches={churches} services={services} classes={classes}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); reload(); flash('تم حفظ التعديلات'); }}
        />
      )}
      <Toast msg={toast} />
    </AppShell>
  );
}
