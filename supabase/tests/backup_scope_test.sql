-- =====================================================================
-- Functional test for migration 20261009120000 (scoped backups —
-- نسخة احتياطية لكنيسة / خدمة / فصل).
--   psql -d app -f supabase/tests/backup_scope_test.sql
-- Ends with «BACKUP SCOPE TESTS PASSED». Self-contained (own rows,
-- rolled back at the end) — runs on an empty DB or on top of the seed.
-- =====================================================================
\set ON_ERROR_STOP on
begin;

-- two churches, each: service → class, a child, a servant, attendance,
-- a church-wide cause, a church-wide event (null service / class)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a001', 'owner-sc@diocese.app'),
  ('00000000-0000-0000-0000-00000000a002', 'servant-a@diocese.app'),
  ('00000000-0000-0000-0000-00000000a003', 'servant-b@diocese.app');
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-00000000a001', 'كنيسة أ (scope)'),
  ('10000000-0000-0000-0000-00000000a002', 'كنيسة ب (scope)');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-00000000a001', '10000000-0000-0000-0000-00000000a001', 'خدمة أ١'),
  ('20000000-0000-0000-0000-00000000a002', '10000000-0000-0000-0000-00000000a001', 'خدمة أ٢'),
  ('20000000-0000-0000-0000-00000000a003', '10000000-0000-0000-0000-00000000a002', 'خدمة ب١');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-00000000a001', '10000000-0000-0000-0000-00000000a001', '20000000-0000-0000-0000-00000000a001', 'فصل أ١-١'),
  ('30000000-0000-0000-0000-00000000a002', '10000000-0000-0000-0000-00000000a001', '20000000-0000-0000-0000-00000000a001', 'فصل أ١-٢'),
  ('30000000-0000-0000-0000-00000000a003', '10000000-0000-0000-0000-00000000a001', '20000000-0000-0000-0000-00000000a002', 'فصل أ٢-١'),
  ('30000000-0000-0000-0000-00000000a004', '10000000-0000-0000-0000-00000000a002', '20000000-0000-0000-0000-00000000a003', 'فصل ب١-١');
insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-00000000a001', 'المالك', 'owner-sc', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-00000000a002', 'خادم أ', 'servant-a', '0102', 'class_servant', 'approved',
   '10000000-0000-0000-0000-00000000a001', '20000000-0000-0000-0000-00000000a001', '30000000-0000-0000-0000-00000000a001', now()),
  ('00000000-0000-0000-0000-00000000a003', 'خادم ب', 'servant-b', '0103', 'class_servant', 'approved',
   '10000000-0000-0000-0000-00000000a002', '20000000-0000-0000-0000-00000000a003', '30000000-0000-0000-0000-00000000a004', now());
insert into public.persons (id, national_id, name) values
  ('40000000-0000-0000-0000-00000000a001', '99900000000001', 'مخدوم أ١-١'),
  ('40000000-0000-0000-0000-00000000a002', '99900000000002', 'مخدوم أ١-٢'),
  ('40000000-0000-0000-0000-00000000a003', '99900000000003', 'مخدوم أ٢-١'),
  ('40000000-0000-0000-0000-00000000a004', '99900000000004', 'مخدوم ب'),
  ('40000000-0000-0000-0000-00000000a005', '99900000000005', 'شخص بلا تسجيل');
insert into public.enrollments (id, person_id, church_id, service_id, class_id) values
  ('50000000-0000-0000-0000-00000000a001', '40000000-0000-0000-0000-00000000a001', '10000000-0000-0000-0000-00000000a001', '20000000-0000-0000-0000-00000000a001', '30000000-0000-0000-0000-00000000a001'),
  ('50000000-0000-0000-0000-00000000a002', '40000000-0000-0000-0000-00000000a002', '10000000-0000-0000-0000-00000000a001', '20000000-0000-0000-0000-00000000a001', '30000000-0000-0000-0000-00000000a002'),
  ('50000000-0000-0000-0000-00000000a003', '40000000-0000-0000-0000-00000000a003', '10000000-0000-0000-0000-00000000a001', '20000000-0000-0000-0000-00000000a002', '30000000-0000-0000-0000-00000000a003'),
  ('50000000-0000-0000-0000-00000000a004', '40000000-0000-0000-0000-00000000a004', '10000000-0000-0000-0000-00000000a002', '20000000-0000-0000-0000-00000000a003', '30000000-0000-0000-0000-00000000a004');
insert into public.causes (id, church_id, name, points) values
  ('60000000-0000-0000-0000-00000000a001', '10000000-0000-0000-0000-00000000a001', 'سبب كنيسة أ', 5),
  ('60000000-0000-0000-0000-00000000a002', '10000000-0000-0000-0000-00000000a002', 'سبب كنيسة ب', 5);
insert into public.events (id, church_id, service_id, class_id, name) values
  ('70000000-0000-0000-0000-00000000a001', '10000000-0000-0000-0000-00000000a001', null, null, 'مناسبة كنيسة أ (عامة)'),
  ('70000000-0000-0000-0000-00000000a002', '10000000-0000-0000-0000-00000000a001', '20000000-0000-0000-0000-00000000a001', null, 'مناسبة خدمة أ١'),
  ('70000000-0000-0000-0000-00000000a003', '10000000-0000-0000-0000-00000000a002', null, null, 'مناسبة كنيسة ب');
insert into public.attendance_log (enrollment_id, event_id, recorded_by) values
  ('50000000-0000-0000-0000-00000000a001', '70000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-00000000a002'),
  ('50000000-0000-0000-0000-00000000a002', '70000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-00000000a002'),
  ('50000000-0000-0000-0000-00000000a004', '70000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a003');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000a001';
set local request.jwt.claim.role = 'authenticated';

-- helpers: rows of a table in a scope (catalogue) · ids dumped in a scope
create or replace function pg_temp.rows_in(p_table text, p_scope jsonb) returns int language sql as $$
  select (e->>'rows')::int from jsonb_array_elements(public.backup_tables(p_scope)) e where e->>'name' = p_table
$$;
create or replace function pg_temp.ids(p_table text, p_scope jsonb) returns text[] language sql as $$
  select coalesce(array_agg(e->>'id' order by e->>'id'), '{}') from jsonb_array_elements(public.backup_dump_table(p_table, 0, 2000, p_scope)) e
$$;
-- child enrollments only (the servant trigger adds `kind = servant` mirror rows)
create or replace function pg_temp.child_enrollments(p_scope jsonb) returns text[] language sql as $$
  select coalesce(array_agg(e->>'id' order by e->>'id'), '{}') from jsonb_array_elements(public.backup_dump_table('enrollments', 0, 2000, p_scope)) e where e->>'kind' = 'child'
$$;

-- ---------- A. scope check / describe ----------
do $$
declare sc jsonb;
begin
  if public.backup_scope_check(null) is not null then raise exception 'null scope must stay null'; end if;
  if public.backup_scope_check('{}') is not null then raise exception 'empty scope must be null'; end if;
  if public.backup_scope_check('{"church_id": null, "service_id": null, "class_id": null}') is not null then raise exception 'all-null scope must be null'; end if;
  sc := public.backup_scope_check('{"class_id": "30000000-0000-0000-0000-00000000a003"}');
  if sc->>'church_id' <> '10000000-0000-0000-0000-00000000a001' or sc->>'service_id' <> '20000000-0000-0000-0000-00000000a002' then raise exception 'parents not filled: %', sc; end if;
  begin
    perform public.backup_scope_check('{"class_id": "30000000-0000-0000-0000-00000000a003", "service_id": "20000000-0000-0000-0000-00000000a001"}');
    raise exception 'mismatch must fail';
  exception when others then if sqlerrm not like 'bad_scope%' then raise; end if; end;
  begin
    perform public.backup_scope_check('{"church_id": "10000000-0000-0000-0000-00000000ffff"}');
    raise exception 'unknown church must fail';
  exception when others then if sqlerrm not like 'bad_scope%' then raise; end if; end;
  begin
    perform public.backup_scope_check('{"church_id": "not-a-uuid"}');
    raise exception 'bad uuid must fail';
  exception when others then if sqlerrm not like 'bad_scope%' then raise; end if; end;
  sc := public.backup_scope_describe('{"class_id": "30000000-0000-0000-0000-00000000a001"}');
  if sc->>'level' <> 'class' or sc->>'label' <> 'كنيسة أ (scope) ← خدمة أ١ ← فصل أ١-١' then raise exception 'describe wrong: %', sc; end if;
  sc := public.backup_scope_describe('{"service_id": "20000000-0000-0000-0000-00000000a001"}');
  if sc->>'level' <> 'service' or sc->>'class_name' is not null then raise exception 'describe service wrong: %', sc; end if;
end $$;

-- ---------- B. the structure follows the branch ----------
do $$
declare c jsonb := '{"church_id": "10000000-0000-0000-0000-00000000a001"}';
        s jsonb := '{"service_id": "20000000-0000-0000-0000-00000000a001"}';
        k jsonb := '{"class_id": "30000000-0000-0000-0000-00000000a001"}';
begin
  if pg_temp.ids('churches', c) <> array['10000000-0000-0000-0000-00000000a001'] then raise exception 'church scope: churches %', pg_temp.ids('churches', c); end if;
  if cardinality(pg_temp.ids('services', c)) <> 2 then raise exception 'church scope: services'; end if;
  if cardinality(pg_temp.ids('classes', c)) <> 3 then raise exception 'church scope: classes'; end if;
  if pg_temp.ids('churches', s) <> array['10000000-0000-0000-0000-00000000a001'] then raise exception 'service scope: churches'; end if;
  if pg_temp.ids('services', s) <> array['20000000-0000-0000-0000-00000000a001'] then raise exception 'service scope: services'; end if;
  if cardinality(pg_temp.ids('classes', s)) <> 2 then raise exception 'service scope: classes'; end if;
  if pg_temp.ids('services', k) <> array['20000000-0000-0000-0000-00000000a001'] then raise exception 'class scope: services'; end if;
  if pg_temp.ids('classes', k) <> array['30000000-0000-0000-0000-00000000a001'] then raise exception 'class scope: classes'; end if;
  if not (select (e->>'scoped')::bool from jsonb_array_elements(public.backup_tables(c)) e where e->>'name' = 'classes') then raise exception 'classes must be scoped'; end if;
  if (select (e->>'scoped')::bool from jsonb_array_elements(public.backup_tables(c)) e where e->>'name' = 'app_settings') then raise exception 'app_settings must not be scoped'; end if;
  if (select (e->>'scoped')::bool from jsonb_array_elements(public.backup_tables()) e where e->>'name' = 'classes') then raise exception 'unscoped catalogue must say scoped=false'; end if;
end $$;

-- ---------- C. scope columns + null = shared rows ----------
do $$
declare c jsonb := '{"church_id": "10000000-0000-0000-0000-00000000a001"}';
        s jsonb := '{"service_id": "20000000-0000-0000-0000-00000000a001"}';
        k jsonb := '{"class_id": "30000000-0000-0000-0000-00000000a001"}';
        ev text[];
begin
  if pg_temp.child_enrollments(c) <> array['50000000-0000-0000-0000-00000000a001','50000000-0000-0000-0000-00000000a002','50000000-0000-0000-0000-00000000a003'] then raise exception 'church enrollments %', pg_temp.child_enrollments(c); end if;
  if pg_temp.child_enrollments(s) <> array['50000000-0000-0000-0000-00000000a001','50000000-0000-0000-0000-00000000a002'] then raise exception 'service enrollments'; end if;
  if pg_temp.child_enrollments(k) <> array['50000000-0000-0000-0000-00000000a001'] then raise exception 'class enrollments'; end if;
  -- the servant's mirror enrollment (kind = servant) follows its class too
  if (select count(*) from jsonb_array_elements(public.backup_dump_table('enrollments', 0, 2000, k)) e where e->>'kind' = 'servant') <> 1 then raise exception 'servant mirror enrollment of the class missing'; end if;
  if (select count(*) from jsonb_array_elements(public.backup_dump_table('enrollments', 0, 2000, c)) e where e->>'kind' = 'servant' and e->>'church_id' <> '10000000-0000-0000-0000-00000000a001') <> 0 then raise exception 'servant mirror of church B leaked'; end if;
  if pg_temp.ids('causes', k) <> array['60000000-0000-0000-0000-00000000a001'] then raise exception 'class scope causes %', pg_temp.ids('causes', k); end if;
  ev := pg_temp.ids('events', k);
  if not ('70000000-0000-0000-0000-00000000a001' = any(ev)) then raise exception 'church-wide event must be included in its class'; end if;
  if not ('70000000-0000-0000-0000-00000000a002' = any(ev)) then raise exception 'service event must be included in its class'; end if;
  if '70000000-0000-0000-0000-00000000a003' = any(ev) then raise exception 'church B event leaked'; end if;
  if not ('00000000-0000-0000-0000-00000000a001' = any(pg_temp.ids('servant_enrollments', k))) then raise exception 'owner must be in every scope'; end if;
  if '00000000-0000-0000-0000-00000000a003' = any(pg_temp.ids('servant_enrollments', c)) then raise exception 'servant B leaked'; end if;
  -- (counted among the test accounts only — the seed may add its own owner)
  if (select count(*) from jsonb_array_elements(public.backup_dump_auth_users(k)) e where e->>'email' in ('owner-sc@diocese.app', 'servant-a@diocese.app')) <> 2 then raise exception 'auth users of class scope'; end if;
  if (select count(*) from jsonb_array_elements(public.backup_dump_auth_users(k)) e where e->>'email' = 'servant-b@diocese.app') <> 0 then raise exception 'auth user B leaked'; end if;
end $$;

-- ---------- D. persons via references, children via NOT NULL FKs ----------
do $$
declare c jsonb := '{"church_id": "10000000-0000-0000-0000-00000000a001"}';
        k jsonb := '{"class_id": "30000000-0000-0000-0000-00000000a001"}';
        p text[];
begin
  p := pg_temp.ids('persons', k);
  if not ('40000000-0000-0000-0000-00000000a001' = any(p)) then raise exception 'child of the class missing'; end if;
  if '40000000-0000-0000-0000-00000000a002' = any(p) then raise exception 'child of the other class leaked'; end if;
  if '40000000-0000-0000-0000-00000000a005' = any(p) then raise exception 'unenrolled person must not be in a class scope'; end if;
  p := pg_temp.ids('persons', c);
  if '40000000-0000-0000-0000-00000000a004' = any(p) then raise exception 'church B child leaked'; end if;
  if not ('40000000-0000-0000-0000-00000000a003' = any(p)) then raise exception 'church A child of service 2 missing'; end if;
  if pg_temp.rows_in('attendance_log', k) <> 1 then raise exception 'class attendance %', pg_temp.rows_in('attendance_log', k); end if;
  if pg_temp.rows_in('attendance_log', c) <> 2 then raise exception 'church attendance %', pg_temp.rows_in('attendance_log', c); end if;
  if jsonb_array_length(public.backup_dump_table('enrollments', 1, 1, c)) <> 1 then raise exception 'scoped paging'; end if;
  if jsonb_array_length(public.backup_dump_table('enrollments', pg_temp.rows_in('enrollments', c), 10, c)) <> 0 then raise exception 'scoped paging end'; end if;
end $$;

-- ---------- E. every NOT NULL FK of every scoped table resolves inside the scope ----------
-- (the predicate text is evaluated directly here, so this part runs as the
--  table owner — the app only ever reaches the rows through the RPCs)
reset role;
set local request.jwt.claim.role = 'service_role';
do $$
declare e record; cnt bigint; bad text := '';
        scopes jsonb[] := array['{"church_id": "10000000-0000-0000-0000-00000000a001"}'::jsonb,
                                '{"service_id": "20000000-0000-0000-0000-00000000a001"}'::jsonb,
                                '{"class_id": "30000000-0000-0000-0000-00000000a001"}'::jsonb];
        sc jsonb;
begin
  foreach sc in array scopes loop
    for e in
      select c.relname::text child, a.attname::text col, p.relname::text parent, pa.attname::text pcol
        from pg_constraint f join pg_class c on c.oid = f.conrelid join pg_namespace ns on ns.oid = c.relnamespace
        join pg_class p on p.oid = f.confrelid join pg_namespace pn on pn.oid = p.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum = f.conkey[1]
        join pg_attribute pa on pa.attrelid = p.oid and pa.attnum = f.confkey[1]
       where f.contype = 'f' and ns.nspname = 'public' and pn.nspname = 'public' and array_length(f.conkey, 1) = 1
         and a.attnotnull and c.relname not like 'backup\_restore\_%'
    loop
      execute format('select count(*) from public.%1$I t where %2$s and not exists (select 1 from public.%3$I q where q.%4$I = t.%5$I and %6$s)',
        e.child, public.backup_scope_predicate(e.child, sc, 't'), e.parent, e.pcol, e.col, public.backup_scope_predicate(e.parent, sc, 'q')) into cnt;
      if cnt > 0 then bad := bad || format(' %s.%s→%s(%s)', e.child, e.col, e.parent, cnt); end if;
    end loop;
  end loop;
  if bad <> '' then raise exception 'dangling NOT NULL references inside a scope:%', bad; end if;
end $$;

-- ---------- F. a class servant may not use the scoped functions either ----------
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000a002';
do $$
begin
  begin
    perform public.backup_tables('{"church_id": "10000000-0000-0000-0000-00000000a001"}');
    raise exception 'class servant must be refused';
  exception when others then if sqlerrm <> 'not_allowed' then raise; end if; end;
  begin
    perform public.backup_dump_table('enrollments', 0, 10, '{"church_id": "10000000-0000-0000-0000-00000000a001"}');
    raise exception 'class servant must be refused (dump)';
  exception when others then if sqlerrm <> 'not_allowed' then raise; end if; end;
end $$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000a001';

-- ---------- G. restore: scoped file → merge only ----------
do $$
declare jid uuid;
begin
  begin
    perform public.backup_restore_begin('replace', array['churches'], '{"file": {"scope": {"church_id": "10000000-0000-0000-0000-00000000a001"}}}');
    raise exception 'scoped replace must be refused';
  exception when others then if sqlerrm <> 'scoped_replace' then raise; end if; end;
  jid := public.backup_restore_begin('merge', array['churches'], '{"file": {"scope": {"church_id": "10000000-0000-0000-0000-00000000a001"}}}');
  if jid is null then raise exception 'scoped merge must work'; end if;
  perform public.backup_restore_finish(jid, 'failed', 'test');
  jid := public.backup_restore_begin('replace', array['churches'], '{"file": {"scope": null}}');
  if jid is null then raise exception 'unscoped replace must work'; end if;
  perform public.backup_restore_finish(jid, 'failed', 'test');
end $$;

-- ---------- H. scope stored on runs / schedules ----------
do $$
begin
  insert into public.backup_runs (kind, status, tables, scope, created_by)
  values ('manual', 'done', array['churches'], '{"church_id": "10000000-0000-0000-0000-00000000a001"}', auth.uid());
  insert into public.backup_schedules (name, scope, created_by)
  values ('نسخة كنيسة أ', '{"church_id": "10000000-0000-0000-0000-00000000a001"}', auth.uid());
  if (select scope->>'church_id' from public.backup_schedules where name = 'نسخة كنيسة أ') <> '10000000-0000-0000-0000-00000000a001' then raise exception 'schedule scope not stored'; end if;
end $$;

rollback;
\echo BACKUP SCOPE TESTS PASSED
