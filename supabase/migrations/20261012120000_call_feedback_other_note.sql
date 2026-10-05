-- =====================================================================
-- 20261012120000: CALL FEEDBACK «أخرى» — a manually written cause
--
-- The call-feedback picker (opened automatically when the servant comes
-- back to the app after a call) gets a fixed extra choice «أخرى» shown
-- with a «!» icon. Choosing it lets the servant WRITE the cause himself
-- instead of picking one of the predefined `call_feedbacks`.
--
-- Storage: the same `contact_log` row model as 0023 —
--     kind = 'call' · occurrence_on = the followed-up occurrence
--     feedback_id = NULL  (no predefined feedback)
--     note        = the written cause            ← NEW COLUMN
-- The badge shows «أخرى» (!) for such a row; the history modal shows the
-- note text. A row is a FEEDBACK row when `occurrence_on` is set and
-- (feedback_id is not null OR note is not null); a plain dial logged when
-- the call button is pressed has both null (and no occurrence_on).
--
-- Idempotent — safe to re-run. Depends on 0023.
-- =====================================================================

begin;

alter table public.contact_log
  add column if not exists note text;   -- the cause written for «أخرى» (feedback_id is null)

-- A note is a short free text (1..500 chars after trimming)
alter table public.contact_log drop constraint if exists contact_log_note_len;
alter table public.contact_log
  add constraint contact_log_note_len
  check (note is null or char_length(btrim(note)) between 1 and 500);

-- Badge lookup now covers BOTH kinds of feedback rows (predefined + «أخرى»)
drop index if exists public.idx_contact_log_feedback_lookup;
create index if not exists idx_contact_log_followup_lookup
  on public.contact_log(event_id, occurrence_on, enrollment_id, created_at desc)
  where feedback_id is not null or note is not null;

comment on column public.contact_log.note is
  'الافتقاد «أخرى»: السبب المكتوب يدويًا عندما لا تُختار نتيجة معرّفة (feedback_id null)';

analyze public.contact_log;

commit;
