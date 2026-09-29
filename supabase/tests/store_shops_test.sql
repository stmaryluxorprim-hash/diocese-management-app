-- =====================================================================
-- Functional test for 20261001120000 (المتاجر + طلبات الشراء من بوابة
-- المخدوم). Run on the local shim DB after run_migrations.sh:
--   psql -d app -f supabase/tests/store_shops_test.sql
-- Every assert raises on failure; a clean run ends with «STORE SHOPS TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

-- ---------- seed ----------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000002'),  -- class servant (class A)
  ('00000000-0000-0000-0000-000000000003');  -- class servant (class B)
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة ١'),
  ('10000000-0000-0000-0000-000000000002', 'كنيسة ٢');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'مدارس الأحد ٢');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل ب'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'فصل ج');
insert into public.profiles (id, full_name, user_id, phone, role, status, church_id, service_id, class_id) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null),
  ('00000000-0000-0000-0000-000000000002', 'خادم أ', 'servant_a', '0101', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000003', 'خادم ب', 'servant_b', '0102', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
insert into public.persons (id, national_id, name) values
  ('40000000-0000-0000-0000-000000000001', '29901010000001', 'مينا'),    -- class A, 50 points
  ('40000000-0000-0000-0000-000000000002', '29901010000002', 'مريم');    -- class C (other church)
insert into public.child_sessions (person_id, token_hash, expires_at)
select id, encode(digest(national_id, 'sha256'), 'hex'), now() + interval '1 day' from public.persons;
insert into public.enrollments (id, person_id, church_id, service_id, class_id, points) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 50),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', 500);

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('role', 'anon', true);
end $$;

-- ---------- 1. owner: module grant, a shop connected to class A only ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.module_access (module_key, church_id) values ('store', null);
insert into public.store_shops (id, church_id, name, is_active) values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'كانتين فصل أ', false);
insert into public.store_shop_targets (shop_id, church_id, service_id, class_id) values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
-- a second shop connected to «الكل»
insert into public.store_shops (id, church_id, name, is_active) values
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'متجر الإيبارشية', true);
insert into public.store_shop_targets (shop_id, church_id) values ('70000000-0000-0000-0000-000000000002', null);
-- items of shop 1 (church-level columns; scope is the shop's)
insert into public.store_items (id, church_id, shop_id, code, name, price, stock) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'SH-PEN', 'قلم', 10, 3),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'SH-BOOK', 'كتاب', 30, 1);
insert into public.store_items (id, church_id, shop_id, code, name, price, stock) values
  ('60000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 'ALL-CUP', 'كوب', 20, 5);
-- bad target chain rejected
do $$ begin
  begin
    insert into public.store_shop_targets (shop_id, church_id, service_id) values
      ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002');
    raise exception 'foreign service accepted';
  exception when others then if sqlerrm not like '%does not belong%' then raise; end if; end;
end $$;
reset role;

-- ---------- 2. RLS: servant B (class B) does not see the class-A shop; A does ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
do $$ begin
  if exists (select 1 from public.store_shops where id = '70000000-0000-0000-0000-000000000001') then raise exception 'servant B sees class-A shop'; end if;
  if not exists (select 1 from public.store_shops where id = '70000000-0000-0000-0000-000000000002') then raise exception 'servant B misses the ALL shop'; end if;
  -- class servant can't connect «الكل»
  begin
    insert into public.store_shop_targets (shop_id, church_id) values ('70000000-0000-0000-0000-000000000002', null);
    raise exception 'class servant added an ALL target';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  if (select count(*) from public.store_shops) <> 2 then raise exception 'servant A should see 2 shops'; end if;
  -- a class servant may connect his own class
  insert into public.store_shop_targets (shop_id, church_id, service_id, class_id) values
    ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
end $$;
reset role;

-- ---------- 3. child portal: inactive shop hidden, active «الكل» shop visible ----------
select pg_temp.as_anon();
do $$ declare j jsonb; begin
  j := public.child_portal_shops('29901010000001');
  if jsonb_array_length(j) <> 1 then raise exception 'child should see 1 active shop, sees %', j; end if;
  if j->0->>'id' <> '70000000-0000-0000-0000-000000000002' then raise exception 'wrong shop visible'; end if;
  -- items of an INACTIVE shop are refused
  begin perform public.child_portal_shop_items('29901010000001', '70000000-0000-0000-0000-000000000001'); raise exception 'inactive shop items served';
  exception when others then if sqlerrm not like '%shop_not_found%' then raise; end if; end;
  -- the other-church child sees the ALL shop too
  j := public.child_portal_shops('29901010000002');
  if jsonb_array_length(j) <> 1 then raise exception 'child 2 should see the ALL shop'; end if;
end $$;
reset role;

-- ---------- 4. owner activates shop 1 → child sees it + its items ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
update public.store_shops set is_active = true where id = '70000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.as_anon();
do $$ declare j jsonb; begin
  j := public.child_portal_shops('29901010000001');
  if jsonb_array_length(j) <> 2 then raise exception 'child should see 2 shops now, sees %', j; end if;
  j := public.child_portal_shops('29901010000002');
  if jsonb_array_length(j) <> 1 then raise exception 'class-A shop leaked to another church child'; end if;
  j := public.child_portal_shop_items('29901010000001', '70000000-0000-0000-0000-000000000001');
  if jsonb_array_length(j) <> 2 then raise exception 'shop 1 should list 2 items'; end if;
end $$;

-- ---------- 5. child sends a request: rules ----------
do $$ declare j jsonb; begin
  -- empty cart
  begin perform public.child_portal_store_request('29901010000001', '70000000-0000-0000-0000-000000000001', '[]'::jsonb); raise exception 'empty cart accepted';
  exception when others then if sqlerrm not like '%empty_basket%' then raise; end if; end;
  -- over balance (50): book 30 + 3 pens = 60
  begin perform public.child_portal_store_request('29901010000001', '70000000-0000-0000-0000-000000000001',
    '[{"item_id":"60000000-0000-0000-0000-000000000002","qty":1},{"item_id":"60000000-0000-0000-0000-000000000001","qty":3}]'::jsonb);
    raise exception 'over-balance request accepted';
  exception when others then if sqlerrm not like '%insufficient_points%' then raise; end if; end;
  -- item of another shop in this cart
  begin perform public.child_portal_store_request('29901010000001', '70000000-0000-0000-0000-000000000001',
    '[{"item_id":"60000000-0000-0000-0000-000000000003","qty":1}]'::jsonb);
    raise exception 'foreign-shop item accepted';
  exception when others then if sqlerrm not like '%item_not_found%' then raise; end if; end;
  -- other-church child can't reach shop 1
  begin perform public.child_portal_store_request('29901010000002', '70000000-0000-0000-0000-000000000001',
    '[{"item_id":"60000000-0000-0000-0000-000000000001","qty":1}]'::jsonb);
    raise exception 'other-church child ordered from class-A shop';
  exception when others then if sqlerrm not like '%shop_not_found%' then raise; end if; end;
  if (select count(*) from public.store_requests) <> 0 then raise exception 'failed request left rows'; end if;

  -- VALID: book 30 + pen 10 = 40 (duplicate pen lines merged → qty 1)
  j := public.child_portal_store_request('29901010000001', '70000000-0000-0000-0000-000000000001',
    '[{"item_id":"60000000-0000-0000-0000-000000000002","qty":1},{"item_id":"60000000-0000-0000-0000-000000000001","qty":1}]'::jsonb, null, 'من فضلك');
  if j->>'status' <> 'pending' then raise exception 'request not pending: %', j; end if;
  if (j->>'total_points')::int <> 40 or (j->>'items_count')::int <> 2 then raise exception 'request totals wrong: %', j; end if;
  if jsonb_array_length(j->'items') <> 2 then raise exception 'request lines wrong'; end if;
  -- nothing deducted yet, stock untouched
  if (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000001') <> 50 then raise exception 'request deducted points'; end if;
  if (select stock from public.store_items where id = '60000000-0000-0000-0000-000000000002') <> 1 then raise exception 'request changed stock'; end if;
  -- one pending request per shop
  begin perform public.child_portal_store_request('29901010000001', '70000000-0000-0000-0000-000000000001',
    '[{"item_id":"60000000-0000-0000-0000-000000000001","qty":1}]'::jsonb);
    raise exception 'second pending request accepted';
  exception when others then if sqlerrm not like '%request_pending%' then raise; end if; end;
  -- my requests list
  j := public.child_portal_store_requests('29901010000001');
  if jsonb_array_length(j) <> 1 then raise exception 'my requests wrong'; end if;
  if (public.child_portal_shops('29901010000001')->1->>'pending_requests')::int + (public.child_portal_shops('29901010000001')->0->>'pending_requests')::int <> 1 then
    raise exception 'pending badge wrong';
  end if;
end $$;
reset role;

-- ---------- 6. servant side: visibility + approve needs the child's card ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');   -- class B servant
do $$ begin
  if (select count(*) from public.store_requests) <> 0 then raise exception 'class B servant sees class A request'; end if;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');   -- class A servant
do $$ declare rid uuid; j jsonb; begin
  select id into rid from public.store_requests;
  if rid is null then raise exception 'class A servant does not see the request'; end if;
  if (select count(*) from public.store_request_items where request_id = rid) <> 2 then raise exception 'request lines hidden'; end if;
  if public.store_request_detail(rid) is null then raise exception 'detail rpc empty'; end if;
  -- wrong card → refused, nothing changes
  begin perform public.store_request_approve(rid, '29901010000002'); raise exception 'approved with another child card';
  exception when others then if sqlerrm not like '%card_mismatch%' then raise; end if; end;
  begin perform public.store_request_approve(rid, ''); raise exception 'approved with empty card';
  exception when others then if sqlerrm not like '%card_mismatch%' then raise; end if; end;
  if (select status from public.store_requests where id = rid) <> 'pending' then raise exception 'status changed by refused approve'; end if;
  if (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000001') <> 50 then raise exception 'refused approve deducted'; end if;

  -- right card → order created through checkout, points & stock move, request approved
  j := public.store_request_approve(rid, ' 29901010000001 ');
  if j->>'status' <> 'approved' then raise exception 'not approved: %', j; end if;
  if (j->>'total_points')::int <> 40 or (j->>'balance_after')::int <> 10 then raise exception 'approve totals wrong: %', j; end if;
  if (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000001') <> 10 then raise exception 'balance not deducted'; end if;
  if (select stock from public.store_items where id = '60000000-0000-0000-0000-000000000002') <> 0 then raise exception 'book stock not decremented'; end if;
  if (select stock from public.store_items where id = '60000000-0000-0000-0000-000000000001') <> 2 then raise exception 'pen stock not decremented'; end if;
  if (select count(*) from public.store_orders where request_id = rid and source = 'request' and shop_id = '70000000-0000-0000-0000-000000000001' and status = 'completed') <> 1 then
    raise exception 'order not linked to the request / shop';
  end if;
  if (select order_id from public.store_requests where id = rid) is null then raise exception 'request.order_id empty'; end if;
  -- double approve
  begin perform public.store_request_approve(rid, '29901010000001'); raise exception 'double approve accepted';
  exception when others then if sqlerrm not like '%not_pending%' then raise; end if; end;
end $$;
reset role;

-- ---------- 7. child sees the receipt with the shop; cancel / reject flows ----------
select pg_temp.as_anon();
do $$ declare j jsonb; r jsonb; begin
  j := public.child_portal_store_orders('29901010000001');
  if jsonb_array_length(j) <> 1 then raise exception 'child receipts wrong'; end if;
  if j->0->>'shop_name' <> 'كانتين فصل أ' or j->0->>'source' <> 'request' then raise exception 'receipt lacks shop / source: %', j->0; end if;
  if jsonb_array_length(j->0->'items') <> 2 then raise exception 'receipt lines wrong'; end if;
  -- points row shows the store source
  if not exists (select 1 from public.child_portal_points('29901010000001') where source = 'store' and delta = -40) then raise exception 'points row missing'; end if;

  -- new request (pen 10 = whole remaining balance) then the child cancels it
  r := public.child_portal_store_request('29901010000001', '70000000-0000-0000-0000-000000000001', '[{"item_id":"60000000-0000-0000-0000-000000000001","qty":1}]'::jsonb);
  r := public.child_portal_store_request_cancel('29901010000001', (r->>'id')::uuid);
  if r->>'status' <> 'cancelled' then raise exception 'cancel failed'; end if;
  begin perform public.child_portal_store_request_cancel('29901010000001', (r->>'id')::uuid); raise exception 'double cancel accepted';
  exception when others then if sqlerrm not like '%not_pending%' then raise; end if; end;
  -- another child can't cancel mine
  r := public.child_portal_store_request('29901010000001', '70000000-0000-0000-0000-000000000001', '[{"item_id":"60000000-0000-0000-0000-000000000001","qty":1}]'::jsonb);
  begin perform public.child_portal_store_request_cancel('29901010000002', (r->>'id')::uuid); raise exception 'foreign cancel accepted';
  exception when others then if sqlerrm not like '%not_found%' then raise; end if; end;
end $$;
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ declare rid uuid; j jsonb; begin
  select id into rid from public.store_requests where status = 'pending';
  j := public.store_request_reject(rid, 'الكمية محجوزة');
  if j->>'status' <> 'rejected' or j->>'decision_note' <> 'الكمية محجوزة' then raise exception 'reject failed: %', j; end if;
  if (select points from public.enrollments where id = '50000000-0000-0000-0000-000000000001') <> 10 then raise exception 'reject touched balance'; end if;
  begin perform public.store_request_approve(rid, '29901010000001'); raise exception 'approved a rejected request';
  exception when others then if sqlerrm not like '%not_pending%' then raise; end if; end;
  -- direct writes to requests are refused (no policies)
  begin
    update public.store_requests set status = 'approved' where id = rid;
    if (select status from public.store_requests where id = rid) = 'approved' then raise exception 'direct update succeeded'; end if;
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---------- 8. POS checkout of a shop item stamps shop_id / source pos; legacy (shop-less) items still work ----------
-- 20261002120000 refuses NEW shop-less items; emulate a pre-existing legacy row (as superuser)
reset role;
alter table public.store_items disable trigger trg_store_items_fill_from_shop;
insert into public.store_items (id, church_id, code, name, price, stock) values
  ('60000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'LEGACY', 'قديم', 5, 5);
alter table public.store_items enable trigger trg_store_items_fill_from_shop;
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
do $$ declare j jsonb; begin
  j := public.store_checkout('50000000-0000-0000-0000-000000000001', '[{"item_id":"60000000-0000-0000-0000-000000000009","qty":1}]'::jsonb);
  if (select source from public.store_orders where id = (j->>'order_id')::uuid) <> 'pos' then raise exception 'pos source wrong'; end if;
  if (select shop_id from public.store_orders where id = (j->>'order_id')::uuid) is not null then raise exception 'legacy item got a shop'; end if;
  j := public.store_checkout('50000000-0000-0000-0000-000000000001', '[{"item_id":"60000000-0000-0000-0000-000000000001","qty":0}]'::jsonb);
  raise exception 'qty 0 accepted';
exception when others then if sqlerrm not like '%invalid_line%' then raise; end if;
end $$;
do $$ declare j jsonb; begin
  -- child 2 (other church, 500 pts) buys from the ALL shop at the POS → shop stamped
  j := public.store_checkout('50000000-0000-0000-0000-000000000002', '[{"item_id":"60000000-0000-0000-0000-000000000003","qty":2}]'::jsonb);
  if (select shop_id from public.store_orders where id = (j->>'order_id')::uuid) <> '70000000-0000-0000-0000-000000000002' then raise exception 'shop not stamped'; end if;
  -- a shop item outside the shop's coverage is refused: shop 1 is class A only → child 2
  begin perform public.store_checkout('50000000-0000-0000-0000-000000000002', '[{"item_id":"60000000-0000-0000-0000-000000000001","qty":1}]'::jsonb);
    raise exception 'shop item sold outside coverage';
  exception when others then if sqlerrm not like '%item_out_of_scope%' then raise; end if; end;
end $$;
-- activity log got the request rows (0047)
do $$ begin
  if to_regclass('public.activity_log') is not null then
    if (select count(*) from public.activity_log where table_name = 'store_requests' and actor_kind = 'child') = 0 then
      raise exception 'child request not audited';
    end if;
    if (select count(*) from public.activity_log where table_name = 'store_requests' and action = 'store_request.approved') = 0 then
      raise exception 'approve not audited';
    end if;
  end if;
end $$;
reset role;

select 'STORE SHOPS TESTS PASSED' as result;
rollback;
