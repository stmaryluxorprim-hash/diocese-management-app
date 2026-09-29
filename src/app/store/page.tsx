'use client';

// ---------- POINTS STORE MODULE HUB (إستبدال النقاط) ----------
// Entry page: quick stats + the five parts of the module.
//   الكاشير  — scan / search a child → basket → checkout (points deducted)
//   الطلبات  — carts the children sent from their portal → scan card → approve
//   المتاجر  — shops connected to church / service / class, activation switch
//   المخزون  — items (code · name · picture · price in points · stock) + QR labels
//   الأرشيف  — every saved bill

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Package, ScanLine, Archive, ChevronLeft, Star, Store, Inbox } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { StoreHeader, usePendingStoreRequests } from '@/components/store/StoreBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { isMigrationMissing, MIGRATION_HINT } from '@/lib/store';

export default function StoreHubPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const [stats, setStats] = useState<{ items: number; stock: number; orders: number; points: number; shops: number } | null>(null);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const pending = usePendingStoreRequests();

  const load = useCallback(async () => {
    const [items, orders, shops] = await Promise.all([
      supabase.from('store_items').select('stock, is_active').limit(5000),
      supabase.from('store_orders').select('total_points, status').limit(5000),
      supabase.from('store_shops').select('id, is_active').limit(1000),
    ]);
    if (items.error || orders.error) {
      if (isMigrationMissing(items.error ?? orders.error)) setMigrationMissing(true);
      return;
    }
    const its = (items.data ?? []) as { stock: number; is_active: boolean }[];
    const ors = ((orders.data ?? []) as { total_points: number; status: string }[]).filter((o) => o.status === 'completed');
    setStats({
      items: its.filter((i) => i.is_active).length,
      stock: its.reduce((s, i) => s + i.stock, 0),
      orders: ors.length,
      points: ors.reduce((s, o) => s + o.total_points, 0),
      shops: ((shops.data ?? []) as { is_active: boolean }[]).filter((s) => s.is_active).length,
    });
  }, [supabase]);

  useEffect(() => { if (profile?.status === 'approved') load(); }, [profile?.status, load]);
  useDebouncedRealtime(
    supabase, 'store-hub', [{ table: 'store_items' }, { table: 'store_orders' }, { table: 'store_shops' }], load,
    { enabled: profile?.status === 'approved' }
  );

  const links = [
    { href: '/store/pos', id: 'store-link-pos', icon: ScanLine, color: 'text-orange-600 bg-orange-50',
      label: 'الكاشير', desc: 'امسح كارت المخدوم أو ابحث عنه → سلة → إستبدال النقاط بالأصناف' },
    { href: '/store/requests', id: 'store-link-requests', icon: Inbox, color: 'text-red-600 bg-red-50', badge: pending,
      label: 'طلبات المخدومين', desc: 'السلات التي أرسلها المخدومون من بوابتهم → امسح كارت المخدوم للتأكيد → اعتماد أو رفض' },
    { href: '/store/shops', id: 'store-link-shops', icon: Store, color: 'text-emerald-600 bg-emerald-50',
      label: 'المتاجر', desc: 'متاجر مرتبطة بكنيسة / خدمة / فصل أو أكثر — عند التفعيل تظهر للمخدومين في بوابتهم' },
    { href: '/store/inventory', id: 'store-link-inventory', icon: Package, color: 'text-primary-600 bg-primary-50',
      label: 'المخزون', desc: 'إضافة وتعديل الأصناف (كود · اسم · صورة · السعر بالنقاط · الكمية · المتجر) وطباعة ملصقات QR' },
    { href: '/store/archive', id: 'store-link-archive', icon: Archive, color: 'text-slate-600 bg-slate-100',
      label: 'أرشيف الفواتير', desc: 'كل عمليات الإستبدال المحفوظة — البنود والرصيد قبل وبعد والمتجر ومصدر العملية' },
  ];

  return (
    <AppShell>
      <StoreHeader info="نقطة بيع بالنقاط: المخدوم يستبدل رصيده من النقاط بأصناف من المخزون. كل عملية تُخصم من رصيده، تُحفظ كفاتورة في الأرشيف وتظهر له في صفحة النقاط ببوابة المخدوم." />

      {migrationMissing && (
        <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">⚠️ {MIGRATION_HINT}</p>
      )}

      <section id="store-stats" className="mb-4 grid grid-cols-5 gap-1.5">
        {[
          { label: 'متجر مفعّل', value: stats?.shops },
          { label: 'أصناف', value: stats?.items },
          { label: 'قطعة متاحة', value: stats?.stock },
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
            <Link key={l.href} id={l.id} href={l.href} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-orange-50/50">
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
    </AppShell>
  );
}
