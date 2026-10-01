-- =====================================================================
-- 1. سجل النشاط — the feed / summary used to TIME OUT for every non-owner
--    («تعذر تحميل السجل», empty «نظرة عامة»).
--    The select policy on activity_log called activity_row_visible() PER
--    ROW, and that function re-ran is_owner() → activity_can() →
--    module_visible() → my_scope() → my_scopes() → has_permission() →
--    scope_overlaps() … (each a security-definer query) for every row.
--    The owner short-circuits on the first branch; a servant / manager
--    pays the whole chain: ~6 ms × rows → activity_summary over a few
--    thousand rows exceeds the statement timeout.
--
--    Fix: `activity_visibility()` computes the caller's context ONCE
--    (owner · may view · sees whole church · the scope list) and the
--    policy wraps it in an InitPlan `(select …)` so Postgres evaluates it
--    a single time per statement; the per-row part is a pure comparison
--    against the arrays. activity_row_visible() keeps its signature
--    (same truth table) for anything still calling it.
--
-- 2. دعوات التسجيل — the invite link vanished when the page was reopened:
--    only the sha256 hash was stored, the raw token lived in React state.
--    Now the token is stored too (`signup_invites.token`, readable only by
--    the creator / owner through RLS) so the link / QR can be shown again,
--    `signup_invite_update()` edits validity · uses · note, and the
--    creator / owner may DELETE an invite. The hash column remains the
--    lookup key for check / consume (token is never read by anon).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. activity_log — one context per statement
-- ---------------------------------------------------------------------
-- Returned once per statement by the policy's InitPlan:
--   is_owner      → everything
--   can_view      → activity.view (false → nothing)
--   whole_church  → church manager OR activity.view_all: every row of his
--                   churches (+ rows without church made by servants of
--                   his churches)
--   churches / scopes → the caller's places (my_scopes())
create or replace function public.activity_visibility()
returns table (is_owner boolean, can_view boolean, whole_church boolean, churches uuid[], scopes jsonb)
language sql stable security definer set search_path = public as $$
  with me as (select role, church_id, service_id, class_id from public.my_scopes()),
       r as (select role from me limit 1)
  select
    coalesce((select role from r) = 'owner', false)                                   as is_owner,
    public.activity_can('activity.view')                                              as can_view,
    coalesce((select role from r) = 'church_manager', false)
      or public.has_permission('activity.view_all')                                   as whole_church,
    coalesce((select array_agg(distinct church_id) from me where church_id is not null), '{}'::uuid[]) as churches,
    coalesce((select jsonb_agg(jsonb_build_object('c', church_id, 's', service_id, 'k', class_id))
                from me where church_id is not null), '[]'::jsonb)                   as scopes
$$;
grant execute on function public.activity_visibility() to authenticated;

-- Pure (no table reads) per-row test against the context above.
-- Same truth table as activity_row_visible() / scope_overlaps():
--   whole church → church ∈ churches
--   else         → one scope with the same church whose service / class are
--                  unset on either side or equal.
create or replace function public.activity_row_in_scope(
  p_church uuid, p_service uuid, p_class uuid, p_whole boolean, p_churches uuid[], p_scopes jsonb
) returns boolean language sql immutable as $$
  select case
    when p_whole then p_church = any(p_churches)
    else exists (
      select 1 from jsonb_array_elements(coalesce(p_scopes, '[]'::jsonb)) s
       where (s->>'c')::uuid = p_church
         and (s->>'s' is null or p_service is null or (s->>'s')::uuid = p_service)
         and (s->>'k' is null or p_class is null or (s->>'k')::uuid = p_class)
    )
  end
$$;

-- Rows WITHOUT a church: a church manager (or view_all) sees what the
-- servants of his churches did. Set-valued once per statement too.
create or replace function public.activity_visible_actors(p_churches uuid[])
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce((
    select array_agg(distinct se.id)
      from public.servant_enrollments se
     where se.church_id = any(p_churches)
        or exists (select 1 from public.servant_scopes x where x.servant_id = se.id and x.church_id = any(p_churches))
  ), '{}'::uuid[])
$$;
grant execute on function public.activity_visible_actors(uuid[]) to authenticated;

drop policy if exists activity_log_select on public.activity_log;
create policy activity_log_select on public.activity_log for select using (
  (select v.is_owner from public.activity_visibility() v)
  or (
    (select v.can_view from public.activity_visibility() v)
    and case
      when church_id is not null then
        public.activity_row_in_scope(church_id, service_id, class_id,
          (select v.whole_church from public.activity_visibility() v),
          (select v.churches from public.activity_visibility() v),
          (select v.scopes from public.activity_visibility() v))
      when actor_kind = 'servant' and actor_id is not null then
        (select v.whole_church from public.activity_visibility() v)
        and actor_id = any ((select public.activity_visible_actors(v.churches) from public.activity_visibility() v)::uuid[])
      else false
    end
  )
);

-- Keep the old helper consistent (person history / tests / older callers)
create or replace function public.activity_row_visible(
  p_church uuid, p_service uuid, p_class uuid, p_actor_kind text, p_actor_id uuid
) returns boolean language sql stable security definer set search_path = public as $$
  select v.is_owner
      or (v.can_view and case
            when p_church is not null then public.activity_row_in_scope(p_church, p_service, p_class, v.whole_church, v.churches, v.scopes)
            when p_actor_kind = 'servant' and p_actor_id is not null then
              v.whole_church and p_actor_id = any (public.activity_visible_actors(v.churches))
            else false
          end)
    from public.activity_visibility() v
$$;

-- The summary over a big log: cap the work to the filter's period (the
-- UI always sends `from`); the by_day / by_hour windows are unchanged.
-- Nothing else to change — once the policy is cheap the RPCs are fast.

-- ---------------------------------------------------------------------
-- 2. signup_invites — stored token · update · delete
-- ---------------------------------------------------------------------
alter table public.signup_invites add column if not exists token text;
alter table public.signup_invites add column if not exists updated_at timestamptz;

-- RLS already limits rows to the creator / owner; the column grant lets
-- them read the token to rebuild the link / QR. anon has NO grant.
grant select (token, updated_at) on public.signup_invites to authenticated;
grant delete on public.signup_invites to authenticated;
drop policy if exists signup_invites_delete on public.signup_invites;
create policy signup_invites_delete on public.signup_invites for delete to authenticated
  using (created_by = auth.uid() or (select public.is_owner()));

-- create: store the token as well (same rules as before)
create or replace function public.signup_invite_create(
  p_kind text, p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_days integer default 7, p_max_uses integer default null, p_note text default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_role public.app_role := public.my_role(); v_token text; v_id uuid; v_exp timestamptz;
begin
  if v_role is null then raise exception 'not_approved' using errcode = '42501'; end if;
  if p_kind not in ('servant', 'child', 'priest') then raise exception 'invalid_kind' using errcode = '22023'; end if;
  if p_kind = 'priest' and not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_kind = 'servant' and v_role = 'class_servant' then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_kind = 'child' then
    if p_church is null or p_service is null or p_class is null then raise exception 'scope_required' using errcode = '22023'; end if;
    if not public.can_access(p_church, p_service, p_class) then raise exception 'forbidden' using errcode = '42501'; end if;
  elsif p_kind = 'servant' and p_church is not null and not public.scope_contains(p_church, p_service, p_class) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_service is not null and not exists (select 1 from public.services s where s.id = p_service and s.church_id = p_church) then
    raise exception 'service_not_in_church' using errcode = '22023';
  end if;
  if p_class is not null and not exists (select 1 from public.classes c where c.id = p_class and c.service_id = p_service) then
    raise exception 'class_not_in_service' using errcode = '22023';
  end if;
  v_exp := now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 365)));
  v_token := encode(gen_random_bytes(18), 'hex');
  insert into public.signup_invites (kind, token_hash, token, church_id, service_id, class_id, created_by, expires_at, max_uses, note)
  values (p_kind, encode(digest(v_token, 'sha256'), 'hex'), v_token, p_church, p_service, p_class, auth.uid(), v_exp, p_max_uses, nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token, 'kind', p_kind, 'church_id', p_church, 'service_id', p_service, 'class_id', p_class, 'expires_at', v_exp);
end $$;
grant execute on function public.signup_invite_create(text, uuid, uuid, uuid, integer, integer, text) to authenticated;

-- update: validity (days from NOW) · max uses · note · un-revoke.
-- Scope / kind are immutable (make a new invite). Creator or owner only.
create or replace function public.signup_invite_update(
  p_id uuid, p_days integer default null, p_max_uses integer default null, p_clear_max_uses boolean default false,
  p_note text default null, p_reactivate boolean default false
) returns public.signup_invites language plpgsql volatile security definer set search_path = public as $$
declare i public.signup_invites;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into i from public.signup_invites where id = p_id for update;
  if not found then raise exception 'invite_not_found' using errcode = 'P0002'; end if;
  if not (i.created_by = auth.uid() or public.is_owner()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.signup_invites set
    expires_at = case when p_days is not null then now() + make_interval(days => greatest(1, least(p_days, 365))) else expires_at end,
    max_uses   = case when p_clear_max_uses then null when p_max_uses is not null then greatest(1, p_max_uses) else max_uses end,
    note       = case when p_note is not null then nullif(trim(p_note), '') else note end,
    revoked_at = case when p_reactivate then null else revoked_at end,
    updated_at = now()
  where id = p_id returning * into i;
  return i;
end $$;
grant execute on function public.signup_invite_update(uuid, integer, integer, boolean, text, boolean) to authenticated;

-- delete: creator / owner (also covered by the policy above; the RPC adds
-- a clear error instead of a silent 0-row delete)
create or replace function public.signup_invite_delete(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare i public.signup_invites;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into i from public.signup_invites where id = p_id;
  if not found then raise exception 'invite_not_found' using errcode = 'P0002'; end if;
  if not (i.created_by = auth.uid() or public.is_owner()) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.signup_invites where id = p_id;
end $$;
grant execute on function public.signup_invite_delete(uuid) to authenticated;

commit;
