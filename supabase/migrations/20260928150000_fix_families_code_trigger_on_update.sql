-- =====================================================================
-- FIX: migration 20260928120000 fails on databases where an OLD family has
-- a code equal to a person's code.
--
--   ERROR: code_is_person (SQLSTATE 23505)
--   At statement: update public.families f set church_id = …   (backfill)
--
-- Why: `families_fill_code` (20260924130000) runs BEFORE INSERT OR UPDATE
-- and re-validates `new.code` on EVERY update — even when the code is not
-- being touched (the backfill only sets church_id). A legacy family whose
-- code collides with a person (created before the rule existed, or a
-- person who received that code later) therefore aborts the whole
-- migration, and every migration after it stays pending on that project.
--
-- Fix:
--   1. validate the code only when it is INSERTED or actually CHANGED
--      (new.code is distinct from old.code) — an unrelated update never
--      fails on a pre-existing collision. New / edited codes keep the rule.
--   2. re-run the backfill of 20260928120000 (it was never applied there).
--
-- Idempotent — safe on projects where 20260928120000 already succeeded
-- (the backfill then updates 0 rows).
-- =====================================================================

begin;

create or replace function public.families_fill_code()
returns trigger language plpgsql set search_path = public as $$
declare
  v_code_changed boolean := tg_op = 'INSERT' or new.code is distinct from old.code;
begin
  if new.code is null or length(trim(new.code)) = 0 then
    new.code := public.family_new_code();
  else
    new.code := trim(new.code);
    if v_code_changed then
      if length(new.code) > 60 then
        raise exception 'code_too_long' using errcode = '22023';
      end if;
      if exists (select 1 from public.persons p where p.national_id = new.code) then
        raise exception 'code_is_person' using errcode = '23505',
          detail = 'A family code cannot equal the code of a person';
      end if;
    end if;
  end if;
  new.name := trim(new.name);
  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := auth.uid();
  end if;
  if tg_op = 'INSERT' and new.edited_by is null then
    new.edited_by := auth.uid();
  end if;
  return new;
end $$;

-- the backfill of 20260928120000, repeated (no-op where it already ran)
do $$ begin
  if to_regclass('public.family_members') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'families' and column_name = 'church_id') then
    update public.families f set church_id = x.church_id
      from (select m.family_id, min(e.church_id::text)::uuid as church_id
              from public.family_members m join public.enrollments e on e.person_id = m.person_id
             group by m.family_id having count(distinct e.church_id) = 1) x
     where f.id = x.family_id and f.church_id is null;
  end if;
end $$;

commit;
