-- =====================================================================
-- FAMILIES — the OWNER and the CHURCH MANAGER manage them too
-- (العائلات — مالك التطبيق ومدير الكنيسة يضيفان العائلات بجانب الكاهن)
--
-- Since 20260928120000 the families were created and managed only by the
-- PRIEST (his portal). The servants' app kept a read-only list. Now, when
-- the owner has opened the family module (module_access 'family'):
--
--   * مالك التطبيق (owner)         → creates / edits / deletes ANY family,
--                                    chooses the church of a new family
--   * مدير الكنيسة (church manager) → creates / edits / deletes the families
--                                    OF HIS CHURCH (church_id is filled
--                                    automatically from his scope)
--   * everybody else in the servants' app → read only (as before)
--   * the priest portal → unchanged (token RPCs, its own visibility)
--
-- Changes
--   1. family_can('family.manage') = module visible AND (owner OR church
--      manager). The service manager and the 'family.manage' permission
--      key no longer grant management (the module moved to the priest /
--      the church level). 'family.view' is unchanged.
--   2. families_fill_church trigger — a family created from the servants'
--      app by a church manager gets his church; the owner must pick one
--      (church_required) unless the place chain already fixes it. A church
--      manager can't create a family in another church (church_forbidden).
--   3. family_visible(id) — a family OF the caller's church (church_id) is
--      visible to him (church manager / any servant of that church), in
--      addition to the older rules (owner · creator · member in scope).
--   4. RLS update / delete — a church manager may only touch families of
--      his church (or that he created).
--   5. family_manage_churches() → the churches the caller may create a
--      family in (owner: all · church manager: his) — for the form.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. permission
-- ---------------------------------------------------------------------
create or replace function public.family_can(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.module_visible('family')
     and (
       p_key = 'family.view'
       or (p_key = 'family.manage'
           and exists (select 1 from public.my_scopes() s where s.role in ('owner', 'church_manager')))
       or (p_key not in ('family.view', 'family.manage') and public.has_permission(p_key))
     )
$$;
grant execute on function public.family_can(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. church of a family created from the servants' app
-- ---------------------------------------------------------------------
create or replace function public.family_manage_churches()
returns setof uuid language sql stable security definer set search_path = public as $$
  select c.id from public.churches c
   where public.module_visible('family')
     and (public.is_owner()
          or exists (select 1 from public.my_scopes() s where s.role = 'church_manager' and s.church_id = c.id))
   order by c.sort_order, c.name
$$;
grant execute on function public.family_manage_churches() to authenticated;

create or replace function public.families_fill_church()
returns trigger language plpgsql set search_path = public as $$
declare v_churches uuid[];
begin
  -- the priest portal (created_by_priest) and the backup restore are not concerned
  if auth.uid() is null or new.created_by_priest is not null then return new; end if;
  if tg_op = 'UPDATE' and new.church_id is not distinct from old.church_id then return new; end if;
  -- families_fill_place (earlier trigger, alphabetical order) may already have
  -- derived the church from area → street → building
  select array_agg(id) into v_churches from public.family_manage_churches();
  if new.church_id is null then
    if v_churches is null then return new; end if;              -- not a manager → RLS decides
    if cardinality(v_churches) = 1 then
      new.church_id := v_churches[1];                            -- church manager of ONE church: his church
    else
      -- the owner, or a manager of several churches, must choose
      raise exception 'church_required' using errcode = '22023',
        detail = 'Choose the church of the family';
    end if;
  elsif not public.is_owner() and not (new.church_id = any (coalesce(v_churches, '{}'::uuid[]))) then
    raise exception 'church_forbidden' using errcode = '42501',
      detail = 'A church manager can only create families in his own church';
  end if;
  return new;
end $$;

-- Postgres fires the BEFORE triggers of one event in NAME order; this one
-- must run AFTER trg_families_fill_place (which may derive the church from
-- the area) — hence the "zz" in its name.
drop trigger if exists trg_families_zz_fill_church on public.families;
create trigger trg_families_zz_fill_church before insert or update on public.families
for each row execute function public.families_fill_church();

-- ---------------------------------------------------------------------
-- 3. visibility — the CHURCH MANAGER sees every family of his church
--    (also an empty one the priest created); other servants keep the
--    older rule (creator · a member enrolled in their scope)
-- ---------------------------------------------------------------------
create or replace function public.family_visible(p_family uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner()
      or exists (select 1 from public.families f where f.id = p_family and f.created_by = auth.uid())
      or exists (select 1 from public.families f join public.my_scopes() s
                    on s.role = 'church_manager' and s.church_id = f.church_id
                  where f.id = p_family)
      or exists (
        select 1
          from public.family_members m
          join public.enrollments e on e.person_id = m.person_id
         where m.family_id = p_family
           and public.can_access(e.church_id, e.service_id, e.class_id)
      )
$$;
grant execute on function public.family_visible(uuid) to authenticated;

-- a manager may CHANGE a family only when it is his church's (or he created it)
create or replace function public.family_manageable(p_family uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.family_can('family.manage') and (
      public.is_owner()
      or exists (select 1 from public.families f where f.id = p_family and f.created_by = auth.uid())
      or exists (select 1 from public.families f join public.my_scopes() s
                    on s.role = 'church_manager' and s.church_id = f.church_id
                  where f.id = p_family)
  )
$$;
grant execute on function public.family_manageable(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------
drop policy if exists families_update on public.families;
create policy families_update on public.families for update using (
  (select public.family_can('family.manage')) and (created_by = auth.uid() or public.family_manageable(id))
) with check (
  (select public.family_can('family.manage'))
);
drop policy if exists families_delete on public.families;
create policy families_delete on public.families for delete using (
  (select public.family_can('family.manage')) and (created_by = auth.uid() or public.family_manageable(id))
);

drop policy if exists family_members_insert on public.family_members;
create policy family_members_insert on public.family_members for insert with check (
  public.family_manageable(family_id)
);
drop policy if exists family_members_update on public.family_members;
create policy family_members_update on public.family_members for update using (
  public.family_manageable(family_id)
);
drop policy if exists family_members_delete on public.family_members;
create policy family_members_delete on public.family_members for delete using (
  public.family_manageable(family_id)
);

-- the member RPCs: manage right on THAT family (not only the module)
create or replace function public.family_add_member(
  p_family   uuid,
  p_person   uuid,
  p_relation text default null,
  p_move     boolean default false
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_person  public.persons%rowtype;
  v_other   public.families%rowtype;
  v_member  public.family_members%rowtype;
  v_moved   jsonb := null;
begin
  if not public.family_can('family.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.families f where f.id = p_family) then
    raise exception 'family_not_found' using errcode = 'P0001';
  end if;
  if not public.family_manageable(p_family) then
    raise exception 'no_access' using errcode = '42501';
  end if;
  if p_relation is not null and p_relation not in (
    'father', 'mother', 'son', 'daughter', 'brother', 'sister',
    'grandfather', 'grandmother', 'husband', 'wife', 'other') then
    raise exception 'invalid_relation' using errcode = '22023';
  end if;

  select * into v_person from public.persons p where p.id = p_person;
  if not found then
    raise exception 'person_not_found' using errcode = 'P0002';
  end if;

  select * into v_member from public.family_members m where m.person_id = v_person.id;
  if found then
    if v_member.family_id = p_family then
      raise exception 'already_member' using errcode = 'P0001';
    end if;
    select * into v_other from public.families f where f.id = v_member.family_id;
    if not p_move then
      raise exception 'in_other_family' using errcode = 'P0001',
        detail = coalesce(v_other.name, ''), hint = v_member.family_id::text;
    end if;
    delete from public.family_members where id = v_member.id;
    v_moved := jsonb_build_object('id', v_other.id, 'name', v_other.name);
  end if;

  insert into public.family_members (family_id, person_id, relation, created_by)
  values (p_family, v_person.id, p_relation, auth.uid())
  returning * into v_member;

  update public.families set edited_at = now(), edited_by = auth.uid() where id = p_family;

  return jsonb_build_object(
    'member_id', v_member.id,
    'relation',  v_member.relation,
    'person',    to_jsonb(v_person),
    'moved_from', v_moved
  );
end $$;
revoke all on function public.family_add_member(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.family_add_member(uuid, uuid, text, boolean) to authenticated;

-- family_add_new_member / family_add_member_by_code delegate to
-- family_add_member, so the manageable check above covers them too (the
-- whole call is one transaction — a refused add creates no person).

-- ---------------------------------------------------------------------
-- 5. back-fill — the church of a legacy family with a single church of members
--    (repeat of 20260928120000 / 150000 — no-op where already done)
-- ---------------------------------------------------------------------
update public.families f set church_id = x.church_id
  from (select m.family_id, min(e.church_id::text)::uuid as church_id
          from public.family_members m join public.enrollments e on e.person_id = m.person_id
         group by m.family_id having count(distinct e.church_id) = 1) x
 where f.id = x.family_id and f.church_id is null;

notify pgrst, 'reload schema';

commit;
