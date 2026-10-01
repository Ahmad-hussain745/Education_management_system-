-- ============================================================================
-- ASK MSA — LLM COPILOT'S TOOL LAYER
--
-- Ask MSA's router (lib/assistant/llm.js) went from a fixed regex parser
-- to an LLM choosing among a fixed set of named tools (lib/assistant/
-- tools.js) — but what runs against the database did NOT change shape at
-- all. The LLM never receives a connection, a table name, or the ability
-- to compose a query; it only ever picks one of a handful of names and
-- fills in a few plain-language parameters, which the application layer
-- then resolves against REAL rows (lib/assistant/resolve.js — "Class 10"
-- has to match an actual class in THIS institute, or the tool call fails
-- closed) before calling the exact same kind of parameterized,
-- authorized, RLS/security-definer-checked RPC every other read in this
-- app already goes through. This migration is two small, genuine gaps
-- that surfaced while giving the new tool layer real parameters to work
-- with, plus the audit trail for which path (LLM or the original regex
-- parser, still intact as the fallback) answered a given question:
--
--   1. get_students_with_unpaid_months() (Priority 5) hard-coded
--      fee_arrears_filtered()'s class/section filters to null — fine
--      when the only caller was the old students_unpaid_months intent,
--      which never asked about one class. get_student_arrears now needs
--      "which students in Class 10 have arrears," so it's extended to
--      take p_class_id/p_section_id and actually pass them through.
--
--   2. Exam results had no summary RPC at all — every existing read
--      (report cards, the results-entry screens) is per-student or
--      per-exam-per-student, nothing aggregates "how did Class 10 do in
--      the Mid Term." get_exam_summary() below is that aggregate, built
--      the same way finance_monthly_trend/get_class_arrears_summary
--      were: one GROUP BY in Postgres, never client-side reduction.
-- ============================================================================

create or replace function get_students_with_unpaid_months(
  p_min_months int, p_limit int default 10, p_class_id uuid default null, p_section_id uuid default null
)
returns table(student_name text, class_name text, months_count int, total_arrears numeric, total_count bigint)
language plpgsql stable set search_path = public as $$
begin
  return query
  with filtered as (
    select * from fee_arrears_filtered(p_class_id, p_section_id, null, null, null, 0)
    where months_count >= p_min_months
  ),
  counted as (
    select *, count(*) over() as total_count from filtered
  )
  select student_name, class_name, months_count, total_arrears, total_count
  from counted
  order by months_count desc, total_arrears desc
  limit greatest(1, least(coalesce(p_limit, 10), 100));
end;
$$;

revoke execute on function get_students_with_unpaid_months(int, int, uuid, uuid) from public;
grant execute on function get_students_with_unpaid_months(int, int, uuid, uuid) to authenticated;

-- Published results only (draft = not yet finalized/verified — same
-- reasoning report cards already use for what a parent/Principal should
-- be told). Pass/fail: the assigned grade_rule's grade <> 'F' where one
-- was assigned (the institute's own grading scale, whatever it calls its
-- lowest band); percentage >= 40 as a fallback for the rare row with no
-- matching grade_rule band (e.g. a scale with gaps) — documented here so
-- it's a known, checkable default rather than a silent one.
create or replace function get_exam_summary(p_exam_id uuid, p_class_id uuid default null)
returns table(
  exam_name text, class_name text, students_count bigint,
  avg_percentage numeric, highest_percentage numeric, lowest_percentage numeric,
  pass_count bigint, fail_count bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can_view_finance() then
    raise exception 'NOT_AUTHORIZED: Not authorized to view exam results.';
  end if;

  if not exists (select 1 from exams where id = p_exam_id and institute_id = current_institute_id()) then
    raise exception 'NOT_FOUND: Exam not found.';
  end if;

  return query
  with scoped as (
    select er.percentage, er.grade_rule_id, s.class_id, cl.name as cn
    from exam_results er
    join students s on s.id = er.student_id
    left join classes cl on cl.id = s.class_id
    where er.exam_id = p_exam_id
      and er.status = 'published'
      and (p_class_id is null or s.class_id = p_class_id)
  ),
  graded as (
    select sc.*,
      case when gr.grade is not null then upper(gr.grade) <> 'F' else sc.percentage >= 40 end as passed
    from scoped sc
    left join grade_rules gr on gr.id = sc.grade_rule_id
  )
  select
    (select name from exams where id = p_exam_id),
    coalesce(cn, 'Unassigned'),
    count(*),
    round(avg(percentage), 2),
    max(percentage),
    min(percentage),
    count(*) filter (where passed),
    count(*) filter (where not passed)
  from graded
  group by cn;
end;
$$;

revoke execute on function get_exam_summary(uuid, uuid) from public;
grant execute on function get_exam_summary(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Which path answered a question — the LLM router (new) or the regex
-- parser (original, still intact as the fallback: no ANTHROPIC_API_KEY
-- configured, the LLM call itself failing, or the LLM declining to pick
-- any of its 8 tools all fall through to it, same as before this
-- migration). 'llm_declined'/'llm_unavailable'/'llm_error' distinguish
-- WHY a question ended up on the regex path — genuinely useful signal
-- for whether the tool list needs to grow, same spirit as
-- matched_intent already being logged null for "didn't understand."
-- ----------------------------------------------------------------------------
alter table assistant_queries add column if not exists source text not null default 'rule_based';
alter table assistant_queries drop constraint if exists assistant_queries_source_check;
alter table assistant_queries add constraint assistant_queries_source_check
  check (source in ('llm', 'rule_based', 'llm_declined', 'llm_unavailable', 'llm_error'));
