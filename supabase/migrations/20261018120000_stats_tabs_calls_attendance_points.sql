-- =====================================================================
-- 20261018120000: الإحصائيات بأربع تبويبات — نظرة عامة · الحضور · النقاط · الافتقاد
--
-- The statistics page is rebuilt as FOUR TABS. The overview tab keeps the
-- 0020 / 0042 RPCs; the three detail tabs need PERIOD analytics that did
-- not exist yet. Every function below is an AGGREGATE over a period
-- (p_from..p_to, Cairo days) inside a scope (church / service / class,
-- null = all) and optionally ONE event (p_event). Nothing scales with the
-- number of children on the client side.
--
-- All functions are SECURITY DEFINER with the caller's visibility applied
-- EXPLICITLY through my_scope_sets() (the 20261016120000 pattern — the
-- scope arrays are InitPlans evaluated once per statement), so a class
-- servant only ever aggregates what he may see, and the per-row RLS of
-- events / call_feedbacks / servant_enrollments is not paid 20 k times.
--
-- ---------------------------------------------------------------------
--  الافتقاد (calls) — contact_log, kind = 'call'
--    A row is a DIAL (the call button) or a FEEDBACK (occurrence_on set +
--    feedback_id or note — see 0023 / 20261012120000). «A call» in these
--    statistics = a dial OR a feedback (any contact_log call row); «a
--    feedback» = a feedback row. Every number is also given as distinct
--    PERSONS so a child called 3 times counts once in the coverage %.
--
--    stats_calls_summary      — KPIs of the period (calls, persons reached,
--                               feedbacks, coverage of absentees, messages)
--    stats_calls_by_servant   — per servant (recorded_by): calls, persons,
--                               feedbacks, messages, first / last, classes
--    stats_calls_by_class     — per class: enrolled, absentees, called,
--                               feedbacks, with/without feedback
--    stats_calls_by_feedback  — per feedback outcome (incl. «أخرى» and
--                               «بدون نتيجة»): count, persons, color, icon
--    stats_calls_timeline     — per bucket: calls, persons, feedbacks, messages
--    stats_calls_persons      — WHO was called / WHO wasn't: one row per
--                               person in scope with his calls, last call,
--                               last feedback, absences in the period
--
--  الحضور (attendance) — attendance_log
--    stats_attendance_period_summary — rows, persons, days, average per
--                               day, best / worst day, never-attended count,
--                               rate against expected occurrences
--    stats_attendance_distribution   — histogram: how many persons attended
--                               0,1,2,… times in the period
--    stats_attendance_hour_profile   — attendance per Cairo hour of day
--    stats_attendance_by_class_period — per class over the period
--    stats_attendance_persons        — per person: attendance count,
--                               first / last day, longest absence run
--                               (feeds «الأكثر غياباً» / «المنتظمون»)
--
--  النقاط (points) — points_log + attendance_log.points_delta
--    stats_points_period_summary — added / removed / net, from attendance
--                               vs causes, recipients, average per person
--    stats_points_distribution   — histogram of current balances
--    stats_points_by_class_period — per class over the period
--    stats_points_by_servant     — who granted the points (recorded_by)
--    stats_points_persons        — per person: period net, balance, rank
--
-- Idempotent — safe to re-run. Depends on 20261016120000 (my_scope_sets).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- Indexes for the new access paths
-- ---------------------------------------------------------------------
create index if not exists idx_contact_log_kind_day
  on public.contact_log(kind, contacted_on);
create index if not exists idx_contact_log_recorded_by_day
  on public.contact_log(recorded_by, contacted_on);
create index if not exists idx_contact_log_enrollment_day
  on public.contact_log(enrollment_id, contacted_on);
create index if not exists idx_points_log_recorded_by
  on public.points_log(recorded_by);

-- ---------------------------------------------------------------------
-- Shared: the enrollments of the scope the caller may see.
-- Returns (enrollment id, person id, class id, church id, service id).
-- Inlined by the planner (plain SQL, stable) — p_event narrows to the
-- enrollments the event applies to.
-- ---------------------------------------------------------------------
create or replace function public.stats_scope_enrollments(
  p_church uuid, p_service uuid, p_class uuid, p_kind text, p_event uuid)
returns table (id uuid, person_id uuid, class_id uuid, service_id uuid, church_id uuid)
language sql stable security definer set search_path = public as $$
  with ss as (select * from public.my_scope_sets()),
  ev as (select e.church_id, e.service_id, e.class_id from public.events e where e.id = p_event)
  select e.id, e.person_id, e.class_id, e.service_id, e.church_id
    from public.enrollments e, ss
   where (p_church  is null or e.church_id  = p_church)
     and (p_service is null or e.service_id = p_service)
     and (p_class   is null or e.class_id   = p_class)
     and (coalesce(p_kind, 'child') = 'all' or e.kind = coalesce(p_kind, 'child'))
     and (ss.is_owner
          or e.church_id  = any (coalesce(ss.churches, '{}'::uuid[]))
          or e.service_id = any (coalesce(ss.services, '{}'::uuid[]))
          or e.class_id   = any (coalesce(ss.classes,  '{}'::uuid[])))
     and (p_event is null or exists (
            select 1 from ev
             where ev.church_id = e.church_id
               and (ev.service_id is null or ev.service_id = e.service_id)
               and (ev.class_id   is null or ev.class_id   = e.class_id)))
$$;
grant execute on function public.stats_scope_enrollments(uuid, uuid, uuid, text, uuid) to authenticated;

-- Bucket helper (same semantics as 0020: Cairo day / ISO week / month)
create or replace function public.stats_bucket(p_day date, p_bucket text)
returns date language sql immutable as $$
  select case lower(coalesce(p_bucket, 'day'))
           when 'week'  then date_trunc('week',  p_day::timestamp)::date
           when 'month' then date_trunc('month', p_day::timestamp)::date
           else p_day end
$$;
grant execute on function public.stats_bucket(date, text) to authenticated;

-- Expected occurrences of the scope's events inside a period: for a weekly
-- event the number of its weekdays falling in [from, to]; for a once-event
-- 1 when its date falls inside. Used as the denominator of the attendance
-- rate. With p_event the single event is counted.
create or replace function public.stats_expected_occurrences(
  p_from date, p_to date, p_church uuid, p_service uuid, p_class uuid, p_event uuid)
returns integer language sql stable security definer set search_path = public as $$
  with ss as (select * from public.my_scope_sets()),
  evs as (
    select e.* from public.events e, ss
     where (p_event is null or e.id = p_event)
       and (p_church  is null or e.church_id = p_church)
       and (p_service is null or e.service_id is null or e.service_id = p_service)
       and (p_class   is null or e.class_id   is null or e.class_id   = p_class)
       and (ss.is_owner
            or e.church_id  = any (coalesce(ss.churches, '{}'::uuid[]))
            or e.service_id = any (coalesce(ss.services, '{}'::uuid[]))
            or e.class_id   = any (coalesce(ss.classes,  '{}'::uuid[]))
            or (e.service_id is null and exists (select 1 from public.services s where s.church_id = e.church_id and s.id = any (coalesce(ss.services, '{}'::uuid[]))))
            or (e.class_id   is null and exists (select 1 from public.classes  c where c.church_id = e.church_id and (e.service_id is null or c.service_id = e.service_id) and c.id = any (coalesce(ss.classes, '{}'::uuid[])))))
  ),
  days as (select d::date as d from generate_series(p_from, p_to, interval '1 day') d)
  select coalesce(sum(cnt), 0)::int from (
    select case
             when ev.recurrence = 'once' then
               case when ev.event_date between p_from and p_to then 1 else 0 end
             else
               (select count(*) from days
                 where coalesce(array_length(ev.weekdays, 1), 0) = 0
                    or extract(dow from days.d)::smallint = any (ev.weekdays))
           end as cnt
      from evs ev) x
$$;
grant execute on function public.stats_expected_occurrences(date, date, uuid, uuid, uuid, uuid) to authenticated;

-- =====================================================================
-- A. الافتقاد — CALLS
-- =====================================================================

-- A1. KPIs of the period
drop function if exists public.stats_calls_summary(date, date, uuid, uuid, uuid, uuid, text);
create or replace function public.stats_calls_summary(
  p_from date, p_to date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_event uuid default null, p_kind text default 'child')
returns table (
  calls            bigint,  -- contact_log call rows (dials + feedbacks)
  dials            bigint,  -- plain call-button rows
  feedbacks        bigint,  -- feedback rows (predefined or «أخرى»)
  other_feedbacks  bigint,  -- «أخرى» rows
  persons_called   bigint,  -- distinct persons with ≥1 call
  persons_feedback bigint,  -- distinct persons with ≥1 feedback
  messages         bigint,  -- whatsapp / sms / internal rows
  persons_messaged bigint,
  servants         bigint,  -- distinct recorded_by
  days_with_calls  bigint,
  scope_persons    bigint,  -- denominator
  absentees        bigint,  -- persons in scope with NO attendance in the period
  absentees_called bigint,  -- of those, how many got a call
  attendees_called bigint,  -- persons who attended and were still called
  first_call       timestamptz,
  last_call        timestamptz
)
language sql stable security definer set search_path = public as $$
  with sc as (select * from public.stats_scope_enrollments(p_church, p_service, p_class, p_kind, p_event)),
  cl as (
    select c.*, sc.person_id
      from public.contact_log c join sc on sc.id = c.enrollment_id
     where c.contacted_on between p_from and p_to
       and (p_event is null or c.event_id = p_event)
  ),
  att_persons as (
    select distinct sc.person_id
      from public.attendance_log a join sc on sc.id = a.enrollment_id
     where a.attended_on between p_from and p_to
       and (p_event is null or a.event_id = p_event)
  ),
  called_persons as (select distinct person_id from cl where kind = 'call')
  select
    (select count(*) from cl where kind = 'call'),
    (select count(*) from cl where kind = 'call' and occurrence_on is null and feedback_id is null and note is null),
    (select count(*) from cl where kind = 'call' and occurrence_on is not null and (feedback_id is not null or note is not null)),
    (select count(*) from cl where kind = 'call' and occurrence_on is not null and feedback_id is null and note is not null),
    (select count(*) from called_persons),
    (select count(distinct person_id) from cl where kind = 'call' and occurrence_on is not null and (feedback_id is not null or note is not null)),
    (select count(*) from cl where kind <> 'call'),
    (select count(distinct person_id) from cl where kind <> 'call'),
    (select count(distinct recorded_by) from cl where kind = 'call' and recorded_by is not null),
    (select count(distinct contacted_on) from cl where kind = 'call'),
    (select count(distinct person_id) from sc),
    (select count(distinct sc.person_id) from sc where sc.person_id not in (select person_id from att_persons)),
    (select count(*) from called_persons cp where cp.person_id not in (select person_id from att_persons)),
    (select count(*) from called_persons cp where cp.person_id in (select person_id from att_persons)),
    (select min(created_at) from cl where kind = 'call'),
    (select max(created_at) from cl where kind = 'call')
$$;
grant execute on function public.stats_calls_summary(date, date, uuid, uuid, uuid, uuid, text) to authenticated;

-- A2. Per SERVANT (who made the calls)
drop function if exists public.stats_calls_by_servant(date, date, uuid, uuid, uuid, uuid, text);
create or replace function public.stats_calls_by_servant(
  p_from date, p_to date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_event uuid default null, p_kind text default 'child')
returns table (
  servant_id     uuid,
  servant_name   text,
  photo_url      text,
  role           text,
  class_name     text,     -- the servant's own class (null for managers)
  calls          bigint,
  persons_called bigint,
  feedbacks      bigint,
  other_feedbacks bigint,
  messages       bigint,
  classes_touched bigint,  -- distinct classes of the children he called
  days_active    bigint,
  first_call     timestamptz,
  last_call      timestamptz
)
language sql stable security definer set search_path = public as $$
  with sc as (select * from public.stats_scope_enrollments(p_church, p_service, p_class, p_kind, p_event)),
  cl as (
    select c.*, sc.person_id, sc.class_id as child_class
      from public.contact_log c join sc on sc.id = c.enrollment_id
     where c.contacted_on between p_from and p_to
       and (p_event is null or c.event_id = p_event)
  ),
  grp as (
    select recorded_by,
           count(*) filter (where kind = 'call')::bigint as calls,
           count(distinct person_id) filter (where kind = 'call')::bigint as persons_called,
           count(*) filter (where kind = 'call' and occurrence_on is not null and (feedback_id is not null or note is not null))::bigint as feedbacks,
           count(*) filter (where kind = 'call' and occurrence_on is not null and feedback_id is null and note is not null)::bigint as other_feedbacks,
           count(*) filter (where kind <> 'call')::bigint as messages,
           count(distinct child_class)::bigint as classes_touched,
           count(distinct contacted_on) filter (where kind = 'call')::bigint as days_active,
           min(created_at) filter (where kind = 'call') as first_call,
           max(created_at) filter (where kind = 'call') as last_call
      from cl group by recorded_by
  )
  select g.recorded_by,
         coalesce(se.full_name, 'غير معروف'),
         se.photo_url,
         se.role::text,
         c.name,
         g.calls, g.persons_called, g.feedbacks, g.other_feedbacks, g.messages,
         g.classes_touched, g.days_active, g.first_call, g.last_call
    from grp g
    left join public.servant_enrollments se on se.id = g.recorded_by
    left join public.classes c on c.id = se.class_id
   order by g.calls desc, g.messages desc, se.full_name
$$;
grant execute on function public.stats_calls_by_servant(date, date, uuid, uuid, uuid, uuid, text) to authenticated;

-- A3. Per CLASS — coverage of the class
drop function if exists public.stats_calls_by_class(date, date, uuid, uuid, uuid, uuid, text);
create or replace function public.stats_calls_by_class(
  p_from date, p_to date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_event uuid default null, p_kind text default 'child')
returns table (
  class_id        uuid,
  class_name      text,
  service_name    text,
  church_name     text,
  enrolled        bigint,   -- persons in the class (scope)
  absentees       bigint,   -- persons with no attendance in the period
  calls           bigint,
  persons_called  bigint,
  absentees_called bigint,
  feedbacks       bigint,
  persons_feedback bigint,
  messages        bigint,
  servants        bigint,   -- distinct callers
  last_call       timestamptz
)
language sql stable security definer set search_path = public as $$
  with sc as (select * from public.stats_scope_enrollments(p_church, p_service, p_class, p_kind, p_event)),
  cl as (
    select c.*, sc.person_id, sc.class_id as cid
      from public.contact_log c join sc on sc.id = c.enrollment_id
     where c.contacted_on between p_from and p_to
       and (p_event is null or c.event_id = p_event)
  ),
  att as (
    select distinct sc.class_id as cid, sc.person_id
      from public.attendance_log a join sc on sc.id = a.enrollment_id
     where a.attended_on between p_from and p_to
       and (p_event is null or a.event_id = p_event)
  ),
  absent as (
    select distinct sc.class_id as cid, sc.person_id from sc
     where not exists (select 1 from att where att.cid = sc.class_id and att.person_id = sc.person_id)
  )
  select c.id, c.name, s.name, ch.name,
         (select count(distinct person_id) from sc where sc.class_id = c.id)::bigint,
         (select count(*) from absent where absent.cid = c.id)::bigint,
         (select count(*) from cl where cl.cid = c.id and kind = 'call')::bigint,
         (select count(distinct person_id) from cl where cl.cid = c.id and kind = 'call')::bigint,
         (select count(distinct cl.person_id) from cl join absent ab on ab.cid = cl.cid and ab.person_id = cl.person_id where cl.cid = c.id and cl.kind = 'call')::bigint,
         (select count(*) from cl where cl.cid = c.id and kind = 'call' and occurrence_on is not null and (feedback_id is not null or note is not null))::bigint,
         (select count(distinct person_id) from cl where cl.cid = c.id and kind = 'call' and occurrence_on is not null and (feedback_id is not null or note is not null))::bigint,
         (select count(*) from cl where cl.cid = c.id and kind <> 'call')::bigint,
         (select count(distinct recorded_by) from cl where cl.cid = c.id and kind = 'call' and recorded_by is not null)::bigint,
         (select max(created_at) from cl where cl.cid = c.id and kind = 'call')
    from public.classes c
    join public.services s on s.id = c.service_id
    join public.churches ch on ch.id = c.church_id
   where c.id in (select distinct class_id from sc)
   order by ch.sort_order, ch.name, s.sort_order, s.name, c.sort_order, c.name
$$;
grant execute on function public.stats_calls_by_class(date, date, uuid, uuid, uuid, uuid, text) to authenticated;

-- A4. Per FEEDBACK outcome
drop function if exists public.stats_calls_by_feedback(date, date, uuid, uuid, uuid, uuid, text);
create or replace function public.stats_calls_by_feedback(
  p_from date, p_to date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_event uuid default null, p_kind text default 'child')
returns table (
  feedback_id   uuid,      -- null for «أخرى» (kind = 'other') and «بدون نتيجة» (kind = 'none')
  feedback_kind text,      -- 'feedback' | 'other' | 'none'
  feedback_name text,
  color         text,
  icon          text,
  entries       bigint,
  persons       bigint,
  servants      bigint,
  last_at       timestamptz
)
language sql stable security definer set search_path = public as $$
  with sc as (select * from public.stats_scope_enrollments(p_church, p_service, p_class, p_kind, p_event)),
  cl as (
    select c.*, sc.person_id,
           case when c.occurrence_on is not null and c.feedback_id is not null then 'feedback'
                when c.occurrence_on is not null and c.note is not null then 'other'
                else 'none' end as fk
      from public.contact_log c join sc on sc.id = c.enrollment_id
     where c.kind = 'call'
       and c.contacted_on between p_from and p_to
       and (p_event is null or c.event_id = p_event)
  ),
  grp as (
    select case when fk = 'feedback' then feedback_id end as fid, fk,
           count(*)::bigint as entries,
           count(distinct person_id)::bigint as persons,
           count(distinct recorded_by)::bigint as servants,
           max(created_at) as last_at
      from cl group by 1, 2
  )
  select g.fid, g.fk,
         case g.fk when 'feedback' then coalesce(fb.name, 'نتيجة محذوفة')
                   when 'other' then 'أخرى' else 'بدون نتيجة' end,
         case g.fk when 'feedback' then coalesce(fb.color, '#94a3b8')
                   when 'other' then '#f97316' else '#94a3b8' end,
         case g.fk when 'feedback' then coalesce(fb.icon, 'phone')
                   when 'other' then 'triangle-alert' else 'phone' end,
         g.entries, g.persons, g.servants, g.last_at
    from grp g
    left join public.call_feedbacks fb on fb.id = g.fid
   order by g.entries desc, 3
$$;
grant execute on function public.stats_calls_by_feedback(date, date, uuid, uuid, uuid, uuid, text) to authenticated;

-- A5. Timeline
drop function if exists public.stats_calls_timeline(date, date, text, uuid, uuid, uuid, uuid, text);
create or replace function public.stats_calls_timeline(
  p_from date, p_to date, p_bucket text default 'day',
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_event uuid default null, p_kind text default 'child')
returns table (
  bucket     date,
  calls      bigint,
  persons    bigint,
  feedbacks  bigint,
  messages   bigint,
  servants   bigint
)
language sql stable security definer set search_path = public as $$
  with sc as (select * from public.stats_scope_enrollments(p_church, p_service, p_class, p_kind, p_event)),
  cl as (
    select public.stats_bucket(c.contacted_on, p_bucket) as b, c.kind, c.occurrence_on, c.feedback_id, c.note, c.recorded_by, sc.person_id
      from public.contact_log c join sc on sc.id = c.enrollment_id
     where c.contacted_on between p_from and p_to
       and (p_event is null or c.event_id = p_event)
  )
  select b,
         count(*) filter (where kind = 'call')::bigint,
         count(distinct person_id) filter (where kind = 'call')::bigint,
         count(*) filter (where kind = 'call' and occurrence_on is not null and (feedback_id is not null or note is not null))::bigint,
         count(*) filter (where kind <> 'call')::bigint,
         count(distinct recorded_by) filter (where kind = 'call')::bigint
    from cl group by b order by b
$$;
grant execute on function public.stats_calls_timeline(date, date, text, uuid, uuid, uuid, uuid, text) to authenticated;

-- A6. Persons — who was called and who wasn't
--   p_only: 'all' | 'called' | 'not_called' | 'absent_not_called'
drop function if exists public.stats_calls_persons(date, date, uuid, uuid, uuid, uuid, text, text, int);
create or replace function public.stats_calls_persons(
  p_from date, p_to date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_event uuid default null, p_kind text default 'child',
  p_only text default 'all', p_limit int default 300)
returns table (
  enrollment_id   uuid,
  person_id       uuid,
  name            text,
  phone           text,
  image_url       text,
  class_name      text,
  attended        bigint,   -- attendance rows in the period
  calls           bigint,
  feedbacks       bigint,
  last_call_at    timestamptz,
  last_caller     text,
  last_feedback   text,     -- latest feedback name / «أخرى» note
  last_feedback_color text
)
language sql stable security definer set search_path = public as $$
  with sc as (select * from public.stats_scope_enrollments(p_church, p_service, p_class, p_kind, p_event)),
  cl as (
    select c.*, sc.id as eid
      from public.contact_log c join sc on sc.id = c.enrollment_id
     where c.kind = 'call'
       and c.contacted_on between p_from and p_to
       and (p_event is null or c.event_id = p_event)
  ),
  att as (
    select sc.id as eid, count(*)::bigint as n
      from public.attendance_log a join sc on sc.id = a.enrollment_id
     where a.attended_on between p_from and p_to
       and (p_event is null or a.event_id = p_event)
     group by sc.id
  ),
  agg as (
    select eid, count(*)::bigint as calls,
           count(*) filter (where occurrence_on is not null and (feedback_id is not null or note is not null))::bigint as feedbacks,
           max(created_at) as last_call_at
      from cl group by eid
  ),
  last_row as (
    select distinct on (eid) eid, recorded_by, feedback_id, note
      from cl order by eid, created_at desc
  ),
  last_fb as (
    select distinct on (eid) eid, feedback_id, note
      from cl where occurrence_on is not null and (feedback_id is not null or note is not null)
      order by eid, created_at desc
  ),
  rows_ as (
    select sc.id, sc.person_id, p.name, p.phone, p.image_url, c.name as class_name,
           coalesce(att.n, 0) as attended,
           coalesce(agg.calls, 0) as calls,
           coalesce(agg.feedbacks, 0) as feedbacks,
           agg.last_call_at,
           se.full_name as last_caller,
           case when lf.feedback_id is not null then fb.name else lf.note end as last_feedback,
           case when lf.feedback_id is not null then fb.color when lf.note is not null then '#f97316' end as last_feedback_color
      from sc
      join public.persons p on p.id = sc.person_id
      left join public.classes c on c.id = sc.class_id
      left join att on att.eid = sc.id
      left join agg on agg.eid = sc.id
      left join last_row lr on lr.eid = sc.id
      left join public.servant_enrollments se on se.id = lr.recorded_by
      left join last_fb lf on lf.eid = sc.id
      left join public.call_feedbacks fb on fb.id = lf.feedback_id
  )
  select * from rows_ r
   where case coalesce(p_only, 'all')
           when 'called' then r.calls > 0
           when 'not_called' then r.calls = 0
           when 'absent_not_called' then r.calls = 0 and r.attended = 0
           when 'absent' then r.attended = 0
           else true end
   order by r.calls desc, r.attended, r.name
   limit greatest(1, least(coalesce(p_limit, 300), 2000))
$$;
grant execute on function public.stats_calls_persons(date, date, uuid, uuid, uuid, uuid, text, text, int) to authenticated;

-- =====================================================================
-- B. الحضور — ATTENDANCE over a period
-- =====================================================================

-- B1. Period summary
drop function if exists public.stats_attendance_period_summary(date, date, uuid, uuid, uuid, uuid, text);
create or replace function public.stats_attendance_period_summary(
  p_from date, p_to date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_event uuid default null, p_kind text default 'child')
returns table (
  attendance        bigint,   -- rows
  attendees         bigint,   -- distinct persons who attended ≥ once
  scope_persons     bigint,
  never_attended    bigint,   -- persons with zero attendance in the period
  days_with_attendance bigint,
  expected_occurrences int,   -- scheduled occurrences of the events in scope
  avg_per_day       numeric,  -- attendance / days_with_attendance
  avg_per_person    numeric,  -- attendance / attendees
  best_day          date,
  best_day_count    bigint,
  worst_day         date,
  worst_day_count   bigint,
  points            bigint,   -- points granted with attendance
  males_attended    bigint,
  females_attended  bigint,
  events_used       bigint,
  servants          bigint    -- distinct recorders
)
language sql stable security definer set search_path = public as $$
  with sc as (select * from public.stats_scope_enrollments(p_church, p_service, p_class, p_kind, p_event)),
  att as (
    select a.*, sc.person_id
      from public.attendance_log a join sc on sc.id = a.enrollment_id
     where a.attended_on between p_from and p_to
       and (p_event is null or a.event_id = p_event)
  ),
  per_day as (select attended_on, count(*)::bigint as n from att group by attended_on),
  best as (select * from per_day order by n desc, attended_on desc limit 1),
  worst as (select * from per_day order by n asc, attended_on desc limit 1)
  select
    (select count(*) from att),
    (select count(distinct person_id) from att),
    (select count(distinct person_id) from sc),
    (select count(distinct sc.person_id) from sc where sc.person_id not in (select person_id from att)),
    (select count(*) from per_day),
    public.stats_expected_occurrences(p_from, p_to, p_church, p_service, p_class, p_event),
    (select case when count(*) > 0 then round((select count(*) from att)::numeric / count(*), 1) else 0 end from per_day),
    (select case when count(distinct person_id) > 0 then round(count(*)::numeric / count(distinct person_id), 1) else 0 end from att),
    (select attended_on from best), (select n from best),
    (select attended_on from worst), (select n from worst),
    (select coalesce(sum(points_delta), 0) from att),
    (select count(distinct att.person_id) from att join public.persons p on p.id = att.person_id where p.gender = 'male'),
    (select count(distinct att.person_id) from att join public.persons p on p.id = att.person_id where p.gender = 'female'),
    (select count(distinct event_id) from att where event_id is not null),
    (select count(distinct recorded_by) from att where recorded_by is not null)
$$;
grant execute on function public.stats_attendance_period_summary(date, date, uuid, uuid, uuid, uuid, text) to authenticated;

-- B2. Distribution — how many persons attended N times
drop function if exists public.stats_attendance_distribution(date, date, uuid, uuid, uuid, uuid, text);
create or replace function public.stats_attendance_distribution(
  p_from date, p_to date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_event uuid default null, p_kind text default 'child')
returns table (times int, persons bigint)
language sql stable security definer set search_path = public as $$
  with sc as (select * from public.stats_scope_enrollments(p_church, p_service, p_class, p_kind, p_event)),
  per_person as (
    select sc.person_id, count(a.id)::int as n
      from sc
      left join public.attendance_log a
        on a.enrollment_id = sc.id and a.attended_on between p_from and p_to
       and (p_event is null or a.event_id = p_event)
     group by sc.person_id
  )
  select n, count(*)::bigint from per_person group by n order by n
$$;
grant execute on function public.stats_attendance_distribution(date, date, uuid, uuid, uuid, uuid, text) to authenticated;

-- B3. Hour-of-day profile (Cairo)
drop function if exists public.stats_attendance_hour_profile(date, date, uuid, uuid, uuid, uuid, text);
create or replace function public.stats_attendance_hour_profile(
  p_from date, p_to date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_event uuid default null, p_kind text default 'child')
returns table (hour int, attendance bigint, days bigint)
language sql stable security definer set search_path = public as $$
  with sc as (select * from public.stats_scope_enrollments(p_church, p_service, p_class, p_kind, p_event))
  select extract(hour from (a.created_at at time zone 'Africa/Cairo'))::int,
         count(*)::bigint, count(distinct a.attended_on)::bigint
    from public.attendance_log a join sc on sc.id = a.enrollment_id
   where a.attended_on between p_from and p_to
     and (p_event is null or a.event_id = p_event)
   group by 1 order by 1
$$;
grant execute on function public.stats_attendance_hour_profile(date, date, uuid, uuid, uuid, uuid, text) to authenticated;

-- B4. Per class over the period
drop function if exists public.stats_attendance_by_class_period(date, date, uuid, uuid, uuid, uuid, text);
create or replace function public.stats_attendance_by_class_period(
  p_from date, p_to date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_event uuid default null, p_kind text default 'child')
returns table (
  class_id     uuid,
  class_name   text,
  service_name text,
  church_name  text,
  enrolled     bigint,
  attendees    bigint,   -- distinct persons attended ≥ once
  attendance   bigint,   -- rows
  days         bigint,   -- days with attendance
  points       bigint,
  avg_per_day  numeric
)
language sql stable security definer set search_path = public as $$
  with sc as (select * from public.stats_scope_enrollments(p_church, p_service, p_class, p_kind, p_event)),
  att as (
    select sc.class_id, sc.person_id, a.points_delta, a.attended_on
      from public.attendance_log a join sc on sc.id = a.enrollment_id
     where a.attended_on between p_from and p_to
       and (p_event is null or a.event_id = p_event)
  ),
  g as (
    select class_id, count(distinct person_id)::bigint as attendees, count(*)::bigint as attendance,
           count(distinct attended_on)::bigint as days, coalesce(sum(points_delta), 0)::bigint as points
      from att group by class_id
  )
  select c.id, c.name, s.name, ch.name,
         (select count(distinct person_id) from sc where sc.class_id = c.id)::bigint,
         coalesce(g.attendees, 0), coalesce(g.attendance, 0), coalesce(g.days, 0), coalesce(g.points, 0),
         case when coalesce(g.days, 0) > 0 then round(g.attendance::numeric / g.days, 1) else 0 end
    from public.classes c
    join public.services s on s.id = c.service_id
    join public.churches ch on ch.id = c.church_id
    left join g on g.class_id = c.id
   where c.id in (select distinct class_id from sc)
   order by ch.sort_order, ch.name, s.sort_order, s.name, c.sort_order, c.name
$$;
grant execute on function public.stats_attendance_by_class_period(date, date, uuid, uuid, uuid, uuid, text) to authenticated;

-- B5. Per person — regulars and absentees
--   p_order: 'most' (most attendance first) | 'least' (least first)
drop function if exists public.stats_attendance_persons(date, date, uuid, uuid, uuid, uuid, text, text, int);
create or replace function public.stats_attendance_persons(
  p_from date, p_to date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_event uuid default null, p_kind text default 'child',
  p_order text default 'most', p_limit int default 20)
returns table (
  enrollment_id uuid,
  person_id     uuid,
  name          text,
  image_url     text,
  class_name    text,
  attendance    bigint,
  first_day     date,
  last_day      date,
  days_since_last int,   -- from p_to
  total_attendance int,  -- all-time counter
  points        int
)
language sql stable security definer set search_path = public as $$
  with sc as (select * from public.stats_scope_enrollments(p_church, p_service, p_class, p_kind, p_event)),
  g as (
    select sc.id, count(a.id)::bigint as n, min(a.attended_on) as f, max(a.attended_on) as l
      from sc
      left join public.attendance_log a
        on a.enrollment_id = sc.id and a.attended_on between p_from and p_to
       and (p_event is null or a.event_id = p_event)
     group by sc.id
  )
  select sc.id, sc.person_id, p.name, p.image_url, c.name, g.n, g.f, g.l,
         case when g.l is null then null else (p_to - g.l) end,
         e.attendance_count, e.points
    from sc
    join g on g.id = sc.id
    join public.enrollments e on e.id = sc.id
    join public.persons p on p.id = sc.person_id
    left join public.classes c on c.id = sc.class_id
   order by case when coalesce(p_order, 'most') = 'least' then g.n end asc,
            case when coalesce(p_order, 'most') = 'least' then g.l end asc nulls first,
            g.n desc, g.l desc nulls last, p.name
   limit greatest(1, least(coalesce(p_limit, 20), 500))
$$;
grant execute on function public.stats_attendance_persons(date, date, uuid, uuid, uuid, uuid, text, text, int) to authenticated;

-- =====================================================================
-- C. النقاط — POINTS over a period
-- =====================================================================

-- C1. Period summary
drop function if exists public.stats_points_period_summary(date, date, uuid, uuid, uuid, uuid, text);
create or replace function public.stats_points_period_summary(
  p_from date, p_to date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_event uuid default null, p_kind text default 'child')
returns table (
  attendance_points bigint,   -- from attendance_log
  cause_added       bigint,
  cause_removed     bigint,
  net               bigint,   -- attendance + added − removed
  cause_entries     bigint,
  recipients        bigint,   -- distinct persons with any points movement
  scope_persons     bigint,
  balance_total     bigint,   -- current sum(enrollments.points)
  balance_avg       numeric,
  balance_max       int,
  zero_balance      bigint,   -- persons with 0 points balance
  causes_used       bigint,
  servants          bigint,   -- distinct recorded_by on points_log
  best_day          date,
  best_day_net      bigint
)
language sql stable security definer set search_path = public as $$
  with sc as (select * from public.stats_scope_enrollments(p_church, p_service, p_class, p_kind, p_event)),
  att as (
    select a.points_delta, a.attended_on as d, sc.person_id
      from public.attendance_log a join sc on sc.id = a.enrollment_id
     where a.attended_on between p_from and p_to
       and (p_event is null or a.event_id = p_event)
  ),
  pts as (
    select l.delta, l.cause_id, l.recorded_by, (l.created_at at time zone 'Africa/Cairo')::date as d, sc.person_id
      from public.points_log l join sc on sc.id = l.enrollment_id
     where (l.created_at at time zone 'Africa/Cairo')::date between p_from and p_to
       and (p_event is null or l.event_id = p_event)
  ),
  per_day as (
    select d, sum(v) as v from (
      select d, points_delta as v from att union all select d, delta from pts) x group by d
  ),
  best as (select * from per_day order by v desc, d desc limit 1),
  bal as (select e.points from public.enrollments e join sc on sc.id = e.id)
  select
    (select coalesce(sum(points_delta), 0) from att),
    (select coalesce(sum(delta), 0) from pts where delta > 0),
    (select coalesce(-sum(delta), 0) from pts where delta < 0),
    (select coalesce(sum(points_delta), 0) from att) + (select coalesce(sum(delta), 0) from pts),
    (select count(*) from pts),
    (select count(distinct person_id) from (select person_id from att union all select person_id from pts) u),
    (select count(distinct person_id) from sc),
    (select coalesce(sum(points), 0) from bal),
    (select coalesce(round(avg(points), 1), 0) from bal),
    (select coalesce(max(points), 0) from bal),
    (select count(*) from bal where points <= 0),
    (select count(distinct cause_id) from pts where cause_id is not null),
    (select count(distinct recorded_by) from pts where recorded_by is not null),
    (select d from best), (select v::bigint from best)
$$;
grant execute on function public.stats_points_period_summary(date, date, uuid, uuid, uuid, uuid, text) to authenticated;

-- C2. Distribution of current balances in buckets of p_step points
drop function if exists public.stats_points_distribution(int, uuid, uuid, uuid, uuid, text);
create or replace function public.stats_points_distribution(
  p_step int default 10,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_event uuid default null, p_kind text default 'child')
returns table (bucket_from int, bucket_to int, persons bigint)
language sql stable security definer set search_path = public as $$
  with sc as (select * from public.stats_scope_enrollments(p_church, p_service, p_class, p_kind, p_event)),
  b as (
    select (floor(greatest(e.points, 0)::numeric / greatest(p_step, 1)) * greatest(p_step, 1))::int as f
      from public.enrollments e join sc on sc.id = e.id
  )
  select f, f + greatest(p_step, 1) - 1, count(*)::bigint from b group by f order by f
$$;
grant execute on function public.stats_points_distribution(int, uuid, uuid, uuid, uuid, text) to authenticated;

-- C3. Per class over the period
drop function if exists public.stats_points_by_class_period(date, date, uuid, uuid, uuid, uuid, text);
create or replace function public.stats_points_by_class_period(
  p_from date, p_to date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_event uuid default null, p_kind text default 'child')
returns table (
  class_id     uuid,
  class_name   text,
  service_name text,
  church_name  text,
  enrolled     bigint,
  attendance_points bigint,
  cause_added  bigint,
  cause_removed bigint,
  net          bigint,
  recipients   bigint,
  balance      bigint,     -- current class balance
  avg_balance  numeric
)
language sql stable security definer set search_path = public as $$
  with sc as (select * from public.stats_scope_enrollments(p_church, p_service, p_class, p_kind, p_event)),
  att as (
    select sc.class_id, sc.person_id, a.points_delta as v
      from public.attendance_log a join sc on sc.id = a.enrollment_id
     where a.attended_on between p_from and p_to and (p_event is null or a.event_id = p_event)
  ),
  pts as (
    select sc.class_id, sc.person_id, l.delta as v
      from public.points_log l join sc on sc.id = l.enrollment_id
     where (l.created_at at time zone 'Africa/Cairo')::date between p_from and p_to
       and (p_event is null or l.event_id = p_event)
  ),
  bal as (select sc.class_id, e.points from public.enrollments e join sc on sc.id = e.id)
  select c.id, c.name, s.name, ch.name,
         (select count(distinct person_id) from sc where sc.class_id = c.id)::bigint,
         (select coalesce(sum(v), 0) from att where att.class_id = c.id)::bigint,
         (select coalesce(sum(v), 0) from pts where pts.class_id = c.id and v > 0)::bigint,
         (select coalesce(-sum(v), 0) from pts where pts.class_id = c.id and v < 0)::bigint,
         ((select coalesce(sum(v), 0) from att where att.class_id = c.id) + (select coalesce(sum(v), 0) from pts where pts.class_id = c.id))::bigint,
         (select count(distinct person_id) from (select class_id, person_id from att union all select class_id, person_id from pts) u where u.class_id = c.id)::bigint,
         (select coalesce(sum(points), 0) from bal where bal.class_id = c.id)::bigint,
         (select coalesce(round(avg(points), 1), 0) from bal where bal.class_id = c.id)
    from public.classes c
    join public.services s on s.id = c.service_id
    join public.churches ch on ch.id = c.church_id
   where c.id in (select distinct class_id from sc)
   order by ch.sort_order, ch.name, s.sort_order, s.name, c.sort_order, c.name
$$;
grant execute on function public.stats_points_by_class_period(date, date, uuid, uuid, uuid, uuid, text) to authenticated;

-- C4. Who granted the points (servants)
drop function if exists public.stats_points_by_servant(date, date, uuid, uuid, uuid, uuid, text);
create or replace function public.stats_points_by_servant(
  p_from date, p_to date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_event uuid default null, p_kind text default 'child')
returns table (
  servant_id   uuid,
  servant_name text,
  photo_url    text,
  role         text,
  entries      bigint,
  added        bigint,
  removed      bigint,
  net          bigint,
  recipients   bigint,
  attendance_scans bigint,   -- attendance rows he recorded in the period
  attendance_points bigint,
  last_at      timestamptz
)
language sql stable security definer set search_path = public as $$
  with sc as (select * from public.stats_scope_enrollments(p_church, p_service, p_class, p_kind, p_event)),
  pts as (
    select l.recorded_by, l.delta, l.created_at, sc.person_id
      from public.points_log l join sc on sc.id = l.enrollment_id
     where (l.created_at at time zone 'Africa/Cairo')::date between p_from and p_to
       and (p_event is null or l.event_id = p_event)
  ),
  att as (
    select a.recorded_by, a.points_delta, a.created_at
      from public.attendance_log a join sc on sc.id = a.enrollment_id
     where a.attended_on between p_from and p_to and (p_event is null or a.event_id = p_event)
  ),
  ids as (select recorded_by from pts union select recorded_by from att),
  g as (
    select i.recorded_by,
           (select count(*) from pts where pts.recorded_by is not distinct from i.recorded_by)::bigint as entries,
           (select coalesce(sum(delta), 0) from pts where pts.recorded_by is not distinct from i.recorded_by and delta > 0)::bigint as added,
           (select coalesce(-sum(delta), 0) from pts where pts.recorded_by is not distinct from i.recorded_by and delta < 0)::bigint as removed,
           (select coalesce(sum(delta), 0) from pts where pts.recorded_by is not distinct from i.recorded_by)::bigint as net,
           (select count(distinct person_id) from pts where pts.recorded_by is not distinct from i.recorded_by)::bigint as recipients,
           (select count(*) from att where att.recorded_by is not distinct from i.recorded_by)::bigint as scans,
           (select coalesce(sum(points_delta), 0) from att where att.recorded_by is not distinct from i.recorded_by)::bigint as apts,
           greatest((select max(created_at) from pts where pts.recorded_by is not distinct from i.recorded_by),
                    (select max(created_at) from att where att.recorded_by is not distinct from i.recorded_by)) as last_at
      from ids i
  )
  select g.recorded_by, coalesce(se.full_name, 'غير معروف'), se.photo_url, se.role::text,
         g.entries, g.added, g.removed, g.net, g.recipients, g.scans, g.apts, g.last_at
    from g left join public.servant_enrollments se on se.id = g.recorded_by
   order by (g.added + g.apts) desc, g.entries desc, se.full_name
$$;
grant execute on function public.stats_points_by_servant(date, date, uuid, uuid, uuid, uuid, text) to authenticated;

-- C5. Per person — period net + balance
drop function if exists public.stats_points_persons(date, date, uuid, uuid, uuid, uuid, text, text, int);
create or replace function public.stats_points_persons(
  p_from date, p_to date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_event uuid default null, p_kind text default 'child',
  p_order text default 'period', p_limit int default 20)
returns table (
  enrollment_id uuid,
  person_id     uuid,
  name          text,
  image_url     text,
  class_name    text,
  period_attendance_points bigint,
  period_added  bigint,
  period_removed bigint,
  period_net    bigint,
  balance       int,
  attendance_count int
)
language sql stable security definer set search_path = public as $$
  with sc as (select * from public.stats_scope_enrollments(p_church, p_service, p_class, p_kind, p_event)),
  att as (
    select sc.id, coalesce(sum(a.points_delta), 0)::bigint as v
      from sc join public.attendance_log a on a.enrollment_id = sc.id
     where a.attended_on between p_from and p_to and (p_event is null or a.event_id = p_event)
     group by sc.id
  ),
  pts as (
    select sc.id,
           coalesce(sum(case when l.delta > 0 then l.delta else 0 end), 0)::bigint as plus,
           coalesce(sum(case when l.delta < 0 then -l.delta else 0 end), 0)::bigint as minus
      from sc join public.points_log l on l.enrollment_id = sc.id
     where (l.created_at at time zone 'Africa/Cairo')::date between p_from and p_to
       and (p_event is null or l.event_id = p_event)
     group by sc.id
  )
  select sc.id, sc.person_id, p.name, p.image_url, c.name,
         coalesce(att.v, 0), coalesce(pts.plus, 0), coalesce(pts.minus, 0),
         coalesce(att.v, 0) + coalesce(pts.plus, 0) - coalesce(pts.minus, 0),
         e.points, e.attendance_count
    from sc
    join public.enrollments e on e.id = sc.id
    join public.persons p on p.id = sc.person_id
    left join public.classes c on c.id = sc.class_id
    left join att on att.id = sc.id
    left join pts on pts.id = sc.id
   order by case when coalesce(p_order, 'period') = 'balance' then e.points
                 when p_order = 'removed' then coalesce(pts.minus, 0)
                 else coalesce(att.v, 0) + coalesce(pts.plus, 0) - coalesce(pts.minus, 0) end desc,
            e.points desc, p.name
   limit greatest(1, least(coalesce(p_limit, 20), 500))
$$;
grant execute on function public.stats_points_persons(date, date, uuid, uuid, uuid, uuid, text, text, int) to authenticated;

analyze public.contact_log;
analyze public.points_log;

commit;
