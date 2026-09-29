'use client';

// ---------- Points store — shared UI bits ----------
// StoreHeader: back arrow + title; inside a shop (/store/[shop]/…) the 4
//   tabs of THAT shop (الكاشير · الطلبات · المخزون · الأرشيف) — الطلبات carries
//   the live count of pending child requests (20261002120000)
// useStoreShop / ShopMissing: load the current shop for the shop pages
// ItemThumb  : item picture or a placeholder
// ScopeSelectors: church → service → class selects (same as the other modules)
// useStoreLookups: churches / services / classes via cachedLookup

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ArrowRight, ShoppingBag, Package, ScanLine, Archive, ImageIcon, Store, Inbox } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cachedLookup, ALL } from '@/lib/queries';
import type { Church, Service, ClassRoom } from '@/lib/types';
import { useNavLabel } from '@/lib/customization-context';
import { fetchStoreShop, type StoreShopWithTargets } from '@/lib/store';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import InfoTip from '@/components/InfoTip';

// 20261002120000 — the SHOP is the container: the four parts of the module
// live under /store/[shop]/… ; /store itself is the list of shops.
const SHOP_TABS = [
  { seg: 'pos', label: 'الكاشير', icon: ScanLine, id: 'store-tab-pos' },
  { seg: 'requests', label: 'الطلبات', icon: Inbox, id: 'store-tab-requests' },
  { seg: 'inventory', label: 'المخزون', icon: Package, id: 'store-tab-inventory' },
  { seg: 'archive', label: 'الأرشيف', icon: Archive, id: 'store-tab-archive' },
];

/** Live count of the child requests waiting for a decision (RLS-scoped);
 *  `shopId` narrows it to one shop. */
export function usePendingStoreRequests(shopId?: string | null): number {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const [count, setCount] = useState(0);
  const enabled = profile?.status === 'approved';
  const load = useCallback(async () => {
    let q = supabase.from('store_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    if (shopId) q = q.eq('shop_id', shopId);
    const { count: c, error } = await q;
    if (!error) setCount(c ?? 0);
  }, [supabase, shopId]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  useDebouncedRealtime(supabase, `store-requests-badge-${shopId ?? 'all'}`, [{ table: 'store_requests' }], load, { enabled, delayMs: 500 });
  return count;
}

/** Module header. Without `shop` → the shops list (back to settings, no
 *  tabs). With `shop` → the shop's name + picture, back to the shops list,
 *  and the four tabs of THAT shop. */
export function StoreHeader({ title, badge, info, shop }: {
  title?: string; badge?: React.ReactNode; info?: React.ReactNode;
  shop?: { id: string; name: string; image_url: string | null; is_active: boolean } | null;
}) {
  const path = usePathname();
  const name = useNavLabel('store');
  const pending = usePendingStoreRequests(shop?.id ?? null);
  return (
    <>
      <section className="mb-3 flex items-center gap-2">
        <Link href={shop ? '/store' : '/settings'} aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
          <ArrowRight className="h-5 w-5" />
        </Link>
        {shop ? (
          <Link href={`/store/${shop.id}`} className="flex min-w-0 flex-1 items-center gap-2">
            <ShopThumb url={shop.image_url} name={shop.name} size={36} />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 truncate text-lg font-extrabold leading-tight">
                {shop.name}
                {!shop.is_active && <span className="badge bg-slate-200 text-slate-600 !text-[10px]">موقوف</span>}
              </span>
              <span className="block truncate text-[11px] font-bold text-slate-400">{name}{title ? ` · ${title}` : ''}</span>
            </span>
          </Link>
        ) : (
          <h2 className="flex min-w-0 flex-1 items-center gap-2 text-lg font-extrabold">
            <ShoppingBag className="h-5 w-5 text-orange-600" />
            {name}
            {title && <span className="text-slate-400 font-bold text-sm">· {title}</span>}
          </h2>
        )}
        {badge}
        {info && <InfoTip title={shop?.name ?? name}>{info}</InfoTip>}
      </section>
      {shop && (
        <nav id="store-tabs" className="mb-3 grid grid-cols-4 gap-1.5">
          {SHOP_TABS.map((t) => {
            const href = `/store/${shop.id}/${t.seg}`;
            const active = path?.startsWith(href);
            const Icon = t.icon;
            const n = t.seg === 'requests' ? pending : 0;
            return (
              <Link
                key={t.seg} id={t.id} href={href} aria-current={active ? 'page' : undefined}
                className={`relative flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-extrabold transition active:scale-95 ${
                  active ? 'bg-orange-600 text-white shadow ring-2 ring-orange-300' : 'bg-white text-slate-600 border border-slate-200'
                }`}
              >
                <Icon className="h-4 w-4" /> {t.label}
                {n > 0 && (
                  <span className={`absolute -top-1.5 -left-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[10px] font-extrabold tabular-nums ring-2 ring-white ${active ? 'bg-white text-orange-700' : 'bg-red-500 text-white'}`}>
                    {n > 99 ? '99+' : n}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}

/** Load ONE shop (with targets) for the /store/[shop]/… pages; realtime on
 *  the row. `missing` = not found / not visible. */
export function useStoreShop(supabase: SupabaseClient, shopId: string | null, enabled: boolean) {
  const [shop, setShop] = useState<StoreShopWithTargets | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    if (!shopId) { setLoading(false); setMissing(true); return; }
    try {
      const row = await fetchStoreShop(supabase, shopId);
      setShop(row); setMissing(!row); setError(null);
    } catch (err) { setError(err); }
    finally { setLoading(false); }
  }, [supabase, shopId]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  useDebouncedRealtime(supabase, `store-shop-${shopId ?? 'none'}`, [{ table: 'store_shops' }, { table: 'store_shop_targets' }], load, { enabled: enabled && !!shopId, delayMs: 600 });
  return { shop, loading, missing, error, reload: load };
}

/** Shared «shop not found» card for /store/[shop]/… */
export function ShopMissing({ migrationHint }: { migrationHint?: string | null }) {
  return (
    <div className="card py-12 text-center text-slate-400">
      <Store className="mx-auto mb-3 h-10 w-10 text-orange-200" />
      <p className="font-bold">{migrationHint ?? 'هذا المتجر غير موجود أو ليس في نطاق صلاحيتك'}</p>
      <Link href="/store" className="btn-secondary mt-4 inline-flex !py-2 !px-4 text-sm">إلى قائمة المتاجر</Link>
    </div>
  );
}

/** Item picture (or placeholder). `fill` → stretches to the parent box. */
export function ItemThumb({ url, name, size = 48, fill = false, className = '' }: {
  url: string | null; name: string; size?: number; fill?: boolean; className?: string;
}) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden ${fill ? 'h-full w-full' : 'rounded-xl ring-1 ring-orange-100'} bg-orange-50 text-orange-300 ${className}`}
      style={fill ? undefined : { width: size, height: size }}
    >
      {url ? (
        <Image src={url} alt={name} fill sizes={fill ? '50vw' : `${size}px`} className="object-cover" />
      ) : (
        <ImageIcon className="absolute inset-0 m-auto" style={fill ? { width: '40%', height: '40%' } : { width: size * 0.45, height: size * 0.45 }} />
      )}
    </div>
  );
}

/** Shop picture (or a storefront placeholder). */
export function ShopThumb({ url, name, size = 48, className = '' }: { url: string | null; name: string; size?: number; className?: string }) {
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-2xl bg-orange-100 text-orange-400 ring-1 ring-orange-200 ${className}`} style={{ width: size, height: size }}>
      {url ? <Image src={url} alt={name} fill sizes={`${size}px`} className="object-cover" />
        : <Store className="absolute inset-0 m-auto" style={{ width: size * 0.5, height: size * 0.5 }} />}
    </div>
  );
}

/** «كنيسة ← خدمة ← فصل» label of ONE shop target (church null = الكل) */
export function targetLabel(
  t: { church_id: string | null; service_id: string | null; class_id: string | null },
  churches: Church[], services: Service[], classes: ClassRoom[]
) {
  if (t.church_id === null) return 'الكل — كل الكنائس';
  return scopeLabel({ church_id: t.church_id, service_id: t.service_id, class_id: t.class_id }, churches, services, classes);
}

export function useStoreLookups(supabase: SupabaseClient, enabled: boolean) {
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  useEffect(() => {
    if (!enabled) return;
    (async () => {
      const [chs, svs, cls] = await Promise.all([
        cachedLookup<Church>(supabase, 'churches'),
        cachedLookup<Service>(supabase, 'services'),
        cachedLookup<ClassRoom>(supabase, 'classes'),
      ]);
      setChurches(chs); setServices(svs); setClasses(cls);
    })();
  }, [supabase, enabled]);
  return { churches, services, classes };
}

export interface ScopeState {
  church: string; service: string; class: string;
  setChurch: (v: string) => void; setService: (v: string) => void; setClass: (v: string) => void;
}

export function useScopeState(): ScopeState {
  const [church, setChurchRaw] = useState(ALL);
  const [service, setServiceRaw] = useState(ALL);
  const [cls, setClassRaw] = useState(ALL);
  return {
    church, service, class: cls,
    setChurch: (v) => { setChurchRaw(v); setServiceRaw(ALL); setClassRaw(ALL); },
    setService: (v) => { setServiceRaw(v); setClassRaw(ALL); },
    setClass: (v) => setClassRaw(v),
  };
}

export function ScopeSelectors({
  idPrefix, scope, churches, services, classes,
}: { idPrefix: string; scope: ScopeState; churches: Church[]; services: Service[]; classes: ClassRoom[] }) {
  const visibleServices = useMemo(
    () => services.filter((s) => scope.church === ALL || s.church_id === scope.church),
    [services, scope.church]
  );
  const visibleClasses = useMemo(
    () => classes.filter((c) =>
      (scope.church === ALL || c.church_id === scope.church) &&
      (scope.service === ALL || c.service_id === scope.service)),
    [classes, scope.church, scope.service]
  );
  return (
    <div className="mb-3 grid grid-cols-3 gap-2">
      <select
        id={`${idPrefix}-church`} aria-label="اختيار الكنيسة"
        className="input-field appearance-none !px-2 text-xs font-bold"
        value={scope.church} disabled={churches.length <= 1}
        onChange={(e) => scope.setChurch(e.target.value)}
      >
        <option value={ALL}>{churches.length === 1 ? churches[0].name : 'كل الكنائس'}</option>
        {churches.length > 1 && churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select
        id={`${idPrefix}-service`} aria-label="اختيار الخدمة"
        className="input-field appearance-none !px-2 text-xs font-bold"
        value={scope.service} disabled={visibleServices.length <= 1}
        onChange={(e) => scope.setService(e.target.value)}
      >
        <option value={ALL}>{visibleServices.length === 1 ? visibleServices[0].name : 'كل الخدمات'}</option>
        {visibleServices.length > 1 && visibleServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <select
        id={`${idPrefix}-class`} aria-label="اختيار الفصل"
        className="input-field appearance-none !px-2 text-xs font-bold"
        value={scope.class} disabled={visibleClasses.length <= 1}
        onChange={(e) => scope.setClass(e.target.value)}
      >
        <option value={ALL}>{visibleClasses.length === 1 ? visibleClasses[0].name : 'كل الفصول'}</option>
        {visibleClasses.length > 1 && visibleClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  );
}

/** «كنيسة ← خدمة ← فصل» label for an item / order scope */
export function scopeLabel(
  x: { church_id: string; service_id: string | null; class_id: string | null },
  churches: Church[], services: Service[], classes: ClassRoom[]
) {
  const church = churches.find((c) => c.id === x.church_id)?.name ?? '';
  if (x.service_id === null) return `${church} ← كل الخدمات`;
  const service = services.find((s) => s.id === x.service_id)?.name ?? '';
  if (x.class_id === null) return `${church} ← ${service} ← كل الفصول`;
  const cls = classes.find((c) => c.id === x.class_id)?.name ?? '';
  return `${church} ← ${service} ← ${cls}`;
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div id="store-toast" role="status" className="fixed inset-x-4 bottom-24 z-[70] mx-auto max-w-md rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white shadow-xl">
      {msg}
    </div>
  );
}
