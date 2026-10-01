-- ============================================================================
-- PRIORITY 4 — MOVE HEAVY CALCULATIONS INTO POSTGRES
--
-- Real anti-pattern found in four places, verified by reading the actual
-- current code (not assumed):
--   - Dashboard (app/(app)/dashboard/page.js): pulls every transactions row
--     for the month (and the prior month, and 6 months of fee_payment rows
--     for the trend) into JS, sums by type there.
--   - Analytics (app/(app)/analytics/page.js): pulls every fee_payments,
--     student_attendance row for 6 months, every active student, and
--     EVERY exam_results row ever (no date bound at all) — then groups by
--     month/class/exam in JS.
--   - Ask MSA (lib/assistant/queries.js): monthFinancials(), expense_total,
--     collection_rate, and attendance_rate each pull a month's worth of raw
--     rows and sum/average them in JS, for every question asked.
--   - Weekly Report cron (app/api/cron/weekly-report/route.js): the same
--     pattern, repeated in a LOOP once per institute — the worst-scaling
--     instance of this, since institute count multiplies the row pull.
--
-- Management Report (0052_management_reporting.sql's finance_monthly_trend/
-- finance_month_comparison) already does this correctly and is UNCHANGED
-- here — it's the existing example this migration follows the shape of.
--
-- Design: each function below is SECURITY INVOKER (the default) when
-- called with no institute id (relies on current_institute_id() +
-- table RLS, same as fee_arrears_summary/list_transactions) — but the
-- weekly-report cron runs as service_role across EVERY institute in a
-- loop, which needs to name a specific institute rather than "whoever is
-- logged in." So every function here takes an explicit p_institute_id,
-- and enforces institute isolation itself: service_role bypasses the
-- check (it's the trusted system cron), any other caller must be asking
-- about their OWN institute or gets rejected — the same shape of guard
-- Phase 21 (0051) added everywhere else a SECURITY DEFINER function takes
-- an id across a tenant boundary.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Shared guard, used by every function below instead of repeating the same
-- three lines six times.
-- ----------------------------------------------------------------------------
create or replace function assert_institute_access(p_institute_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' then
    return;
  end if;
  if p_institute_id is null or p_institute_id is distinct from current_institute_id() then
    raise exception 'NOT_AUTHORIZED: You can only query your own institute.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- get_month_financial_summary() — replaces every hand-rolled "pull
-- transactions, filter by type, sum in JS" block. One SUM/GROUP BY instead
-- of however many rows the month contains. Explicit start/end (not a bare
-- "month") so the SAME function serves a calendar month (Dashboard,
-- Analytics, Ask MSA) and a rolling 7-day window (Weekly Report) without
-- two near-duplicate functions.
-- ----------------------------------------------------------------------------
create or replace function get_month_financial_summary(p_institute_id uuid, p_start_date date, p_end_date date)
returns table(collected numeric, other_income numeric, expenses numeric, salaries numeric, net numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_institute_access(p_institute_id);
  return query
  select
    coalesce(sum(amount) filter (where type = 'fee_payment'), 0),
    coalesce(sum(amount) filter (where type = 'income'), 0),
    coalesce(sum(amount) filter (where type = 'expense'), 0),
    coalesce(sum(amount) filter (where type = 'salary_payment'), 0),
    coalesce(sum(amount) filter (where type in ('fee_payment', 'income')), 0)
      - coalesce(sum(amount) filter (where type in ('expense', 'salary_payment')), 0)
  from transactions
  where institute_id = p_institute_id and txn_date >= p_start_date and txn_date < p_end_date;
end;
$$;

-- ----------------------------------------------------------------------------
-- get_collection_rate() — replaces the "pull every fee_records row for the
-- month, sum total_payable in JS, divide" pattern (Dashboard, Ask MSA's
-- collection_rate). Collected comes from the same transactions-based
-- summary above rather than a second separate sum, so this can never
-- disagree with what Dashboard/Reports call "collected."
-- ----------------------------------------------------------------------------
create or replace function get_collection_rate(p_institute_id uuid, p_month date)
returns table(expected numeric, collected numeric, rate numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_month_end date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_expected numeric;
  v_collected numeric;
begin
  perform assert_institute_access(p_institute_id);
  select coalesce(sum(total_payable), 0) into v_expected
    from fee_records where institute_id = p_institute_id and month = v_month;
  select fs.collected into v_collected from get_month_financial_summary(p_institute_id, v_month, v_month_end) fs;
  return query select v_expected, v_collected, case when v_expected > 0 then (v_collected / v_expected) * 100 else 0 end;
end;
$$;

-- ----------------------------------------------------------------------------
-- get_class_arrears_summary() — replaces Ask MSA's class_most_arrears,
-- which pulled up to 5,000 individual arrears rows via fee_arrears_accounts
-- and grouped them by class in JS. Reuses fee_arrears_filtered() (the same
-- base view fee_arrears_accounts/fee_arrears_summary already share) so all
-- three stay consistent, just aggregated in SQL instead of the app layer.
-- ----------------------------------------------------------------------------
create or replace function get_class_arrears_summary(p_institute_id uuid)
returns table(class_name text, total_arrears numeric, students_with_arrears bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_institute_access(p_institute_id);
  return query
  select f.class_name, sum(f.total_arrears), count(*)
  from fee_arrears_filtered(null, null, null, null, null, 0) f
  group by f.class_name
  order by sum(f.total_arrears) desc;
end;
$$;

-- ----------------------------------------------------------------------------
-- get_attendance_summary() — replaces the "pull every attendance row for
-- the month, filter+divide in JS" pattern (Dashboard's studentAttendance/
-- teacherAttendance, Ask MSA's attendance_rate). p_who picks the table;
-- everything else about the shape matches get_month_financial_summary's
-- explicit start/end convention.
-- ----------------------------------------------------------------------------
create or replace function get_attendance_summary(p_institute_id uuid, p_start_date date, p_end_date date, p_who text default 'student')
returns table(present_count bigint, total_count bigint, rate numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_present bigint;
  v_total bigint;
begin
  perform assert_institute_access(p_institute_id);
  if p_who = 'teacher' then
    select count(*) filter (where status = 'present'), count(*) into v_present, v_total
      from teacher_attendance where institute_id = p_institute_id and date >= p_start_date and date < p_end_date;
  else
    select count(*) filter (where status = 'present'), count(*) into v_present, v_total
      from student_attendance where institute_id = p_institute_id and date >= p_start_date and date < p_end_date;
  end if;
  return query select v_present, v_total, case when v_total > 0 then (v_present::numeric / v_total) * 100 else null end;
end;
$$;

-- ----------------------------------------------------------------------------
-- get_exam_performance_summary() — replaces Analytics' worst offender: a
-- plain `select percentage, exam_id, exams(name) from exam_results` with NO
-- date bound at all, pulling the institute's entire exam history, forever,
-- on every single page load, just to average percentages per exam in JS.
-- ----------------------------------------------------------------------------
create or replace function get_exam_performance_summary(p_institute_id uuid, p_limit int default 6)
returns table(exam_id uuid, exam_name text, average_percentage numeric, students_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_institute_access(p_institute_id);
  return query
  select e.id, e.name, round(avg(r.percentage), 2), count(*)
  from exam_results r
  join exams e on e.id = r.exam_id
  where r.institute_id = p_institute_id
  group by e.id, e.name, e.start_date
  order by e.start_date desc nulls last
  limit greatest(1, least(coalesce(p_limit, 6), 50));
end;
$$;

-- ----------------------------------------------------------------------------
-- get_expense_breakdown() — replaces Ask MSA's expense_total, which pulled
-- every expense row for the month (optionally re-filtered by category
-- client-side) and summed in JS. Returns the FULL category breakdown in
-- one call; a caller wanting one category's total just reads that one row
-- instead of the function needing a separate code path.
-- ----------------------------------------------------------------------------
create or replace function get_expense_breakdown(p_institute_id uuid, p_start_date date, p_end_date date)
returns table(category text, total numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_institute_access(p_institute_id);
  return query
  select e.category, sum(e.amount)
  from expenses e
  where e.institute_id = p_institute_id and e.expense_date >= p_start_date and e.expense_date < p_end_date
  group by e.category
  order by sum(e.amount) desc;
end;
$$;

revoke execute on function get_month_financial_summary(uuid, date, date) from public;
revoke execute on function get_collection_rate(uuid, date) from public;
revoke execute on function get_class_arrears_summary(uuid) from public;
revoke execute on function get_attendance_summary(uuid, date, date, text) from public;
revoke execute on function get_exam_performance_summary(uuid, int) from public;
revoke execute on function get_expense_breakdown(uuid, date, date) from public;
grant execute on function get_month_financial_summary(uuid, date, date) to authenticated, service_role;
grant execute on function get_collection_rate(uuid, date) to authenticated, service_role;
grant execute on function get_class_arrears_summary(uuid) to authenticated, service_role;
grant execute on function get_attendance_summary(uuid, date, date, text) to authenticated, service_role;
grant execute on function get_exam_performance_summary(uuid, int) to authenticated, service_role;
grant execute on function get_expense_breakdown(uuid, date, date) to authenticated, service_role;
