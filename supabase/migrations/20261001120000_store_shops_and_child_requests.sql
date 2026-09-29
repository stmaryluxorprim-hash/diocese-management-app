-- =====================================================================
-- STORE SHOPS + CHILD PURCHASE REQUESTS
-- (إستبدال النقاط — المتاجر وطلبات الشراء من بوابة المخدوم)
--
-- Until now the points store was ONE flat inventory sold at the servant's
-- POS. This migration adds the missing pieces the user asked for:
--
--   1. المتاجر (store_shops) — a shop / kiosk with a name, picture and an
--      ACTIVATION switch (is_active). A shop is connected to one or MANY
--      places through store_shop_targets: a church, a service, a class,
--      several of them, or «الكل» (a target row with church_id = null).
--      Items (store_items.shop_id) belong to a shop; the legacy items
--      without a shop keep working exactly as before at the POS.
--   2. بوابة المخدوم — an ACTIVE shop whose targets cover one of the
--      child's enrollments appears in his portal (child_portal_shops). He
--      browses its items (child_portal_shop_items), builds a cart and SENDS
--      IT to the servants (child_portal_store_request → store_requests +
--      store_request_items, status = pending). He may cancel while pending.
--   3. الطلبات — the servants of the child's scope see the request live
--      (RLS on store_requests). To approve, the servant SCANS THE CHILD'S
--      CARD as a confirmation (store_request_approve(p_request, p_card_code)
--      refuses when the code is not the child's) → the request becomes an
--      ORDER through the very same store_checkout logic (stock, balance,
--      points_log, receipt) → status approved + order_id. Or he rejects it
--      (store_request_reject) with an optional reason.
--   4. Receipts — store_orders.shop_id + request_id (+ source 'pos' |
--      'request'). The child sees every receipt with its lines in the portal
--      (child_portal_store_orders now carries shop_name / source) and the
--      servant sees it in the module archive as before.
--
-- Idempotent — safe to re-run. Depends on 0026 (store), 0027
-- (module_granted_for), 0042 (child_portal_person = session token), 0046
-- (broadcast bus), 0047 (activity log).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. TABLE: store_shops (المتاجر)
-- ---------------------------------------------------------------------
create table if not exists public.store_shops (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references public.churches(id) on delete cascade,   -- owning church (RLS write)
  name        text not null,
  description text,
  image_url   text,
  is_active   boolean not null default false,          -- «تفعيل» → visible in the child portal
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.servant_enrollments(id) on delete set null,
  edited_at   timestamptz not null default now(),
  edited_by   uuid references public.servant_enrollments(id) on delete set null,
  constraint store_shops_name_not_blank check (length(trim(name)) > 0)
);
comment on table public.store_shops is
  'إستبدال النقاط — المتاجر: متجر له اسم وصورة وزر تفعيل، مرتبط بكنيسة / خدمة / فصل أو أكثر (store_shop_targets)';

create index if not exists idx_store_shops_church on public.store_shops(church_id);
create index if not exists idx_store_shops_active on public.store_shops(church_id, is_active);

drop trigger if exists trg_store_shops_touch on public.store_shops;
create trigger trg_store_shops_touch before update on public.store_shops
for each row execute function public.touch_edited();

create or replace function public.store_shops_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.name := trim(new.name);
  if tg_op = 'INSERT' and new.created_by is null then new.created_by := auth.uid(); end if;
  if tg_op = 'UPDATE' then new.edited_by := coalesce(auth.uid(), new.edited_by); end if;
  return new;
end $$;
drop trigger if exists trg_store_shops_fill on public.store_shops;
create trigger trg_store_shops_fill before insert or update on public.store_shops
for each row execute function public.store_shops_fill();

-- ---------------------------------------------------------------------
-- 2. TABLE: store_shop_targets — where the shop is connected
--    church_id null           → «الكل» (every church)
--    church only              → the whole church
--    church + service         → the whole service
--    church + service + class → that class
--    Several rows = several places.
-- ---------------------------------------------------------------------
create table if not exists public.store_shop_targets (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.store_shops(id) on delete cascade,
  church_id  uuid references public.churches(id) on delete cascade,
  service_id uuid references public.services(id) on delete cascade,
  class_id   uuid references public.classes(id)  on delete cascade,
  created_at timestamptz not null default now(),
  constraint store_shop_targets_chain check (
    not (service_id is not null and church_id is null)
    and not (class_id is not null and service_id is null))
);
comment on table public.store_shop_targets is
  'إستبدال النقاط — أماكن المتجر: كل صف = كنيسة / خدمة / فصل يظهر فيه المتجر (church_id null = الكل)';

create unique index if not exists uq_store_shop_targets
  on public.store_shop_targets (shop_id, coalesce(church_id, '00000000-0000-0000-0000-000000000000'::uuid),
                                coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
                                coalesce(class_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_store_shop_targets_shop  on public.store_shop_targets(shop_id);
create index if not exists idx_store_shop_targets_scope on public.store_shop_targets(church_id, service_id, class_id);

create or replace function public.check_store_shop_target()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.service_id is not null and not exists (
    select 1 from public.services s where s.id = new.service_id and s.church_id = new.church_id) then
    raise exception 'service does not belong to the church';
  end if;
  if new.class_id is not null and not exists (
    select 1 from public.classes c
     where c.id = new.class_id and c.service_id = new.service_id and c.church_id = new.church_id) then
    raise exception 'class does not belong to the service';
  end if;
  return new;
end $$;
drop trigger if exists trg_store_shop_target on public.store_shop_targets;
create trigger trg_store_shop_target before insert or update on public.store_shop_targets
for each row execute function public.check_store_shop_target();

-- does this shop cover the given enrollment scope?
create or replace function public.store_shop_covers(p_shop uuid, p_church uuid, p_service uuid, p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.store_shop_targets t
     where t.shop_id = p_shop
       and (t.church_id is null
            or (t.church_id = p_church
                and (t.service_id is null or t.service_id = p_service)
                and (t.class_id   is null or t.class_id   = p_class)))
  )
$$;
grant execute on function public.store_shop_covers(uuid, uuid, uuid, uuid) to authenticated, anon;

-- can the caller see the shop? owner / church manager of the owning church
-- (scope_contains) — or ANY target overlaps his scope (a class servant sees
-- the shops connected to his class, not the ones of other classes)
create or replace function public.store_shop_visible(p_shop uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.module_visible('store') and (
    exists (select 1 from public.store_shops s where s.id = p_shop and public.scope_contains(s.church_id, null, null))
    or exists (
      select 1 from public.store_shop_targets t
       where t.shop_id = p_shop
         and (t.church_id is null or public.scope_overlaps(t.church_id, t.service_id, t.class_id)))
  )
$$;
grant execute on function public.store_shop_visible(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. store_items.shop_id · store_orders.shop_id / request_id / source
-- ---------------------------------------------------------------------
alter table public.store_items
  add column if not exists shop_id uuid references public.store_shops(id) on delete set null;
create index if not exists idx_store_items_shop on public.store_items(shop_id);

alter table public.store_orders
  add column if not exists shop_id    uuid references public.store_shops(id) on delete set null,
  add column if not exists request_id uuid,                                  -- FK added below (table created after)
  add column if not exists source     text not null default 'pos';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'store_orders_source_check') then
    alter table public.store_orders add constraint store_orders_source_check check (source in ('pos', 'request'));
  end if;
end $$;
create index if not exists idx_store_orders_shop on public.store_orders(shop_id);

-- ---------------------------------------------------------------------
-- 4. TABLES: store_requests (طلبات الشراء) + store_request_items
-- ---------------------------------------------------------------------
create table if not exists public.store_requests (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.store_shops(id) on delete cascade,
  enrollment_id  uuid not null references public.enrollments(id) on delete cascade,
  person_id      uuid not null references public.persons(id) on delete cascade,
  church_id      uuid not null references public.churches(id) on delete cascade,
  service_id     uuid not null references public.services(id) on delete cascade,
  class_id       uuid not null references public.classes(id)  on delete cascade,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  items_count    integer not null default 0,
  total_points   integer not null default 0 check (total_points >= 0),
  balance_at_request integer not null default 0,     -- the child's balance when he sent it (info)
  note           text,                               -- the child's note
  decision_note  text,                               -- the servant's reason (reject)
  order_id       uuid references public.store_orders(id) on delete set null,   -- when approved
  decided_by     uuid references public.servant_enrollments(id) on delete set null,
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);
comment on table public.store_requests is
  'إستبدال النقاط — طلبات الشراء من بوابة المخدوم: سلة أرسلها المخدوم، يعتمدها الخادم بعد مسح كارته أو يرفضها';

create index if not exists idx_store_requests_status  on public.store_requests(status, created_at desc);
create index if not exists idx_store_requests_church  on public.store_requests(church_id, status);
create index if not exists idx_store_requests_service on public.store_requests(service_id);
create index if not exists idx_store_requests_class   on public.store_requests(class_id);
create index if not exists idx_store_requests_person  on public.store_requests(person_id, created_at desc);
create index if not exists idx_store_requests_shop    on public.store_requests(shop_id);

create table if not exists public.store_request_items (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.store_requests(id) on delete cascade,
  item_id    uuid references public.store_items(id) on delete set null,
  item_code  text not null,
  item_name  text not null,
  image_url  text,
  unit_price integer not null check (unit_price >= 0),
  qty        integer not null check (qty > 0),
  line_total integer not null check (line_total >= 0)
);
create index if not exists idx_store_request_items_request on public.store_request_items(request_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'store_orders_request_id_fkey') then
    alter table public.store_orders
      add constraint store_orders_request_id_fkey foreign key (request_id)
      references public.store_requests(id) on delete set null;
  end if;
end $$;
create index if not exists idx_store_orders_request on public.store_orders(request_id);

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------
alter table public.store_shops          enable row level security;
alter table public.store_shop_targets   enable row level security;
alter table public.store_requests       enable row level security;
alter table public.store_request_items  enable row level security;

-- shops: read = store_shop_visible; create = any servant of the church
-- (he then connects the places his scope contains); edit / delete /
-- activate = whoever can see the shop
drop policy if exists store_shops_select on public.store_shops;
create policy store_shops_select on public.store_shops for select using (
  public.store_shop_visible(id)
);
drop policy if exists store_shops_insert on public.store_shops;
create policy store_shops_insert on public.store_shops for insert with check (
  (select public.module_visible('store')) and (select public.scope_overlaps(church_id, null, null))
);
drop policy if exists store_shops_update on public.store_shops;
create policy store_shops_update on public.store_shops for update using (
  public.store_shop_visible(id)
) with check (
  (select public.module_visible('store')) and (select public.scope_overlaps(church_id, null, null))
);
drop policy if exists store_shops_delete on public.store_shops;
create policy store_shops_delete on public.store_shops for delete using (
  public.store_shop_visible(id)
);

-- targets: read with the shop; write when my scope CONTAINS the target
-- (a class servant can only connect his class; «الكل» is owner-only)
drop policy if exists store_shop_targets_select on public.store_shop_targets;
create policy store_shop_targets_select on public.store_shop_targets for select using (
  public.store_shop_visible(shop_id)
);
drop policy if exists store_shop_targets_insert on public.store_shop_targets;
create policy store_shop_targets_insert on public.store_shop_targets for insert with check (
  (select public.module_visible('store'))
  and exists (select 1 from public.store_shops s where s.id = shop_id and public.scope_overlaps(s.church_id, null, null))
  and (case when church_id is null then public.is_owner() else public.scope_contains(church_id, service_id, class_id) end)
);
drop policy if exists store_shop_targets_delete on public.store_shop_targets;
create policy store_shop_targets_delete on public.store_shop_targets for delete using (
  (select public.module_visible('store'))
  and exists (select 1 from public.store_shops s where s.id = shop_id and public.scope_overlaps(s.church_id, null, null))
  and (case when church_id is null then public.is_owner() else public.scope_contains(church_id, service_id, class_id) end)
);

-- requests: the servants who can see the child's enrollment; no direct
-- writes — everything goes through the RPCs
drop policy if exists store_requests_select on public.store_requests;
create policy store_requests_select on public.store_requests for select using (
  (select public.module_visible('store'))
  and public.enrollment_visible(church_id, service_id, class_id,
    (select role from public.my_scope()), (select church_id from public.my_scope()),
    (select service_id from public.my_scope()), (select class_id from public.my_scope()))
);
drop policy if exists store_request_items_select on public.store_request_items;
create policy store_request_items_select on public.store_request_items for select using (
  exists (
    select 1 from public.store_requests r
     where r.id = store_request_items.request_id
       and (select public.module_visible('store'))
       and public.enrollment_visible(r.church_id, r.service_id, r.class_id,
         (select role from public.my_scope()), (select church_id from public.my_scope()),
         (select service_id from public.my_scope()), (select class_id from public.my_scope()))
  )
);

-- ---------------------------------------------------------------------
-- 6. store_checkout learns shop_id / request_id / source (internal
--    variant) — the public 3-arg signature stays and delegates to it.
-- ---------------------------------------------------------------------
create or replace function public.store_checkout_internal(
  p_enrollment uuid, p_lines jsonb, p_note text, p_shop uuid, p_request uuid, p_source text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  s        record;
  e        public.enrollments;
  it       public.store_items;
  ln       record;
  v_order  uuid;
  v_total  integer := 0;
  v_count  integer := 0;
  v_before integer;
  v_after  integer;
  v_pl     uuid;
begin
  if auth.uid() is null then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if not public.module_visible('store') then
    raise exception 'module_not_visible' using errcode = 'P0001';
  end if;
  select * into s from public.my_scope();
  if not found then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  select * into e from public.enrollments where id = p_enrollment for update;
  if not found then
    raise exception 'enrollment_not_found' using errcode = 'P0002';
  end if;
  if not public.enrollment_visible(e.church_id, e.service_id, e.class_id,
                                   s.role, s.church_id, s.service_id, s.class_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'empty_basket' using errcode = 'P0001';
  end if;

  v_before := e.points;

  insert into public.store_orders (
    enrollment_id, person_id, church_id, service_id, class_id,
    balance_before, balance_after, note, recorded_by, shop_id, request_id, source)
  values (e.id, e.person_id, e.church_id, e.service_id, e.class_id,
          v_before, v_before, nullif(trim(coalesce(p_note, '')), ''), auth.uid(),
          p_shop, p_request, coalesce(p_source, 'pos'))
  returning id into v_order;

  for ln in
    select (x->>'item_id')::uuid as item_id, sum((x->>'qty')::int) as qty
      from jsonb_array_elements(p_lines) x
     group by 1
  loop
    if ln.item_id is null or ln.qty is null or ln.qty <= 0 then
      raise exception 'invalid_line' using errcode = 'P0001';
    end if;
    select * into it from public.store_items where id = ln.item_id for update;
    if not found then
      raise exception 'item_not_found' using errcode = 'P0002';
    end if;
    if not it.is_active then
      raise exception 'item_inactive:%', it.name using errcode = 'P0001';
    end if;
    -- an item of a shop applies where the SHOP is connected; a legacy item
    -- (no shop) applies by its own scope columns
    if it.shop_id is not null then
      if not public.store_shop_covers(it.shop_id, e.church_id, e.service_id, e.class_id) then
        raise exception 'item_out_of_scope:%', it.name using errcode = 'P0001';
      end if;
    elsif not (it.church_id = e.church_id
            and (it.service_id is null or it.service_id = e.service_id)
            and (it.class_id   is null or it.class_id   = e.class_id)) then
      raise exception 'item_out_of_scope:%', it.name using errcode = 'P0001';
    end if;
    if it.stock < ln.qty then
      raise exception 'insufficient_stock:%', it.name using errcode = 'P0001';
    end if;

    update public.store_items set stock = stock - ln.qty where id = it.id;

    insert into public.store_order_items (
      order_id, item_id, item_code, item_name, image_url, unit_price, qty, line_total)
    values (v_order, it.id, it.code, it.name, it.image_url, it.price, ln.qty, it.price * ln.qty);

    v_total := v_total + it.price * ln.qty;
    v_count := v_count + ln.qty;
  end loop;

  if v_total > v_before then
    raise exception 'insufficient_points' using errcode = 'P0001';
  end if;

  if v_total > 0 then
    insert into public.points_log (enrollment_id, cause_id, event_id, delta, recorded_by)
    values (e.id, null, null, -v_total, auth.uid())
    returning id into v_pl;
  end if;

  select points into v_after from public.enrollments where id = e.id;

  update public.store_orders
     set items_count = v_count, total_points = v_total,
         balance_after = v_after, points_log_id = v_pl
   where id = v_order;

  return jsonb_build_object(
    'order_id', v_order, 'total_points', v_total, 'items_count', v_count,
    'balance_before', v_before, 'balance_after', v_after);
end $$;
revoke all on function public.store_checkout_internal(uuid, jsonb, text, uuid, uuid, text) from public, anon, authenticated;

-- POS entry point (unchanged signature). The shop of the sale is the shop
-- of the first line (all lines of one basket come from one shop / counter).
create or replace function public.store_checkout(
  p_enrollment uuid, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_shop uuid;
begin
  if p_lines is not null and jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) > 0 then
    select it.shop_id into v_shop from public.store_items it
     where it.id = nullif(p_lines->0->>'item_id', '')::uuid;
  end if;
  return public.store_checkout_internal(p_enrollment, p_lines, p_note, v_shop, null, 'pos');
end $$;
grant execute on function public.store_checkout(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. CHILD PORTAL — shops · items · send / cancel a request · my requests
-- ---------------------------------------------------------------------

-- the ACTIVE shops that cover one of my enrollments (module granted there)
create or replace function public.child_portal_shops(p_national_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.persons; res jsonb;
begin
  p := public.child_portal_person(p_national_id);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'description', s.description, 'image_url', s.image_url,
           'church_id', s.church_id, 'church_name', ch.name,
           'items_count', (select count(*) from public.store_items i where i.shop_id = s.id and i.is_active and i.stock > 0),
           'enrollment_ids', (
             select jsonb_agg(distinct e.id) from public.enrollments e
              where e.person_id = p.id and e.kind = 'child' and e.status = 'active'
                and public.store_shop_covers(s.id, e.church_id, e.service_id, e.class_id)
                and public.module_granted_for('store', e.church_id, e.service_id, e.class_id)),
           'pending_requests', (select count(*) from public.store_requests r where r.shop_id = s.id and r.person_id = p.id and r.status = 'pending')
         ) order by s.sort_order, s.name), '[]'::jsonb)
    into res
    from public.store_shops s
    join public.churches ch on ch.id = s.church_id
   where s.is_active
     and exists (
       select 1 from public.enrollments e
        where e.person_id = p.id and e.kind = 'child' and e.status = 'active'
          and public.store_shop_covers(s.id, e.church_id, e.service_id, e.class_id)
          and public.module_granted_for('store', e.church_id, e.service_id, e.class_id));
  return res;
end $$;
grant execute on function public.child_portal_shops(text) to anon, authenticated;

-- the sellable items of ONE shop I can see
create or replace function public.child_portal_shop_items(p_national_id text, p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.persons; res jsonb;
begin
  p := public.child_portal_person(p_national_id);
  if not exists (
    select 1 from public.store_shops s
     where s.id = p_shop and s.is_active
       and exists (
         select 1 from public.enrollments e
          where e.person_id = p.id and e.kind = 'child' and e.status = 'active'
            and public.store_shop_covers(s.id, e.church_id, e.service_id, e.class_id)
            and public.module_granted_for('store', e.church_id, e.service_id, e.class_id))) then
    raise exception 'shop_not_found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'code', i.code, 'name', i.name, 'description', i.description,
           'image_url', i.image_url, 'price', i.price, 'stock', i.stock
         ) order by i.sort_order, i.name), '[]'::jsonb)
    into res
    from public.store_items i
   where i.shop_id = p_shop and i.is_active;
  return res;
end $$;
grant execute on function public.child_portal_shop_items(text, uuid) to anon, authenticated;

-- shape of one request (used by the child list + the servant RPCs)
create or replace function public.store_request_json(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'shop_id', r.shop_id, 'shop_name', s.name, 'shop_image_url', s.image_url,
    'enrollment_id', r.enrollment_id, 'person_id', r.person_id,
    'status', r.status, 'items_count', r.items_count, 'total_points', r.total_points,
    'balance_at_request', r.balance_at_request, 'note', r.note, 'decision_note', r.decision_note,
    'order_id', r.order_id, 'decided_at', r.decided_at, 'created_at', r.created_at,
    'decided_by_name', pr.full_name,
    'class_name', cl.name, 'service_name', sv.name, 'church_name', ch.name,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', li.id, 'item_id', li.item_id, 'item_name', li.item_name, 'item_code', li.item_code,
               'image_url', li.image_url, 'unit_price', li.unit_price,
               'qty', li.qty, 'line_total', li.line_total) order by li.item_name), '[]'::jsonb)
        from public.store_request_items li where li.request_id = r.id))
    from public.store_requests r
    join public.store_shops s on s.id = r.shop_id
    left join public.servant_enrollments pr on pr.id = r.decided_by
    join public.classes  cl on cl.id = r.class_id
    join public.services sv on sv.id = r.service_id
    join public.churches ch on ch.id = r.church_id
   where r.id = p_id
$$;
revoke all on function public.store_request_json(uuid) from public, anon, authenticated;

-- «أرسل الطلب» — the child's cart → a pending request
--   p_lines = [{ "item_id": uuid, "qty": int }, ...]
create or replace function public.child_portal_store_request(
  p_national_id text, p_shop uuid, p_lines jsonb, p_enrollment uuid default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p public.persons; s public.store_shops; e public.enrollments; it public.store_items; ln record;
  v_req uuid; v_total int := 0; v_count int := 0;
begin
  p := public.child_portal_person(p_national_id);
  select * into s from public.store_shops where id = p_shop;
  if not found or not s.is_active then raise exception 'shop_not_found' using errcode = 'P0002'; end if;

  -- the enrollment the shop is connected to (explicit when the child is in several)
  select * into e from public.enrollments x
   where x.person_id = p.id and x.kind = 'child' and x.status = 'active'
     and (p_enrollment is null or x.id = p_enrollment)
     and public.store_shop_covers(s.id, x.church_id, x.service_id, x.class_id)
     and public.module_granted_for('store', x.church_id, x.service_id, x.class_id)
   order by x.created_at limit 1;
  if not found then raise exception 'shop_not_found' using errcode = 'P0002'; end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'empty_basket' using errcode = 'P0001';
  end if;
  -- one open request per shop at a time
  if exists (select 1 from public.store_requests r where r.person_id = p.id and r.shop_id = s.id and r.status = 'pending') then
    raise exception 'request_pending' using errcode = 'P0001';
  end if;

  insert into public.store_requests (shop_id, enrollment_id, person_id, church_id, service_id, class_id,
                                     balance_at_request, note)
  values (s.id, e.id, e.person_id, e.church_id, e.service_id, e.class_id,
          e.points, nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_req;

  for ln in
    select (x->>'item_id')::uuid as item_id, sum((x->>'qty')::int) as qty
      from jsonb_array_elements(p_lines) x group by 1
  loop
    if ln.item_id is null or ln.qty is null or ln.qty <= 0 then
      raise exception 'invalid_line' using errcode = 'P0001';
    end if;
    select * into it from public.store_items where id = ln.item_id;
    if not found or it.shop_id is distinct from s.id then
      raise exception 'item_not_found' using errcode = 'P0002';
    end if;
    if not it.is_active then raise exception 'item_inactive:%', it.name using errcode = 'P0001'; end if;
    if it.stock < ln.qty then raise exception 'insufficient_stock:%', it.name using errcode = 'P0001'; end if;
    insert into public.store_request_items (request_id, item_id, item_code, item_name, image_url, unit_price, qty, line_total)
    values (v_req, it.id, it.code, it.name, it.image_url, it.price, ln.qty, it.price * ln.qty);
    v_total := v_total + it.price * ln.qty;
    v_count := v_count + ln.qty;
  end loop;

  if v_total > e.points then raise exception 'insufficient_points' using errcode = 'P0001'; end if;

  update public.store_requests set items_count = v_count, total_points = v_total where id = v_req;
  return public.store_request_json(v_req);
end $$;
grant execute on function public.child_portal_store_request(text, uuid, jsonb, uuid, text) to anon, authenticated;

-- the child cancels his own PENDING request
create or replace function public.child_portal_store_request_cancel(p_national_id text, p_request uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p public.persons; r public.store_requests;
begin
  p := public.child_portal_person(p_national_id);
  select * into r from public.store_requests where id = p_request and person_id = p.id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'not_pending' using errcode = 'P0001'; end if;
  update public.store_requests set status = 'cancelled', decided_at = now() where id = r.id;
  return public.store_request_json(r.id);
end $$;
grant execute on function public.child_portal_store_request_cancel(text, uuid) to anon, authenticated;

-- my requests (all statuses), newest first
create or replace function public.child_portal_store_requests(p_national_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.persons; res jsonb;
begin
  p := public.child_portal_person(p_national_id);
  select coalesce(jsonb_agg(public.store_request_json(r.id) order by r.created_at desc), '[]'::jsonb)
    into res from public.store_requests r where r.person_id = p.id;
  return res;
end $$;
grant execute on function public.child_portal_store_requests(text) to anon, authenticated;

-- my receipts — now with the shop and the source (pos | request)
create or replace function public.child_portal_store_orders(p_national_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p public.persons;
  res jsonb;
begin
  p := public.child_portal_person(p_national_id);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id,
           'enrollment_id', o.enrollment_id,
           'status', o.status,
           'source', o.source,
           'shop_id', o.shop_id,
           'shop_name', sh.name,
           'request_id', o.request_id,
           'items_count', o.items_count,
           'total_points', o.total_points,
           'balance_before', o.balance_before,
           'balance_after', o.balance_after,
           'note', o.note,
           'created_at', o.created_at,
           'cancelled_at', o.cancelled_at,
           'recorded_by_name', pr.full_name,
           'class_name', cl.name,
           'service_name', sv.name,
           'church_name', ch.name,
           'items', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'id', li.id, 'item_name', li.item_name, 'item_code', li.item_code,
                      'image_url', li.image_url, 'unit_price', li.unit_price,
                      'qty', li.qty, 'line_total', li.line_total) order by li.item_name), '[]'::jsonb)
               from public.store_order_items li where li.order_id = o.id)
         ) order by o.created_at desc), '[]'::jsonb)
    into res
    from public.store_orders o
    join public.enrollments e on e.id = o.enrollment_id
    left join public.servant_enrollments pr on pr.id = o.recorded_by
    left join public.store_shops sh on sh.id = o.shop_id
    join public.classes  cl on cl.id = o.class_id
    join public.services sv on sv.id = o.service_id
    join public.churches ch on ch.id = o.church_id
   where e.person_id = p.id;
  return res;
end $$;
grant execute on function public.child_portal_store_orders(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. SERVANT SIDE — approve (after scanning the child's card) / reject
-- ---------------------------------------------------------------------
create or replace function public.store_request_approve(p_request uuid, p_card_code text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  s record; r public.store_requests; p public.persons; lines jsonb; res jsonb;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if not public.module_visible('store') then raise exception 'module_not_visible' using errcode = 'P0001'; end if;
  select * into s from public.my_scope();
  if not found then raise exception 'forbidden' using errcode = 'P0001'; end if;

  select * into r from public.store_requests where id = p_request for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.enrollment_visible(r.church_id, r.service_id, r.class_id, s.role, s.church_id, s.service_id, s.class_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if r.status <> 'pending' then raise exception 'not_pending' using errcode = 'P0001'; end if;

  -- the CONFIRMATION: the scanned card must be the child's own code
  select * into p from public.persons where id = r.person_id;
  if nullif(trim(coalesce(p_card_code, '')), '') is null
     or lower(trim(p_card_code)) <> lower(trim(p.national_id)) then
    raise exception 'card_mismatch' using errcode = 'P0001';
  end if;

  select jsonb_agg(jsonb_build_object('item_id', li.item_id, 'qty', li.qty))
    into lines from public.store_request_items li where li.request_id = r.id;
  if lines is null then raise exception 'empty_basket' using errcode = 'P0001'; end if;
  if exists (select 1 from public.store_request_items li where li.request_id = r.id and li.item_id is null) then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;

  -- the sale itself — same rules as the POS (stock · scope · balance)
  res := public.store_checkout_internal(r.enrollment_id, lines,
           coalesce(nullif(trim(coalesce(p_note, '')), ''), r.note), r.shop_id, r.id, 'request');

  update public.store_requests
     set status = 'approved', order_id = (res->>'order_id')::uuid,
         decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = r.id;

  return public.store_request_json(r.id) || res;
end $$;
grant execute on function public.store_request_approve(uuid, text, text) to authenticated;

create or replace function public.store_request_reject(p_request uuid, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s record; r public.store_requests;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if not public.module_visible('store') then raise exception 'module_not_visible' using errcode = 'P0001'; end if;
  select * into s from public.my_scope();
  if not found then raise exception 'forbidden' using errcode = 'P0001'; end if;
  select * into r from public.store_requests where id = p_request for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.enrollment_visible(r.church_id, r.service_id, r.class_id, s.role, s.church_id, s.service_id, s.class_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if r.status <> 'pending' then raise exception 'not_pending' using errcode = 'P0001'; end if;
  update public.store_requests
     set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = r.id;
  return public.store_request_json(r.id);
end $$;
grant execute on function public.store_request_reject(uuid, text) to authenticated;

-- one request with its lines for the servant UI (RLS-checked)
create or replace function public.store_request_detail(p_request uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.store_requests r where r.id = p_request
                             and public.module_visible('store')
                             and public.enrollment_visible(r.church_id, r.service_id, r.class_id,
                                   (select role from public.my_scope()), (select church_id from public.my_scope()),
                                   (select service_id from public.my_scope()), (select class_id from public.my_scope())))
         then public.store_request_json(p_request) else null end
$$;
grant execute on function public.store_request_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 9. REALTIME — shops / targets via postgres_changes (cold tables);
--    requests on the broadcast bus (hot, like store_orders)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'store_shops') then
    alter publication supabase_realtime add table public.store_shops;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'store_shop_targets') then
    alter publication supabase_realtime add table public.store_shop_targets;
  end if;
exception when undefined_object then null;
end $$;
alter table public.store_shops        replica identity full;
alter table public.store_shop_targets replica identity full;

do $$
begin
  if to_regprocedure('public.rt_trg_scoped()') is not null then
    execute 'drop trigger if exists zzz_rt_ins on public.store_requests';
    execute 'drop trigger if exists zzz_rt_upd on public.store_requests';
    execute 'drop trigger if exists zzz_rt_del on public.store_requests';
    execute 'create trigger zzz_rt_ins after insert on public.store_requests referencing new table as new_rows for each statement execute function public.rt_trg_scoped()';
    execute 'create trigger zzz_rt_upd after update on public.store_requests referencing old table as old_rows new table as new_rows for each statement execute function public.rt_trg_scoped()';
    execute 'create trigger zzz_rt_del after delete on public.store_requests referencing old table as old_rows for each statement execute function public.rt_trg_scoped()';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 10. ACTIVITY LOG — audit the new tables
-- ---------------------------------------------------------------------
do $$ begin
  if to_regprocedure('public.activity_audit_attach(text)') is not null then
    perform public.activity_audit_attach('store_shops');
    perform public.activity_audit_attach('store_shop_targets');
    perform public.activity_audit_attach('store_requests');
  end if;
end $$;

-- action keys: store_shop.add / .activate / .deactivate · store_shop_target.add
-- · store_request.add (by the child) / .approved / .rejected / .cancelled
do $$ begin
  if to_regprocedure('public.activity_action_key(text,text,jsonb,jsonb)') is not null then
    execute $fn$
create or replace function public.activity_action_key(p_table text, p_op text, p_old jsonb, p_new jsonb)
returns text language plpgsql immutable as $body$
declare base text; verb text;
begin
  verb := case p_op when 'INSERT' then 'add' when 'DELETE' then 'remove' else 'update' end;
  base := case p_table
    when 'attendance_log' then 'attendance'
    when 'points_log' then 'points'
    when 'contact_log' then case coalesce(p_new->>'kind', p_old->>'kind') when 'call' then 'call' else 'message' end
    when 'persons' then 'person'
    when 'enrollments' then case when coalesce(p_new->>'kind', p_old->>'kind') = 'servant' then 'servant_mirror' else 'enrollment' end
    when 'servant_enrollments' then 'servant'
    when 'servant_scopes' then 'servant_scope'
    when 'permissions' then 'permission'
    when 'permission_profiles' then 'permission_profile'
    when 'module_access' then 'module_access'
    when 'churches' then 'church'
    when 'services' then 'service'
    when 'classes' then 'class'
    when 'events' then 'event'
    when 'causes' then 'cause'
    when 'call_feedbacks' then 'feedback'
    when 'card_print_requests' then 'print_request'
    when 'card_templates' then 'card_template'
    when 'data_change_requests' then 'data_request'
    when 'child_join_requests' then 'join_request'
    when 'person_credentials' then 'password'
    when 'shepherd_groups' then 'shepherd'
    when 'store_items' then 'store_item'
    when 'store_orders' then 'store_order'
    when 'store_shops' then 'store_shop'
    when 'store_shop_targets' then 'store_shop_target'
    when 'store_requests' then 'store_request'
    when 'exams' then 'exam'
    when 'exam_questions' then 'exam_question'
    when 'exam_attempts' then 'exam_attempt'
    when 'birthday_greetings' then 'birthday'
    when 'birthday_settings' then 'birthday_setting'
    when 'birthday_card_templates' then 'birthday_card'
    when 'chat_messages' then 'chat'
    when 'online_classes' then 'online_class'
    when 'online_class_participants' then 'online_participant'
    when 'achievements' then 'achievement'
    when 'user_achievements' then 'achievement_award'
    when 'occasions' then 'occasion'
    when 'occasion_registrations' then 'occasion_registration'
    when 'occasion_checklist_items' then 'occasion_checklist'
    when 'occasion_checklist_marks' then 'occasion_mark'
    when 'notifications' then 'notification'
    when 'notification_automations' then 'notification_automation'
    when 'app_settings' then 'setting'
    when 'result_exams' then 'result_exam'
    when 'result_subjects' then 'result_subject'
    when 'exam_results' then 'result'
    when 'grading_systems' then 'grading'
    when 'grading_grades' then 'grading_grade'
    when 'library_subjects' then 'library_subject'
    when 'library_books' then 'library_book'
    when 'library_lectures' then 'library_lecture'
    when 'library_favorites' then 'library_favorite'
    when 'backup_runs' then 'backup'
    when 'backup_schedules' then 'backup_schedule'
    else p_table end;

  -- a few semantic refinements
  if p_table = 'servant_enrollments' and p_op = 'UPDATE' then
    if p_old->>'status' is distinct from p_new->>'status' then
      verb := case p_new->>'status' when 'approved' then 'approve' when 'rejected' then 'reject'
                   when 'suspended' then 'suspend' else 'status' end;
    elsif p_old->>'role' is distinct from p_new->>'role' then verb := 'role';
    end if;
  elsif p_table = 'enrollments' and p_op = 'UPDATE' then
    if p_old->>'status' is distinct from p_new->>'status' then verb := case p_new->>'status' when 'stopped' then 'stop' else 'resume' end;
    elsif p_old->>'class_id' is distinct from p_new->>'class_id' then verb := 'move';
    elsif (p_old - 'attendance_count' - 'points' - 'edited_at' - 'edited_by') = (p_new - 'attendance_count' - 'points' - 'edited_at' - 'edited_by') then
      verb := 'counters';
    end if;
  elsif p_table = 'points_log' and p_op = 'INSERT' then
    verb := case when coalesce((p_new->>'delta')::int, 0) < 0 then 'deduct' else 'add' end;
  elsif p_table = 'store_shops' and p_op = 'UPDATE' and p_old->>'is_active' is distinct from p_new->>'is_active' then
    verb := case when (p_new->>'is_active')::boolean then 'activate' else 'deactivate' end;
  elsif p_table in ('store_orders', 'store_requests', 'exam_attempts', 'occasion_registrations') and p_op = 'UPDATE'
        and p_old->>'status' is distinct from p_new->>'status' then
    verb := coalesce(p_new->>'status', 'status');
  elsif p_table in ('data_change_requests', 'child_join_requests') and p_op = 'UPDATE'
        and p_old->>'status' is distinct from p_new->>'status' then
    verb := coalesce(p_new->>'status', 'status');
  elsif p_table = 'result_exams' and p_op = 'UPDATE' and p_old->>'locked' is distinct from p_new->>'locked' then
    verb := case when (p_new->>'locked')::boolean then 'lock' else 'unlock' end;
  elsif p_table = 'online_classes' and p_op = 'UPDATE' and p_old->>'status' is distinct from p_new->>'status' then
    verb := coalesce(p_new->>'status', 'status');
  elsif p_table = 'exams' and p_op = 'UPDATE' and p_old->>'status' is distinct from p_new->>'status' then
    verb := coalesce(p_new->>'status', 'status');
  end if;
  return base || '.' || verb;
end $body$;
    $fn$;
  end if;
end $$;

do $$ begin
  if to_regprocedure('public.activity_audited_tables()') is not null then
    create or replace function public.activity_audited_tables()
    returns text[] language sql immutable as $f$
      select array[
        'persons', 'enrollments', 'servant_enrollments', 'servant_scopes', 'permissions', 'permission_profiles',
        'module_access', 'churches', 'services', 'classes', 'events', 'causes', 'call_feedbacks',
        'attendance_log', 'points_log', 'contact_log', 'card_print_requests', 'card_templates', 'card_print_profiles',
        'data_change_requests', 'child_join_requests', 'person_credentials', 'shepherd_groups',
        'store_items', 'store_orders', 'store_shops', 'store_shop_targets', 'store_requests',
        'exams', 'exam_questions', 'exam_attempts',
        'birthday_greetings', 'birthday_settings', 'birthday_card_templates', 'chat_messages',
        'online_classes', 'online_class_participants', 'online_class_checks', 'online_class_questions', 'online_class_answers',
        'achievements', 'user_achievements', 'occasions', 'occasion_registrations',
        'occasion_checklist_items', 'occasion_checklist_marks', 'occasion_notifications',
        'notifications', 'notification_automations', 'app_settings',
        'result_exams', 'result_subjects', 'exam_results', 'grading_systems', 'grading_grades',
        'library_subjects', 'library_books', 'library_lectures', 'library_favorites',
        'backup_runs', 'backup_schedules', 'report_templates', 'families', 'family_members',
        'access_events', 'access_rule_groups', 'access_rules', 'access_allowed', 'access_log',
        'priests', 'priest_requests', 'priest_confessors', 'confessions', 'confession_appointments', 'priest_contacts',
        'areas', 'area_priests', 'streets', 'buildings', 'family_visits',
        'finance_causes', 'finance_entries', 'finance_budgets', 'finance_budget_members'
      ]
    $f$;
  end if;
end $$;

analyze public.store_shops;
analyze public.store_shop_targets;
analyze public.store_requests;
analyze public.store_request_items;

commit;
