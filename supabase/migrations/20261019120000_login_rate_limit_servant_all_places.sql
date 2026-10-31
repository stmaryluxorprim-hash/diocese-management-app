-- =====================================================================
-- 20261019120000 — LOGIN RATE LIMIT · ONE SERVANT ACCOUNT = ALL HIS PLACES
--   (حدّ محاولات الدخول · حساب خادم واحد يرى كل أماكن خدمته)
--
--   1. LOGIN THROTTLE (login_throttle). Every password check on the three
--      login doors (account_login · child_login · priest_login) and on
--      person_verify_password is counted per CODE and per IP:
--        • wrong password → the attempt is recorded; after `code_max` wrong
--          tries inside `code_window_min` the code is LOCKED for
--          `code_lock_min` (doubling on every new lock, capped by
--          `max_lock_min`); the same per IP with the `ip_*` limits.
--        • a locked code / IP gets {error:'too_many_attempts', retry_after}
--          WITHOUT touching the password (no bcrypt, no sleep).
--        • a right password clears the code counter.
--      The limits live in app_settings key `login_limits` (owner-editable,
--      defaults in login_limits()). login_locks() / login_unlock() let the
--      owner see and lift the locks.
--
--      WHY THE FUNCTIONS RETURN {error} INSTEAD OF RAISING: a RAISE rolls
--      the whole statement back — the recorded attempt would vanish with
--      it. So the two throttled outcomes (wrong_password · too_many_attempts)
--      are returned as a payload; the clients turn it into the same error
--      they used to receive. Every other outcome (unknown_code · pending …)
--      still raises exactly as before.
--
--      The pg_sleep(0.25) "brute-force brake" is removed from the login
--      doors: it kept a pooled connection busy for 250 ms per wrong try,
--      which under a login rush starved the pool. The lock replaces it.
--
--   2. ONE SERVANT ACCOUNT = ALL PLACES. person_accounts() lists, for a
--      servant with more than one place, a leading row
--      {kind:'servant', all_places:true, church_id:null …} = «كل أماكن
--      خدمتي». Minting it (account_mint with church null) clears
--      servant_active_places → my_scopes() returns EVERY place → the app
--      shows all the churches / services / classes he is allowed to see
--      in one session. The per-place rows stay for whoever wants a
--      narrower session. The login page enters this row directly when the
--      person is a servant only.
--
-- Idempotent.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. login_throttle — counters + locks per code / IP
-- ---------------------------------------------------------------------
create table if not exists public.login_throttle (
  key           text primary key,                 -- 'code:<code>' | 'ip:<ip>'
  fails         integer not null default 0,
  window_start  timestamptz not null default now(),
  last_fail_at  timestamptz,
  locked_until  timestamptz,
  lock_count    integer not null default 0,
  last_code     text,                             -- ip rows: the last code tried (owner view)
  updated_at    timestamptz not null default now()
);
comment on table public.login_throttle is
  'حدّ محاولات الدخول — عدّاد المحاولات الخاطئة والقفل المؤقت لكل كود ولكل IP (يُقرأ من المالك عبر login_locks)';
create index if not exists idx_login_throttle_locked on public.login_throttle(locked_until) where locked_until is not null;
create index if not exists idx_login_throttle_updated on public.login_throttle(updated_at);
alter table public.login_throttle enable row level security;
revoke all on public.login_throttle from anon, authenticated;

-- the limits: defaults overlaid by app_settings.login_limits (owner-editable)
create or replace function public.login_limits()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'code_max', 5,  'code_window_min', 15, 'code_lock_min', 15,
           'ip_max', 40,   'ip_window_min', 10,   'ip_lock_min', 10,
           'max_lock_min', 240)
         || coalesce((select value from public.app_settings where key = 'login_limits' and jsonb_typeof(value) = 'object'), '{}'::jsonb)
$$;
grant execute on function public.login_limits() to anon, authenticated;

-- the caller's IP as PostgREST hands it over (null in psql / tests)
create or replace function public.request_ip()
returns text language plpgsql stable as $$
declare h jsonb; v text;
begin
  begin h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then h := null; end;
  if h is null then return null; end if;
  v := coalesce(nullif(trim(h->>'cf-connecting-ip'), ''),
                nullif(trim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), ''),
                nullif(trim(h->>'x-real-ip'), ''));
  return left(v, 64);
end $$;
revoke all on function public.request_ip() from public, anon, authenticated;

create or replace function public.login_throttle_key_code(p_code text)
returns text language sql immutable as $$ select 'code:' || left(lower(trim(coalesce(p_code, ''))), 80) $$;

-- seconds the caller must still wait (0 = free). Checks the code AND the IP.
create or replace function public.login_throttle_check(p_code text)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare v_ip text := public.request_ip(); v_until timestamptz;
begin
  select max(locked_until) into v_until from public.login_throttle
   where key in (public.login_throttle_key_code(p_code), 'ip:' || coalesce(v_ip, '-'))
     and locked_until > now();
  if v_until is null then return 0; end if;
  return greatest(1, ceil(extract(epoch from (v_until - now())))::integer);
end $$;
revoke all on function public.login_throttle_check(text) from public, anon, authenticated;

-- one bucket: returns the lock length in seconds when THIS failure locks it
create or replace function public.login_throttle_bump(p_key text, p_max integer, p_window_min integer, p_lock_min integer, p_max_lock_min integer, p_code text)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare r public.login_throttle; v_lock_min integer;
begin
  insert into public.login_throttle (key, fails, window_start, last_fail_at, last_code)
  values (p_key, 0, now(), now(), left(p_code, 80))
  on conflict (key) do update set last_fail_at = now(), last_code = excluded.last_code, updated_at = now()
  returning * into r;
  -- a window that expired starts over
  if r.window_start < now() - make_interval(mins => greatest(1, p_window_min)) then
    r.fails := 0; r.window_start := now();
  end if;
  r.fails := r.fails + 1;
  if r.fails >= greatest(1, p_max) then
    r.lock_count := r.lock_count + 1;
    v_lock_min := least(greatest(1, p_lock_min) * power(2, least(r.lock_count - 1, 8))::integer, greatest(1, p_max_lock_min));
    update public.login_throttle
       set fails = 0, window_start = now(), lock_count = r.lock_count,
           locked_until = now() + make_interval(mins => v_lock_min), updated_at = now()
     where key = p_key;
    return v_lock_min * 60;
  end if;
  update public.login_throttle set fails = r.fails, window_start = r.window_start, updated_at = now() where key = p_key;
  return 0;
end $$;
revoke all on function public.login_throttle_bump(text, integer, integer, integer, integer, text) from public, anon, authenticated;

-- a wrong password: count it for the code and for the IP.
-- Returns {error:'too_many_attempts', retry_after} when this try locked
-- something, else {error:'wrong_password', remaining}.
create or replace function public.login_throttle_fail(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare l jsonb := public.login_limits(); v_ip text := public.request_ip(); s1 integer := 0; s2 integer := 0; v_left integer;
begin
  s1 := public.login_throttle_bump(public.login_throttle_key_code(p_code),
          (l->>'code_max')::int, (l->>'code_window_min')::int, (l->>'code_lock_min')::int, (l->>'max_lock_min')::int, p_code);
  if v_ip is not null then
    s2 := public.login_throttle_bump('ip:' || v_ip,
            (l->>'ip_max')::int, (l->>'ip_window_min')::int, (l->>'ip_lock_min')::int, (l->>'max_lock_min')::int, p_code);
  end if;
  -- housekeeping (cheap: indexed, rarely matches)
  delete from public.login_throttle where updated_at < now() - interval '2 days' and (locked_until is null or locked_until < now());
  if greatest(s1, s2) > 0 then
    return jsonb_build_object('error', 'too_many_attempts', 'retry_after', greatest(s1, s2));
  end if;
  select greatest(0, (l->>'code_max')::int - fails) into v_left from public.login_throttle where key = public.login_throttle_key_code(p_code);
  return jsonb_build_object('error', 'wrong_password', 'remaining', coalesce(v_left, (l->>'code_max')::int));
end $$;
revoke all on function public.login_throttle_fail(text) from public, anon, authenticated;

-- the right password clears the code counter (the IP keeps counting)
create or replace function public.login_throttle_ok(p_code text)
returns void language sql volatile security definer set search_path = public as $$
  delete from public.login_throttle where key = public.login_throttle_key_code(p_code)
$$;
revoke all on function public.login_throttle_ok(text) from public, anon, authenticated;

-- ---------- owner: see the locks · lift them ----------
create or replace function public.login_locks(p_limit integer default 200)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_owner() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', t.key, 'kind', split_part(t.key, ':', 1), 'subject', substr(t.key, position(':' in t.key) + 1),
             'fails', t.fails, 'lock_count', t.lock_count, 'locked', t.locked_until > now(),
             'locked_until', t.locked_until, 'last_fail_at', t.last_fail_at, 'last_code', t.last_code,
             'person_name', (select p.name from public.persons p where t.key like 'code:%' and lower(p.national_id) = substr(t.key, 6)))
             order by (t.locked_until > now()) desc nulls last, t.last_fail_at desc)
      from (select * from public.login_throttle
             where locked_until > now() or last_fail_at > now() - interval '1 day'
             order by last_fail_at desc nulls last limit greatest(1, least(coalesce(p_limit, 200), 1000))) t
  ), '[]'::jsonb) end
$$;
revoke all on function public.login_locks(integer) from public, anon;
grant execute on function public.login_locks(integer) to authenticated;

create or replace function public.login_unlock(p_key text default null)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_key is null then
    delete from public.login_throttle;
  else
    delete from public.login_throttle where key = p_key;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.login_unlock(text) from public, anon;
grant execute on function public.login_unlock(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. The login doors use the throttle
-- ---------------------------------------------------------------------
-- 2a. account_login — the ONE login page
create or replace function public.account_login(p_code text, p_password text, p_remember boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare p public.persons; v_grant text; acc jsonb; v_wait integer;
begin
  if nullif(trim(coalesce(p_code, '')), '') is null then raise exception 'invalid_code' using errcode = 'P0001'; end if;
  v_wait := public.login_throttle_check(p_code);
  if v_wait > 0 then return jsonb_build_object('error', 'too_many_attempts', 'retry_after', v_wait); end if;
  select * into p from public.persons where national_id = trim(p_code);
  if not found then raise exception 'unknown_code' using errcode = 'P0002'; end if;
  acc := public.person_accounts(p.id);
  if jsonb_array_length(acc) = 0 then
    if exists (select 1 from public.child_join_requests r where r.code = p.national_id and r.status = 'pending')
       or exists (select 1 from public.priest_requests r where r.code = p.national_id and r.status = 'pending') then
      raise exception 'pending_approval' using errcode = 'P0001';
    end if;
    raise exception 'no_account' using errcode = 'P0002';
  end if;
  -- a servant / priest whose password was never mirrored (legacy): the
  -- client falls back to Supabase Auth and the mirror catches up
  if not exists (select 1 from public.person_credentials c where c.person_id = p.id)
     and not exists (select 1 from public.enrollments e where e.person_id = p.id and e.kind = 'child') then
    raise exception 'password_unknown' using errcode = 'P0012';
  end if;
  if not public.person_password_ok(p.id, p_password) then
    return public.login_throttle_fail(p_code);
  end if;
  perform public.login_throttle_ok(p_code);
  v_grant := encode(gen_random_bytes(32), 'hex');
  delete from public.login_grants where expires_at < now();
  insert into public.login_grants (person_id, grant_hash, remember, expires_at)
  values (p.id, encode(digest(v_grant, 'sha256'), 'hex'), coalesce(p_remember, false), now() + interval '5 minutes');
  return jsonb_build_object(
    'grant', v_grant,
    'person', jsonb_build_object('id', p.id, 'name', p.name, 'code', p.national_id, 'image_url', p.image_url),
    'accounts', acc);
end $$;
grant execute on function public.account_login(text, text, boolean) to anon, authenticated;

-- 2b. child_login (0043 body + throttle, no pg_sleep)
create or replace function public.child_login(p_code text, p_password text, p_remember boolean default false, p_user_agent text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  p public.persons;
  c public.person_credentials;
  v_token text;
  v_exp timestamptz;
  v_default boolean := false;
  v_wait integer;
begin
  if nullif(trim(coalesce(p_code, '')), '') is null then raise exception 'invalid_code' using errcode = 'P0001'; end if;
  v_wait := public.login_throttle_check(p_code);
  if v_wait > 0 then return jsonb_build_object('error', 'too_many_attempts', 'retry_after', v_wait); end if;
  select * into p from public.persons where national_id = trim(p_code);
  if not found then raise exception 'unknown_code' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.enrollments e where e.person_id = p.id and e.kind = 'child') then
    raise exception 'unknown_code' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.enrollments e where e.person_id = p.id and e.kind = 'child' and e.status = 'active') then
    raise exception 'account_stopped' using errcode = 'P0011';
  end if;

  select * into c from public.person_credentials where person_id = p.id;
  if not found then
    v_default := true;
    if coalesce(p_password, '') <> public.default_password() then
      return public.login_throttle_fail(p_code);
    end if;
  elsif coalesce(p_password, '') = '' or c.password_hash <> crypt(p_password, c.password_hash) then
    return public.login_throttle_fail(p_code);
  end if;
  perform public.login_throttle_ok(p_code);

  v_token := encode(gen_random_bytes(32), 'hex');
  v_exp := case when coalesce(p_remember, false) then now() + interval '90 days' else now() + interval '12 hours' end;
  insert into public.child_sessions (person_id, token_hash, remember, expires_at, user_agent)
  values (p.id, encode(digest(v_token, 'sha256'), 'hex'), coalesce(p_remember, false), v_exp, left(p_user_agent, 300));
  delete from public.child_sessions where expires_at < now() - interval '1 day';

  return jsonb_build_object('token', v_token, 'expires_at', v_exp, 'person_id', p.id, 'remember', coalesce(p_remember, false),
                            'default_password', v_default);
end $$;
grant execute on function public.child_login(text, text, boolean, text) to anon, authenticated;

-- 2c. priest_login (20261003120000 body + throttle, no pg_sleep)
create or replace function public.priest_login(p_code text, p_password text, p_remember boolean default false, p_user_agent text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  p public.persons;
  pr public.priests;
  v_token text;
  v_exp timestamptz;
  v_wait integer;
begin
  if nullif(trim(coalesce(p_code, '')), '') is null then raise exception 'invalid_code' using errcode = 'P0001'; end if;
  v_wait := public.login_throttle_check(p_code);
  if v_wait > 0 then return jsonb_build_object('error', 'too_many_attempts', 'retry_after', v_wait); end if;
  if exists (select 1 from public.priest_requests r where r.code = trim(p_code) and r.status = 'pending') then
    raise exception 'pending_approval' using errcode = 'P0001';
  end if;
  select * into p from public.persons where national_id = trim(p_code);
  if not found then raise exception 'unknown_code' using errcode = 'P0002'; end if;
  select * into pr from public.priests where person_id = p.id;
  if not found then raise exception 'not_priest' using errcode = 'P0002'; end if;
  if not public.person_password_ok(p.id, p_password)
     and not (coalesce(p_password, '') <> '' and pr.password_hash = crypt(p_password, pr.password_hash)) then
    return public.login_throttle_fail(p_code);
  end if;
  perform public.login_throttle_ok(p_code);
  if pr.status = 'pending' then raise exception 'pending_approval' using errcode = 'P0001'; end if;
  if pr.status = 'rejected' then raise exception 'account_rejected' using errcode = 'P0001'; end if;
  if pr.status = 'suspended' then raise exception 'account_stopped' using errcode = 'P0001'; end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_exp := case when coalesce(p_remember, false) then now() + interval '90 days' else now() + interval '12 hours' end;
  insert into public.priest_sessions (priest_id, token_hash, remember, expires_at, user_agent)
  values (pr.id, encode(digest(v_token, 'sha256'), 'hex'), coalesce(p_remember, false), v_exp, left(p_user_agent, 300));
  delete from public.priest_sessions where expires_at < now() - interval '1 day';
  perform set_config('app.priest_actor', pr.id::text, true);
  return jsonb_build_object('token', v_token, 'expires_at', v_exp, 'priest_id', pr.id, 'remember', coalesce(p_remember, false));
end $$;
grant execute on function public.priest_login(text, text, boolean, text) to anon, authenticated;

-- 2d. person_verify_password (signup wizards): counted too, a lock → false
create or replace function public.person_verify_password(p_code text, p_password text)
returns boolean language plpgsql volatile security definer set search_path = public, extensions as $$
declare v uuid; ok boolean;
begin
  if public.login_throttle_check(p_code) > 0 then return false; end if;
  select id into v from public.persons where national_id = trim(coalesce(p_code, ''));
  if v is null then return false; end if;
  if not exists (select 1 from public.person_credentials c where c.person_id = v)
     and not exists (select 1 from public.enrollments e where e.person_id = v and e.kind = 'child') then
    return false;
  end if;
  ok := public.person_password_ok(v, p_password);
  if ok then perform public.login_throttle_ok(p_code); else perform public.login_throttle_fail(p_code); end if;
  return ok;
end $$;
grant execute on function public.person_verify_password(text, text) to anon, authenticated;

-- 2e. account_switch_peek — read a ticket WITHOUT consuming it (service role).
--     /api/account/switch mints the Auth link first and redeems only on
--     success, so a 429 from the Auth server during a login rush leaves the
--     ticket valid for the browser's retry.
create or replace function public.account_switch_peek(p_ticket text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare t public.account_switch_tickets; s public.servant_enrollments;
begin
  if auth.role() <> 'service_role' and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_ticket is null or length(trim(p_ticket)) < 20 then raise exception 'invalid_ticket' using errcode = 'P0001'; end if;
  select * into t from public.account_switch_tickets where ticket_hash = encode(digest(trim(p_ticket), 'sha256'), 'hex');
  if not found or t.used_at is not null or t.expires_at < now() then raise exception 'invalid_ticket' using errcode = 'P0001'; end if;
  select * into s from public.servant_enrollments where id = t.servant_id;
  if not found or s.status <> 'approved' then raise exception 'account_stopped' using errcode = 'P0001'; end if;
  return jsonb_build_object('servant_id', s.id, 'user_id', s.user_id, 'remember', t.remember, 'person_id', t.person_id);
end $$;
revoke all on function public.account_switch_peek(text) from public, anon, authenticated;
grant execute on function public.account_switch_peek(text) to service_role;

-- ---------------------------------------------------------------------
-- 3. person_accounts — the servant's «كل أماكن خدمتي» row
-- ---------------------------------------------------------------------
create or replace function public.person_accounts(p_person uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(a order by a->>'order', a->>'label2') from (
      -- 3a. ONE row = every place (only when he has more than one)
      select jsonb_build_object(
          'order', '0', 'kind', 'servant', 'id', s.id, 'status', s.status, 'role', s.role, 'label', 'خادم',
          'enrollment_id', s.id, 'church_id', null, 'service_id', null, 'class_id', null,
          'is_primary', true, 'all_places', true,
          'label2', 'كل أماكن خدمتي (' || pl.n || ')',
          'places', pl.places) a
        from public.servant_enrollments s
        join lateral (
          select count(*) n,
                 jsonb_agg(jsonb_build_object('church', ch.name, 'service', sv.name, 'class', cl.name) order by ch.name, sv.name, cl.name) places
            from public.servant_places(s.id) x
            left join public.churches ch on ch.id = x.church_id
            left join public.services sv on sv.id = x.service_id
            left join public.classes cl on cl.id = x.class_id
        ) pl on pl.n > 1
       where s.person_id = p_person
      union all
      -- 3b. one row per place (unchanged)
      select jsonb_build_object(
          'order', '1', 'kind', 'servant', 'id', s.id, 'status', s.status, 'role', s.role, 'label', 'خادم',
          'enrollment_id', s.id,
          'church_id', pl.church_id, 'service_id', pl.service_id, 'class_id', pl.class_id,
          'is_primary', coalesce(pl.is_primary, true),
          'label2', coalesce(ch.name, '') || coalesce(' ← ' || sv.name, '') || coalesce(' ← ' || cl.name, ''),
          'places', case when pl.church_id is null then '[]'::jsonb
                         else jsonb_build_array(jsonb_build_object('church', ch.name, 'service', sv.name, 'class', cl.name)) end) a
        from public.servant_enrollments s
        left join lateral public.servant_places(s.id) pl on true
        left join public.churches ch on ch.id = pl.church_id
        left join public.services sv on sv.id = pl.service_id
        left join public.classes cl on cl.id = pl.class_id
       where s.person_id = p_person
      union all
      select jsonb_build_object(
          'order', '2', 'kind', 'child', 'id', e.id, 'enrollment_id', e.id, 'status', e.status, 'label', 'مخدوم',
          'church_id', e.church_id, 'service_id', e.service_id, 'class_id', e.class_id,
          'label2', ch.name || ' ← ' || sv.name || ' ← ' || cl.name,
          'places', jsonb_build_array(jsonb_build_object('church', ch.name, 'service', sv.name, 'class', cl.name)))
        from public.enrollments e
        join public.churches ch on ch.id = e.church_id
        join public.services sv on sv.id = e.service_id
        join public.classes cl on cl.id = e.class_id
       where e.person_id = p_person and e.kind = 'child'
      union all
      select jsonb_build_object(
          'order', '3', 'kind', 'priest', 'id', pr.id, 'enrollment_id', pr.id, 'status', pr.status, 'title', pr.title, 'label', 'كاهن',
          'church_id', pr.church_id, 'label2', ch.name,
          'places', jsonb_build_array(jsonb_build_object('church', ch.name, 'service', null, 'class', null)))
        from public.priests pr join public.churches ch on ch.id = pr.church_id
       where pr.person_id = p_person
    ) t(a)
  ), '[]'::jsonb)
$$;
revoke all on function public.person_accounts(uuid) from public, anon, authenticated;

commit;
