-- =====================================================================
-- 20261008120000 — FIX: adding a family from the servants' app failed
--   («تعذر الحفظ … تأكد من تطبيق تحديث قاعدة البيانات» on + عائلة)
--
-- Cause — 20260930130000 introduced the trigger families_fill_church()
-- (fills / validates families.church_id for the owner and the church
-- manager). It read the allowed churches with
--
--     select array_agg(id) into v_churches from public.family_manage_churches();
--
-- but family_manage_churches() returns `setof uuid` — a SCALAR set whose
-- only column is named after the function, not `id`. Postgres therefore
-- raised  ERROR: column "id" does not exist  (SQLSTATE 42703) on EVERY
-- insert into public.families made by a logged-in servant (owner / church
-- manager), and on every update that changes church_id. The priest portal
-- was not affected (the trigger returns early for created_by_priest /
-- auth.uid() is null), which is why only /family broke.
--
-- Fix — same logic, the set is aliased and aggregated correctly. Nothing
-- else changes (church_required / church_forbidden behave as documented).
-- =====================================================================

begin;

create or replace function public.families_fill_church()
returns trigger language plpgsql set search_path = public as $$
declare v_churches uuid[];
begin
  -- the priest portal (created_by_priest) and the backup restore are not concerned
  if auth.uid() is null or new.created_by_priest is not null then return new; end if;
  if tg_op = 'UPDATE' and new.church_id is not distinct from old.church_id then return new; end if;
  -- families_fill_place (earlier trigger, alphabetical order) may already have
  -- derived the church from area → street → building
  select array_agg(c) into v_churches from public.family_manage_churches() as c;
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

-- the trigger itself is unchanged (trg_families_zz_fill_church, created by
-- 20260930130000) — recreate it defensively in case it is missing
drop trigger if exists trg_families_zz_fill_church on public.families;
create trigger trg_families_zz_fill_church before insert or update on public.families
for each row execute function public.families_fill_church();

notify pgrst, 'reload schema';

commit;
