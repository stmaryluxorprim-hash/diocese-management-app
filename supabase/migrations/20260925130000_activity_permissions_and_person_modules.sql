-- =====================================================================
-- ACTIVITY ITEM PERMISSIONS + MODULE VISIBILITY PER PERSON
--
-- 1. صلاحيات عناصر النشاط — the four coarse keys of the «activity» group
--    (activity.events / causes / feedbacks / data_requests) become
--    FINE-GRAINED keys, each enforced by RLS:
--
--      المناسبات            activity.events.view · add · edit · delete · set_default
--      أسباب النقاط          activity.causes.view · add · edit · delete · set_default
--      نتائج الافتقاد        activity.feedbacks.view · add · edit · delete · reorder
--      طلبات تعديل البيانات   activity.data_requests.view · approve · reject · delete
--
--    Rule (`activity_item_can(key)`):
--      owner / church manager / service manager → everything in their scope
--      (as before — nothing changes for them);
--      class servant → `*.view` is default (he must pick the event on the
--      scanner), every other key needs a permission profile holding EITHER
--      the fine key OR the legacy coarse key (`activity.events` ⇒ all of
--      `activity.events.*`) — so existing profiles keep working.
--    Scope is still bounded by scope_overlaps (read) / scope_contains
--    (write) exactly like before; the permission is an ADDITIONAL wall.
--
--    `is_default` on events / causes and `sort_order` on call_feedbacks
--    are protected by BEFORE triggers (a class servant without
--    `set_default` / `reorder` cannot flip them even when he may edit).
--    `review_data_change_request` checks approve / reject; the dcr
--    delete policy checks `activity.data_requests.delete`.
--
-- 2. الوحدات لأشخاص محددين — `module_access.servant_id`: a grant that
--    targets ONE servant (any scope). `module_visible(key)` is true when a
--    scope grant overlaps the caller OR a person grant names him. The owner
--    adds / removes person grants from /owner/modules («أشخاص محددون»).
--    Scope grants are unchanged (servant_id = null).
--
-- Idempotent; run after 20260925120000_access_control.sql.
-- Test: supabase/tests/activity_permissions_test.sql
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Permission helper
-- ---------------------------------------------------------------------
-- The coarse legacy key of a fine key: 'activity.events.add' → 'activity.events'
create or replace function public.activity_item_legacy_key(p_key text)
returns text language sql immutable as $$
  select case
    when p_key ~ '^activity\.(events|causes|feedbacks|data_requests)\.' then
      regexp_replace(p_key, '^(activity\.[a-z_]+)\..*$', '\1')
    else p_key
  end
$$;

create or replace function public.activity_item_can(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when s.role in ('owner', 'church_manager', 'service_manager') then true
      when s.role = 'class_servant' then
        p_key like '%.view'
        or public.has_permission(p_key)
        or public.has_permission(public.activity_item_legacy_key(p_key))
      else false
    end
    from public.my_scope() s
  ), false)
$$;
grant execute on function public.activity_item_can(text) to authenticated;

create or replace function public.activity_item_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'events', jsonb_build_object(
      'view', public.activity_item_can('activity.events.view'),
      'add', public.activity_item_can('activity.events.add'),
      'edit', public.activity_item_can('activity.events.edit'),
      'delete', public.activity_item_can('activity.events.delete'),
      'set_default', public.activity_item_can('activity.events.set_default')),
    'causes', jsonb_build_object(
      'view', public.activity_item_can('activity.causes.view'),
      'add', public.activity_item_can('activity.causes.add'),
      'edit', public.activity_item_can('activity.causes.edit'),
      'delete', public.activity_item_can('activity.causes.delete'),
      'set_default', public.activity_item_can('activity.causes.set_default')),
    'feedbacks', jsonb_build_object(
      'view', public.activity_item_can('activity.feedbacks.view'),
      'add', public.activity_item_can('activity.feedbacks.add'),
      'edit', public.activity_item_can('activity.feedbacks.edit'),
      'delete', public.activity_item_can('activity.feedbacks.delete'),
      'reorder', public.activity_item_can('activity.feedbacks.reorder')),
    'data_requests', jsonb_build_object(
      'view', public.activity_item_can('activity.data_requests.view'),
      'approve', public.activity_item_can('activity.data_requests.approve'),
      'reject', public.activity_item_can('activity.data_requests.reject'),
      'delete', public.activity_item_can('activity.data_requests.delete'))
  )
$$;
grant execute on function public.activity_item_permissions() to authenticated;

-- ---------------------------------------------------------------------
-- 2. RLS — events
-- ---------------------------------------------------------------------
drop policy if exists events_select on public.events;
create policy events_select on public.events for select using (
  (select public.scope_overlaps(church_id, service_id, class_id))
  and (select public.activity_item_can('activity.events.view'))
);
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert with check (
  (select public.scope_contains(church_id, service_id, class_id))
  and (select public.activity_item_can('activity.events.add'))
);
drop policy if exists events_update on public.events;
create policy events_update on public.events for update using (
  (select public.scope_contains(church_id, service_id, class_id))
  and (select public.activity_item_can('activity.events.edit'))
) with check (
  (select public.scope_contains(church_id, service_id, class_id))
  and (select public.activity_item_can('activity.events.edit'))
);
drop policy if exists events_delete on public.events;
create policy events_delete on public.events for delete using (
  (select public.scope_contains(church_id, service_id, class_id))
  and (select public.activity_item_can('activity.events.delete'))
);

-- is_default needs its own key (guard defined in §3b below, after the 0048
-- cascade functions are re-created so the cascade can mark itself).

-- ---------------------------------------------------------------------
-- 3. RLS — causes
-- ---------------------------------------------------------------------
drop policy if exists causes_select on public.causes;
create policy causes_select on public.causes for select using (
  (select public.scope_overlaps(church_id, service_id, class_id))
  and (select public.activity_item_can('activity.causes.view'))
);
drop policy if exists causes_insert on public.causes;
create policy causes_insert on public.causes for insert with check (
  (select public.scope_contains(church_id, service_id, class_id))
  and (select public.activity_item_can('activity.causes.add'))
);
drop policy if exists causes_update on public.causes;
create policy causes_update on public.causes for update using (
  (select public.scope_contains(church_id, service_id, class_id))
  and (select public.activity_item_can('activity.causes.edit'))
) with check (
  (select public.scope_contains(church_id, service_id, class_id))
  and (select public.activity_item_can('activity.causes.edit'))
);
drop policy if exists causes_delete on public.causes;
create policy causes_delete on public.causes for delete using (
  (select public.scope_contains(church_id, service_id, class_id))
  and (select public.activity_item_can('activity.causes.delete'))
);


-- The 0048 cascade (switch the OTHER default off) runs inside the same
-- statement as an allowed change; it must not trip the guard of the other
-- row. Re-create the 0048 trigger functions so the cascade marks itself.
create or replace function public.check_event_default_scope()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_default and (tg_op = 'INSERT' or not old.is_default
      or old.church_id is distinct from new.church_id
      or old.service_id is distinct from new.service_id
      or old.class_id is distinct from new.class_id) then
    perform set_config('app.default_cascade', '1', true);
    update public.events
       set is_default = false
     where id <> new.id and is_default
       and church_id = new.church_id
       and service_id is not distinct from new.service_id
       and class_id is not distinct from new.class_id;
    perform set_config('app.default_cascade', '', true);
  end if;
  return new;
end $$;

create or replace function public.check_cause_default_scope()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_default and (tg_op = 'INSERT' or not old.is_default
      or old.church_id is distinct from new.church_id
      or old.service_id is distinct from new.service_id
      or old.class_id is distinct from new.class_id) then
    perform set_config('app.default_cascade', '1', true);
    update public.causes
       set is_default = false
     where id <> new.id and is_default
       and church_id = new.church_id
       and service_id is not distinct from new.service_id
       and class_id is not distinct from new.class_id;
    perform set_config('app.default_cascade', '', true);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3b. Default-flag guards: a class servant needs `*.set_default` to turn a
--     default on / off. Skipped when there is no caller (seeds, service
--     role) and for the cascade rows written by the 0048 trigger.
-- ---------------------------------------------------------------------
create or replace function public.guard_event_default_permission()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(current_setting('app.default_cascade', true), '') = '1' then return new; end if;
  if (tg_op = 'INSERT' and new.is_default)
     or (tg_op = 'UPDATE' and new.is_default is distinct from old.is_default) then
    if not public.activity_item_can('activity.events.set_default') then
      raise exception 'permission_denied: activity.events.set_default' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create or replace function public.guard_cause_default_permission()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(current_setting('app.default_cascade', true), '') = '1' then return new; end if;
  if (tg_op = 'INSERT' and new.is_default)
     or (tg_op = 'UPDATE' and new.is_default is distinct from old.is_default) then
    if not public.activity_item_can('activity.causes.set_default') then
      raise exception 'permission_denied: activity.causes.set_default' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_events_default_permission on public.events;
create trigger trg_events_default_permission before insert or update of is_default
  on public.events for each row execute function public.guard_event_default_permission();
drop trigger if exists trg_causes_default_permission on public.causes;
create trigger trg_causes_default_permission before insert or update of is_default
  on public.causes for each row execute function public.guard_cause_default_permission();

-- ---------------------------------------------------------------------
-- 4. RLS — call_feedbacks (+ reorder guard on sort_order)
-- ---------------------------------------------------------------------
drop policy if exists call_feedbacks_select on public.call_feedbacks;
create policy call_feedbacks_select on public.call_feedbacks for select using (
  (select public.scope_overlaps(church_id, service_id, class_id))
  and (select public.activity_item_can('activity.feedbacks.view'))
);
drop policy if exists call_feedbacks_insert on public.call_feedbacks;
create policy call_feedbacks_insert on public.call_feedbacks for insert with check (
  (select public.scope_contains(church_id, service_id, class_id))
  and (select public.activity_item_can('activity.feedbacks.add'))
);
drop policy if exists call_feedbacks_update on public.call_feedbacks;
create policy call_feedbacks_update on public.call_feedbacks for update using (
  (select public.scope_contains(church_id, service_id, class_id))
  and ((select public.activity_item_can('activity.feedbacks.edit'))
       or (select public.activity_item_can('activity.feedbacks.reorder')))
) with check (
  (select public.scope_contains(church_id, service_id, class_id))
  and ((select public.activity_item_can('activity.feedbacks.edit'))
       or (select public.activity_item_can('activity.feedbacks.reorder')))
);
drop policy if exists call_feedbacks_delete on public.call_feedbacks;
create policy call_feedbacks_delete on public.call_feedbacks for delete using (
  (select public.scope_contains(church_id, service_id, class_id))
  and (select public.activity_item_can('activity.feedbacks.delete'))
);

-- On UPDATE: a sort_order change needs `reorder`; any other column needs `edit`.
create or replace function public.guard_feedback_update_permission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_reorder boolean := new.sort_order is distinct from old.sort_order;
  v_other   boolean := (to_jsonb(new) - 'sort_order' - 'edited_at' - 'edited_by')
                       is distinct from (to_jsonb(old) - 'sort_order' - 'edited_at' - 'edited_by');
begin
  if auth.uid() is null then return new; end if;
  if v_reorder and not public.activity_item_can('activity.feedbacks.reorder') then
    raise exception 'permission_denied: activity.feedbacks.reorder' using errcode = '42501';
  end if;
  if v_other and not public.activity_item_can('activity.feedbacks.edit') then
    raise exception 'permission_denied: activity.feedbacks.edit' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_call_feedbacks_update_permission on public.call_feedbacks;
create trigger trg_call_feedbacks_update_permission before update
  on public.call_feedbacks for each row execute function public.guard_feedback_update_permission();

-- ---------------------------------------------------------------------
-- 5. data_change_requests — view / approve / reject / delete
-- ---------------------------------------------------------------------
drop policy if exists dcr_select on public.data_change_requests;
create policy dcr_select on public.data_change_requests for select to authenticated
  using (public.can_access_person(person_id)
         and (select public.activity_item_can('activity.data_requests.view')));

drop policy if exists dcr_delete on public.data_change_requests;
create policy dcr_delete on public.data_change_requests for delete to authenticated
  using (public.can_access_person(person_id)
         and (select public.activity_item_can('activity.data_requests.delete')));

create or replace function public.review_data_change_request(
  p_request uuid, p_approve boolean, p_note text default null)
returns public.data_change_requests
language plpgsql security definer set search_path = public as $$
declare
  r public.data_change_requests;
begin
  select * into r from public.data_change_requests where id = p_request for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0008';
  end if;
  if r.status <> 'pending' then
    raise exception 'not_pending' using errcode = 'P0007';
  end if;
  if not public.can_access_person(r.person_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_approve and not public.activity_item_can('activity.data_requests.approve') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not p_approve and not public.activity_item_can('activity.data_requests.reject') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_approve then
    if r.kind = 'photo' then
      update public.persons
         set image_url = r.changes->>'image_url',
             edited_at = now(), edited_by = auth.uid()
       where id = r.person_id;
    else
      update public.persons
         set name      = case when r.changes ? 'name'      then coalesce(r.changes->>'name', name) else name end,
             birthdate = case when r.changes ? 'birthdate' then (r.changes->>'birthdate')::date else birthdate end,
             gender    = case when r.changes ? 'gender'    then r.changes->>'gender' else gender end,
             phone     = case when r.changes ? 'phone'     then r.changes->>'phone' else phone end,
             address   = case when r.changes ? 'address'   then r.changes->>'address' else address end,
             edited_at = now(), edited_by = auth.uid()
       where id = r.person_id;
    end if;
  end if;

  update public.data_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decision_note = nullif(trim(coalesce(p_note, '')), ''),
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_request
  returning * into r;
  return r;
end $$;
revoke all on function public.review_data_change_request(uuid, boolean, text) from public, anon;
grant execute on function public.review_data_change_request(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Module visibility for SPECIFIC PEOPLE — module_access.servant_id
-- ---------------------------------------------------------------------
alter table public.module_access
  add column if not exists servant_id uuid references public.servant_enrollments(id) on delete cascade;

-- a person grant carries no scope (church/service/class null) — the person
-- sees the module wherever he is.
alter table public.module_access drop constraint if exists module_access_person_no_scope;
alter table public.module_access add constraint module_access_person_no_scope check (
  servant_id is null or (church_id is null and service_id is null and class_id is null)
);

-- one grant per module per person
create unique index if not exists uq_module_access_servant
  on public.module_access (module_key, servant_id) where servant_id is not null;
create index if not exists idx_module_access_servant on public.module_access(servant_id);

-- the old scope-unique index must ignore person grants (they all have null scope)
drop index if exists public.uq_module_access_scope;
create unique index if not exists uq_module_access_scope
  on public.module_access (
    module_key,
    coalesce(church_id,  '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(class_id,   '00000000-0000-0000-0000-000000000000'::uuid)
  ) where servant_id is null;

create or replace function public.module_visible(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select (select public.is_owner())
      or exists (
           select 1 from public.module_access m
            where m.module_key = p_key
              and (
                (m.servant_id is null
                 and (m.church_id is null
                      or public.scope_overlaps(m.church_id, m.service_id, m.class_id)))
                or m.servant_id = auth.uid()
              )
         )
$$;
grant execute on function public.module_visible(text) to authenticated;

-- everyone reads the grants that concern him: scope grants as before + his
-- own person grants (the owner reads all)
drop policy if exists module_access_select on public.module_access;
create policy module_access_select on public.module_access for select using (
  (select public.is_owner())
  or (servant_id is null and (church_id is null
      or (select public.scope_overlaps(church_id, service_id, class_id))))
  or servant_id = auth.uid()
);

-- Child-portal / automation module checks are SCOPE based — a person grant
-- (null scope) must not read as «all churches» there.
create or replace function public.module_granted_for(p_key text, p_church uuid, p_service uuid, p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.module_access m
     where m.module_key = p_key
       and m.servant_id is null
       and (m.church_id is null
            or (m.church_id = p_church
                and (m.service_id is null or m.service_id = p_service)
                and (m.class_id   is null or m.class_id   = p_class)))
  )
$$;
revoke all on function public.module_granted_for(text, uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.notif_module_covers(p_church uuid, p_service uuid, p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.module_access m
     where m.module_key = 'notifications'
       and m.servant_id is null
       and (m.church_id is null
            or (m.church_id = p_church
                and (m.service_id is null or p_service is null or m.service_id = p_service)
                and (m.class_id   is null or p_class   is null or m.class_id   = p_class)))
  )
$$;
revoke all on function public.notif_module_covers(uuid, uuid, uuid) from public, anon, authenticated;

commit;
