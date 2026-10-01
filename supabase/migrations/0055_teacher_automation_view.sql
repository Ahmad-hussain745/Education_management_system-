-- ============================================================================
-- 55. TEACHER AUTOMATION VIEW — one summary query instead of four/five
-- separate round trips from the page. Same SECURITY DEFINER + explicit
-- check shape as 0052/0054 — a teacher can only ever ask for their OWN
-- summary; is_admin()/can_approve() can ask for any teacher's, for the
-- same oversight reasoning Principal already has via can_approve() elsewhere.
-- ============================================================================
create or replace function teacher_dashboard_summary(p_teacher_id uuid)
returns table(
  classes_assigned int,
  classes_attendance_marked_today int,
  syllabus_topics_total int,
  syllabus_topics_completed int,
  exam_subjects_assigned int
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_institute_id uuid;
begin
  select institute_id into v_institute_id from teachers where id = p_teacher_id;
  if v_institute_id is null or v_institute_id != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That teacher does not match your session.';
  end if;
  if not (current_teacher_id() = p_teacher_id or is_admin() or can_approve()) then
    raise exception 'NOT_AUTHORIZED: You can only view your own teaching summary.';
  end if;

  return query
  with tc as (
    select distinct class_id, section_id, subject_id from teacher_classes where teacher_id = p_teacher_id
  ),
  topics as (
    select st.id as topic_id, sp.completed
    from syllabus_chapters sc
    join syllabus_topics st on st.chapter_id = sc.id
    left join syllabus_progress sp on sp.topic_id = st.id
    where (sc.class_id, sc.subject_id) in (select class_id, subject_id from tc where subject_id is not null)
  )
  select
    (select count(*) from (select distinct class_id, section_id from tc) x)::int,
    (select count(*) from (select distinct class_id, section_id from tc) x
      where exists (
        select 1 from student_attendance sa
        where sa.class_id = x.class_id
          and (x.section_id is null or sa.section_id = x.section_id)
          and sa.date = current_date
      ))::int,
    (select count(*) from topics)::int,
    (select count(*) from topics where completed)::int,
    (select count(distinct es.id) from exam_subjects es
      where (es.class_id, es.subject_id) in (select class_id, subject_id from tc where subject_id is not null))::int;
end;
$$;

revoke execute on function teacher_dashboard_summary(uuid) from public;
grant execute on function teacher_dashboard_summary(uuid) to authenticated;
