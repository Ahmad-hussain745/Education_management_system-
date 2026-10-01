-- ============================================================================
-- 53. ANOMALY DETECTION
--
-- Deliberately NOT an LLM call anywhere in this file, per the request:
-- "Don't use AI to calculate fees. Use it to detect unusual behavior" —
-- and the actual right tool for "is this number unusual compared to its
-- own history" is a baseline-and-deviation comparison, not a language
-- model. Every function here does exactly that: compute a trailing
-- historical average from real rows (fee_payments/income/expenses/
-- salary_records/inventory_stock_movements — never a projection, same
-- "real numbers only" rule 0052 already follows), compare it to the
-- current period, and flag it only when the deviation clears a threshold
-- chosen to avoid noise. No forecasting, no model, no training data —
-- just arithmetic a person could check by hand, which is exactly what
-- makes it trustworthy enough to alert an administrator with.
--
-- Six checks, matching the six examples given:
--   detect_cash_collection_anomaly   — today's cash vs trailing 30-day avg
--   detect_cashier_reversal_anomaly  — one cashier's reversal count vs the
--                                      per-cashier average
--   detect_expense_category_anomaly — this month's spend per category vs
--                                      trailing 3-month average
--   detect_arrears_anomaly           — total outstanding arrears vs the
--                                      last time this check ran (see its
--                                      own comment — no arrears history
--                                      table exists, so the previous
--                                      automation_runs row IS the baseline)
--   detect_salary_cost_anomaly       — this month's payroll vs trailing
--                                      3-month average
--   detect_inventory_usage_anomaly  — this month's stock-out qty per
--                                      category vs trailing 3-month avg
--
-- All six: service_role only, same as reconcile_ledger_totals (0048) —
-- these are cron-only diagnostic helpers with no signed-in-session
-- concept of "current institute," called with p_institute_id explicitly
-- by the automation job. An interactive "explore anomalies yourself"
-- report page, if ever built, would need its own authenticated wrapper
-- with the current_institute_id() check 0052 established — same shape as
-- queue_fee_notification wrapping queue_fee_notification_internal.
-- ============================================================================

-- 1. Cash collection suddenly drops. Combines fee_payments + income (both
-- "money someone handed over in cash," the same combination
-- reconcile_ledger_totals (0048) already treats as one concept) into one
-- daily total, then compares p_date against the preceding 30 days' daily
-- average. Deliberately excludes p_date itself from its own baseline.
create or replace function detect_cash_collection_anomaly(p_institute_id uuid, p_date date)
returns table(current_amount numeric, baseline_avg numeric, change_pct numeric, is_anomaly boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_current numeric;
  v_baseline numeric;
begin
  with daily as (
    select d::date as day, (
      coalesce((select sum(amount) from fee_payments where institute_id = p_institute_id and method = 'Cash' and paid_on = d::date), 0) +
      coalesce((select sum(amount) from income where institute_id = p_institute_id and method = 'Cash' and income_date = d::date), 0)
    ) as total
    from generate_series(p_date - 30, p_date, interval '1 day') d
  )
  select
    (select total from daily where day = p_date),
    (select avg(total) from daily where day < p_date)
  into v_current, v_baseline;

  return query select
    coalesce(v_current, 0),
    coalesce(v_baseline, 0),
    case when v_baseline > 0 then round((v_current - v_baseline) / v_baseline * 100, 1) else null end,
    -- A 40%+ drop, and only once there's a real baseline (a brand-new
    -- institute with 3 days of history shouldn't get flagged for having
    -- no cash today).
    coalesce(v_baseline, 0) > 0 and coalesce(v_current, 0) <= v_baseline * 0.6;
end;
$$;

revoke execute on function detect_cash_collection_anomaly(uuid, date) from public, authenticated;
grant execute on function detect_cash_collection_anomaly(uuid, date) to service_role;

-- 2. One cashier reversing far more than everyone else. reversed_by
-- (0011) is who actually clicked Reverse — counted across fee_payments +
-- income + expenses, trailing 30 days from p_date. Flagged only when a
-- cashier clears BOTH a floor (3+, so 1 reversal out of an average of 0.4
-- doesn't trigger) AND a real multiple of the average (2x) — either
-- alone is too easy to trip on small numbers.
create or replace function detect_cashier_reversal_anomaly(p_institute_id uuid, p_date date)
returns table(cashier_id uuid, cashier_name text, reversal_count int, institute_avg numeric, is_anomaly boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  with reversals as (
    select reversed_by as cashier_id, reversed_at::date as day from fee_payments
      where institute_id = p_institute_id and reversed_by is not null and reversed_at::date between p_date - 30 and p_date
    union all
    select reversed_by, reversed_at::date from income
      where institute_id = p_institute_id and reversed_by is not null and reversed_at::date between p_date - 30 and p_date
    union all
    select reversed_by, reversed_at::date from expenses
      where institute_id = p_institute_id and reversed_by is not null and reversed_at::date between p_date - 30 and p_date
  ),
  per_cashier as (
    select cashier_id, count(*) as cnt from reversals group by cashier_id
  ),
  avg_all as (
    select coalesce(avg(cnt), 0) as a from per_cashier
  )
  select p.cashier_id, u.name, p.cnt::int, round(avg_all.a, 2),
    p.cnt >= 3 and avg_all.a > 0 and p.cnt >= avg_all.a * 2
  from per_cashier p
  join users u on u.id = p.cashier_id
  cross join avg_all
  order by p.cnt desc;
end;
$$;

revoke execute on function detect_cashier_reversal_anomaly(uuid, date) from public, authenticated;
grant execute on function detect_cashier_reversal_anomaly(uuid, date) to service_role;

-- 3. Expense category unusually high — the exact worked example
-- (Electricity: avg Rs 80,000, this month Rs 145,000, +81%). Trailing
-- 3-month average, excluding the current month itself, per category.
create or replace function detect_expense_category_anomaly(p_institute_id uuid, p_month date default current_date)
returns table(category text, baseline_avg numeric, current_amount numeric, change_pct numeric, is_anomaly boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_this date := date_trunc('month', p_month)::date;
begin
  return query
  with this_month as (
    select category, sum(amount) as total from expenses
    where institute_id = p_institute_id and date_trunc('month', expense_date) = v_this
    group by category
  ),
  trailing_avg as (
    select category, avg(monthly_total) as avg_total from (
      select category, date_trunc('month', expense_date) as m, sum(amount) as monthly_total
      from expenses
      where institute_id = p_institute_id
        and expense_date >= v_this - interval '3 months' and expense_date < v_this
      group by category, date_trunc('month', expense_date)
    ) x
    group by category
  )
  select
    coalesce(tm.category, tr.category),
    coalesce(tr.avg_total, 0),
    coalesce(tm.total, 0),
    case when coalesce(tr.avg_total, 0) > 0 then round((coalesce(tm.total,0) - tr.avg_total) / tr.avg_total * 100, 1) else null end,
    -- +50% or more, and only for a category with real history — a
    -- brand-new expense category has nothing to compare against yet.
    coalesce(tr.avg_total, 0) > 0 and coalesce(tm.total, 0) >= tr.avg_total * 1.5
  from this_month tm
  full outer join trailing_avg tr on tr.category = tm.category;
end;
$$;

revoke execute on function detect_expense_category_anomaly(uuid, date) from public, authenticated;
grant execute on function detect_expense_category_anomaly(uuid, date) to service_role;

-- 4. Student arrears increasing. Unlike the others, there's no history
-- table this can average against — arrears is a running BALANCE, not a
-- flow of dated transactions, so there's no "trailing 3 months of arrears
-- snapshots" to query. The baseline instead is simply "what this same
-- check computed last time it ran," read back from this job's own most
-- recent automation_runs.summary (job_key='anomaly-detection') by the JS
-- job, not by this function — this function only computes today's true
-- figure. That keeps this migration from needing a new snapshot table
-- purely to support one of six checks.
create or replace function get_current_arrears_total(p_institute_id uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(total_payable - paid_total), 0)
  from fee_records
  where institute_id = p_institute_id and status in ('unpaid', 'partial');
$$;

revoke execute on function get_current_arrears_total(uuid) from public, authenticated;
grant execute on function get_current_arrears_total(uuid) to service_role;

-- 5. Salary cost unusually high — same shape as the expense-category
-- check, applied to total payroll instead of one category. Uses
-- gross_salary (base + percentage share + allowances/deductions —
-- everything 0049 added), not just paid_total, since a draft is worth
-- comparing the moment it's generated, before anyone's approved or paid it.
create or replace function detect_salary_cost_anomaly(p_institute_id uuid, p_month date default current_date)
returns table(baseline_avg numeric, current_amount numeric, change_pct numeric, is_anomaly boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_this date := date_trunc('month', p_month)::date;
  v_current numeric;
  v_baseline numeric;
begin
  select coalesce(sum(gross_salary), 0) into v_current
    from salary_records where institute_id = p_institute_id and month = v_this;

  select coalesce(avg(monthly_total), 0) into v_baseline from (
    select month, sum(gross_salary) as monthly_total from salary_records
    where institute_id = p_institute_id and month >= v_this - interval '3 months' and month < v_this
    group by month
  ) x;

  return query select
    v_baseline, v_current,
    case when v_baseline > 0 then round((v_current - v_baseline) / v_baseline * 100, 1) else null end,
    v_baseline > 0 and v_current >= v_baseline * 1.25;
end;
$$;

revoke execute on function detect_salary_cost_anomaly(uuid, date) from public, authenticated;
grant execute on function detect_salary_cost_anomaly(uuid, date) to service_role;

-- 6. Inventory usage abnormal — stock-out quantity per category, this
-- month vs trailing 3-month average. Quantity, not value: units differ by
-- item (reams, liters, boxes), but summing quantity within one category
-- is still meaningful since a category groups genuinely comparable items,
-- the same assumption inventory_categories already makes everywhere else
-- (Stock Report groups by category too).
create or replace function detect_inventory_usage_anomaly(p_institute_id uuid, p_month date default current_date)
returns table(category_name text, baseline_avg numeric, current_amount numeric, change_pct numeric, is_anomaly boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_this date := date_trunc('month', p_month)::date;
begin
  return query
  with this_month as (
    select c.id as category_id, c.name, sum(m.quantity) as total
    from inventory_stock_movements m
    join inventory_items i on i.id = m.item_id
    join inventory_categories c on c.id = i.category_id
    where m.institute_id = p_institute_id and m.movement_type = 'stock_out'
      and date_trunc('month', m.movement_date) = v_this
    group by c.id, c.name
  ),
  trailing_avg as (
    select c.id as category_id, avg(monthly_total) as avg_total from (
      select c.id, date_trunc('month', m.movement_date) as mo, sum(m.quantity) as monthly_total
      from inventory_stock_movements m
      join inventory_items i on i.id = m.item_id
      join inventory_categories c on c.id = i.category_id
      where m.institute_id = p_institute_id and m.movement_type = 'stock_out'
        and m.movement_date >= v_this - interval '3 months' and m.movement_date < v_this
      group by c.id, date_trunc('month', m.movement_date)
    ) x(id, mo, monthly_total)
    group by c.id
  )
  select
    coalesce(tm.name, ic.name),
    coalesce(tr.avg_total, 0),
    coalesce(tm.total, 0),
    case when coalesce(tr.avg_total, 0) > 0 then round((coalesce(tm.total,0) - tr.avg_total) / tr.avg_total * 100, 1) else null end,
    coalesce(tr.avg_total, 0) > 0 and coalesce(tm.total, 0) >= tr.avg_total * 1.5
  from this_month tm
  full outer join trailing_avg tr on tr.category_id = tm.category_id
  left join inventory_categories ic on ic.id = tr.category_id;
end;
$$;

revoke execute on function detect_inventory_usage_anomaly(uuid, date) from public, authenticated;
grant execute on function detect_inventory_usage_anomaly(uuid, date) to service_role;

-- ----------------------------------------------------------------------------
-- Storage: staff_notifications (0050) again — type='anomaly', same
-- upsert-in-place-while-open shape as low_stock, so ten days of the same
-- Electricity overspend is one row refreshed in place, not ten. related_id
-- is null for anomalies (there's no single row an anomaly is "about" the
-- way a low-stock alert is about one inventory_items row) — the dedupe
-- key is (institute_id, type, metric) instead, via related_table holding
-- the metric identifier.
-- ----------------------------------------------------------------------------
create unique index if not exists idx_staff_notifications_anomaly_dedupe
  on staff_notifications(institute_id, type, related_table)
  where dismissed_at is null and type = 'anomaly';

create or replace function upsert_anomaly_notification(
  p_institute_id uuid, p_metric_key text, p_severity text, p_title text, p_message text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into staff_notifications (institute_id, type, severity, title, message, related_table, related_id)
    values (p_institute_id, 'anomaly', p_severity, p_title, p_message, p_metric_key, null)
  on conflict (institute_id, type, related_table) where dismissed_at is null and type = 'anomaly'
  do update set message = excluded.message, severity = excluded.severity, title = excluded.title, updated_at = now();
end;
$$;

revoke execute on function upsert_anomaly_notification(uuid, text, text, text, text) from public, authenticated;
grant execute on function upsert_anomaly_notification(uuid, text, text, text, text) to service_role;

insert into automation_jobs (key, name, description, schedule) values
  ('anomaly-detection', 'Anomaly Detection', 'Flags unusual cash collection, cashier reversals, expense categories, arrears growth, salary cost, and inventory usage.', '0 4 * * *')
on conflict (key) do nothing;
