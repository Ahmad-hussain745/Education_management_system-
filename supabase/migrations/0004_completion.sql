-- ============================================================================
-- 15. COMPLETION — NULL-safe uniqueness, plus indexes the new report/register
-- pages actually query by.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 15a. NULL-safe uniqueness for "whole class" rows.
--
-- teacher_classes, salary_rules and syllabus_progress each have a plain
-- `unique (..., section_id[, subject_id])` constraint from 0001_init.sql.
-- Postgres treats every NULL as distinct from every other NULL, so that
-- constraint does nothing for the "whole class" case (section_id null) —
-- two whole-class rows for the same teacher+class, or the same topic, are
-- NOT rejected by it. That's exactly the gap the application code has been
-- working around by hand: salary/config/actions.js, teachers/classes/
-- actions.js and syllabus/chapters/actions.js all do an explicit
-- "check for an existing row, then update or insert" before writing,
-- specifically because this constraint can't be trusted to catch it.
--
-- These new indexes close that gap at the database layer using coalesce()
-- to fold every NULL to the same sentinel value, so a second whole-class row
-- really does collide. They don't replace the application-level check —
-- PostgREST's upsert (on_conflict=col1,col2) can only target a plain-column
-- constraint, not an expression index like this one, so the JS code still
-- can't use a one-line .upsert() against it. What this DOES fix is the
-- narrow race the JS check can't: two simultaneous requests can both see
-- "no existing row" before either has inserted (check-then-insert isn't
-- atomic) and both insert — previously that produced a silent duplicate;
-- now the second insert is rejected with a real unique_violation (Postgres
-- error 23505), which the actions below now catch and turn into a clear
-- message instead of a raw database error.

alter table teacher_classes  drop constraint if exists teacher_classes_teacher_id_class_id_section_id_subject_id_key;
alter table salary_rules     drop constraint if exists salary_rules_teacher_id_class_id_section_id_key;
alter table syllabus_progress drop constraint if exists syllabus_progress_topic_id_section_id_key;

-- De-dup defensively before adding the index, in case any duplicate
-- whole-class rows already slipped in before this migration (keeping the
-- earliest row of any pair).
delete from teacher_classes a using teacher_classes b
  where a.id > b.id
    and a.teacher_id = b.teacher_id and a.class_id = b.class_id
    and coalesce(a.section_id, '00000000-0000-0000-0000-000000000000') = coalesce(b.section_id, '00000000-0000-0000-0000-000000000000')
    and coalesce(a.subject_id, '00000000-0000-0000-0000-000000000000') = coalesce(b.subject_id, '00000000-0000-0000-0000-000000000000');

delete from salary_rules a using salary_rules b
  where a.id > b.id
    and a.teacher_id = b.teacher_id and a.class_id = b.class_id
    and coalesce(a.section_id, '00000000-0000-0000-0000-000000000000') = coalesce(b.section_id, '00000000-0000-0000-0000-000000000000');

delete from syllabus_progress a using syllabus_progress b
  where a.id > b.id
    and a.topic_id = b.topic_id
    and coalesce(a.section_id, '00000000-0000-0000-0000-000000000000') = coalesce(b.section_id, '00000000-0000-0000-0000-000000000000');

create unique index uq_teacher_classes_assignment on teacher_classes (
  teacher_id, class_id,
  coalesce(section_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create unique index uq_salary_rules_assignment on salary_rules (
  teacher_id, class_id,
  coalesce(section_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create unique index uq_syllabus_progress_scope on syllabus_progress (
  topic_id,
  coalesce(section_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

-- ----------------------------------------------------------------------------
-- 15b. Reporting/register indexes the new pages built this session actually
-- filter or group by, that 0001_init.sql didn't anticipate.
-- ----------------------------------------------------------------------------

-- (Teacher Attendance's date-nav is already covered by idx_teacher_attendance_date in 0001_init.sql.)

-- Syllabus Progress now groups per section as well as whole-class (see the
-- Chapters/Progress pages) — idx_syllabus_progress_topic alone doesn't help
-- a "give me this section's rows" filter.
create index if not exists idx_syllabus_progress_section on syllabus_progress(section_id);

-- Financial Reports filters by a txn_date range with no account_id filter,
-- so the existing idx_transactions_account_date (account_id, txn_date) can't
-- be used — its leading column doesn't match the query. And its per-type
-- sums (fee_payment/income/expense/salary_payment) benefit from type being
-- the leading column of a composite index alongside the same date range.
create index if not exists idx_transactions_date      on transactions(txn_date);
create index if not exists idx_transactions_type_date  on transactions(type, txn_date);
