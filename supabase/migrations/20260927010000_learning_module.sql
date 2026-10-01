-- ============================================================================
-- LEARNING MODULE
--
--   Learning
--   ├── Homework          — unchanged, already exists (20260926010000):
--   │                       a quick, ungraded notice. Kept exactly as-is.
--   ├── Assignments       — assignments (new): the gradable unit — title,
--   │                       instructions, a rubric, a due date, draft/published.
--   ├── Resources         — assignment_resources (new): materials attached to
--   │                       an assignment, or standalone for a class/subject.
--   ├── Submission        — assignment_submissions (new): one row per
--   │                       (assignment, student) — a parent submits online,
--   │                       or a teacher marks it received (e.g. on paper).
--   ├── Teacher feedback  — assignment_submissions.feedback — same row.
--   ├── Grades            — assignment_submissions.marks_obtained — same row,
--   │                       because a grade and its feedback are never really
--   │                       two separate facts about a submission.
--   └── Deadlines         — no new table: get_upcoming_deadlines() is a lens
--                           on assignments.due_date, for teacher and parent.
--
-- assignment_submissions has NO insert/update RLS policy at all — every
-- write goes through submit_assignment() or grade_submission() below, same
-- "an action, not a column edit" reasoning as set_teacher_draft_status /
-- respond_to_support_request. A submission's lifecycle (pending -> submitted
-- -> graded, never backwards without a teacher's explicit re-grade) is a
-- real state machine; trusting it to whatever a client PATCHes in would mean
-- re-deriving that logic in RLS's WITH CHECK instead of one readable place.
--
-- get_assignment_difficulty() is deliberately NOT an AI feature, even
-- though the request groups "difficulty analysis" with AI drafting/rubrics/
-- feedback. Those three are genuinely creative — there's no "verified"
-- version of a draft assignment to check an LLM's writing against.
-- Difficulty, once an assignment has real grades, DOES have a verified
-- answer: how the class actually scored. Computing it deterministically
-- from assignment_submissions and returning plain, checkable numbers is the
-- same "signal, not judgment" choice this app already made for Student Risk
-- (migration 20260925020000) and for Teacher Copilot's own risk tool — an
-- LLM opinion would be strictly less trustworthy than the real average.
-- ============================================================================

create table if not exists assignments (
  id              uuid primary key default gen_random_uuid(),
  institute_id    uuid not null references institutes(id) on delete cascade,
  class_id        uuid not null references classes(id) on delete cascade,
  section_id      uuid references sections(id) on delete set null,
  subject_id      uuid references subjects(id) on delete set null,
  teacher_id      uuid references teachers(id) on delete set null,
  title           text not null,
  description     text,
  assignment_type text not null default 'homework' check (assignment_type in ('homework', 'classwork', 'project', 'quiz', 'other')),
  max_marks       numeric(6, 2),
  due_date        date,
  allow_late      boolean not null default true,
  rubric          jsonb,
  status          text not null default 'draft' check (status in ('draft', 'published')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_assignments_class on assignments(class_id, section_id, due_date);
create index if not exists idx_assignments_institute on assignments(institute_id, created_at desc);

drop trigger if exists trg_set_institute_id on assignments;
create trigger trg_set_institute_id before insert on assignments
  for each row execute function set_institute_id();

alter table assignments enable row level security;

create policy institute_isolation on assignments as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

create policy "staff read assignments" on assignments for select using (is_active_staff());

-- teacher_owns_class() already resolves true for Super Admin/Principal too
-- (migration 20260924030000) — see its own definition for why.
create policy "teacher manages own class assignments" on assignments for all
  using (teacher_owns_class(class_id, section_id)) with check (teacher_owns_class(class_id, section_id));

-- Only PUBLISHED assignments — a draft is the teacher still working on it,
-- same "draft isn't shown until it's ready" reasoning as every other
-- draft/approve workflow in this app.
create policy "parent reads own child's published assignments" on assignments for select
  using (status = 'published' and is_parent_of_class(class_id));

-- ----------------------------------------------------------------------------
-- Resources — materials for a class/subject, optionally tied to one
-- assignment. No sensitive columns, so ordinary RLS (unlike Parent Portal
-- 2.0's timetable/homework, which needed SECURITY DEFINER functions to
-- avoid leaking teacher salary/phone columns — nothing like that here).
-- ----------------------------------------------------------------------------
create table if not exists assignment_resources (
  id            uuid primary key default gen_random_uuid(),
  institute_id  uuid not null references institutes(id) on delete cascade,
  assignment_id uuid references assignments(id) on delete cascade,
  class_id      uuid not null references classes(id) on delete cascade,
  section_id    uuid references sections(id) on delete set null,
  subject_id    uuid references subjects(id) on delete set null,
  teacher_id    uuid references teachers(id) on delete set null,
  title         text not null,
  description   text,
  resource_type text not null default 'link' check (resource_type in ('link', 'note')),
  url           text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_assignment_resources_class on assignment_resources(class_id, section_id);
create index if not exists idx_assignment_resources_assignment on assignment_resources(assignment_id);

drop trigger if exists trg_set_institute_id on assignment_resources;
create trigger trg_set_institute_id before insert on assignment_resources
  for each row execute function set_institute_id();

alter table assignment_resources enable row level security;

create policy institute_isolation on assignment_resources as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

create policy "staff read resources" on assignment_resources for select using (is_active_staff());

create policy "teacher manages own class resources" on assignment_resources for all
  using (teacher_owns_class(class_id, section_id)) with check (teacher_owns_class(class_id, section_id));

create policy "parent reads own child's class resources" on assignment_resources for select
  using (
    is_parent_of_class(class_id)
    and (assignment_id is null or exists (select 1 from assignments a where a.id = assignment_resources.assignment_id and a.status = 'published'))
  );

-- ----------------------------------------------------------------------------
-- Submissions — one row per (assignment, student). Created either by a
-- parent submitting online, or by a teacher grading/marking a physical
-- submission (which creates the row if it doesn't exist yet).
-- ----------------------------------------------------------------------------
create table if not exists assignment_submissions (
  id              uuid primary key default gen_random_uuid(),
  institute_id    uuid not null references institutes(id) on delete cascade,
  assignment_id   uuid not null references assignments(id) on delete cascade,
  student_id      uuid not null references students(id) on delete cascade,
  submission_type text check (submission_type in ('online', 'physical')),
  content_text    text,
  content_url     text,
  submitted_at    timestamptz,
  submitted_by    uuid references users(id),
  is_late         boolean,
  marks_obtained  numeric(6, 2),
  feedback        text,
  graded_by       uuid references users(id),
  graded_at       timestamptz,
  status          text not null default 'pending' check (status in ('pending', 'submitted', 'graded')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (assignment_id, student_id)
);
create index if not exists idx_assignment_submissions_assignment on assignment_submissions(assignment_id);
create index if not exists idx_assignment_submissions_student on assignment_submissions(student_id);

drop trigger if exists trg_set_institute_id on assignment_submissions;
create trigger trg_set_institute_id before insert on assignment_submissions
  for each row execute function set_institute_id();

alter table assignment_submissions enable row level security;

create policy institute_isolation on assignment_submissions as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

create policy "parent reads own child's submissions" on assignment_submissions for select using (is_parent_of(student_id));
create policy "staff read submissions" on assignment_submissions for select using (is_active_staff());

-- A parent submitting their child's work — checks the assignment is
-- actually published and belongs to this child's class before anything is
-- written, and flags is_late from the assignment's own due_date rather
-- than trusting the client's clock.
create or replace function submit_assignment(p_assignment_id uuid, p_student_id uuid, p_content_text text, p_content_url text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_assignment assignments%rowtype;
  v_id uuid;
  v_late boolean;
begin
  select id into v_user_id from users where auth_user_id = auth.uid();
  if v_user_id is null or not is_parent_of(p_student_id) then
    raise exception 'NOT_AUTHORIZED: That student is not linked to your account.';
  end if;

  select * into v_assignment from assignments where id = p_assignment_id and status = 'published';
  if v_assignment.id is null then
    raise exception 'NOT_FOUND: Assignment not found or not yet published.';
  end if;
  if not exists (select 1 from students where id = p_student_id and class_id = v_assignment.class_id) then
    raise exception 'NOT_AUTHORIZED: This assignment is not for this student''s class.';
  end if;
  if coalesce(trim(p_content_text), '') = '' and coalesce(trim(p_content_url), '') = '' then
    raise exception 'EMPTY_SUBMISSION: Add some text or a link before submitting.';
  end if;

  v_late := v_assignment.due_date is not null and current_date > v_assignment.due_date;
  if v_late and not v_assignment.allow_late then
    raise exception 'PAST_DUE: This assignment no longer accepts submissions.';
  end if;

  insert into assignment_submissions (institute_id, assignment_id, student_id, submission_type, content_text, content_url, submitted_at, submitted_by, is_late, status)
    values (current_institute_id(), p_assignment_id, p_student_id, 'online', nullif(trim(p_content_text), ''), nullif(trim(p_content_url), ''), now(), v_user_id, v_late, 'submitted')
  on conflict (assignment_id, student_id) do update
    set content_text = excluded.content_text, content_url = excluded.content_url, submitted_at = excluded.submitted_at,
        submitted_by = excluded.submitted_by, is_late = excluded.is_late, submission_type = 'online', status = 'submitted', updated_at = now()
  where assignment_submissions.status <> 'graded'
  returning id into v_id;

  if v_id is null then
    raise exception 'ALREADY_GRADED: This assignment has already been graded — contact the teacher to resubmit.';
  end if;
  return v_id;
end;
$$;

revoke execute on function submit_assignment(uuid, uuid, text, text) from public;
grant execute on function submit_assignment(uuid, uuid, text, text) to authenticated;

-- A teacher grading a submission (or recording one that arrived on
-- paper) — creates the row if it doesn't exist yet, same upsert shape as
-- submit_assignment. This is the only way marks_obtained/feedback ever get
-- written.
create or replace function grade_submission(p_assignment_id uuid, p_student_id uuid, p_marks_obtained numeric, p_feedback text, p_submission_type text default 'physical')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_teacher uuid;
  v_class_id uuid;
  v_section_id uuid;
  v_max_marks numeric;
  v_id uuid;
begin
  select class_id, section_id, max_marks into v_class_id, v_section_id, v_max_marks from assignments where id = p_assignment_id;
  if v_class_id is null then raise exception 'NOT_FOUND: Assignment not found.'; end if;
  if not teacher_owns_class(v_class_id, v_section_id) then
    raise exception 'NOT_AUTHORIZED: You do not teach this class.';
  end if;
  if p_marks_obtained is not null and v_max_marks is not null and (p_marks_obtained < 0 or p_marks_obtained > v_max_marks) then
    raise exception 'OUT_OF_RANGE: Marks must be between 0 and %.', v_max_marks;
  end if;
  if not exists (select 1 from students where id = p_student_id and class_id = v_class_id) then
    raise exception 'INVALID_STUDENT: That student is not in this class.';
  end if;

  select id into v_teacher from users where auth_user_id = auth.uid();

  insert into assignment_submissions (institute_id, assignment_id, student_id, submission_type, marks_obtained, feedback, graded_by, graded_at, status)
    values (current_institute_id(), p_assignment_id, p_student_id, p_submission_type, p_marks_obtained, nullif(trim(p_feedback), ''), v_teacher, now(), 'graded')
  on conflict (assignment_id, student_id) do update
    set marks_obtained = excluded.marks_obtained, feedback = excluded.feedback, graded_by = excluded.graded_by,
        graded_at = excluded.graded_at, status = 'graded',
        submission_type = coalesce(assignment_submissions.submission_type, excluded.submission_type), updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function grade_submission(uuid, uuid, numeric, text, text) from public;
grant execute on function grade_submission(uuid, uuid, numeric, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Deadlines — a lens on assignments.due_date, not a new table.
-- ----------------------------------------------------------------------------
create or replace function get_upcoming_deadlines(p_class_id uuid default null, p_days int default 14)
returns table(id uuid, title text, class_name text, section_name text, subject_name text, due_date date, status text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_active_staff() then
    raise exception 'NOT_AUTHORIZED: Not authorized.';
  end if;
  return query
  select a.id, a.title, c.name, sec.name, sub.name, a.due_date, a.status
  from assignments a
  join classes c on c.id = a.class_id
  left join sections sec on sec.id = a.section_id
  left join subjects sub on sub.id = a.subject_id
  where a.institute_id = current_institute_id()
    and (p_class_id is null or a.class_id = p_class_id)
    and a.due_date is not null and a.due_date between current_date and current_date + p_days
  order by a.due_date;
end;
$$;

revoke execute on function get_upcoming_deadlines(uuid, int) from public;
grant execute on function get_upcoming_deadlines(uuid, int) to authenticated;

-- Parent-facing: the child's own upcoming due dates only, across
-- Assignments AND the simpler Homework notices (20260926010000) — one
-- combined "what's due" list is more useful to a parent than two.
create or replace function get_child_deadlines(p_student_id uuid, p_days int default 14)
returns table(id uuid, kind text, title text, subject_name text, due_date date)
language plpgsql stable security definer set search_path = public as $$
declare
  v_class_id uuid;
  v_section_id uuid;
begin
  if not (is_parent_of(p_student_id) or is_active_staff()) then
    raise exception 'NOT_AUTHORIZED: Not authorized to view this student''s deadlines.';
  end if;
  select class_id, section_id into v_class_id, v_section_id from students where id = p_student_id;
  if v_class_id is null then raise exception 'NOT_FOUND: Student not found.'; end if;

  return query
  select a.id, 'assignment', a.title, sub.name, a.due_date
  from assignments a
  left join subjects sub on sub.id = a.subject_id
  where a.class_id = v_class_id and (a.section_id is null or a.section_id = v_section_id)
    and a.status = 'published' and a.due_date is not null and a.due_date between current_date and current_date + p_days
  union all
  select h.id, 'homework', h.title, sub.name, h.due_date
  from homework h
  left join subjects sub on sub.id = h.subject_id
  where h.class_id = v_class_id and (h.section_id is null or h.section_id = v_section_id)
    and h.due_date is not null and h.due_date between current_date and current_date + p_days
  order by due_date;
end;
$$;

revoke execute on function get_child_deadlines(uuid, int) from public;
grant execute on function get_child_deadlines(uuid, int) to authenticated;

-- ----------------------------------------------------------------------------
-- Difficulty analysis — deterministic, grounded in actual grades. See this
-- file's header for why this one is not an AI feature. Requires at least 3
-- graded submissions before saying anything at all — a class of 2 grades
-- isn't a real distribution, and a false signal here would nudge a
-- teacher's next assignment based on noise.
-- ----------------------------------------------------------------------------
create or replace function get_assignment_difficulty(p_assignment_id uuid)
returns table(
  total_students int, graded_count int, avg_pct numeric, highest_pct numeric, lowest_pct numeric,
  pass_count int, fail_count int, signal text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_class_id uuid; v_section_id uuid; v_max_marks numeric;
begin
  select class_id, section_id, max_marks into v_class_id, v_section_id, v_max_marks from assignments where id = p_assignment_id;
  if v_class_id is null then raise exception 'NOT_FOUND: Assignment not found.'; end if;
  if not teacher_owns_class(v_class_id, v_section_id) then
    raise exception 'NOT_AUTHORIZED: You do not teach this class.';
  end if;
  if v_max_marks is null or v_max_marks <= 0 then
    raise exception 'NO_MAX_MARKS: This assignment has no max marks set, so a percentage can''t be computed.';
  end if;

  return query
  with roster as (select count(*)::int as n from students where class_id = v_class_id and (v_section_id is null or section_id = v_section_id) and status = 'active'),
  graded as (
    select (100.0 * marks_obtained / v_max_marks) as pct
    from assignment_submissions
    where assignment_id = p_assignment_id and status = 'graded' and marks_obtained is not null
  )
  select
    (select n from roster), (select count(*)::int from graded),
    round((select avg(pct) from graded), 1), round((select max(pct) from graded), 1), round((select min(pct) from graded), 1),
    (select count(*)::int from graded where pct >= 40), (select count(*)::int from graded where pct < 40),
    case
      when (select count(*) from graded) < 3 then 'not_enough_data'
      when (select avg(pct) from graded) < 50 then 'many_struggled'
      when (select avg(pct) from graded) > 90 and (select max(pct) - min(pct) from graded) < 15 then 'likely_too_easy'
      when (select count(*) from graded where pct < 40) >= greatest(1, (select count(*) from graded) / 3) then 'wide_spread'
      else 'appropriate'
    end;
end;
$$;

revoke execute on function get_assignment_difficulty(uuid) from public;
grant execute on function get_assignment_difficulty(uuid) to authenticated;
