-- ============================================================================
-- 52. MANAGEMENT REPORTING — trend and comparison data, real numbers only
--
-- Both functions here return ACTUAL historical figures from fee_payments/
-- income/expenses — nothing projected. Forecasting itself is deliberately
-- NOT done here in SQL: it happens in the application layer
-- (app/(app)/reports/management/), computed live from this real data and
-- never written back to any table. That split is the actual mechanism
-- behind "keep forecasting separate from actual accounting" — a forecast
-- that only ever exists as a number computed at render time, from
-- functions that only ever report what really happened, structurally
-- cannot leak into a real balance or bill no matter what the application
-- layer does with it.
--
-- Following 0051's audit findings to the letter: explicit p_institute_id
-- parameter (not current_institute_id() alone) is checked against the
-- caller's actual institute before anything runs — the same pattern the
-- audit just spent an entire migration adding everywhere it was missing.
-- ============================================================================

create or replace function finance_monthly_trend(p_institute_id uuid, p_months int default 6)
returns table(month date, collected numeric, other_income numeric, expenses numeric, net numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_institute_id != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That institute does not match your session.';
  end if;
  if not can_view_finance() then
    raise exception 'NOT_AUTHORIZED: Not authorized to view finance reports.';
  end if;
  if p_months is null or p_months < 1 or p_months > 24 then
    raise exception 'INVALID_RANGE: Choose between 1 and 24 months.';
  end if;

  return query
  with months as (
    select date_trunc('month', current_date - (n || ' months')::interval)::date as m
    from generate_series(0, p_months - 1) as n
  ),
  coll as (
    select date_trunc('month', paid_on)::date as m, sum(amount) as total
    from fee_payments where institute_id = p_institute_id group by 1
  ),
  inc as (
    select date_trunc('month', income_date)::date as m, sum(amount) as total
    from income where institute_id = p_institute_id group by 1
  ),
  exp as (
    select date_trunc('month', expense_date)::date as m, sum(amount) as total
    from expenses where institute_id = p_institute_id group by 1
  )
  select
    mo.m,
    coalesce(c.total, 0),
    coalesce(i.total, 0),
    coalesce(e.total, 0),
    coalesce(c.total, 0) + coalesce(i.total, 0) - coalesce(e.total, 0)
  from months mo
  left join coll c on c.m = mo.m
  left join inc i on i.m = mo.m
  left join exp e on e.m = mo.m
  order by mo.m;
end;
$$;

revoke execute on function finance_monthly_trend(uuid, int) from public;
grant execute on function finance_monthly_trend(uuid, int) to authenticated;

-- Single month vs. the month before it — the exact "August Rs 3.8M,
-- September Rs 4.1M, Growth +7.9%" shape from the request. Built as its
-- own function rather than "just take the last two rows of the trend"
-- so a report needing only this doesn't have to fetch and discard N
-- months of history it isn't using.
create or replace function finance_month_comparison(p_institute_id uuid, p_month date default current_date)
returns table(
  this_month date, this_collected numeric, this_expenses numeric,
  last_month date, last_collected numeric, last_expenses numeric,
  collection_growth_pct numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_this date := date_trunc('month', p_month)::date;
  v_last date := (date_trunc('month', p_month) - interval '1 month')::date;
  v_this_coll numeric; v_last_coll numeric;
  v_this_exp numeric; v_last_exp numeric;
begin
  if p_institute_id != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That institute does not match your session.';
  end if;
  if not can_view_finance() then
    raise exception 'NOT_AUTHORIZED: Not authorized to view finance reports.';
  end if;

  select coalesce(sum(amount), 0) into v_this_coll from fee_payments
    where institute_id = p_institute_id and date_trunc('month', paid_on) = v_this;
  select coalesce(sum(amount), 0) into v_last_coll from fee_payments
    where institute_id = p_institute_id and date_trunc('month', paid_on) = v_last;
  select coalesce(sum(amount), 0) into v_this_exp from expenses
    where institute_id = p_institute_id and date_trunc('month', expense_date) = v_this;
  select coalesce(sum(amount), 0) into v_last_exp from expenses
    where institute_id = p_institute_id and date_trunc('month', expense_date) = v_last;

  return query select
    v_this, v_this_coll, v_this_exp,
    v_last, v_last_coll, v_last_exp,
    case when v_last_coll > 0 then round((v_this_coll - v_last_coll) / v_last_coll * 100, 1) else null end;
end;
$$;

revoke execute on function finance_month_comparison(uuid, date) from public;
grant execute on function finance_month_comparison(uuid, date) to authenticated;
