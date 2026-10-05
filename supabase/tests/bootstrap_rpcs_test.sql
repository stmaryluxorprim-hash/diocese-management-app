-- =====================================================================
-- Test for migration 20261015120000 — app_bootstrap() · child_portal_bootstrap()
-- · config tables on the broadcast bus. Run on the local shim DB after
-- run_migrations.sh:  psql -d app -f supabase/tests/bootstrap_rpcs_test.sql
-- Every assert raises on failure; a clean run ends with «BOOTSTRAP TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
begin;

-- ---------- seed ----------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000002'),  -- class servant (approved, 2 places)
  ('00000000-0000-0000-0000-000000000006');  -- pending servant
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة ١'),
  ('10000000-0000-0000-0000-000000000002', 'كنيسة ٢');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل ب');
insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null),
  ('00000000-0000-0000-0000-000000000002', 'خادم أ', 'servant_a', '0101', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000006', 'منتظر', 'pending_x', '0106', 'class_servant', 'pending',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
insert into public.servant_scopes (servant_id, church_id, service_id, class_id) values
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
insert into public.persons (id, national_id, name) values
  ('40000000-0000-0000-0000-000000000001', '1001', 'John');
-- a real-looking session token (child_session_touch requires ≥ 20 chars)
insert into public.child_sessions (person_id, token_hash, expires_at)
values ('40000000-0000-0000-0000-000000000001', encode(digest('tok-1001-aaaaaaaaaaaaaaaaaaaaaaaa', 'sha256'), 'hex'), now() + interval '1 day');
insert into public.enrollments (id, person_id, church_id, service_id, class_id) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
insert into public.permission_profiles (id, name, permissions) values
  ('70000000-0000-0000-0000-000000000001', 'سجل النشاط', array['activity.view']);
insert into public.permissions (servant_id, permission_profile_id) values
  ('00000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001');
insert into public.app_settings (key, value) values ('names', '{"children":"المخدومون"}'::jsonb)
  on conflict (key) do update set value = excluded.value;

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
create or replace function pg_temp.as_super() returns void language plpgsql as $$
begin perform set_config('role', 'postgres', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $$;

-- ---------- 1. app_bootstrap() == the separate queries, for an approved servant ----------
do $$
declare b jsonb; n int;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000002');
  b := public.app_bootstrap();

  if b->'profile'->>'id' <> '00000000-0000-0000-0000-000000000002' then raise exception 'profile'; end if;
  if b->'profile'->>'full_name' <> 'خادم أ' then raise exception 'profile name'; end if;
  -- extra scopes: exactly the servant_scopes rows the servant can read
  select count(*) into n from public.servant_scopes where servant_id = '00000000-0000-0000-0000-000000000002';
  if jsonb_array_length(b->'scopes') <> n then raise exception 'scopes: % vs %', jsonb_array_length(b->'scopes'), n; end if;
  if b->'church'->>'name' <> 'كنيسة ١' then raise exception 'church'; end if;
  if b->'service'->>'name' <> 'مدارس الأحد' then raise exception 'service'; end if;
  if b->'active_place' is not null and jsonb_typeof(b->'active_place') <> 'null' then raise exception 'active_place should be null'; end if;
  -- config blocks equal the direct selects under the same RLS
  select count(*) into n from public.module_access;
  if jsonb_array_length(b->'module_access') <> n then raise exception 'module_access % vs %', jsonb_array_length(b->'module_access'), n; end if;
  select count(*) into n from public.permission_profiles;
  if jsonb_array_length(b->'permission_profiles') <> n then raise exception 'permission_profiles'; end if;
  select count(*) into n from public.permissions;
  if jsonb_array_length(b->'permissions') <> n then raise exception 'permissions'; end if;
  select count(*) into n from public.app_settings where key in ('navigation', 'widgets', 'names', 'codes');
  if jsonb_array_length(b->'app_settings') <> n then raise exception 'app_settings % vs %', jsonb_array_length(b->'app_settings'), n; end if;
  if n > 0 and not exists (select 1 from jsonb_array_elements(b->'app_settings') e where e->>'key' = 'names') then raise exception 'names setting missing'; end if;
end $$;

-- ---------- 2. owner: no church / service, every config row ----------
do $$
declare b jsonb; n int;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000001');
  b := public.app_bootstrap();
  if b->'profile'->>'role' <> 'owner' then raise exception 'owner role'; end if;
  if jsonb_typeof(b->'church') <> 'null' then raise exception 'owner church'; end if;
  select count(*) into n from public.permission_profiles;
  if jsonb_array_length(b->'permission_profiles') <> n then raise exception 'owner profiles'; end if;
end $$;

-- ---------- 3. pending servant: profile only, no config ----------
do $$
declare b jsonb;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000006');
  b := public.app_bootstrap();
  if b->'profile'->>'status' <> 'pending' then raise exception 'pending status'; end if;
  if b ? 'module_access' then raise exception 'pending must not get config'; end if;
end $$;

-- ---------- 4. unknown uid / anon → profile null, nothing leaks ----------
do $$
declare b jsonb;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000099');
  b := public.app_bootstrap();
  if jsonb_typeof(b->'profile') <> 'null' then raise exception 'unknown uid must get null profile'; end if;
  if b ? 'module_access' then raise exception 'unknown uid leak'; end if;
  perform pg_temp.as_anon();
  begin
    b := public.app_bootstrap();
    raise exception 'anon must not execute app_bootstrap';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------- 5. child_portal_bootstrap(token) == the separate RPCs ----------
do $$
declare b jsonb; p jsonb; ex jsonb;
begin
  perform pg_temp.as_anon();
  b := public.child_portal_bootstrap('tok-1001-aaaaaaaaaaaaaaaaaaaaaaaa');
  p := public.child_portal_profile('tok-1001-aaaaaaaaaaaaaaaaaaaaaaaa');
  if b->'profile' <> p then raise exception 'profile differs'; end if;
  if (b->'session'->>'person_id') <> '40000000-0000-0000-0000-000000000001' then raise exception 'session'; end if;
  -- every block key present (null allowed when a module is not granted)
  if not (b ? 'exams' and b ? 'conversations' and b ? 'online_classes' and b ? 'achievements' and b ? 'occasions'
          and b ? 'notifications' and b ? 'library' and b ? 'shops' and b ? 'store_requests') then
    raise exception 'missing block keys: %', (select string_agg(k, ',') from jsonb_object_keys(b) k);
  end if;
  -- a block that works alone must be identical inside the bundle
  begin ex := public.child_portal_exams('tok-1001-aaaaaaaaaaaaaaaaaaaaaaaa'); exception when others then ex := null; end;
  if ex is not null and b->'exams' <> ex then raise exception 'exams differ'; end if;
end $$;

-- ---------- 6. expired / bad token → same errors as child_session_touch ----------
do $$
begin
  perform pg_temp.as_anon();
  begin
    perform public.child_portal_bootstrap('no-such-token-xxxxxxxxxxxxxxxxxxxx');
    raise exception 'bad token must fail';
  exception when others then
    if sqlerrm not in ('session_expired', 'invalid_code', 'unknown_code') then raise exception 'unexpected error %', sqlerrm; end if;
  end;
end $$;

-- ---------- 7. config tables: statement-level bus trigger attached, left the publication ----------
do $$
declare t text; n int;
begin
  perform pg_temp.as_super();
  foreach t in array array['app_settings', 'module_access', 'permission_profiles', 'permissions'] loop
    select count(*) into n from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname in ('zzz_rt_ins', 'zzz_rt_upd', 'zzz_rt_del') and not tgisinternal;
    if n <> 3 then raise exception '% has % rt triggers', t, n; end if;
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      raise exception '% still in supabase_realtime publication', t;
    end if;
  end loop;
  -- the trigger runs without error on a real write (rt_send is a no-op locally)
  update public.app_settings set value = '{"children":"الأطفال"}'::jsonb where key = 'names';
  insert into public.permission_profiles (id, name, permissions) values ('70000000-0000-0000-0000-000000000002', 'x', array['activity.view']);
  delete from public.permission_profiles where id = '70000000-0000-0000-0000-000000000002';
end $$;

rollback;
\echo BOOTSTRAP TESTS PASSED
