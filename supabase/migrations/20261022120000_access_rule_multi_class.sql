-- Access rules: 'enrolled_in' may now target several classes (params.class_ids).
-- Backward compatible: the legacy single params.class_id is still honoured.

create or replace function public.access_eval_rule(
  p_rule   public.access_rules,
  p_person public.persons,
  p_enr    uuid[],
  p_event  public.access_events
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  pr      jsonb := coalesce(p_rule.params, '{}'::jsonb);
  v_op    text := coalesce(pr ->> 'op', 'gte');
  v_v1    numeric;
  v_v2    numeric;
  v_from  date;
  v_to    date;
  v_num   numeric;
  v_ok    boolean := false;
  v_actual jsonb := 'null'::jsonb;
  v_ids   uuid[];
  v_hit   int;
  v_txt   text;
begin
  -- numeric / date params are parsed only for the kinds that use them
  -- (`value` is a text for gender / person_field)
  if p_rule.kind in ('points', 'attendance_count', 'age') then
    v_v1 := public.access_num(pr ->> 'value');
    v_v2 := public.access_num(pr ->> 'value2');
  end if;
  if p_rule.kind in ('attendance_count', 'attended_events') then
    v_from := public.access_date(pr ->> 'from');
    v_to   := public.access_date(pr ->> 'to');
  end if;

  case p_rule.kind
    when 'points' then
      select coalesce(sum(e.points), 0) into v_num from public.enrollments e where e.id = any(p_enr);
      v_ok := public.access_cmp(v_num, v_op, v_v1, v_v2);
      v_actual := to_jsonb(v_num);

    when 'attendance_count' then
      if v_from is null and v_to is null and nullif(pr ->> 'event_id', '') is null then
        select coalesce(sum(e.attendance_count), 0) into v_num from public.enrollments e where e.id = any(p_enr);
      else
        select count(*) into v_num
          from public.attendance_log a
         where a.enrollment_id = any(p_enr)
           and (v_from is null or a.attended_on >= v_from)
           and (v_to is null or a.attended_on <= v_to)
           and (nullif(pr ->> 'event_id', '') is null or a.event_id = (pr ->> 'event_id')::uuid);
      end if;
      v_ok := public.access_cmp(v_num, v_op, v_v1, v_v2);
      v_actual := to_jsonb(v_num);

    when 'attended_events' then
      select coalesce(array_agg(x::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(pr -> 'event_ids', '[]'::jsonb)) x;
      select count(distinct a.event_id) into v_hit
        from public.attendance_log a
       where a.enrollment_id = any(p_enr)
         and a.event_id = any(v_ids)
         and (v_from is null or a.attended_on >= v_from)
         and (v_to is null or a.attended_on <= v_to);
      v_ok := case when coalesce(array_length(v_ids, 1), 0) = 0 then true
                   when coalesce(pr ->> 'mode', 'all') = 'any' then v_hit >= 1
                   else v_hit >= array_length(v_ids, 1) end;
      v_actual := jsonb_build_object('hit', v_hit, 'of', coalesce(array_length(v_ids, 1), 0), 'event_ids', coalesce((
        select jsonb_agg(distinct a.event_id) from public.attendance_log a
         where a.enrollment_id = any(p_enr) and a.event_id = any(v_ids)
           and (v_from is null or a.attended_on >= v_from) and (v_to is null or a.attended_on <= v_to)), '[]'::jsonb));

    when 'gender' then
      v_ok := p_person.gender is not null and p_person.gender::text = (pr ->> 'value');
      v_actual := to_jsonb(p_person.gender::text);

    when 'age' then
      if p_person.birthdate is null then
        v_ok := false; v_actual := 'null'::jsonb;
      else
        v_num := extract(year from age(current_date, p_person.birthdate));
        v_ok := public.access_cmp(v_num, v_op, v_v1, v_v2);
        v_actual := to_jsonb(v_num);
      end if;

    when 'enrolled_in' then
      select count(*) into v_hit
        from public.enrollments e
       where e.person_id = p_person.id
         and coalesce(e.status::text, 'active') = 'active'
         and (nullif(pr ->> 'church_id', '') is null or e.church_id = (pr ->> 'church_id')::uuid)
         and (nullif(pr ->> 'service_id', '') is null or e.service_id = (pr ->> 'service_id')::uuid)
         and (
               case
                 when jsonb_typeof(pr -> 'class_ids') = 'array' and jsonb_array_length(pr -> 'class_ids') > 0
                   then e.class_id::text in (select jsonb_array_elements_text(pr -> 'class_ids'))
                 else nullif(pr ->> 'class_id', '') is null or e.class_id = (pr ->> 'class_id')::uuid
               end
             );
      v_ok := v_hit > 0;
      v_actual := to_jsonb(v_hit > 0);

    when 'person_field' then
      v_txt := case pr ->> 'field'
        when 'phone' then p_person.phone
        when 'address' then p_person.address
        when 'notes' then p_person.notes
        when 'image_url' then p_person.image_url
        when 'birthdate' then p_person.birthdate::text
        when 'name' then p_person.name
        when 'national_id' then p_person.national_id
        else null end;
      v_ok := case coalesce(pr ->> 'op', 'present')
        when 'present'  then nullif(trim(coalesce(v_txt, '')), '') is not null
        when 'absent'   then nullif(trim(coalesce(v_txt, '')), '') is null
        when 'contains' then coalesce(v_txt, '') ilike '%' || coalesce(pr ->> 'value', '') || '%'
        when 'equals'   then trim(coalesce(v_txt, '')) = trim(coalesce(pr ->> 'value', ''))
        else false end;
      v_actual := to_jsonb(case when pr ->> 'field' in ('image_url') then (case when v_txt is null then null else 'موجودة' end) else v_txt end);

    when 'exam_passed' then
      v_ok := nullif(pr ->> 'exam_id', '') is not null and exists (
        select 1 from public.exam_attempts a
         where a.person_id = p_person.id and a.exam_id = (pr ->> 'exam_id')::uuid
           and a.status = 'submitted' and a.passed = true);
      v_actual := to_jsonb(v_ok);

    when 'achievement' then
      v_ok := nullif(pr ->> 'achievement_id', '') is not null and exists (
        select 1 from public.user_achievements u
         where u.person_id = p_person.id and u.achievement_id = (pr ->> 'achievement_id')::uuid);
      v_actual := to_jsonb(v_ok);

    when 'occasion' then
      v_ok := nullif(pr ->> 'occasion_id', '') is not null and exists (
        select 1 from public.occasion_registrations r
         where r.person_id = p_person.id and r.occasion_id = (pr ->> 'occasion_id')::uuid
           and r.status = any (coalesce(
             (select array_agg(x) from jsonb_array_elements_text(pr -> 'statuses') x),
             array['confirmed', 'checked_in'])));
      v_actual := to_jsonb(v_ok);

    when 'not_entered' then
      select count(*) into v_hit
        from public.access_log l
       where l.event_id = p_event.id and l.person_id = p_person.id and l.granted
         and (coalesce(pr ->> 'period', 'day') <> 'day' or l.checked_on = (now() at time zone 'Africa/Cairo')::date);
      v_ok := v_hit = 0;
      v_actual := to_jsonb(v_hit);

    else
      v_ok := false;
      v_actual := 'null'::jsonb;
  end case;

  return jsonb_build_object('fulfilled', v_ok, 'actual', v_actual);
exception when others then
  return jsonb_build_object('fulfilled', false, 'actual', 'null'::jsonb, 'error', sqlerrm);
end $$;
revoke all on function public.access_eval_rule(public.access_rules, public.persons, uuid[], public.access_events) from public, anon, authenticated;
