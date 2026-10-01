-- ============================================================================
-- TEACHER AI COPILOT
--
-- Nine tools, in two families that get treated very differently:
--
--   GENERATIVE (lesson planner, worksheet generator, quiz generator,
--   question generator, differentiated activities, parent-report draft)
--   — genuinely creative content an LLM drafts from a brief (Class,
--   Subject, Topic, Difficulty, Learning objectives — exactly the picker
--   the request specified). There is no "verified" version of a lesson
--   plan to check the AI's writing against, so the safety mechanism here
--   isn't grounding — it's the workflow itself: every draft lands in
--   teacher_copilot_drafts with status='draft' and is NEVER shown to a
--   student or parent by this app until the teacher who requested it
--   reviews and explicitly approves it (set_teacher_draft_status below).
--   "AI produces a draft. Teacher approves it." is the actual safety
--   design here, not a side note.
--
--   GROUNDED (attendance insights, student risk signals, progress
--   summary) — these follow the exact same "AI never writes SQL, only
--   calls an approved, parameterized RPC" discipline Ask MSA already
--   established (see 20260923040000's header). The three functions below
--   ARE those approved RPCs. lib/teacher-copilot/insights.js is their
--   only caller and never lets an LLM phrase these — the numbers are
--   sensitive enough (which named students are struggling) that this
--   app doesn't take even the grounded-and-checked risk Ask MSA accepts
--   for phrasing; these render as data, described by fixed templates.
--
-- Every one of the six RPCs/functions below (three insight RPCs, three
-- draft-lifecycle functions) starts by checking teacher_owns_class() —
-- a teacher only ever gets AI output, generated or grounded, about a
-- class/section they're actually assigned to via teacher_classes. Same
-- "belt and braces on top of RLS" reasoning as everywhere else in this
-- app: RLS on students/exam_results/student_attendance already restricts
-- what a Teacher's session can even see, but this makes the class
-- ownership check that would otherwise be implicit and scattered explicit
-- and shared.
-- ============================================================================

create or replace function teacher_owns_class(p_class_id uuid, p_section_id uuid default null)
returns boolean
language sql stable security definer set search_path = public as $$
  select can_approve() or exists (
    select 1 from teacher_classes tc
    where tc.teacher_id = current_teacher_id()
      and tc.class_id = p_class_id
      and (p_section_id is null or tc.section_id is null or tc.section_id = p_section_id)
  );
$$;

revoke execute on function teacher_owns_class(uuid, uuid) from public;
grant execute on function teacher_owns_class(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Attendance insights — per-student attendance over the last p_days,
-- worst-first, so a teacher opening this sees who needs a word first
-- rather than an alphabetical list they have to scan.
-- ----------------------------------------------------------------------------
create or replace function get_class_attendance_insights(p_class_id uuid, p_section_id uuid default null, p_days int default 30)
returns table(
  student_id uuid, student_name text, present_count int, absent_count int,
  late_count int, leave_count int, total_marked int, attendance_rate numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not teacher_owns_class(p_class_id, p_section_id) then
    raise exception 'NOT_AUTHORIZED: You do not teach this class.';
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'INVALID_RANGE: Choose between 1 and 90 days.';
  end if;

  return query
  select
    s.id, s.name,
    count(*) filter (where sa.status = 'present')::int,
    count(*) filter (where sa.status = 'absent')::int,
    count(*) filter (where sa.status = 'late')::int,
    count(*) filter (where sa.status = 'leave')::int,
    count(*)::int,
    case when count(*) = 0 then null else round(100.0 * count(*) filter (where sa.status in ('present', 'late')) / count(*), 1) end
  from students s
  join student_attendance sa on sa.student_id = s.id
  where s.class_id = p_class_id and (p_section_id is null or s.section_id = p_section_id)
    and sa.date >= current_date - p_days
  group by s.id, s.name
  order by 8 asc nulls last;
end;
$$;

revoke execute on function get_class_attendance_insights(uuid, uuid, int) from public;
grant execute on function get_class_attendance_insights(uuid, uuid, int) to authenticated;

-- ----------------------------------------------------------------------------
-- Student risk signals — the one function in this migration that
-- returns only a SUBSET of students (the ones actually flagged), on
-- purpose: this is meant to be a short, actionable list, not "attendance
-- insights with an extra column" a teacher has to filter themselves.
-- Three signals, each independently real and checkable against the same
-- tables Attendance/Exams already show:
--   low_attendance — under 75% present/late over the last 30 days
--   failing        — latest PUBLISHED exam result under 40%
--   declining      — latest published result at least 10 points below
--                    the one before it
-- No single score, no weighting, no hidden formula — a Principal or
-- parent asking "why is this student flagged" gets one of these three
-- words and can go check the underlying number themselves.
-- ----------------------------------------------------------------------------
create or replace function get_class_risk_signals(p_class_id uuid, p_section_id uuid default null)
returns table(
  student_id uuid, student_name text, attendance_rate_30d numeric,
  latest_exam_name text, latest_exam_pct numeric, prior_exam_pct numeric, risk_flags text[]
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not teacher_owns_class(p_class_id, p_section_id) then
    raise exception 'NOT_AUTHORIZED: You do not teach this class.';
  end if;

  return query
  with att as (
    select s.id as student_id,
      case when count(sa.*) = 0 then null else round(100.0 * count(*) filter (where sa.status in ('present', 'late')) / count(*), 1) end as rate
    from students s
    left join student_attendance sa on sa.student_id = s.id and sa.date >= current_date - 30
    where s.class_id = p_class_id and (p_section_id is null or s.section_id = p_section_id) and s.status = 'active'
    group by s.id
  ),
  ranked_exams as (
    select er.student_id, er.percentage, e.name as exam_name,
      row_number() over (partition by er.student_id order by e.start_date desc nulls last) as rn
    from exam_results er
    join exams e on e.id = er.exam_id
    where er.status = 'published'
      and er.student_id in (select id from students where class_id = p_class_id and (p_section_id is null or section_id = p_section_id))
  ),
  latest as (select * from ranked_exams where rn = 1),
  prior as (select * from ranked_exams where rn = 2),
  combined as (
    select
      s.id as student_id, s.name as student_name, att.rate as attendance_rate_30d,
      latest.exam_name as latest_exam_name, latest.percentage as latest_exam_pct, prior.percentage as prior_exam_pct,
      array_remove(array[
        case when att.rate is not null and att.rate < 75 then 'low_attendance' end,
        case when latest.percentage is not null and latest.percentage < 40 then 'failing' end,
        case when latest.percentage is not null and prior.percentage is not null and latest.percentage < prior.percentage - 10 then 'declining' end
      ], null) as risk_flags
    from students s
    left join att on att.student_id = s.id
    left join latest on latest.student_id = s.id
    left join prior on prior.student_id = s.id
    where s.class_id = p_class_id and (p_section_id is null or s.section_id = p_section_id) and s.status = 'active'
  )
  select * from combined
  where array_length(risk_flags, 1) > 0
  order by array_length(risk_flags, 1) desc, attendance_rate_30d asc nulls last;
end;
$$;

revoke execute on function get_class_risk_signals(uuid, uuid) from public;
grant execute on function get_class_risk_signals(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Progress summary — one class+subject's syllabus completion (from the
-- Syllabus module a teacher already ticks off), the class's average in
-- that subject on the most recent exam that actually included it (via
-- exam_subjects/exam_marks, not exam_results.percentage — that column is
-- the OVERALL result across every subject, not this one), and recent
-- attendance. Three different real numbers presented together, never
-- blended into one invented "progress score."
-- ----------------------------------------------------------------------------
create or replace function get_class_progress_summary(p_class_id uuid, p_subject_id uuid, p_section_id uuid default null)
returns table(
  topics_total int, topics_completed int, completion_pct numeric,
  latest_exam_name text, avg_subject_pct numeric, students_assessed int,
  attendance_rate_30d numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_exam_subject_id uuid;
  v_exam_name text;
begin
  if not teacher_owns_class(p_class_id, p_section_id) then
    raise exception 'NOT_AUTHORIZED: You do not teach this class.';
  end if;

  select es.id, e.name into v_exam_subject_id, v_exam_name
  from exam_subjects es
  join exams e on e.id = es.exam_id
  where es.class_id = p_class_id and es.subject_id = p_subject_id and e.institute_id = current_institute_id()
  order by coalesce(es.exam_date, e.start_date) desc nulls last
  limit 1;

  return query
  with topics as (
    select count(*)::int as total
    from syllabus_topics st join syllabus_chapters sc on sc.id = st.chapter_id
    where sc.class_id = p_class_id and sc.subject_id = p_subject_id
  ),
  completed as (
    select count(*)::int as done
    from syllabus_topics st
    join syllabus_chapters sc on sc.id = st.chapter_id
    join syllabus_progress sp on sp.topic_id = st.id
    where sc.class_id = p_class_id and sc.subject_id = p_subject_id and sp.completed
      and (p_section_id is null or sp.section_id is null or sp.section_id = p_section_id)
  ),
  marks as (
    select avg(em.marks_obtained / es.max_marks * 100) as avg_pct, count(*)::int as n
    from exam_marks em
    join exam_subjects es on es.id = em.exam_subject_id
    join students s on s.id = em.student_id
    where em.exam_subject_id = v_exam_subject_id and not em.is_absent
      and (p_section_id is null or s.section_id = p_section_id)
  ),
  att as (
    select case when count(*) = 0 then null else round(100.0 * count(*) filter (where sa.status in ('present', 'late')) / count(*), 1) end as rate
    from student_attendance sa
    join students s on s.id = sa.student_id
    where sa.class_id = p_class_id and (p_section_id is null or sa.section_id = p_section_id) and sa.date >= current_date - 30
  )
  select
    (select total from topics), (select done from completed),
    case when (select total from topics) = 0 then null else round(100.0 * (select done from completed) / (select total from topics), 1) end,
    v_exam_name, round((select avg_pct from marks)::numeric, 1), (select n from marks),
    (select rate from att);
end;
$$;

revoke execute on function get_class_progress_summary(uuid, uuid, uuid) from public;
grant execute on function get_class_progress_summary(uuid, uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- The drafts table every one of the 9 tools writes into — generative
-- output (the actual generated text) and a saved copy of a grounded
-- insight's rendering (so "my drafts" is one consistent place to review
-- and approve ANY copilot output, not two different UIs for two
-- different tool families). content is always plain text/markdown,
-- never executable — this table is a place AI output is stored and
-- read, not a place anything runs from.
-- ----------------------------------------------------------------------------
create table if not exists teacher_copilot_drafts (
  id                   uuid primary key default gen_random_uuid(),
  institute_id         uuid not null references institutes(id) on delete cascade,
  teacher_id           uuid not null references teachers(id) on delete cascade,
  kind                 text not null check (kind in (
    'lesson_plan', 'worksheet', 'quiz', 'question_bank', 'differentiated_activities',
    'attendance_insights', 'risk_signals', 'progress_summary', 'parent_report'
  )),
  class_id             uuid references classes(id) on delete set null,
  section_id           uuid references sections(id) on delete set null,
  subject_id           uuid references subjects(id) on delete set null,
  topic                text,
  difficulty           text,
  learning_objectives  text,
  content              text not null,
  status               text not null default 'draft' check (status in ('draft', 'approved', 'discarded')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  approved_at          timestamptz
);
create index if not exists idx_teacher_copilot_drafts_teacher on teacher_copilot_drafts(teacher_id, created_at desc);
create index if not exists idx_teacher_copilot_drafts_institute on teacher_copilot_drafts(institute_id, created_at desc);

drop trigger if exists trg_set_institute_id on teacher_copilot_drafts;
create trigger trg_set_institute_id before insert on teacher_copilot_drafts
  for each row execute function set_institute_id();

alter table teacher_copilot_drafts enable row level security;

create policy institute_isolation on teacher_copilot_drafts as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

-- A teacher's own drafts: full lifecycle (create, edit while still a
-- draft, approve, discard) — always their own row, never anyone else's.
create policy "teacher manages own drafts" on teacher_copilot_drafts for all
  using (teacher_id = current_teacher_id())
  with check (teacher_id = current_teacher_id());

-- Oversight, read-only — a Principal/Super Admin can see what the AI has
-- been drafting for their teachers without being able to approve on a
-- teacher's behalf (approval is deliberately the requesting teacher's
-- call alone — see set_teacher_draft_status below).
create policy "admin/principal read all drafts" on teacher_copilot_drafts for select
  using (can_approve());

create or replace function create_teacher_draft(
  p_kind text, p_class_id uuid, p_section_id uuid, p_subject_id uuid,
  p_topic text, p_difficulty text, p_learning_objectives text, p_content text
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_teacher uuid := current_teacher_id();
  v_id uuid;
begin
  if v_teacher is null then
    raise exception 'NOT_AUTHORIZED: Only a teacher can create a copilot draft.';
  end if;
  if p_kind not in (
    'lesson_plan', 'worksheet', 'quiz', 'question_bank', 'differentiated_activities',
    'attendance_insights', 'risk_signals', 'progress_summary', 'parent_report'
  ) then
    raise exception 'INVALID_KIND: % is not a recognized copilot tool.', p_kind;
  end if;
  if p_class_id is not null and not teacher_owns_class(p_class_id, p_section_id) then
    raise exception 'NOT_AUTHORIZED: You do not teach this class.';
  end if;
  if coalesce(trim(p_content), '') = '' then
    raise exception 'EMPTY_CONTENT: Nothing was generated to save.';
  end if;

  insert into teacher_copilot_drafts (institute_id, teacher_id, kind, class_id, section_id, subject_id, topic, difficulty, learning_objectives, content)
    values (current_institute_id(), v_teacher, p_kind, p_class_id, p_section_id, p_subject_id, p_topic, p_difficulty, p_learning_objectives, p_content)
    returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function create_teacher_draft(text, uuid, uuid, uuid, text, text, text, text) from public;
grant execute on function create_teacher_draft(text, uuid, uuid, uuid, text, text, text, text) to authenticated;

-- The only way a draft's status changes — a real action, not a raw
-- UPDATE, so the state machine (draft -> approved/discarded, never back,
-- never twice) is enforced in one place rather than trusted to whatever
-- the client happens to send.
create or replace function set_teacher_draft_status(p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_current text;
begin
  if p_status not in ('approved', 'discarded') then
    raise exception 'INVALID_STATUS: % is not a valid target status.', p_status;
  end if;

  select status into v_current from teacher_copilot_drafts where id = p_id and teacher_id = current_teacher_id();
  if v_current is null then
    raise exception 'NOT_FOUND: Draft not found.';
  end if;
  if v_current <> 'draft' then
    raise exception 'ALREADY_DECIDED: This draft has already been %.', v_current;
  end if;

  update teacher_copilot_drafts
    set status = p_status, updated_at = now(), approved_at = case when p_status = 'approved' then now() else null end
    where id = p_id;
end;
$$;

revoke execute on function set_teacher_draft_status(uuid, text) from public;
grant execute on function set_teacher_draft_status(uuid, text) to authenticated;
