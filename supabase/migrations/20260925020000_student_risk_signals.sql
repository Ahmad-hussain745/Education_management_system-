-- ============================================================================
-- STUDENT RISK & EARLY-WARNING SYSTEM
--
-- Combines five inputs this app already has, plus one it didn't
-- (teacher observations, added here), into four independent dimension
-- signals — never one blended "risk score":
--
--   Attendance  + Fee arrears  + Exam performance  + Syllabus progress  + Teacher observations
--        ↓              ↓                ↓                   ↓                    ↓
--   Attendance      Financial        Academic          Engagement (shared with observations)
--
--   Student Risk
--   ├── Academic     — latest PUBLISHED exam result declining or under 40%
--   ├── Attendance   — last-30-days rate declining vs. the 30 days before, or under 75%
--   ├── Financial    — 2+ months of fee arrears
--   └── Engagement   — the class is meaningfully behind its own syllabus pace,
--                       and/or a teacher has logged a recent concern about this student
--
-- WHY NO SINGLE SCORE: a blended number ("Risk: 72/100") invites reading it
-- as a verdict about the student. Four independent, individually-labeled
-- signals invite the opposite — each one is a plain, checkable fact
-- ("attendance is down") a Principal or teacher can go verify against
-- Attendance/Exams/Fees/Syllabus themselves, not a conclusion to accept on
-- faith. get_student_risk_signals() only returns students with at least
-- one signal (an early-warning list, not a full roster with a column
-- added), and "recommended_actions" is a fixed, fully-explainable mapping
-- from which signals fired (see the SELECT below) — never AI-generated,
-- never a suggestion this app can act on by itself. It is presented to a
-- human (Super Admin/Principal) as something to look into, not something
-- already decided; see docs/STUDENT_RISK.md for the full framing.
--
-- Deliberately NOT security definer: it calls fee_arrears_filtered(),
-- which is itself a plain (RLS-respecting) function — wrapping it in
-- SECURITY DEFINER here would run that nested call as this function's
-- owner instead of the signed-in Principal, which is exactly the kind of
-- accidental cross-institute exposure this codebase's own multi-tenancy
-- migration (0035) was built to prevent. can_approve() is checked
-- explicitly instead of relying on that to enforce the role gate.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Teacher observations — the one input to this pipeline that isn't
-- already a table in this app. A short, dated, teacher-authored note
-- about a student. 'concern' notes feed the Engagement signal below;
-- 'positive'/'neutral' notes are logged too (a full picture, not just a
-- complaint box) but never contribute a flag.
-- ----------------------------------------------------------------------------
create table if not exists student_observations (
  id           uuid primary key default gen_random_uuid(),
  institute_id uuid not null references institutes(id) on delete cascade,
  student_id   uuid not null references students(id) on delete cascade,
  teacher_id   uuid not null references teachers(id) on delete cascade,
  class_id     uuid references classes(id) on delete set null,
  section_id   uuid references sections(id) on delete set null,
  category     text not null default 'concern' check (category in ('concern', 'positive', 'neutral')),
  note         text not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_student_observations_student on student_observations(student_id, created_at desc);
create index if not exists idx_student_observations_institute on student_observations(institute_id, created_at desc);

drop trigger if exists trg_set_institute_id on student_observations;
create trigger trg_set_institute_id before insert on student_observations
  for each row execute function set_institute_id();

alter table student_observations enable row level security;

create policy institute_isolation on student_observations as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

create policy "teacher reads own observations" on student_observations for select
  using (teacher_id = current_teacher_id());

create policy "admin/principal read all observations" on student_observations for select
  using (can_approve());

-- No direct insert policy for `authenticated` — only through this
-- function, so class ownership and the category value are validated in
-- one place rather than trusted to whatever the client sends.
create or replace function create_student_observation(p_student_id uuid, p_class_id uuid, p_section_id uuid, p_category text, p_note text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_teacher uuid := current_teacher_id();
  v_id uuid;
begin
  if v_teacher is null then
    raise exception 'NOT_AUTHORIZED: Only a teacher can log a student observation.';
  end if;
  if p_category not in ('concern', 'positive', 'neutral') then
    raise exception 'INVALID_CATEGORY: % is not recognized.', p_category;
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'EMPTY_NOTE: Write a short note first.';
  end if;
  if not teacher_owns_class(p_class_id, p_section_id) then
    raise exception 'NOT_AUTHORIZED: You do not teach this class.';
  end if;
  if not exists (select 1 from students where id = p_student_id and class_id = p_class_id) then
    raise exception 'INVALID_STUDENT: That student is not in this class.';
  end if;

  insert into student_observations (institute_id, student_id, teacher_id, class_id, section_id, category, note)
    values (current_institute_id(), p_student_id, v_teacher, p_class_id, p_section_id, p_category, trim(p_note))
    returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function create_student_observation(uuid, uuid, uuid, text, text) from public;
grant execute on function create_student_observation(uuid, uuid, uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- The pipeline itself. p_class_id narrows to one class; null (the
-- Student Risk page's default) covers the whole institute. Every reason
-- a student appears is a plain, independently-verifiable number — no
-- weighting, no hidden formula, and specifically NOT phrased by an LLM
-- (unlike Ask MSA's tools, which accept a grounded-and-checked AI
-- phrasing step): which named students are struggling is sensitive
-- enough that this app draws that line more conservatively even here.
-- ----------------------------------------------------------------------------
create or replace function get_student_risk_signals(p_class_id uuid default null)
returns table(
  student_id uuid, student_name text, class_name text, section_name text,
  attendance_rate_30d numeric, attendance_rate_prior_30d numeric, attendance_signal text,
  months_unpaid int, total_arrears numeric, financial_signal text,
  latest_exam_name text, latest_exam_pct numeric, prior_exam_pct numeric, academic_signal text,
  class_syllabus_completion_pct numeric, recent_observation_count int, latest_observation_note text, engagement_signal text,
  recommended_actions text[]
)
language plpgsql stable set search_path = public as $$
begin
  if not can_approve() then
    raise exception 'NOT_AUTHORIZED: Only a Super Admin or Principal can view the student risk overview.';
  end if;

  return query
  with base as (
    select s.id as sid, s.name as sname, s.class_id, s.section_id, c.name as cname, sec.name as secname
    from students s
    join classes c on c.id = s.class_id
    left join sections sec on sec.id = s.section_id
    where s.institute_id = current_institute_id() and s.status = 'active'
      and (p_class_id is null or s.class_id = p_class_id)
  ),
  att_recent as (
    select student_id, round(100.0 * count(*) filter (where status in ('present', 'late')) / nullif(count(*), 0), 1) as rate
    from student_attendance where date >= current_date - 30 group by student_id
  ),
  att_prior as (
    select student_id, round(100.0 * count(*) filter (where status in ('present', 'late')) / nullif(count(*), 0), 1) as rate
    from student_attendance where date >= current_date - 60 and date < current_date - 30 group by student_id
  ),
  arrears as (
    select f.student_id, f.months_count, f.total_arrears from fee_arrears_filtered(p_class_id, null, null, null, null, 0) f
  ),
  ranked_exams as (
    select er.student_id, er.percentage, e.name as exam_name,
      row_number() over (partition by er.student_id order by e.start_date desc nulls last) as rn
    from exam_results er
    join exams e on e.id = er.exam_id
    where er.status = 'published' and er.student_id in (select sid from base)
  ),
  latest_exam as (select * from ranked_exams where rn = 1),
  prior_exam as (select * from ranked_exams where rn = 2),
  -- Class-wide completion, deliberately not per-student (syllabus_progress
  -- is tracked per class/section, not per student) — every student in the
  -- same class/section shares this number, same as it appears in the
  -- Syllabus module itself. Across every subject, unlike Teacher
  -- Copilot's Progress Summary, which is intentionally one subject at a
  -- time — this is meant as a whole-class pace check, not a subject drill-down.
  class_syllabus as (
    select b.class_id, b.section_id,
      case when count(st.*) = 0 then null
        else round(100.0 * count(*) filter (where sp.completed and (sp.section_id is null or sp.section_id = b.section_id)) / count(*), 1)
      end as completion_pct
    from (select distinct class_id, section_id from base) b
    join syllabus_chapters sc on sc.class_id = b.class_id
    join syllabus_topics st on st.chapter_id = sc.id
    left join syllabus_progress sp on sp.topic_id = st.id
    group by b.class_id, b.section_id
  ),
  observations as (
    select student_id, count(*) as recent_count, (array_agg(note order by created_at desc))[1] as latest_note
    from student_observations
    where category = 'concern' and created_at >= now() - interval '60 days'
    group by student_id
  ),
  combined as (
    select
      b.sid as student_id, b.sname as student_name, b.cname as class_name, b.secname as section_name,
      ar.rate as attendance_rate_30d, ap.rate as attendance_rate_prior_30d,
      case
        when ar.rate is not null and ap.rate is not null and ar.rate < ap.rate - 10 then 'declining'
        when ar.rate is not null and ar.rate < 75 then 'low'
        else null
      end as attendance_signal,
      coalesce(arr.months_count, 0) as months_unpaid, coalesce(arr.total_arrears, 0) as total_arrears,
      case when coalesce(arr.months_count, 0) >= 2 then 'overdue' else null end as financial_signal,
      le.exam_name as latest_exam_name, le.percentage as latest_exam_pct, pe.percentage as prior_exam_pct,
      case
        when le.percentage is not null and pe.percentage is not null and le.percentage < pe.percentage - 10 then 'declining'
        when le.percentage is not null and le.percentage < 40 then 'failing'
        else null
      end as academic_signal,
      cs.completion_pct as class_syllabus_completion_pct,
      coalesce(obs.recent_count, 0) as recent_observation_count, obs.latest_note as latest_observation_note,
      case
        when coalesce(obs.recent_count, 0) > 0 and cs.completion_pct is not null and cs.completion_pct < 50 then 'flagged_and_behind'
        when coalesce(obs.recent_count, 0) > 0 then 'teacher_flagged'
        when cs.completion_pct is not null and cs.completion_pct < 50 then 'behind_syllabus'
        else null
      end as engagement_signal
    from base b
    left join att_recent ar on ar.student_id = b.sid
    left join att_prior ap on ap.student_id = b.sid
    left join arrears arr on arr.student_id = b.sid
    left join latest_exam le on le.student_id = b.sid
    left join prior_exam pe on pe.student_id = b.sid
    left join class_syllabus cs on cs.class_id = b.class_id and cs.section_id is not distinct from b.section_id
    left join observations obs on obs.student_id = b.sid
  )
  select
    student_id, student_name, class_name, section_name,
    attendance_rate_30d, attendance_rate_prior_30d, attendance_signal,
    months_unpaid, total_arrears, financial_signal,
    latest_exam_name, latest_exam_pct, prior_exam_pct, academic_signal,
    class_syllabus_completion_pct, recent_observation_count, latest_observation_note, engagement_signal,
    -- Deliberately left with duplicates (e.g. both Attendance and
    -- Academic can each suggest "Teacher review") — the application
    -- layer (lib/student-risk/format.js) dedupes for display, which
    -- keeps this mapping here a plain, auditable list of "signal X
    -- suggests action Y" rules rather than something already trying to
    -- be clever about ordering or precedence.
    array_remove(array[
      case when attendance_signal is not null then 'Teacher review' end,
      case when attendance_signal is not null then 'Parent communication' end,
      case when academic_signal is not null then 'Teacher review' end,
      case when academic_signal is not null then 'Academic support' end,
      case when engagement_signal is not null then 'Teacher review' end,
      case when financial_signal is not null then 'Parent communication' end
    ], null)
  from combined
  where attendance_signal is not null or financial_signal is not null or academic_signal is not null or engagement_signal is not null
  order by
    (attendance_signal is not null)::int + (financial_signal is not null)::int + (academic_signal is not null)::int + (engagement_signal is not null)::int desc,
    student_name;
end;
$$;

revoke execute on function get_student_risk_signals(uuid) from public;
grant execute on function get_student_risk_signals(uuid) to authenticated;
