'use client';

// ---------- Points store module (إستبدال النقاط) — client data layer ----------
// Inventory CRUD goes straight to `store_items` (RLS scoped). The sale
// itself is ONE RPC (`store_checkout`) that re-validates everything inside
// a transaction (module, scope, stock, balance) and writes the bill +
// the −points row. Cancelling is `store_cancel_order` (managers only).

import { legacyCode } from '@/lib/code-templates';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  StoreItem, StoreOrder, StoreOrderItem, StoreCheckoutResult, EnrollmentWithPerson,
  StoreShop, StoreShopTarget, StoreRequest, StoreRequestDetail, StoreRequestStatus,
} from '@/lib/types';
import { ALL, type ScopeSelection } from '@/lib/queries';

// ---------- Basket ----------
export interface BasketLine {
  item: StoreItem;
  qty: number;
}

export const basketTotal = (lines: BasketLine[]) =>
  lines.reduce((s, l) => s + l.item.price * l.qty, 0);
export const basketCount = (lines: BasketLine[]) =>
  lines.reduce((s, l) => s + l.qty, 0);

/** Does a shop (through its targets) cover this enrollment scope? */
export const shopCovers = (
  targets: Pick<StoreShopTarget, 'church_id' | 'service_id' | 'class_id'>[],
  e: Pick<EnrollmentWithPerson, 'church_id' | 'service_id' | 'class_id'>
) =>
  targets.some((t) =>
    t.church_id === null ||
    (t.church_id === e.church_id &&
      (t.service_id === null || t.service_id === e.service_id) &&
      (t.class_id === null || t.class_id === e.class_id)));

/** Does the item apply to this child's enrollment scope?
 *  An item of a SHOP applies where the shop is connected (pass the shop
 *  targets); a legacy item (no shop) applies by its own scope columns. */
export const itemAppliesTo = (
  it: Pick<StoreItem, 'church_id' | 'service_id' | 'class_id'> & { shop_id?: string | null },
  e: Pick<EnrollmentWithPerson, 'church_id' | 'service_id' | 'class_id'>,
  targetsByShop?: Map<string, StoreShopTarget[]>
) => {
  if (it.shop_id && targetsByShop) {
    const ts = targetsByShop.get(it.shop_id);
    // targets unknown (RLS hid the shop) → fall back to the item columns
    if (ts) return shopCovers(ts, e);
  }
  return it.church_id === e.church_id &&
    (it.service_id === null || it.service_id === e.service_id) &&
    (it.class_id === null || it.class_id === e.class_id);
};

// ---------- Error mapping (RPC raise → Arabic) ----------
const ERRORS: [string, string][] = [
  ['module_not_visible', 'وحدة إستبدال النقاط غير مفعّلة لنطاقك'],
  ['enrollment_not_found', 'المخدوم غير موجود'],
  ['empty_basket', 'السلة فارغة'],
  ['invalid_line', 'بند غير صالح في السلة'],
  ['item_not_found', 'أحد الأصناف لم يعد موجوداً في المخزون'],
  ['item_inactive', 'الصنف «%» غير متاح للبيع'],
  ['item_out_of_scope', 'الصنف «%» غير متاح لفصل هذا المخدوم'],
  ['insufficient_stock', 'الكمية المتاحة من «%» لا تكفي'],
  ['insufficient_points', 'رصيد النقاط لا يكفي لهذه السلة'],
  ['not_completed', 'هذه الفاتورة ملغاة بالفعل'],
  ['card_mismatch', 'الكارت الممسوح ليس كارت هذا المخدوم — امسح كارته هو للتأكيد'],
  ['not_pending', 'هذا الطلب لم يعد بانتظار القرار'],
  ['request_pending', 'لديك طلب سابق بانتظار الخادم في هذا المتجر'],
  ['shop_not_found', 'المتجر غير متاح'],
  ['not_found', 'غير موجود'],
  ['forbidden', 'ليس لديك صلاحية على هذه العملية'],
  ['shop_required', 'الصنف يجب أن يكون داخل متجر — افتح المتجر ثم أضف الصنف من مخزونه'],
];

export const SHOPS_MIGRATION_HINT = 'تحتاج تشغيل تحديثات قاعدة البيانات 20261001120000_store_shops_and_child_requests.sql ثم 20261002120000_store_shop_is_the_container.sql في Supabase أولاً';

export function isShopsMigrationMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /store_shops|store_shop_targets|store_requests|store_request_items|store_request_approve|store_request_reject|store_request_detail|store_shop_stats|shop_id/.test(msg) &&
    /does not exist|not find|schema cache|relation|column/i.test(msg);
}

export const MIGRATION_HINT = 'تحتاج تشغيل تحديث قاعدة البيانات 0026_points_store.sql في Supabase أولاً';

export function isMigrationMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /store_items|store_orders|store_order_items|store_checkout|store_cancel_order|store_lookup_item/.test(msg) &&
    /does not exist|not find|schema cache|relation/i.test(msg);
}

export function storeErrorMessage(err: unknown, fallback = 'حدث خطأ، حاول مجدداً'): string {
  const msg = (err as { message?: string } | null)?.message ?? '';
  if (!msg) return fallback;
  if (isShopsMigrationMissing(err)) return SHOPS_MIGRATION_HINT;
  if (isMigrationMissing(err)) return MIGRATION_HINT;
  if ((err as { code?: string } | null)?.code === '23505') return 'هذا الكود مستخدم بالفعل لصنف آخر في نفس المتجر';
  if ((err as { code?: string } | null)?.code === '42501' || /row-level security/i.test(msg)) {
    return 'ليس لديك صلاحية على هذه العملية — تأكد من تشغيل تحديث 20261002120000_store_shop_is_the_container.sql ومن أن الوحدة مفعّلة لنطاقك';
  }
  for (const [key, label] of ERRORS) {
    const i = msg.indexOf(key);
    if (i >= 0) {
      if (label.includes('%')) {
        const after = msg.slice(i + key.length);
        const m = after.match(/^:([^\n"]*)/);
        return label.replace('%', (m?.[1] ?? '').trim() || 'الصنف');
      }
      return label;
    }
  }
  return fallback;
}

// ---------- Inventory ----------
export async function fetchStoreItems(
  supabase: SupabaseClient,
  scope: ScopeSelection = {},
  opts: { activeOnly?: boolean; shopId?: string | null } = {}
): Promise<StoreItem[]> {
  let q = supabase.from('store_items').select('*');
  if (scope.church && scope.church !== ALL) q = q.eq('church_id', scope.church);
  if (opts.activeOnly) q = q.eq('is_active', true);
  if (opts.shopId) q = q.eq('shop_id', opts.shopId);
  const { data, error } = await q.order('sort_order').order('name');
  if (error) throw error;
  let rows = (data ?? []) as StoreItem[];
  // service / class narrowing keeps "all" items (null) that still apply;
  // items of a SHOP are kept — their place is the shop's, not the columns
  if (scope.service && scope.service !== ALL) {
    rows = rows.filter((r) => r.shop_id || r.service_id === null || r.service_id === scope.service);
  }
  if (scope.class && scope.class !== ALL) {
    rows = rows.filter((r) => r.shop_id || r.class_id === null || r.class_id === scope.class);
  }
  return rows;
}

// ---------- Shops (المتاجر) ----------
export interface StoreShopWithTargets extends StoreShop {
  targets: StoreShopTarget[];
  items_count?: number;
}

export async function fetchStoreShops(
  supabase: SupabaseClient,
  opts: { church?: string; activeOnly?: boolean } = {}
): Promise<StoreShopWithTargets[]> {
  let q = supabase.from('store_shops').select('*, targets:store_shop_targets(*)');
  if (opts.church && opts.church !== ALL) q = q.eq('church_id', opts.church);
  if (opts.activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q.order('sort_order').order('name');
  if (error) throw error;
  return ((data ?? []) as unknown as StoreShopWithTargets[]).map((s) => ({ ...s, targets: s.targets ?? [] }));
}

export const targetsByShop = (shops: StoreShopWithTargets[]) =>
  new Map(shops.map((s) => [s.id, s.targets]));

export interface ShopTargetInput { church_id: string | null; service_id: string | null; class_id: string | null }

/** Insert / update a shop and replace its targets in one go. */
export async function saveStoreShop(
  supabase: SupabaseClient,
  shop: { id?: string; church_id: string; name: string; description: string | null; image_url: string | null; is_active: boolean },
  targets: ShopTargetInput[]
): Promise<StoreShopWithTargets> {
  const { id, ...payload } = shop;
  const res = id
    ? await supabase.from('store_shops').update(payload).eq('id', id).select('*').single()
    : await supabase.from('store_shops').insert(payload).select('*').single();
  if (res.error) throw res.error;
  const saved = res.data as StoreShop;
  const { data: existing, error: e1 } = await supabase.from('store_shop_targets').select('*').eq('shop_id', saved.id);
  if (e1) throw e1;
  const cur = (existing ?? []) as StoreShopTarget[];
  const key = (t: ShopTargetInput) => `${t.church_id ?? ''}|${t.service_id ?? ''}|${t.class_id ?? ''}`;
  const wanted = new Map(targets.map((t) => [key(t), t]));
  const toDelete = cur.filter((t) => !wanted.has(key(t))).map((t) => t.id);
  const have = new Set(cur.map(key));
  const toInsert = targets.filter((t) => !have.has(key(t))).map((t) => ({ shop_id: saved.id, ...t }));
  if (toDelete.length) {
    const { error } = await supabase.from('store_shop_targets').delete().in('id', toDelete);
    if (error) throw error;
  }
  if (toInsert.length) {
    const { error } = await supabase.from('store_shop_targets').insert(toInsert);
    if (error) throw error;
  }
  const { data: fresh } = await supabase.from('store_shop_targets').select('*').eq('shop_id', saved.id);
  return { ...saved, targets: (fresh ?? []) as StoreShopTarget[] };
}

/** Numbers for one shop (RLS-checked in the DB; null when the shop is not visible). */
export interface StoreShopStats { items: number; stock: number; pending: number; orders: number; points: number }
export async function fetchStoreShopStats(supabase: SupabaseClient, shopId: string): Promise<StoreShopStats | null> {
  const { data, error } = await supabase.rpc('store_shop_stats', { p_shop: shopId });
  if (error) throw error;
  return (data ?? null) as StoreShopStats | null;
}

export async function fetchStoreShop(supabase: SupabaseClient, shopId: string): Promise<StoreShopWithTargets | null> {
  const { data, error } = await supabase.from('store_shops').select('*, targets:store_shop_targets(*)').eq('id', shopId).maybeSingle();
  if (error) throw error;
  return (data ?? null) as StoreShopWithTargets | null;
}

export async function setStoreShopActive(supabase: SupabaseClient, shopId: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('store_shops').update({ is_active: active }).eq('id', shopId);
  if (error) throw error;
}

export async function deleteStoreShop(supabase: SupabaseClient, shopId: string): Promise<void> {
  const { error } = await supabase.from('store_shops').delete().eq('id', shopId);
  if (error) throw error;
}

// ---------- Purchase requests (طلبات الشراء من بوابة المخدوم) ----------
export interface StoreRequestWithPerson extends StoreRequest {
  person: { id: string; name: string; national_id: string; image_url: string | null } | null;
  shop: { id: string; name: string; image_url: string | null } | null;
}

export async function fetchStoreRequests(
  supabase: SupabaseClient,
  scope: ScopeSelection,
  opts: { status?: StoreRequestStatus | 'all'; limit?: number; shopId?: string } = {}
): Promise<StoreRequestWithPerson[]> {
  let q = supabase.from('store_requests')
    .select('*, person:persons(id, name, national_id, image_url), shop:store_shops(id, name, image_url)');
  if (scope.church && scope.church !== ALL) q = q.eq('church_id', scope.church);
  if (scope.service && scope.service !== ALL) q = q.eq('service_id', scope.service);
  if (scope.class && scope.class !== ALL) q = q.eq('class_id', scope.class);
  if (opts.status && opts.status !== 'all') q = q.eq('status', opts.status);
  if (opts.shopId) q = q.eq('shop_id', opts.shopId);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(opts.limit ?? 200);
  if (error) throw error;
  return (data ?? []) as unknown as StoreRequestWithPerson[];
}

export async function fetchStoreRequestDetail(supabase: SupabaseClient, id: string): Promise<StoreRequestDetail | null> {
  const { data, error } = await supabase.rpc('store_request_detail', { p_request: id });
  if (error) throw error;
  return (data ?? null) as StoreRequestDetail | null;
}

/** Approve after scanning the child's card — the DB refuses any other code. */
export async function storeRequestApprove(
  supabase: SupabaseClient, id: string, cardCode: string, note?: string
): Promise<StoreRequestDetail & StoreCheckoutResult> {
  const { data, error } = await supabase.rpc('store_request_approve', {
    p_request: id, p_card_code: cardCode.trim(), p_note: note?.trim() || null,
  });
  if (error) throw error;
  return data as StoreRequestDetail & StoreCheckoutResult;
}

export async function storeRequestReject(supabase: SupabaseClient, id: string, note?: string): Promise<StoreRequestDetail> {
  const { data, error } = await supabase.rpc('store_request_reject', { p_request: id, p_note: note?.trim() || null });
  if (error) throw error;
  return data as StoreRequestDetail;
}

/** Resolve a scanned item QR (the item code) — may return several rows
 *  (one per church); the caller narrows to the child's church. */
export async function lookupStoreItem(supabase: SupabaseClient, code: string): Promise<StoreItem[]> {
  const { data, error } = await supabase.rpc('store_lookup_item', { p_code: code.trim() });
  if (error) throw error;
  return (data ?? []) as StoreItem[];
}

// ---------- Sale ----------
export async function storeCheckout(
  supabase: SupabaseClient,
  enrollmentId: string,
  lines: BasketLine[],
  note?: string,
  shopId?: string | null
): Promise<StoreCheckoutResult> {
  // 20261002120000: the POS lives inside a shop → every line must belong to it
  const args: Record<string, unknown> = {
    p_enrollment: enrollmentId,
    p_lines: lines.map((l) => ({ item_id: l.item.id, qty: l.qty })),
    p_note: note?.trim() || null,
  };
  if (shopId) args.p_shop = shopId;
  const { data, error } = await supabase.rpc('store_checkout', args);
  if (error) throw error;
  return data as StoreCheckoutResult;
}

export async function storeCancelOrder(
  supabase: SupabaseClient,
  orderId: string,
  note?: string
): Promise<{ order_id: string; refunded: number; balance_after: number }> {
  const { data, error } = await supabase.rpc('store_cancel_order', {
    p_order: orderId,
    p_note: note?.trim() || null,
  });
  if (error) throw error;
  return data as { order_id: string; refunded: number; balance_after: number };
}

// ---------- Archive ----------
export interface StoreOrderWithPerson extends StoreOrder {
  person: { id: string; name: string; national_id: string; image_url: string | null } | null;
  shop?: { id: string; name: string } | null;
}

const ORDER_LIST_SELECT = '*, person:persons(id, name, national_id, image_url), shop:store_shops(id, name)';
const ORDER_LIST_SELECT_LEGACY = '*, person:persons(id, name, national_id, image_url)';

export const ORDERS_PAGE_SIZE = 50;

export async function fetchStoreOrders(
  supabase: SupabaseClient,
  scope: ScopeSelection,
  opts: { page?: number; pageSize?: number; search?: string; enrollmentId?: string; shopId?: string } = {}
): Promise<{ rows: StoreOrderWithPerson[]; hasMore: boolean }> {
  const page = opts.page ?? 0;
  const size = opts.pageSize ?? ORDERS_PAGE_SIZE;
  const search = (opts.search ?? '').trim();
  const run = async (base: string) => {
    const select = search ? base.replace('person:persons(', 'person:persons!inner(') : base;
    let q = supabase.from('store_orders').select(select);
    if (scope.church && scope.church !== ALL) q = q.eq('church_id', scope.church);
    if (scope.service && scope.service !== ALL) q = q.eq('service_id', scope.service);
    if (scope.class && scope.class !== ALL) q = q.eq('class_id', scope.class);
    if (opts.enrollmentId) q = q.eq('enrollment_id', opts.enrollmentId);
    if (opts.shopId) q = q.eq('shop_id', opts.shopId);
    if (search) {
      const s = search.replace(/[,()]/g, ' ');
      q = q.or(`name.ilike.%${s}%,national_id.ilike.%${s}%`, { referencedTable: 'person' });
    }
    return q.order('created_at', { ascending: false }).range(page * size, page * size + size);
  };
  let { data, error } = await run(ORDER_LIST_SELECT);
  // before the shops migration the join on store_shops does not exist
  if (error && isShopsMigrationMissing(error)) ({ data, error } = await run(ORDER_LIST_SELECT_LEGACY));
  if (error) throw error;
  const list = (data ?? []) as unknown as StoreOrderWithPerson[];
  const hasMore = list.length > size;
  return { rows: hasMore ? list.slice(0, size) : list, hasMore };
}

export async function fetchStoreOrderItems(supabase: SupabaseClient, orderId: string): Promise<StoreOrderItem[]> {
  const { data, error } = await supabase
    .from('store_order_items').select('*').eq('order_id', orderId).order('item_name');
  if (error) throw error;
  return (data ?? []) as StoreOrderItem[];
}

/** Names of the servants who recorded the given orders (profiles RLS may
 *  hide some → they fall back to '—'). */
export async function fetchRecorderNames(
  supabase: SupabaseClient, ids: (string | null)[]
): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter((x): x is string => !!x)));
  const m = new Map<string, string>();
  if (uniq.length === 0) return m;
  const { data } = await supabase.from('servant_enrollments').select('id, full_name').in('id', uniq);
  ((data ?? []) as { id: string; full_name: string }[]).forEach((p) => m.set(p.id, p.full_name));
  return m;
}

// ---------- QR labels ----------
export type LabelSize = 'small' | 'medium' | 'large';
export const LABEL_SIZES: Record<LabelSize, { w: number; h: number; qr: number; label: string }> = {
  small:  { w: 38, h: 25, qr: 18, label: 'صغير 38×25 مم' },
  medium: { w: 50, h: 30, qr: 22, label: 'متوسط 50×30 مم' },
  large:  { w: 70, h: 40, qr: 30, label: 'كبير 70×40 مم' },
};

/** Built-in item code suggestion, e.g. ST-4F7K2Q — components use useCodeGenerator('store_item') */
export function suggestItemCode(): string {
  return legacyCode('store_item');
}
