-- ============================================================================
-- 26. ATOMIC TEACHER ASSIGNMENT + SALARY RULE
--
-- app/(app)/teachers/classes/actions.js currently does this as three
-- separate statements from the client:
--   1. insert into teacher_classes
--   2. check for an overlapping salary rule
--   3. insert/update salary_rules
-- Postgres already guarantees each INDIVIDUAL statement is atomic, but the
-- SEQUENCE of statements from a Server Action is not one transaction — if
-- step 3 fails (network drop, the OVERLAPPING_SALARY_RULE trigger firing on
-- a race the pre-check missed, anything), step 1 has already committed.
-- Result: a teaching duty exists with no matching salary rule, and nothing
-- forces anyone to notice or go back and fix it. Since payroll is generated
-- straight from active salary_rules, a percentage the school believes was
-- set never actually gets paid.
--
-- Fix: do all of it inside one PostgreSQL function, in one transaction. A
-- PL/pgSQL function body is implicitly one transaction already — there's no
-- explicit BEGIN/COMMIT to write; an exception anywhere inside aborts the
-- whole thing and every write made so far in this call is rolled back
-- automatically. This function re-does every validation the app currently
-- does in JS (teacher/class/section/percentage/duplicate/overlap) inside
-- that same transaction, so nothing depends on the caller having checked
-- first.
--
-- SECURITY INVOKER (the default) is intentional, not SECURITY DEFINER: this
-- must still run as the calling user, so the existing RLS write policies on
-- teacher_classes and salary_rules ("write: finance staff" /
-- "write: admin only" per 0002_rls.sql) keep applying exactly as before —
-- this function is a transaction boundary, not a privilege escalation.
-- ============================================================================

create or replace function assign_teacher_class_with_salary(
  p_teacher_id uuid,
  p_class_id   uuid,
  p_section_id uuid default null,
  p_subject_id uuid default null,
  p_percentage numeric default null
) returns teacher_classes as $$
declare
  v_teacher_status person_status;
  v_class_status   person_status;
  v_section_class  uuid;
  v_subject_active boolean;
  v_existing_tc_id uuid;
  v_overlap_id     uuid;
  v_existing_rule_id uuid;
  v_row teacher_classes;
begin
  -- Validate teacher: must exist and be active.
  select status into v_teacher_status from teachers where id = p_teacher_id;
  if v_teacher_status is null then
    raise exception 'TEACHER_NOT_FOUND: Teacher % does not exist.', p_teacher_id;
  end if;
  if v_teacher_status <> 'active' then
    raise exception 'TEACHER_INACTIVE: This teacher is inactive and can''t be assigned to a new class.';
  end if;

  -- Validate class: must exist and be active.
  select status into v_class_status from classes where id = p_class_id;
  if v_class_status is null then
    raise exception 'CLASS_NOT_FOUND: Class % does not exist.', p_class_id;
  end if;
  if v_class_status <> 'active' then
    raise exception 'CLASS_INACTIVE: This class is inactive and can''t take new assignments.';
  end if;

  -- Validate section: if given, must belong to this class.
  if p_section_id is not null then
    select class_id into v_section_class from sections where id = p_section_id;
    if v_section_class is null then
      raise exception 'SECTION_NOT_FOUND: Section % does not exist.', p_section_id;
    end if;
    if v_section_class <> p_class_id then
      raise exception 'SECTION_CLASS_MISMATCH: That section does not belong to the selected class.';
    end if;
  end if;

  -- Validate subject: if given, must exist and be active.
  if p_subject_id is not null then
    select active into v_subject_active from subjects where id = p_subject_id;
    if v_subject_active is null then
      raise exception 'SUBJECT_NOT_FOUND: Subject % does not exist.', p_subject_id;
    end if;
    if not v_subject_active then
      raise exception 'SUBJECT_INACTIVE: This subject is inactive and can''t be assigned.';
    end if;
  end if;

  -- Validate percentage range (salary_rules' own check constraint enforces
  -- this too, but a clear message here beats a raw constraint-violation).
  if p_percentage is not null and (p_percentage <= 0 or p_percentage > 100) then
    raise exception 'INVALID_PERCENTAGE: Percentage must be greater than 0 and no more than 100.';
  end if;

  -- Duplicate assignment check — mirrors uq_teacher_classes_assignment
  -- (0004_completion.sql), checked here first for a clear message.
  select id into v_existing_tc_id from teacher_classes
    where teacher_id = p_teacher_id
      and class_id = p_class_id
      and coalesce(section_id::text, '') = coalesce(p_section_id::text, '')
      and coalesce(subject_id::text, '') = coalesce(p_subject_id::text, '');
  if v_existing_tc_id is not null then
    raise exception 'DUPLICATE_ASSIGNMENT: This teacher is already assigned to this class/section/subject.';
  end if;

  -- Salary overlap check — mirrors check_salary_rule_overlap()
  -- (0006_salary_rule_validation.sql): a whole-class rule and a
  -- section-specific rule for the SAME teacher/class can never both be
  -- active. Only relevant if a percentage was actually given.
  if p_percentage is not null then
    if p_section_id is null then
      select id into v_overlap_id from salary_rules
        where teacher_id = p_teacher_id and class_id = p_class_id
          and section_id is not null and active limit 1;
    else
      select id into v_overlap_id from salary_rules
        where teacher_id = p_teacher_id and class_id = p_class_id
          and section_id is null and active limit 1;
    end if;
    if v_overlap_id is not null then
      raise exception 'OVERLAPPING_SALARY_RULE: A % rule already exists for this teacher/class — a whole-class rule and a section-specific rule can''t both be active at once.',
        (case when p_section_id is null then 'section-specific' else 'whole-class' end);
    end if;
  end if;

  -- Insert the teaching assignment.
  insert into teacher_classes (teacher_id, class_id, section_id, subject_id)
    values (p_teacher_id, p_class_id, p_section_id, p_subject_id)
    returning * into v_row;

  -- Insert or update the matching salary rule, in the SAME transaction as
  -- the assignment above — if this fails for any reason, the insert above
  -- is rolled back too, so the two can never end up out of sync.
  if p_percentage is not null then
    select id into v_existing_rule_id from salary_rules
      where teacher_id = p_teacher_id and class_id = p_class_id
        and coalesce(section_id::text, '') = coalesce(p_section_id::text, '');

    if v_existing_rule_id is not null then
      update salary_rules
        set percentage = p_percentage, active = true, updated_at = now()
        where id = v_existing_rule_id;
    else
      insert into salary_rules (teacher_id, class_id, section_id, percentage, active)
        values (p_teacher_id, p_class_id, p_section_id, p_percentage, true);
    end if;
  end if;

  return v_row;
end;
$$ language plpgsql;

grant execute on function assign_teacher_class_with_salary(uuid, uuid, uuid, uuid, numeric) to authenticated;
