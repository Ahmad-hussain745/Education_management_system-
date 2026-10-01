-- ============================================================================
-- 16. SALARY RULE VALIDATION
--
-- Two gaps in the original salary_rules definition:
--
-- 1. The percentage check allowed exactly 0 (`percentage >= 0`). A 0% rule
--    is meaningless (it always pays nothing) and almost certainly a data
--    entry mistake, not an intentional configuration — tighten to > 0.
--
-- 2. Nothing stopped a teacher having BOTH a whole-class rule (section_id
--    is null) AND a section-specific rule for the same class. Since
--    class_collected_amount() sums every student in the class when
--    section_id is null, that section's collection gets counted twice in
--    generate_salary_records() — e.g.
--        Teacher A · Class 10 · Whole Class · 60%
--        Teacher A · Class 10 · Section A   · 60%
--    Section A's fee payments feed BOTH rows' `share`, silently overpaying
--    that teacher for every rupee collected from Section A.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Percentage must be strictly greater than 0.
-- ----------------------------------------------------------------------------
alter table salary_rules drop constraint if exists salary_rules_percentage_check;
alter table salary_rules add constraint salary_rules_percentage_check
  check (percentage > 0 and percentage <= 100);

-- ----------------------------------------------------------------------------
-- 2. No overlapping active rule for the same teacher + class.
--
-- A whole-class rule (section_id is null) and any section-specific rule for
-- that same teacher/class can never both be active at once — one always
-- makes the other double-count. This only looks at the SAME teacher; two
-- different teachers legitimately sharing a class (co-teaching) is fine and
-- untouched by this trigger.
-- ----------------------------------------------------------------------------
create or replace function check_salary_rule_overlap() returns trigger as $$
declare
  conflict_id uuid;
begin
  if not new.active then
    return new;
  end if;

  if new.section_id is null then
    -- New rule is whole-class — any active section-specific rule for this
    -- teacher/class would now be double-counted by this one.
    select id into conflict_id from salary_rules
      where teacher_id = new.teacher_id
        and class_id = new.class_id
        and section_id is not null
        and active
        and id is distinct from new.id
      limit 1;
  else
    -- New rule is section-specific — an active whole-class rule for this
    -- teacher/class already covers (and would double-count) this section.
    select id into conflict_id from salary_rules
      where teacher_id = new.teacher_id
        and class_id = new.class_id
        and section_id is null
        and active
        and id is distinct from new.id
      limit 1;
  end if;

  if conflict_id is not null then
    raise exception 'OVERLAPPING_SALARY_RULE: % already has an active rule (id %) that overlaps this one for the same class — a whole-class rule and a section-specific rule can''t both be active, since the section''s collection would be paid twice.',
      (select name from teachers where id = new.teacher_id), conflict_id;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_check_salary_rule_overlap on salary_rules;
create trigger trg_check_salary_rule_overlap
  before insert or update on salary_rules
  for each row execute function check_salary_rule_overlap();
