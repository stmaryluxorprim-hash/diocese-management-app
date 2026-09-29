-- =====================================================================
-- 20261002120000 — إستبدال النقاط: المتجر هو الوعاء (the shop is the container)
-- =====================================================================
-- Follow-up of 20261001120000 after the first live use:
--
-- 1. BUG «ليس لديك صلاحية» when adding a shop.
--    `insert into store_shops … returning *` failed for EVERY role (even
--    the owner). Postgres evaluates the SELECT policy on the RETURNING row;
--    the policy called store_shop_visible(id), a STABLE security-definer
--    function that re-reads store_shops — inside the same statement it does
--    not see the row being inserted → false → «new row violates row-level
--    security policy». Fix: the policies use the row's own columns
--    (church_id) and the targets table only; no self-lookup on store_shops.
--
-- 2. The shop is the container: everything of the module (items, POS,
--    requests, archive) lives INSIDE a shop.
--      • store_items.shop_id is REQUIRED for new items (legacy items
--        without a shop keep working until they are moved).
--      • item visibility / write rights follow the SHOP (whoever can see /
--        manage the shop manages its items), not the item's scope columns —
--        the item's church_id is copied from the shop by trigger.
--      • the item code is unique per SHOP (a legacy per-church index is
--        kept for shop-less items).
--      • store_shop_stats(shop) → items · stock · pending · orders · points
--        for the shops list.
--
-- Idempotent — safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. store_shops — RLS that works with RETURNING
-- ---------------------------------------------------------------------
-- Who may SEE (and manage) a shop:
--   • owner / church manager of the owning church (scope_contains), or
--   • the servant who CREATED it (so `insert … returning` works before any
--     target exists and a class servant always keeps his own shop), or
--   • any target of the shop overlaps the caller's scope (a class servant
--     sees the shops connected to his class; «الكل» → everybody).
-- All helpers are SECURITY DEFINER so the policies never recurse
-- (shops ↔ targets ↔ items).

-- any target of the shop overlaps my scope?
create or replace function public.store_shop_target_overlaps(p_shop uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.store_shop_targets t
     where t.shop_id = p_shop
       and (t.church_id is null or public.scope_overlaps(t.church_id, t.service_id, t.class_id)))
$$;
grant execute on function public.store_shop_target_overlaps(uuid) to authenticated;

-- the church of a shop (bypasses the shops RLS)
create or replace function public.store_shop_church(p_shop uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select church_id from public.store_shops where id = p_shop
$$;
grant execute on function public.store_shop_church(uuid) to authenticated;

-- row-level rule (used by the store_shops policies on the row's own columns)
create or replace function public.store_shop_row_visible(p_shop uuid, p_church uuid, p_created_by uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.module_visible('store') and (
    public.scope_contains(p_church, null, null)
    or (p_created_by is not null and p_created_by = auth.uid())
    or public.store_shop_target_overlaps(p_shop))
$$;
grant execute on function public.store_shop_row_visible(uuid, uuid, uuid) to authenticated;

-- by id (used everywhere else: items, requests, stats, RPCs)
create or replace function public.store_shop_visible(p_shop uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public.store_shop_row_visible(s.id, s.church_id, s.created_by)
                     from public.store_shops s where s.id = p_shop), false)
$$;
grant execute on function public.store_shop_visible(uuid) to authenticated;

-- who may CREATE a shop of a church: module + my scope overlaps the church
create or replace function public.store_shop_creatable(p_church uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.module_visible('store') and public.scope_overlaps(p_church, null, null)
$$;
grant execute on function public.store_shop_creatable(uuid) to authenticated;

drop policy if exists store_shops_select on public.store_shops;
create policy store_shops_select on public.store_shops for select using (
  public.store_shop_row_visible(id, church_id, created_by)
);
drop policy if exists store_shops_insert on public.store_shops;
create policy store_shops_insert on public.store_shops for insert with check (
  (select public.store_shop_creatable(church_id))
);
drop policy if exists store_shops_update on public.store_shops;
create policy store_shops_update on public.store_shops for update using (
  public.store_shop_row_visible(id, church_id, created_by)
) with check (
  (select public.store_shop_creatable(church_id))
);
drop policy if exists store_shops_delete on public.store_shops;
create policy store_shops_delete on public.store_shops for delete using (
  public.store_shop_row_visible(id, church_id, created_by)
);

-- targets: read with the shop; write when I can manage the shop AND my
-- scope CONTAINS the target («الكل» is owner-only)
drop policy if exists store_shop_targets_select on public.store_shop_targets;
create policy store_shop_targets_select on public.store_shop_targets for select using (
  public.store_shop_visible(shop_id)
);
drop policy if exists store_shop_targets_insert on public.store_shop_targets;
create policy store_shop_targets_insert on public.store_shop_targets for insert with check (
  public.store_shop_visible(shop_id)
  and (case when church_id is null then public.is_owner() else public.scope_contains(church_id, service_id, class_id) end)
);
drop policy if exists store_shop_targets_delete on public.store_shop_targets;
create policy store_shop_targets_delete on public.store_shop_targets for delete using (
  public.store_shop_visible(shop_id)
  and (case when church_id is null then public.is_owner() else public.scope_contains(church_id, service_id, class_id) end)
);

-- ---------------------------------------------------------------------
-- 2. store_items — inside a shop
-- ---------------------------------------------------------------------
-- new items must belong to a shop; the church is copied from the shop
create or replace function public.store_items_fill_from_shop()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_church uuid;
begin
  if new.shop_id is not null then
    select church_id into v_church from public.store_shops where id = new.shop_id;
    if v_church is null then
      raise exception 'shop_not_found' using errcode = 'P0002';
    end if;
    new.church_id  := v_church;
    new.service_id := null;     -- the place of a shop item is the shop's
    new.class_id   := null;
  elsif tg_op = 'INSERT' then
    raise exception 'shop_required' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_store_items_fill_from_shop on public.store_items;
create trigger trg_store_items_fill_from_shop before insert or update on public.store_items
for each row execute function public.store_items_fill_from_shop();

-- code unique per SHOP (legacy per-church index stays for shop-less items)
drop index if exists public.uq_store_items_church_code;
create unique index if not exists uq_store_items_church_code_legacy
  on public.store_items (church_id, lower(trim(code))) where shop_id is null;
create unique index if not exists uq_store_items_shop_code
  on public.store_items (shop_id, lower(trim(code))) where shop_id is not null;

-- RLS: a shop item is read / written by whoever can see / manage the shop;
-- a legacy item keeps the 0026 scope rules
drop policy if exists store_items_select on public.store_items;
create policy store_items_select on public.store_items for select using (
  (select public.module_visible('store')) and (
    case when shop_id is null then (select public.scope_overlaps(church_id, service_id, class_id))
         else public.store_shop_visible(shop_id) end)
);
drop policy if exists store_items_insert on public.store_items;
create policy store_items_insert on public.store_items for insert with check (
  (select public.module_visible('store')) and (
    case when shop_id is null then (select public.scope_contains(church_id, service_id, class_id))
         else public.store_shop_visible(shop_id) end)
);
drop policy if exists store_items_update on public.store_items;
create policy store_items_update on public.store_items for update using (
  (select public.module_visible('store')) and (
    case when shop_id is null then (select public.scope_contains(church_id, service_id, class_id))
         else public.store_shop_visible(shop_id) end)
) with check (
  (select public.module_visible('store')) and (
    case when shop_id is null then (select public.scope_contains(church_id, service_id, class_id))
         else public.store_shop_visible(shop_id) end)
);
drop policy if exists store_items_delete on public.store_items;
create policy store_items_delete on public.store_items for delete using (
  (select public.module_visible('store')) and (
    case when shop_id is null then (select public.scope_contains(church_id, service_id, class_id))
         else public.store_shop_visible(shop_id) end)
);

-- the scanned-label lookup stays RLS-scoped (security invoker) — nothing to
-- change; the UI narrows the rows to the current shop.

-- ---------------------------------------------------------------------
-- 3. store_shop_stats — numbers for the shops list
-- ---------------------------------------------------------------------
create or replace function public.store_shop_stats(p_shop uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.store_shop_visible(p_shop) then null else jsonb_build_object(
    'items',   (select count(*) from public.store_items i where i.shop_id = p_shop and i.is_active),
    'stock',   (select coalesce(sum(i.stock), 0) from public.store_items i where i.shop_id = p_shop and i.is_active),
    'pending', (select count(*) from public.store_requests r where r.shop_id = p_shop and r.status = 'pending'),
    'orders',  (select count(*) from public.store_orders o where o.shop_id = p_shop and o.status = 'completed'),
    'points',  (select coalesce(sum(o.total_points), 0) from public.store_orders o where o.shop_id = p_shop and o.status = 'completed')
  ) end
$$;
grant execute on function public.store_shop_stats(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. store_checkout(p_enrollment, p_lines, p_note, p_shop) — the POS is
--    inside a shop: every line must belong to that shop
-- ---------------------------------------------------------------------
-- the 3-arg version would make 3-arg calls ambiguous → replace it
drop function if exists public.store_checkout(uuid, jsonb, text);
create or replace function public.store_checkout(
  p_enrollment uuid, p_lines jsonb, p_note text default null, p_shop uuid default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_shop uuid := p_shop; v_bad text;
begin
  if v_shop is null and p_lines is not null and jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) > 0 then
    select it.shop_id into v_shop from public.store_items it
     where it.id = nullif(p_lines->0->>'item_id', '')::uuid;
  end if;
  if v_shop is not null then
    if not public.store_shop_visible(v_shop) then
      raise exception 'shop_not_found' using errcode = 'P0002';
    end if;
    select it.name into v_bad
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
      join public.store_items it on it.id = nullif(x->>'item_id', '')::uuid
     where it.shop_id is distinct from v_shop
     limit 1;
    if v_bad is not null then
      raise exception 'item_out_of_scope:%', v_bad using errcode = 'P0001';
    end if;
  end if;
  return public.store_checkout_internal(p_enrollment, p_lines, p_note, v_shop, null, 'pos');
end $$;
grant execute on function public.store_checkout(uuid, jsonb, text, uuid) to authenticated;
