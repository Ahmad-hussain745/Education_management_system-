-- ============================================================================
-- 31. THREAD effective_from THROUGH assign_teacher_class_with_salary
--
-- 0025_salary_rule_history.sql's trigger on salary_rules reacts to whatever
-- effective_from value is actually present in the row being written — for
-- an UPDATE that doesn't mention effective_from at all in its SET list,
-- Postgres carries the OLD value forward unchanged, which the trigger would
-- then (correctly) reject as "not advancing." So the two statements in
-- assign_teacher_class_with_salary() that touch salary_rules need to pass
-- effective_from explicitly, the same way the RPC already validates
-- everything else about the write instead of leaving it implicit.
--
-- Same shape otherwise as 0018 — only the new parameter and the two
-- touched lines change.
-- ============================================================================

create or replace function assign_teacher_class_with_salary(
  p_teacher_id uuid,
  p_class_id   uuid,
  p_section_id uuid default null,
  p_subject_id uuid default null,
  p_percentage numeric default null,
  p_effective_from date default current_date
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

  if p_effective_from is null then
    p_effective_from := current_date;
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
  --
  -- effective_from is passed explicitly on both branches now (0026): on
  -- insert it's this rule's opening date; on update, passing it lets
  -- 0025's trigger correctly log a new history segment starting exactly
  -- there, rather than silently carrying the old effective_from forward.
  if p_percentage is not null then
    select id into v_existing_rule_id from salary_rules
      where teacher_id = p_teacher_id and class_id = p_class_id
        and coalesce(section_id::text, '') = coalesce(p_section_id::text, '');

    if v_existing_rule_id is not null then
      -- effective_from only advances when the percentage is actually
      -- changing — resubmitting the same rate (e.g. editing which subject
      -- is attached, or just re-saving) shouldn't bump "since when has
      -- this rate applied" for no reason. The CASE reads `percentage` and
      -- `effective_from` bare (the pre-update row values — that's how SET
      -- expressions work in Postgres) against the incoming p_percentage.
      update salary_rules
        set percentage = p_percentage,
            active = true,
            updated_at = now(),
            effective_from = case when percentage is distinct from p_percentage then p_effective_from else effective_from end
        where id = v_existing_rule_id;
    else
      insert into salary_rules (teacher_id, class_id, section_id, percentage, active, effective_from)
        values (p_teacher_id, p_class_id, p_section_id, p_percentage, true, p_effective_from);
    end if;
  end if;

  return v_row;
end;
$$ language plpgsql;

grant execute on function assign_teacher_class_with_salary(uuid, uuid, uuid, uuid, numeric, date) to authenticated;
