-- =====================================================================
-- ONE CODE SPACE FOR PERSONS AND FAMILIES (كود واحد — شخص أو عائلة)
--
-- A code (QR) identifies EITHER a person (persons.national_id) OR a
-- family (families.code) — never both. The family side has been enforced
-- since 20260924130000 (`families_fill_code` refuses a person code); the
-- person side was only checked inside three RPCs (family_add_new_member ·
-- priest_family_new_member · priest_confessor_new). Every other path that
-- writes persons.national_id — add_person_and_enroll (إضافة مخدوم, bulk
-- import, extra classes), admin_add_servant, servant_signup, the
-- «تغيير الكود» modal (direct update), the servant-account API, the code
-- generator `new_person_code` — could still give a person a family code.
--
-- This migration closes the gap at the ONE place every path goes through:
--
--   1. trigger `persons_code_not_family` (BEFORE INSERT OR UPDATE OF
--      national_id) → `code_is_family` (SQLSTATE 23505) when the code
--      belongs to a family. Same shape as the family trigger: validated
--      only when the code is inserted or actually CHANGED, so an unrelated
--      update of a legacy person never fails on a pre-existing collision.
--   2. `new_person_code()` (generator fallback) skips codes used by a
--      family — same as `family_new_code()` already skips person codes.
--   3. `person_code_lookup(code)` → { code, free, person, family } — the
--      live check for the person-side forms (mirror of family_code_lookup).
--   4. `admin_servant_code_lookup` / `signup_lookup_code` /
--      `child_signup_lookup_code` gain a `family` key so the servant /
--      signup forms can warn before submitting.
--
-- Backup restore (`alter table … disable trigger user`) is unaffected: it
-- disables user triggers while loading, exactly like the family trigger.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. persons trigger — a person code can never equal a family code
-- ---------------------------------------------------------------------
create or replace function public.persons_code_not_family()
returns trigger language plpgsql set search_path = public as $$
declare
  v_code_changed boolean := tg_op = 'INSERT' or new.national_id is distinct from old.national_id;
begin
  if v_code_changed and new.national_id is not null
     and to_regclass('public.families') is not null
     and exists (select 1 from public.families f where f.code = new.national_id) then
    raise exception 'code_is_family' using errcode = '23505',
      detail = 'A person code cannot equal the code of a family',
      hint = new.national_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_persons_code_not_family on public.persons;
create trigger trg_persons_code_not_family
before insert or update of national_id on public.persons
for each row execute function public.persons_code_not_family();

-- ---------------------------------------------------------------------
-- 2. new_person_code — the generated fallback must also be free of families
--    (same body as 0040, one more `exists` in the exit condition)
-- ---------------------------------------------------------------------
create or replace function public.new_person_code(p_church uuid, p_service uuid, p_class uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v text; i int := 0; t jsonb; scopes jsonb;
begin
  t := public.code_template_for('person');
  select value -> 'scopes' into scopes from public.app_settings where key = 'codes';
  loop
    if t is not null then
      v := public.render_code(t, coalesce(scopes, '{}'::jsonb), p_church, p_service, p_class);
      if i > 0 then v := v || '-' || public.random_code_chars(2, 'alnum'); end if;
    end if;
    if v is null then v := 'P-' || public.random_code_chars(8, 'alnum'); end if;
    exit when not exists (select 1 from public.persons p where p.national_id = v)
          and not exists (select 1 from public.families f where f.code = v);
    i := i + 1;
    if i > 20 then raise exception 'person_code_collision'; end if;
    perform pg_sleep(0.001);
  end loop;
  return v;
end $$;
revoke all on function public.new_person_code(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. person_code_lookup(code) — live check while typing / after a scan
--    { code, free, person: {id, name} | null, family: {id, name} | null }
--    Any approved servant may call it (same exposure as
--    find_person_by_national_id — the servant already holds the card).
-- ---------------------------------------------------------------------
create or replace function public.person_code_lookup(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_code text := trim(coalesce(p_code, ''));
  v_per  record;
  v_fam  record;
begin
  if public.my_role() is null then
    raise exception 'not_approved' using errcode = '42501';
  end if;
  if v_code = '' then
    return jsonb_build_object('code', '', 'free', false, 'person', null, 'family', null);
  end if;
  select id, name into v_per from public.persons  where national_id = v_code;
  select id, name into v_fam from public.families where code = v_code;
  return jsonb_build_object(
    'code', v_code,
    'free', (v_per.id is null and v_fam.id is null),
    'person', case when v_per.id is null then null else jsonb_build_object('id', v_per.id, 'name', v_per.name) end,
    'family', case when v_fam.id is null then null else jsonb_build_object('id', v_fam.id, 'name', v_fam.name) end
  );
end $$;
revoke all on function public.person_code_lookup(text) from public, anon;
grant execute on function public.person_code_lookup(text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. existing lookups gain a `family` key (name of the family that owns
--    the code, or null) so the forms can refuse the code before submit
-- ---------------------------------------------------------------------
create or replace function public.admin_servant_code_lookup(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when nullif(trim(p_code), '') is null then null
    else jsonb_build_object(
      'user_id', public.code_to_user_id(trim(p_code)),
      'login_taken', exists (select 1 from public.servant_enrollments s
                              where s.user_id = public.code_to_user_id(trim(p_code))),
      'person', (
        select jsonb_build_object(
          'name', p.name, 'gender', p.gender, 'birthdate', p.birthdate,
          'phone', p.phone, 'address', p.address, 'notes', p.notes, 'image_url', p.image_url,
          'has_account', exists (select 1 from public.servant_enrollments s where s.person_id = p.id))
        from public.persons p where p.national_id = trim(p_code) limit 1),
      'family', (select f.name from public.families f where f.code = trim(p_code) limit 1)
    )
  end
$$;
revoke all on function public.admin_servant_code_lookup(text) from public, anon;
grant execute on function public.admin_servant_code_lookup(text) to authenticated;

-- servant self-signup («الكود» step): the person (if any) + is it a family code
create or replace function public.signup_lookup_code(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when nullif(trim(p_code), '') is null then null
    else coalesce(
      (select jsonb_build_object(
          'name', p.name, 'gender', p.gender, 'birthdate', p.birthdate,
          'phone', p.phone, 'address', p.address, 'image_url', p.image_url,
          'has_account', exists (select 1 from public.servant_enrollments s where s.person_id = p.id))
         from public.persons p where p.national_id = trim(p_code) limit 1),
      case when exists (select 1 from public.families f where f.code = trim(p_code))
           then jsonb_build_object('family', true) end)
  end
$$;
grant execute on function public.signup_lookup_code(text) to anon, authenticated;

-- child self-signup («الكود» step)
create or replace function public.child_signup_lookup_code(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when nullif(trim(p_code), '') is null then null
    else jsonb_build_object(
      'exists', exists (select 1 from public.persons p where p.national_id = trim(p_code)),
      'has_password', exists (select 1 from public.persons p join public.person_credentials c on c.person_id = p.id
                               where p.national_id = trim(p_code)),
      'pending', exists (select 1 from public.child_join_requests r where r.code = trim(p_code) and r.status = 'pending'),
      'name', (select p.name from public.persons p where p.national_id = trim(p_code) limit 1),
      'family', exists (select 1 from public.families f where f.code = trim(p_code))
    )
  end
$$;
grant execute on function public.child_signup_lookup_code(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Report (NOTICE only) — legacy collisions that exist today. They are
--    NOT touched (which side should give up its code is a human decision);
--    the owner sees them in the migration log and fixes them from the app.
-- ---------------------------------------------------------------------
do $$
declare r record; n int := 0;
begin
  for r in select p.national_id as code, p.name as person, f.name as family
             from public.persons p join public.families f on f.code = p.national_id
  loop
    n := n + 1;
    raise notice 'code shared by person and family: % (person «%», family «%») — change one of them', r.code, r.person, r.family;
  end loop;
  if n > 0 then
    raise notice '% code(s) are used by both a person and a family — new / edited codes are refused from now on', n;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
