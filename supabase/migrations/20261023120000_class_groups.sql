-- ---------------------------------------------------------------------
-- Class groups: ONE record in the UI that covers several classes.
--
-- A record is still bound to a single class in the database (RLS, attendance,
-- points and the stats functions all rely on that), so a record picked for
-- several classes is stored as one row per class. `group_id` ties those rows
-- together; the app shows / edits / deletes them as one item.
--   group_id is null  → an ordinary single record (all existing rows)
-- Purely additive: nothing reads group_id on the server.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'events', 'causes', 'call_feedbacks', 'card_templates', 'card_print_profiles',
    'achievements', 'exams', 'result_exams', 'occasions', 'online_classes',
    'access_events', 'finance_budgets', 'notification_automations',
    'library_subjects', 'library_books', 'library_lectures'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists group_id uuid', t);
      execute format('create index if not exists %I on public.%I (group_id) where group_id is not null', 'idx_' || t || '_group', t);
    end if;
  end loop;
end $$;
