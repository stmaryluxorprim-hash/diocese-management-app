-- =====================================================================
-- 20261015120000: ONE request to open the app — app_bootstrap() ·
--                 child_portal_bootstrap() · config tables on the bus
--
-- Third round on the Supabase «Logs Ingest» meter (the API gateway logs one
-- line per HTTP request and cannot be switched off). The previous rounds
-- removed background polling and the realtime fan-out; what is left is the
-- «every open» cost — the requests every device makes each time the app
-- starts, which scales with the number of PEOPLE, not with activity.
--
--   STAFF — a full load / PWA cold start / new tab ran, before the page's
--   own data: servant_enrollments (1) · servant_scopes + persons + churches
--   + services + servant_active_places (5) · module_access (1) ·
--   permission_profiles + permissions (2) · app_settings (1) = 10 requests,
--   then 4 `postgres_changes` joins on the cold config tables (each join =
--   a realtime handshake + per-change RLS work).
--
--   CHILD PORTAL — opening any page ran profile · exams · chat overview ·
--   online classes · achievements · occasions · notifications · library ·
--   shops · store requests = 10 RPCs, and the SAME 10 again on every tab
--   focus, plus 4 anon `postgres_changes` joins.
--
-- FIX
--   1. app_bootstrap()                → everything AuthProvider · Modules ·
--                                       Permissions · Customization need,
--                                       as one jsonb. RLS-equivalent: the
--                                       function runs as the caller
--                                       (security INVOKER) so every row is
--                                       exactly what the 10 queries returned.
--   2. child_portal_bootstrap(token)  → session touch + the 10 blocks in one
--                                       call (each block is the existing RPC;
--                                       a block that fails — module not
--                                       granted / migration missing — is
--                                       null, the others still arrive).
--   3. The four config tables (app_settings · module_access ·
--      permission_profiles · permissions) join the 0046 broadcast bus with
--      a statement-level trigger that notifies EVERY church topic (+
--      scope:all) — they are global, change about once a month, and every
--      signed-in device needs to hear about it. The app drops its four
--      postgres_changes channels for them.
--
-- Idempotent. No behaviour change on screen.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. STAFF BOOTSTRAP — security invoker: RLS applies exactly as before
-- ---------------------------------------------------------------------
create or replace function public.app_bootstrap()
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
  prof public.servant_enrollments;
  out jsonb;
begin
  if uid is null then return jsonb_build_object('profile', null); end if;
  select * into prof from public.servant_enrollments where id = uid;
  if not found then return jsonb_build_object('profile', null); end if;

  out := jsonb_build_object(
    'profile', to_jsonb(prof),
    'scopes', coalesce((select jsonb_agg(jsonb_build_object('church_id', church_id, 'service_id', service_id, 'class_id', class_id))
                          from public.servant_scopes where servant_id = uid), '[]'::jsonb),
    'person',  (select to_jsonb(p) from public.persons p where p.id = prof.person_id),
    'church',  (select to_jsonb(c) from public.churches c where c.id = prof.church_id),
    'service', (select to_jsonb(s) from public.services s where s.id = prof.service_id),
    'active_place', (select jsonb_build_object('church_id', church_id, 'service_id', service_id, 'class_id', class_id)
                       from public.servant_active_places where servant_id = uid limit 1)
  );

  -- the rest only for an approved servant (the providers skip it otherwise)
  if prof.status = 'approved' then
    out := out || jsonb_build_object(
      'module_access', coalesce((select jsonb_agg(to_jsonb(m)) from public.module_access m), '[]'::jsonb),
      'permission_profiles', coalesce((select jsonb_agg(to_jsonb(pp) order by pp.sort_order, pp.name) from public.permission_profiles pp), '[]'::jsonb),
      'permissions', coalesce((select jsonb_agg(to_jsonb(pe)) from public.permissions pe), '[]'::jsonb),
      'app_settings', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'value', value))
                                  from public.app_settings where key in ('navigation', 'widgets', 'names', 'codes')), '[]'::jsonb)
    );
  end if;
  return out;
end $$;
revoke all on function public.app_bootstrap() from public, anon;
grant execute on function public.app_bootstrap() to authenticated;
comment on function public.app_bootstrap() is 'كل ما يحتاجه التطبيق عند الفتح في طلب واحد — profile · scopes · person · church · service · active_place · module_access · permission_profiles · permissions · app_settings (security invoker → نفس RLS)';

-- ---------------------------------------------------------------------
-- 2. CHILD PORTAL BOOTSTRAP — one call = session touch + every block.
--    Each block is the existing RPC; a failing one becomes null so a
--    module that is not granted / a migration not yet applied never takes
--    the whole portal down.
-- ---------------------------------------------------------------------
create or replace function public.child_portal_bootstrap(p_token text, p_notif_limit integer default 80)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  out jsonb := '{}'::jsonb;
  v jsonb;
begin
  -- session first: this raises session_expired / invalid_code exactly like
  -- child_session_touch did, so the client logs the child out the same way
  v := public.child_session_touch(p_token);
  out := out || jsonb_build_object('session', v);

  -- profile is mandatory — if it fails the whole call fails (same as before)
  out := out || jsonb_build_object('profile', public.child_portal_profile(p_token));

  begin v := public.child_portal_exams(p_token);            exception when others then v := null; end; out := out || jsonb_build_object('exams', v);
  begin v := public.child_chat_overview(p_token);           exception when others then v := null; end; out := out || jsonb_build_object('conversations', v);
  begin v := public.child_online_classes(p_token);          exception when others then v := null; end; out := out || jsonb_build_object('online_classes', v);
  begin v := public.child_portal_achievements(p_token);     exception when others then v := null; end; out := out || jsonb_build_object('achievements', v);
  begin v := public.child_portal_occasions(p_token);        exception when others then v := null; end; out := out || jsonb_build_object('occasions', v);
  begin v := public.child_notifications(p_token, p_notif_limit); exception when others then v := null; end; out := out || jsonb_build_object('notifications', v);
  begin v := public.child_portal_library(p_token);          exception when others then v := null; end; out := out || jsonb_build_object('library', v);
  begin v := public.child_portal_shops(p_token);            exception when others then v := null; end; out := out || jsonb_build_object('shops', v);
  begin v := public.child_portal_store_requests(p_token);   exception when others then v := null; end; out := out || jsonb_build_object('store_requests', v);
  return out;
end $$;
revoke all on function public.child_portal_bootstrap(text, integer) from public;
grant execute on function public.child_portal_bootstrap(text, integer) to anon, authenticated;
comment on function public.child_portal_bootstrap(text, integer) is 'بوابة المخدوم — تمديد الجلسة + كل بيانات البوابة في طلب واحد (كل كتلة = الدالة القديمة؛ الكتلة الفاشلة = null)';

-- ---------------------------------------------------------------------
-- 3. CONFIG TABLES → broadcast bus (every church topic + scope:all)
-- ---------------------------------------------------------------------
create or replace function public.rt_trg_global()
returns trigger language plpgsql security definer set search_path = public as $$
declare churches uuid[];
begin
  select array_agg(id) into churches from public.churches;
  perform public.rt_notify_scope(tg_table_name, tg_op, churches, null);
  return null;
end $$;
revoke all on function public.rt_trg_global() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['app_settings', 'module_access', 'permission_profiles', 'permissions'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists zzz_rt_ins on public.%I', t);
    execute format('drop trigger if exists zzz_rt_upd on public.%I', t);
    execute format('drop trigger if exists zzz_rt_del on public.%I', t);
    execute format('create trigger zzz_rt_ins after insert on public.%I for each statement execute function public.rt_trg_global()', t);
    execute format('create trigger zzz_rt_upd after update on public.%I for each statement execute function public.rt_trg_global()', t);
    execute format('create trigger zzz_rt_del after delete on public.%I for each statement execute function public.rt_trg_global()', t);
    -- leave the postgres_changes publication (no more per-subscriber RLS work)
    begin
      execute format('alter publication supabase_realtime drop table public.%I', t);
    exception when others then null; -- not in the publication / no publication locally
    end;
  end loop;
end $$;

commit;
