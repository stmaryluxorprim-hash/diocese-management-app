-- =====================================================================
-- Functional test for migration 0026 (إستبدال النقاط). Run on the local
-- shim DB after run_migrations.sh:  psql -d app -f supabase/tests/store_module_test.sql
-- Every "assert" raises on failure; a clean run ends with «STORE TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

-- ---------- seed ----------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000002'),  -- class servant (class A)
  ('00000000-0000-0000-0000-000000000003');  -- class servant (class B, other class)
insert into public.churches (id, name) values ('10000000-0000-0000-0000-000000000001', 'كنيسة');
insert into public.services (id, church_id, name) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل ب');
insert into public.profiles (id, full_name, user_id, phone, role, status, church_id, service_id, class_id) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null),
  ('00000000-0000-0000-0000-000000000002', 'خادم أ', 'servant_a', '0101', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000003', 'خادم ب', 'servant_b', '0102', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
insert into public.persons (id, national_id, name) values ('40000000-0000-0000-0000-000000000001', '29901010000001', 'مينا');
-- 0042: the portal now needs a session token; for the legacy tests the raw code doubles as the token
insert into public.child_sessions (person_id, token_hash, expires_at)
select id, encode(digest(national_id, 'sha256'), 'hex'), now() + interval '1 day' from public.persons;

insert into public.enrollments (id, person_id, church_id, service_id, class_id, points) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 50);

-- helper: act as a user
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ---------- 1. module NOT granted → servant sees nothing / can't sell ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  if (select count(*) from public.store_items) <> 0 then raise exception 'items visible without grant'; end if;
  begin
    perform public.store_checkout('50000000-0000-0000-0000-000000000001', '[{"item_id":"00000000-0000-0000-0000-000000000000","qty":1}]'::jsonb);
    raise exception 'checkout allowed without module grant';
  exception when others then
    if sqlerrm not like '%module_not_visible%' then raise; end if;
  end;
end $$;
reset role;

-- ---------- 2. owner grants the module + adds items ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.module_access (module_key, church_id) values ('store', null);
-- 20261002120000: items live inside a shop — a church-wide shop + a class-B shop
insert into public.store_shops (id, church_id, name, is_active) values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'متجر الكنيسة', true),
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'متجر فصل ب', true);
insert into public.store_shop_targets (shop_id, church_id, service_id, class_id) values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', null, null),
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
insert into public.store_items (id, church_id, shop_id, code, name, price, stock) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'ST-PEN', 'قلم', 10, 3),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'ST-BOOK', 'كتاب', 30, 1);
-- item of the class-B shop
insert into public.store_items (id, church_id, shop_id, code, name, price, stock) values
  ('60000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 'ST-B', 'صنف فصل ب', 5, 10);
-- duplicate code in the same shop → rejected
do $$ begin
  begin
    insert into public.store_items (church_id, shop_id, code, name, price, stock) values ('10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', ' st-pen ', 'x', 1, 1);
    raise exception 'duplicate code accepted';
  exception when unique_violation then null; end;
end $$;
reset role;

-- ---------- 3. servant A: RLS + lookup ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  -- sees church-wide items (2) but NOT the class-B item
  if (select count(*) from public.store_items) <> 2 then raise exception 'servant A should see 2 items, sees %', (select count(*) from public.store_items); end if;
  if (select count(*) from public.store_lookup_item('st-pen')) <> 1 then raise exception 'lookup by code failed'; end if;
  -- can't write into a shop he cannot see (the class-B shop)
  begin
    insert into public.store_items (church_id, shop_id, code, name, price, stock) values ('10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 'ST-X', 'x', 1, 1);
    raise exception 'class servant inserted into a foreign shop';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------- 4. checkout rules ----------
do $$
declare r jsonb;
begin
  -- empty basket
  begin perform public.store_checkout('50000000-0000-0000-0000-000000000001', '[]'::jsonb); raise exception 'empty basket accepted';
  exception when others then if sqlerrm not like '%empty_basket%' then raise; end if; end;
  -- over balance (50): book 30 + 3 pens 30 = 60
  begin perform public.store_checkout('50000000-0000-0000-0000-000000000001',
        '[{"item_id":"60000000-0000-0000-0000-000000000002","qty":1},{"item_id":"60000000-0000-0000-0000-000000000001","qty":3}]'::jsonb);
        raise exception 'over-balance accepted';
  exception when others then if sqlerrm not like '%insufficient_points%' then raise; end if; end;
  -- over stock (book stock 1)
  begin perform public.store_checkout('50000000-0000-0000-0000-000000000001', '[{"item_id":"60000000-0000-0000-0000-000000000002","qty":2}]'::jsonb);
        raise exception 'over-stock accepted';
  exception when others then if sqlerrm not like '%insufficient_stock:كتاب%' then raise; end if; end;
  -- out of scope item (class B item for class A child)
  begin perform public.store_checkout('50000000-0000-0000-0000-000000000001', '[{"item_id":"60000000-0000-0000-0000-000000000003","qty":1}]'::jsonb);
        raise exception 'out-of-scope item accepted';
  exception when others then if sqlerrm not like '%item_out_of_scope%' and sqlerrm not like '%shop_not_found%' then raise; end if; end;
  -- nothing was written by the failed attempts
  if (select count(*) from public.store_orders) <> 0 then raise exception 'failed checkout left an order'; end if;
  if (select stock from public.store_items where id = '60000000-0000-0000-0000-000000000002') <> 1 then raise exception 'failed checkout changed stock'; end if;
  if (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000001') <> 50 then raise exception 'failed checkout changed balance'; end if;

  -- VALID: book 30 + pen ×2 (20) = 50 = whole balance; duplicate lines merged
  r := public.store_checkout('50000000-0000-0000-0000-000000000001',
        '[{"item_id":"60000000-0000-0000-0000-000000000002","qty":1},{"item_id":"60000000-0000-0000-0000-000000000001","qty":1},{"item_id":"60000000-0000-0000-0000-000000000001","qty":1}]'::jsonb,
        'اختبار');
  if (r->>'total_points')::int <> 50 then raise exception 'total wrong: %', r; end if;
  if (r->>'items_count')::int <> 3 then raise exception 'count wrong: %', r; end if;
  if (r->>'balance_before')::int <> 50 or (r->>'balance_after')::int <> 0 then raise exception 'balances wrong: %', r; end if;
  if (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000001') <> 0 then raise exception 'balance not deducted'; end if;
  if (select stock from public.store_items where id = '60000000-0000-0000-0000-000000000001') <> 1 then raise exception 'pen stock wrong'; end if;
  if (select stock from public.store_items where id = '60000000-0000-0000-0000-000000000002') <> 0 then raise exception 'book stock wrong'; end if;
  if (select count(*) from public.store_order_items where order_id = (r->>'order_id')::uuid) <> 2 then raise exception 'lines not merged'; end if;
  if (select delta from public.points_log where id = (select points_log_id from public.store_orders where id = (r->>'order_id')::uuid)) <> -50 then raise exception 'points_log row wrong'; end if;
  -- servant sees his bill in the archive
  if (select count(*) from public.store_orders) <> 1 then raise exception 'archive not visible'; end if;
  -- servant can't cancel (managers only)
  begin perform public.store_cancel_order((r->>'order_id')::uuid); raise exception 'servant cancelled a bill';
  exception when others then if sqlerrm not like '%forbidden%' then raise; end if; end;
  -- archive is read-only through the API
  begin delete from public.store_orders; if found then raise exception 'deleted archive'; end if; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---------- 5. other-class servant sees nothing of it ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
do $$ begin
  if (select count(*) from public.store_orders) <> 0 then raise exception 'cross-class archive leak'; end if;
  if (select count(*) from public.store_order_items) <> 0 then raise exception 'cross-class lines leak'; end if;
end $$;
reset role;

-- ---------- 6. child portal sees the redemption (anon) ----------
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', 'anon', true), set_config('role', 'anon', true);
do $$
declare n int; o jsonb;
begin
  select count(*) into n from public.child_portal_points('29901010000001') where source = 'store' and delta = -50 and order_id is not null;
  if n <> 1 then raise exception 'portal points missing store row (n=%)', n; end if;
  o := public.child_portal_store_orders('29901010000001');
  if jsonb_array_length(o) <> 1 or jsonb_array_length(o->0->'items') <> 2 then raise exception 'portal orders wrong: %', o; end if;
end $$;
reset role;

-- ---------- 7. owner cancels → refund + restock ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
do $$
declare oid uuid; r jsonb;
begin
  select id into oid from public.store_orders limit 1;
  r := public.store_cancel_order(oid, 'خطأ');
  if (r->>'refunded')::int <> 50 or (r->>'balance_after')::int <> 50 then raise exception 'refund wrong: %', r; end if;
  if (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000001') <> 50 then raise exception 'balance not refunded'; end if;
  if (select stock from public.store_items where id = '60000000-0000-0000-0000-000000000001') <> 3 then raise exception 'pen not restocked'; end if;
  if (select stock from public.store_items where id = '60000000-0000-0000-0000-000000000002') <> 1 then raise exception 'book not restocked'; end if;
  if (select status from public.store_orders where id = oid) <> 'cancelled' then raise exception 'status not cancelled'; end if;
  -- twice → not_completed
  begin perform public.store_cancel_order(oid); raise exception 'double cancel accepted';
  exception when others then if sqlerrm not like '%not_completed%' then raise; end if; end;
end $$;
reset role;

-- portal shows both rows now
select set_config('request.jwt.claim.role', 'anon', true), set_config('role', 'anon', true);
do $$ declare n int; begin
  select count(*) into n from public.child_portal_points('29901010000001') where source = 'store';
  if n <> 2 then raise exception 'portal should show sale + refund (n=%)', n; end if;
end $$;
reset role;

-- realtime publication
do $$ begin
  -- 0046: store_orders moved to broadcast (zzz_rt_* triggers)
  -- 20261016: broadcast bus trigger instead of the publication
  if not exists (select 1 from pg_trigger where tgname = 'zzz_rt_ins' and tgrelid = 'public.store_items'::regclass) then
    raise exception 'store_items broadcast trigger missing'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'zzz_rt_ins' and tgrelid = 'public.store_orders'::regclass) then
    raise exception 'store_orders broadcast trigger missing'; end if;
end $$;

select 'STORE TESTS PASSED' as result;
rollback;
