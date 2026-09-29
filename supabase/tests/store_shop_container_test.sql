-- =====================================================================
-- Functional test for 20261002120000 (المتجر هو الوعاء).
--   psql -d app -f supabase/tests/store_shop_container_test.sql
-- Asserts: `insert … returning` on store_shops works for every role that
-- may create a shop (the live «ليس لديك صلاحية» bug), a class servant can't
-- create a shop for another church, new items need a shop and inherit its
-- church, item rights follow the shop, code unique per shop, stats RPC,
-- 4-arg store_checkout refuses a foreign line.
-- Ends with «STORE SHOP CONTAINER TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000002'),  -- church manager (church 1)
  ('00000000-0000-0000-0000-000000000003'),  -- class servant (class A, church 1)
  ('00000000-0000-0000-0000-000000000004');  -- class servant (class C, church 2)
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة ١'),
  ('10000000-0000-0000-0000-000000000002', 'كنيسة ٢');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'مدارس الأحد ٢');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'فصل ج');
insert into public.profiles (id, full_name, user_id, phone, role, status, church_id, service_id, class_id) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null),
  ('00000000-0000-0000-0000-000000000002', 'مدير', 'manager', '0101', 'church_manager', 'approved', '10000000-0000-0000-0000-000000000001', null, null),
  ('00000000-0000-0000-0000-000000000003', 'خادم أ', 'servant_a', '0102', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000004', 'خادم ج', 'servant_c', '0103', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003');
insert into public.persons (id, national_id, name) values ('40000000-0000-0000-0000-000000000001', '29901010000001', 'مينا');
insert into public.enrollments (id, person_id, church_id, service_id, class_id, points) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 100);

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);
end $$;

-- module granted everywhere
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.module_access (module_key, church_id) values ('store', null);
reset role;

-- ---------- 1. insert … returning works for owner / manager / class servant ----------
do $$
declare v_id uuid; v_name text;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000001');
  insert into public.store_shops (church_id, name) values ('10000000-0000-0000-0000-000000000001', 'متجر المالك')
    returning id, name into v_id, v_name;
  if v_id is null or v_name <> 'متجر المالك' then raise exception 'owner returning failed'; end if;
  update public.store_shops set is_active = true where id = v_id;
  if not (select is_active from public.store_shops where id = v_id) then raise exception 'owner update failed'; end if;
  delete from public.store_shops where id = v_id;

  perform pg_temp.as_user('00000000-0000-0000-0000-000000000002');
  insert into public.store_shops (id, church_id, name) values ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'متجر المدير')
    returning id into v_id;
  if v_id is null then raise exception 'manager returning failed'; end if;

  perform pg_temp.as_user('00000000-0000-0000-0000-000000000003');
  insert into public.store_shops (id, church_id, name) values ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'كانتين فصل أ')
    returning id into v_id;
  if v_id is null then raise exception 'class servant returning failed'; end if;
  -- he connects his own class
  insert into public.store_shop_targets (shop_id, church_id, service_id, class_id) values
    (v_id, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');

  -- another church → refused
  begin
    insert into public.store_shops (church_id, name) values ('10000000-0000-0000-0000-000000000002', 'متجر غريب') returning id into v_id;
    raise exception 'foreign church shop accepted';
  exception when others then if sqlerrm not like '%row-level security%' then raise; end if; end;
  reset role;
end $$;

-- the class servant of church 2 sees neither shop; the manager sees both
do $$
declare n int;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000004');
  select count(*) into n from public.store_shops;
  if n <> 0 then raise exception 'servant C sees % shops of church 1', n; end if;
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000002');
  select count(*) into n from public.store_shops;
  if n <> 2 then raise exception 'manager sees % shops (expected 2)', n; end if;
  reset role;
end $$;

-- ---------- 2. items live inside a shop ----------
do $$
declare v_church uuid; v_id uuid;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000003');
  -- no shop → shop_required
  begin
    insert into public.store_items (church_id, code, name, price, stock) values ('10000000-0000-0000-0000-000000000001', 'X1', 'بدون متجر', 1, 1);
    raise exception 'item without shop accepted';
  exception when others then if sqlerrm not like '%shop_required%' then raise; end if; end;
  -- with a shop: church copied from the shop even if a wrong one is sent
  insert into public.store_items (id, church_id, shop_id, code, name, price, stock) values
    ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 'PEN', 'قلم', 10, 5)
    returning church_id into v_church;
  if v_church <> '10000000-0000-0000-0000-000000000001' then raise exception 'church not copied from shop'; end if;
  -- class servant A can't put an item into the manager's shop (not connected to his class)
  begin
    insert into public.store_items (church_id, shop_id, code, name, price, stock) values
      ('10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'X2', 'غريب', 1, 1);
    raise exception 'servant A wrote into a foreign shop';
  exception when insufficient_privilege then null; end;
  -- same code in ANOTHER shop of the same church is fine (manager's shop, by the manager)
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000002');
  insert into public.store_items (id, church_id, shop_id, code, name, price, stock) values
    ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'PEN', 'قلم المدير', 12, 5);
  -- same code in the SAME shop → duplicate
  begin
    insert into public.store_items (church_id, shop_id, code, name, price, stock) values
      ('10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 'pen', 'مكرر', 1, 1);
    raise exception 'duplicate code in shop accepted';
  exception when unique_violation then null; end;
  reset role;

  -- servant C (church 2) sees no item; manager (church 1) edits the canteen item
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000004');
  if (select count(*) from public.store_items) <> 0 then raise exception 'servant C sees items'; end if;
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000002');
  update public.store_items set stock = 7 where id = '60000000-0000-0000-0000-000000000001' returning id into v_id;
  if v_id is null then raise exception 'manager cannot edit shop item'; end if;
  reset role;
end $$;

-- ---------- 3. stats + 4-arg checkout ----------
do $$
declare st jsonb; res jsonb;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000003');
  st := public.store_shop_stats('70000000-0000-0000-0000-000000000002');
  if (st->>'items')::int <> 1 or (st->>'stock')::int <> 7 or (st->>'pending')::int <> 0 then
    raise exception 'stats wrong: %', st;
  end if;
  -- a line of another shop → refused
  begin
    perform public.store_checkout('50000000-0000-0000-0000-000000000001',
      '[{"item_id":"60000000-0000-0000-0000-000000000002","qty":1}]'::jsonb, null, '70000000-0000-0000-0000-000000000002');
    raise exception 'foreign line accepted';
  exception when others then if sqlerrm not like 'item_out_of_scope%' then raise; end if; end;
  -- own line → sale stamped with the shop
  res := public.store_checkout('50000000-0000-0000-0000-000000000001',
      '[{"item_id":"60000000-0000-0000-0000-000000000001","qty":2}]'::jsonb, 'من الكاشير', '70000000-0000-0000-0000-000000000002');
  if (res->>'total_points')::int <> 20 then raise exception 'checkout total %', res; end if;
  if (select shop_id from public.store_orders where id = (res->>'order_id')::uuid) <> '70000000-0000-0000-0000-000000000002' then
    raise exception 'order not stamped with shop';
  end if;
  st := public.store_shop_stats('70000000-0000-0000-0000-000000000002');
  if (st->>'orders')::int <> 1 or (st->>'points')::int <> 20 or (st->>'stock')::int <> 5 then
    raise exception 'stats after sale wrong: %', st;
  end if;
  -- 3-arg call (legacy client) still works: shop inferred from the first line
  res := public.store_checkout('50000000-0000-0000-0000-000000000001',
      '[{"item_id":"60000000-0000-0000-0000-000000000001","qty":1}]'::jsonb, null);
  if (select shop_id from public.store_orders where id = (res->>'order_id')::uuid) is null then
    raise exception '3-arg checkout lost the shop';
  end if;
  reset role;
end $$;

select 'STORE SHOP CONTAINER TESTS PASSED';
rollback;
