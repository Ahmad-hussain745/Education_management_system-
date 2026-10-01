-- ============================================================================
-- 33. EXAMS AND RESULTS
--
-- Not required for FinanceOS itself — flagged as a forward-looking module
-- toward a full Academy Management System. Follows the same workflow it
-- was specced with, each stage a distinct step with its own access tier
-- rather than one big form:
--
--   Create Exam → Assign Classes → Enter Marks → Calculate Total →
--   Percentage → Grade → Publish Result → Generate Report Card
--
--   exam_types, grade_rules   admin/Principal-configured lookups
--                              (can_approve() — same tier Monthly Closing's
--                              "Approve" already uses)
--   exams, exam_classes,
--   exam_subjects              the exam's definition — also can_approve():
--                              "Create Exam" and "Assign Classes" are setup
--                              decisions, not day-to-day teaching work
--   exam_marks                 entered by the TEACHER actually assigned to
--                              that class+subject (teacher_classes), same
--                              shape as syllabus_progress — but stricter:
--                              matched on subject_id too, not just class_id,
--                              since a grade is higher-stakes than a
--                              syllabus checkbox
--   exam_results                "Calculate Total → Percentage → Grade" is
--                              compute_exam_results() below — a single
--                              set-based aggregation over exam_marks, not a
--                              per-student loop. "Publish Result" is a
--                              separate, explicit step (publish_exam_
--                              results()) so a class's grades don't become
--                              visible/final the instant they're computed —
--                              same "compute vs. approve are different
--                              actions" split as Monthly Closing.
--   Report Card                generated on demand as a PDF
--                              (/api/report-cards/[examId]/[studentId]),
--                              same pdf-lib pattern as receipts/salary-slips
--                              /student-statements — nothing stored, gated
--                              on that student's exam_results.status being
--                              'published'.
--
-- Read access for exam_marks/exam_results is scoped from the start the way
-- 0015_attendance_read_scoping.sql had to retrofit onto attendance: full
-- read for admin/oversight roles, narrow read for a teacher to only their
-- own assigned classes' students — never a blanket "any signed-in user".
-- Cashier has no stated stake in exams, same reasoning as attendance, so
-- neither policy grants them anything.
-- ============================================================================

-- Needed for the grade_rules EXCLUDE constraint below (no two grade bands
-- allowed to overlap — enforced by Postgres itself, not just app code).
create extension if not exists btree_gist;

create table exam_types (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,     -- "Class Test", "Mid Term", "Final Term"
  created_at timestamptz not null default now()
);

create table grade_rules (
  id             uuid primary key default gen_random_uuid(),
  grade          text not null,                 -- "A+", "A", "B", "F"...
  min_percentage numeric(5,2) not null check (min_percentage >= 0 and min_percentage <= 100),
  max_percentage numeric(5,2) not null check (max_percentage >= 0 and max_percentage <= 100),
  grade_point    numeric(3,2),
  remarks        text,                           -- "Excellent", "Needs Improvement"...
  created_at     timestamptz not null default now(),
  check (min_percentage <= max_percentage),
  exclude using gist (numrange(min_percentage, max_percentage, '[]') with &&)
);

create table exams (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,                    -- "Mid Term 2026"
  exam_type_id uuid references exam_types(id) on delete set null,
  start_date   date,
  end_date     date,
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  check (start_date is null or end_date is null or start_date <= end_date)
);

-- "Assign Classes" — section_id null means the whole class, every section.
create table exam_classes (
  id         uuid primary key default gen_random_uuid(),
  exam_id    uuid not null references exams(id) on delete cascade,
  class_id   uuid not null references classes(id) on delete cascade,
  section_id uuid references sections(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- Plain `unique(exam_id, class_id, section_id)` would not catch two
-- whole-class rows (section_id null) — Postgres treats every NULL as
-- distinct from every other NULL. Same NULL-safe-uniqueness fix
-- 0004_completion.sql already had to retrofit onto teacher_classes/
-- salary_rules/syllabus_progress, applied here from the start instead.
create unique index idx_exam_classes_unique on exam_classes(
  exam_id, class_id, coalesce(section_id, '00000000-0000-0000-0000-000000000000')
);

-- Which subjects this exam covers for a given class, and out of how many
-- marks — set once per exam+class+subject, referenced by every mark
-- entered against it (so max_marks lives in exactly one place).
create table exam_subjects (
  id            uuid primary key default gen_random_uuid(),
  exam_id       uuid not null references exams(id) on delete cascade,
  class_id      uuid not null references classes(id) on delete cascade,
  subject_id    uuid not null references subjects(id) on delete cascade,
  max_marks     numeric(6,2) not null check (max_marks > 0),
  passing_marks numeric(6,2) not null default 0 check (passing_marks >= 0),
  exam_date     date,
  created_at    timestamptz not null default now(),
  unique (exam_id, class_id, subject_id),
  check (passing_marks <= max_marks)
);
create index idx_exam_subjects_exam on exam_subjects(exam_id);

-- "Enter Marks" — one row per student per exam_subject. is_absent and
-- marks_obtained are kept mutually exclusive by the two CHECKs below,
-- and marks_obtained's actual range (0..max_marks) is enforced by the
-- trigger further down, since a CHECK constraint on this table can't see
-- exam_subjects.max_marks.
create table exam_marks (
  id              uuid primary key default gen_random_uuid(),
  exam_subject_id uuid not null references exam_subjects(id) on delete cascade,
  student_id      uuid not null references students(id) on delete cascade,
  marks_obtained  numeric(6,2) check (marks_obtained >= 0),
  is_absent       boolean not null default false,
  entered_by      uuid references users(id),
  entered_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (exam_subject_id, student_id),
  check (is_absent or marks_obtained is not null),
  check (not is_absent or marks_obtained is null)
);
create index idx_exam_marks_student on exam_marks(student_id);

create or replace function trg_exam_marks_guard_fn() returns trigger
language plpgsql set search_path = public as $$
declare
  v_max       numeric;
  v_published boolean;
begin
  select max_marks into v_max from exam_subjects where id = new.exam_subject_id;
  if v_max is null then
    raise exception 'INVALID_EXAM_SUBJECT: That exam/subject assignment no longer exists.';
  end if;
  if not new.is_absent and new.marks_obtained > v_max then
    raise exception 'MARKS_OUT_OF_RANGE: Marks can''t exceed % for this subject.', v_max;
  end if;

  -- Once a student's overall result has been published, their individual
  -- subject marks are locked — same "unpublish before you can correct"
  -- shape as Monthly Closing, just scoped to one student's result instead
  -- of a whole month.
  select exists(
    select 1 from exam_results er
    join exam_subjects es on es.exam_id = er.exam_id
    where es.id = new.exam_subject_id and er.student_id = new.student_id and er.status = 'published'
  ) into v_published;
  if v_published then
    raise exception 'RESULT_PUBLISHED: This student''s result is already published — unpublish it first to correct marks.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_exam_marks_guard before insert or update on exam_marks
  for each row execute function trg_exam_marks_guard_fn();

-- "Calculate Total → Percentage → Grade" output, one row per (exam,
-- student) once compute_exam_results() has run — never hand-written.
create table exam_results (
  id              uuid primary key default gen_random_uuid(),
  exam_id         uuid not null references exams(id) on delete cascade,
  student_id      uuid not null references students(id) on delete cascade,
  total_marks     numeric(8,2) not null default 0,
  total_max_marks numeric(8,2) not null default 0,
  percentage      numeric(5,2) not null default 0,
  grade_rule_id   uuid references grade_rules(id),
  class_rank      int,
  status          text not null default 'draft' check (status in ('draft', 'published')),
  computed_at     timestamptz not null default now(),
  published_at    timestamptz,
  published_by    uuid references users(id),
  unique (exam_id, student_id)
);
create index idx_exam_results_exam on exam_results(exam_id);
create index idx_exam_results_student on exam_results(student_id);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table exam_types    enable row level security;
alter table grade_rules   enable row level security;
alter table exams         enable row level security;
alter table exam_classes  enable row level security;
alter table exam_subjects enable row level security;
alter table exam_marks    enable row level security;
alter table exam_results  enable row level security;

create policy "read: any signed-in staff" on exam_types    for select using (is_active_staff());
create policy "read: any signed-in staff" on grade_rules   for select using (is_active_staff());
create policy "read: any signed-in staff" on exams         for select using (is_active_staff());
create policy "read: any signed-in staff" on exam_classes  for select using (is_active_staff());
create policy "read: any signed-in staff" on exam_subjects for select using (is_active_staff());

-- Setup tier — "Create Exam", "Assign Classes", subject/max-marks
-- configuration, and grading policy are Super Admin/Principal decisions,
-- the same can_approve() tier Monthly Closing's approval step uses.
create policy "admin/principal manage exam types"    on exam_types    for all using (can_approve()) with check (can_approve());
create policy "admin/principal manage grade rules"   on grade_rules   for all using (can_approve()) with check (can_approve());
create policy "admin/principal manage exams"         on exams         for all using (can_approve()) with check (can_approve());
create policy "admin/principal manage exam classes"  on exam_classes  for all using (can_approve()) with check (can_approve());
create policy "admin/principal manage exam subjects" on exam_subjects for all using (can_approve()) with check (can_approve());

-- exam_marks: scoped read (not "any signed-in user" — individual marks are
-- more sensitive than which subjects exist) and teacher-scoped write,
-- matching a teacher's actual subject assignment in teacher_classes.
create policy "admin/principal/accountant view all exam marks" on exam_marks for select using (is_admin() or can_view_finance());
create policy "teacher views own classes' exam marks" on exam_marks for select using (
  exists (
    select 1 from exam_subjects es join teacher_classes tc on tc.class_id = es.class_id and tc.subject_id = es.subject_id
    where es.id = exam_marks.exam_subject_id and tc.teacher_id = current_teacher_id()
  )
);
create policy "admin/teacher enter own classes' exam marks" on exam_marks for insert with check (
  is_admin() or exists (
    select 1 from exam_subjects es join teacher_classes tc on tc.class_id = es.class_id and tc.subject_id = es.subject_id
    where es.id = exam_marks.exam_subject_id and tc.teacher_id = current_teacher_id()
  )
);
create policy "admin/teacher update own classes' exam marks" on exam_marks for update using (
  is_admin() or exists (
    select 1 from exam_subjects es join teacher_classes tc on tc.class_id = es.class_id and tc.subject_id = es.subject_id
    where es.id = exam_marks.exam_subject_id and tc.teacher_id = current_teacher_id()
  )
) with check (
  is_admin() or exists (
    select 1 from exam_subjects es join teacher_classes tc on tc.class_id = es.class_id and tc.subject_id = es.subject_id
    where es.id = exam_marks.exam_subject_id and tc.teacher_id = current_teacher_id()
  )
);
create policy "admin deletes exam marks" on exam_marks for delete using (is_admin());

-- exam_results: read-only from the app's perspective — every row comes
-- from compute_exam_results()/publish_exam_results()/
-- unpublish_exam_results() below (all SECURITY DEFINER), never a direct
-- insert/update, so there is deliberately no write policy at all here.
create policy "admin/principal/accountant view all exam results" on exam_results for select using (is_admin() or can_view_finance());
create policy "teacher views own classes' exam results" on exam_results for select using (
  exists (
    select 1 from students s join teacher_classes tc on tc.class_id = s.class_id
    where s.id = exam_results.student_id and tc.teacher_id = current_teacher_id()
  )
);

-- Parent portal (0030_parent_portal.sql, applied before this migration —
-- is_parent_of() must already exist): a parent may see their own child's
-- result, but ONLY once published — "Publish Result" is the step that's
-- supposed to make a grade visible outside the school at all, and a
-- parent seeing a draft result before a teacher/admin has finished
-- checking it is exactly the leak that step exists to prevent. Same
-- reasoning extends to exam_marks: a parent can see the subject-by-subject
-- breakdown behind a published result (that's what a report card is), but
-- never an unpublished one.
create policy "parent reads own child's published results" on exam_results for select using (
  status = 'published' and is_parent_of(student_id)
);
create policy "parent reads own child's published marks" on exam_marks for select using (
  exists (
    select 1 from exam_results er
    join exam_subjects es on es.exam_id = er.exam_id
    where es.id = exam_marks.exam_subject_id
      and er.student_id = exam_marks.student_id
      and er.status = 'published'
      and is_parent_of(exam_marks.student_id)
  )
);

-- Same class-scoping pattern as syllabus (0030_parent_portal.sql) — a
-- parent can see which exams exist and what subjects/marks they cover for
-- their own child's class, but nothing about any other class's exam setup.
-- This is independent of publish status (an exam's existence and schedule
-- isn't the sensitive part; the grade is — that's what the two policies
-- above gate separately).
create policy "parent reads own child's assigned exams" on exams for select using (
  exists (select 1 from exam_classes ec where ec.exam_id = exams.id and is_parent_of_class(ec.class_id))
);
create policy "parent reads own child's exam class assignment" on exam_classes for select using (
  is_parent_of_class(class_id)
);
create policy "parent reads own child's exam subjects" on exam_subjects for select using (
  is_parent_of_class(class_id)
);

-- ----------------------------------------------------------------------------
-- "Calculate Total → Percentage → Grade" — one set-based pass over every
-- student with at least one mark recorded for this exam, not a per-student
-- loop. Recomputing (e.g. after a marks correction) is safe to re-run: the
-- upsert never touches status/published_at/published_by, so it can't
-- silently re-publish or un-publish anything — that's only ever
-- publish_exam_results()/unpublish_exam_results() below.
-- ----------------------------------------------------------------------------
create or replace function compute_exam_results(p_exam_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if not can_approve() then
    raise exception 'NOT_AUTHORIZED: Not authorized to calculate exam results.';
  end if;

  with totals as (
    select
      em.student_id,
      s.class_id,
      sum(coalesce(em.marks_obtained, 0)) as total_marks,
      sum(es.max_marks) as total_max_marks
    from exam_marks em
    join exam_subjects es on es.id = em.exam_subject_id
    join students s on s.id = em.student_id
    where es.exam_id = p_exam_id
    group by em.student_id, s.class_id
  ),
  scored as (
    select t.*,
      case when t.total_max_marks > 0 then round(t.total_marks / t.total_max_marks * 100, 2) else 0 end as percentage
    from totals t
  ),
  graded as (
    select sc.*,
      (select gr.id from grade_rules gr
        where sc.percentage >= gr.min_percentage and sc.percentage <= gr.max_percentage
        order by gr.min_percentage desc limit 1) as grade_rule_id
    from scored sc
  ),
  ranked as (
    select g.*, dense_rank() over (partition by g.class_id order by g.percentage desc) as class_rank
    from graded g
  )
  insert into exam_results (exam_id, student_id, total_marks, total_max_marks, percentage, grade_rule_id, class_rank, status)
  select p_exam_id, student_id, total_marks, total_max_marks, percentage, grade_rule_id, class_rank, 'draft'
  from ranked
  on conflict (exam_id, student_id) do update set
    total_marks = excluded.total_marks,
    total_max_marks = excluded.total_max_marks,
    percentage = excluded.percentage,
    grade_rule_id = excluded.grade_rule_id,
    class_rank = excluded.class_rank,
    computed_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function compute_exam_results(uuid) from public;
grant execute on function compute_exam_results(uuid) to authenticated;

-- "Publish Result" — deliberately its own step, not folded into compute:
-- a class's results shouldn't become final (and, via the trigger above,
-- lock their underlying marks) the instant someone recalculates a preview.
create or replace function publish_exam_results(p_exam_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_by uuid;
  v_count int;
begin
  if not can_approve() then
    raise exception 'NOT_AUTHORIZED: Not authorized to publish exam results.';
  end if;
  select id into v_by from users where auth_user_id = auth.uid();
  update exam_results set status = 'published', published_at = now(), published_by = v_by
    where exam_id = p_exam_id and status = 'draft';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function publish_exam_results(uuid) from public;
grant execute on function publish_exam_results(uuid) to authenticated;

-- The correction path the trigger above points to: unpublish, fix the
-- marks, recompute, republish.
create or replace function unpublish_exam_results(p_exam_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if not can_approve() then
    raise exception 'NOT_AUTHORIZED: Not authorized to unpublish exam results.';
  end if;
  update exam_results set status = 'draft', published_at = null, published_by = null
    where exam_id = p_exam_id and status = 'published';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function unpublish_exam_results(uuid) from public;
grant execute on function unpublish_exam_results(uuid) to authenticated;
