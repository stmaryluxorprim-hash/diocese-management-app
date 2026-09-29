'use client';

// ---------- POINTS STORE — INVENTORY (المخزون) ----------
// Manage the items children can buy with points:
//   • list (scoped church → service → class, search by name / code)
//   • add / edit (code, name, picture, price in points, stock, active, scope)
//   • quick +/− stock, toggle active, delete
//   • select items → print QR labels (LabelsPrintModal)
// Realtime on store_items so several servants can restock together.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Plus, Search, Loader2, Pencil, Trash2, Tag, Package, CheckSquare, Square, Minus,
  EyeOff, Eye, Star, Boxes, AlertTriangle, Store,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import {
  StoreHeader, ItemThumb, ScopeSelectors, useScopeState, useStoreLookups, scopeLabel, Toast,
} from '@/components/store/StoreBits';
import ItemFormModal from '@/components/store/ItemFormModal';
import LabelsPrintModal from '@/components/store/LabelsPrintModal';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { fetchStoreItems, fetchStoreShops, isMigrationMissing, MIGRATION_HINT, storeErrorMessage, type StoreShopWithTargets } from '@/lib/store';
import type { StoreItem } from '@/lib/types';

const ALL_SHOPS = 'all';
const NO_SHOP = 'none';

export default function InventoryPage() {
  return (
    <Suspense fallback={<AppShell><div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-orange-500" /></div></AppShell>}>
      <InventoryContent />
    </Suspense>
  );
}

function InventoryContent() {
  const { profile } = useAuth();
  const params = useSearchParams();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { churches, services, classes } = useStoreLookups(supabase, approved);
  const scope = useScopeState();

  // shops (20261001120000) — filter + the shop select in the item form
  const [shops, setShops] = useState<StoreShopWithTargets[]>([]);
  const [shopFilter, setShopFilter] = useState<string>(params.get('shop') ?? ALL_SHOPS);
  useEffect(() => {
    if (!approved) return;
    fetchStoreShops(supabase).then(setShops).catch(() => setShops([]));
  }, [approved, supabase]);
  useDebouncedRealtime(supabase, 'inv-shops', [{ table: 'store_shops' }], () => fetchStoreShops(supabase).then(setShops).catch(() => {}), { enabled: approved, delayMs: 800 });
  const shopName = (id: string | null) => shops.find((s) => s.id === id)?.name ?? null;

  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [form, setForm] = useState<{ open: boolean; item: StoreItem | null }>({ open: false, item: null });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [labelsFor, setLabelsFor] = useState<StoreItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  const load = useCallback(async () => {
    try {
      const rows = await fetchStoreItems(supabase, { church: scope.church, service: scope.service, class: scope.class });
      setItems(rows);
      setMigrationMissing(false);
    } catch (err) {
      if (isMigrationMissing(err)) setMigrationMissing(true);
    } finally {
      setLoading(false);
    }
  }, [supabase, scope.church, scope.service, scope.class]);

  useEffect(() => { if (approved) load(); }, [approved, load]);
  useDebouncedRealtime(supabase, 'store-inventory', [{ table: 'store_items' }], load, { enabled: approved, delayMs: 600 });

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter((it) =>
      (showInactive || it.is_active) &&
      (shopFilter === ALL_SHOPS || (shopFilter === NO_SHOP ? !it.shop_id : it.shop_id === shopFilter)) &&
      (!s || it.name.toLowerCase().includes(s) || it.code.toLowerCase().includes(s))
    );
  }, [items, search, showInactive, shopFilter]);

  const totals = useMemo(() => ({
    active: items.filter((i) => i.is_active).length,
    stock: items.reduce((s, i) => s + i.stock, 0),
    out: items.filter((i) => i.is_active && i.stock === 0).length,
  }), [items]);

  // ---------- actions ----------
  const patch = (id: string, p: Partial<StoreItem>) =>
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it)));

  const adjustStock = async (it: StoreItem, d: number) => {
    const next = Math.max(0, it.stock + d);
    if (next === it.stock) return;
    setBusy(it.id);
    patch(it.id, { stock: next });
    const { error } = await supabase.from('store_items').update({ stock: next }).eq('id', it.id);
    setBusy(null);
    if (error) { patch(it.id, { stock: it.stock }); flash(storeErrorMessage(error, 'تعذر تعديل الكمية')); }
  };

  const toggleActive = async (it: StoreItem) => {
    setBusy(it.id);
    patch(it.id, { is_active: !it.is_active });
    const { error } = await supabase.from('store_items').update({ is_active: !it.is_active }).eq('id', it.id);
    setBusy(null);
    if (error) { patch(it.id, { is_active: it.is_active }); flash(storeErrorMessage(error, 'تعذر التعديل')); }
  };

  const remove = async (it: StoreItem) => {
    if (!confirm(`حذف الصنف «${it.name}» نهائياً؟\nالفواتير القديمة تحتفظ ببياناته.`)) return;
    setBusy(it.id);
    const { error } = await supabase.from('store_items').delete().eq('id', it.id);
    setBusy(null);
    if (error) { flash(storeErrorMessage(error, 'تعذر الحذف')); return; }
    setItems((l) => l.filter((x) => x.id !== it.id));
    setSelected((s) => { const n = new Set(s); n.delete(it.id); return n; });
  };

  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSelected = visible.length > 0 && visible.every((it) => selected.has(it.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visible.map((it) => it.id)));
  const selectedItems = items.filter((it) => selected.has(it.id));

  return (
    <AppShell>
      <StoreHeader title="المخزون" badge={<span className="badge bg-orange-100 text-orange-700 tabular-nums">{items.length}</span>} />

      {migrationMissing && (
        <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">⚠️ {MIGRATION_HINT}</p>
      )}

      {/* KPIs */}
      <section className="mb-3 grid grid-cols-3 gap-2">
        <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-emerald-600">{totals.active}</p><p className="text-[10px] font-bold text-slate-400">صنف متاح</p></div>
        <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-primary-600">{totals.stock}</p><p className="text-[10px] font-bold text-slate-400">قطعة في المخزون</p></div>
        <div className="card !p-2 text-center"><p className={`text-lg font-extrabold tabular-nums ${totals.out ? 'text-red-500' : 'text-slate-400'}`}>{totals.out}</p><p className="text-[10px] font-bold text-slate-400">نفذت كميته</p></div>
      </section>

      {/* search + scope */}
      <div className="relative mb-2">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input id="inv-search" className="input-field pr-9" placeholder="ابحث بالاسم أو الكود..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ScopeSelectors idPrefix="inv" scope={scope} churches={churches} services={services} classes={classes} />
      {shops.length > 0 && (
        <div className="relative mb-3">
          <Store className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-500" />
          <select id="inv-shop" aria-label="المتجر" className="input-field appearance-none pr-9 text-xs font-bold" value={shopFilter} onChange={(e) => setShopFilter(e.target.value)}>
            <option value={ALL_SHOPS}>كل المتاجر + أصناف الكاشير</option>
            {shops.map((s) => <option key={s.id} value={s.id}>متجر: {s.name}{s.is_active ? '' : ' (غير مفعّل)'}</option>)}
            <option value={NO_SHOP}>بدون متجر — أصناف الكاشير فقط</option>
          </select>
        </div>
      )}

      {/* toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button id="inv-add" type="button" onClick={() => setForm({ open: true, item: null })}
          className="btn-primary flex items-center gap-1.5 !py-2 !px-3 text-sm !from-orange-600 !to-orange-500">
          <Plus className="h-4 w-4" /> إضافة صنف
        </button>
        <button id="inv-print-labels" type="button" disabled={selectedItems.length === 0} onClick={() => setLabelsFor(selectedItems)}
          className="btn-secondary flex items-center gap-1.5 !py-2 !px-3 text-sm disabled:opacity-40">
          <Tag className="h-4 w-4" /> طباعة ملصقات ({selectedItems.length})
        </button>
        <button id="inv-toggle-inactive" type="button" onClick={() => setShowInactive((v) => !v)}
          className="mr-auto flex items-center gap-1 text-xs font-bold text-slate-500">
          {showInactive ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          {showInactive ? 'إخفاء غير المتاح' : 'إظهار غير المتاح'}
        </button>
      </div>

      {/* list */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-orange-500" /></div>
      ) : visible.length === 0 ? (
        <div className="card py-12 text-center text-slate-400">
          <Package className="mx-auto mb-3 h-10 w-10 text-orange-200" />
          <p className="font-bold">{items.length === 0 ? 'المخزون فارغ — أضف أول صنف' : 'لا نتائج'}</p>
        </div>
      ) : (
        <div id="inv-list" className="card !p-0 overflow-hidden divide-y divide-orange-50">
          <div className="flex items-center gap-2 bg-orange-50/60 px-3 py-2 text-xs font-bold text-slate-500">
            <button type="button" id="inv-select-all" onClick={toggleAll} aria-label="تحديد الكل" className="p-1">
              {allSelected ? <CheckSquare className="h-4 w-4 text-orange-600" /> : <Square className="h-4 w-4" />}
            </button>
            <span>تحديد الكل ({visible.length})</span>
          </div>
          {visible.map((it) => {
            const sel = selected.has(it.id);
            const out = it.stock === 0;
            return (
              <div key={it.id} id={`inv-item-${it.id}`} className={`flex items-center gap-2.5 px-3 py-3 ${!it.is_active ? 'bg-slate-50 opacity-70' : out ? 'bg-red-50/40' : 'bg-white'}`}>
                <button type="button" onClick={() => toggleSel(it.id)} aria-label="تحديد" aria-pressed={sel} className="p-1">
                  {sel ? <CheckSquare className="h-5 w-5 text-orange-600" /> : <Square className="h-5 w-5 text-slate-300" />}
                </button>
                <ItemThumb url={it.image_url} name={it.name} size={52} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-extrabold">{it.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] font-bold text-slate-400">
                    <span dir="ltr" className="font-mono">{it.code}</span>
                    {it.shop_id
                      ? <span className="flex items-center gap-1 text-orange-600"><Store className="h-3 w-3" /> {shopName(it.shop_id) ?? 'متجر'}</span>
                      : <span className="truncate">{scopeLabel(it, churches, services, classes)}</span>}
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="badge bg-gold-100 text-gold-700"><Star className="h-3 w-3" /> {it.price}</span>
                    <span className="inline-flex items-center overflow-hidden rounded-lg ring-1 ring-slate-200">
                      <button type="button" aria-label="إنقاص الكمية" disabled={busy === it.id || it.stock === 0} onClick={() => adjustStock(it, -1)} className="px-2 py-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button>
                      <span className={`min-w-[2.5rem] px-1 text-center text-xs font-extrabold tabular-nums ${out ? 'text-red-500' : 'text-slate-700'}`}>
                        <Boxes className="mb-0.5 inline h-3 w-3" /> {it.stock}
                      </span>
                      <button type="button" aria-label="زيادة الكمية" disabled={busy === it.id} onClick={() => adjustStock(it, +1)} className="px-2 py-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
                    </span>
                    {out && it.is_active && <span className="badge bg-red-100 text-red-600"><AlertTriangle className="h-3 w-3" /> نفذ</span>}
                    {!it.is_active && <span className="badge bg-slate-200 text-slate-600">غير متاح</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <button type="button" aria-label="تعديل" onClick={() => setForm({ open: true, item: it })} className="rounded-full bg-primary-50 p-2 text-primary-600 hover:bg-primary-100"><Pencil className="h-4 w-4" /></button>
                  <button type="button" aria-label={it.is_active ? 'إيقاف البيع' : 'إتاحة البيع'} title={it.is_active ? 'إيقاف البيع' : 'إتاحة البيع'} disabled={busy === it.id} onClick={() => toggleActive(it)} className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200">
                    {it.is_active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button type="button" aria-label="حذف" disabled={busy === it.id} onClick={() => remove(it)} className="rounded-full bg-red-50 p-2 text-red-500 hover:bg-red-100">
                    {busy === it.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {form.open && (
        <ItemFormModal
          item={form.item} churches={churches} services={services} classes={classes}
          shops={shops} defaultShopId={shopFilter !== ALL_SHOPS && shopFilter !== NO_SHOP ? shopFilter : null}
          onClose={() => setForm({ open: false, item: null })}
          onSaved={(saved) => {
            setForm({ open: false, item: null });
            setItems((l) => (l.some((x) => x.id === saved.id) ? l.map((x) => (x.id === saved.id ? saved : x)) : [...l, saved]));
            flash(form.item ? 'تم حفظ التعديلات' : `تمت إضافة «${saved.name}»`);
          }}
        />
      )}
      {labelsFor && <LabelsPrintModal items={labelsFor} onClose={() => setLabelsFor(null)} />}
      <Toast msg={toast} />
    </AppShell>
  );
}
