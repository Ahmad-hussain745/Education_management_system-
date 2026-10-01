-- ============================================================================
-- 27. ENFORCE MONTHLY CLOSING AT THE DATABASE
--
-- monthly_closing (0001_init.sql) has always been a snapshot: closing a
-- month writes one row with that month's totals frozen into `snapshot`, but
-- nothing stopped a fee payment, income entry, expense, or salary payment
-- from being inserted dated INTO that already-closed month afterward. The
-- UI called it "closed"; the database never enforced it. A late Cashier
-- entry backdated into a closed month would silently make that month's
-- frozen `snapshot` wrong with no error anywhere.
--
-- Fix: a helper that answers "is this month closed", plus a BEFORE INSERT
-- trigger on each of the four ledger tables that calls it against that
-- table's own date column and rejects the insert outright if the month is
-- closed. No role bypasses this — Cashier, Accountant, even Super Admin — a
-- closed month is closed for everyone; the sanctioned way to correct
-- something dated into a closed month is the SAME reverse-then-adjust path
-- already used for any posted ledger row (0011_immutable_ledger.sql), never
-- a new backdated insert.
--
-- Why this doesn't also need to block reverse_*()/post_transaction():
-- checked directly against 0011 — reverse_fee_payment(),
-- reverse_income(), reverse_expense() and reverse_salary_payment() never
-- INSERT into fee_payments/income/expenses/salary_payments at all. Each one
-- only UPDATEs the reversed_at/reversed_by/reversal_reason columns on the
-- EXISTING row (which enforce_ledger_row_immutable() already permits), and
-- separately calls post_transaction() to post the reversing entry into
-- `transactions` — a different table, not one of the four this migration
-- guards. So reversing a payment that happened to fall in a since-closed
-- month keeps working exactly as designed; only NEW inserts dated into a
-- closed month are blocked.
-- ============================================================================

create or replace function is_month_closed(p_month date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from monthly_closing
    where month = date_trunc('month', p_month)::date
  );
$$;

grant execute on function is_month_closed(date) to authenticated;

-- ----------------------------------------------------------------------------
-- fee_payments — guard on paid_on (the actual payment date; `month`,
-- alongside it, is the fee-record month, not necessarily today).
-- ----------------------------------------------------------------------------
create or replace function check_fee_payment_month_open() returns trigger as $$
begin
  if is_month_closed(new.paid_on) then
    raise exception 'MONTH_CLOSED: The accounting month for % is closed. To correct a closed month, reverse the original entry and post an adjustment in the current month instead of backdating a new one.', new.paid_on;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_check_fee_payment_month_open on fee_payments;
create trigger trg_check_fee_payment_month_open
  before insert on fee_payments
  for each row execute function check_fee_payment_month_open();

-- ----------------------------------------------------------------------------
-- income — guard on income_date.
-- ----------------------------------------------------------------------------
create or replace function check_income_month_open() returns trigger as $$
begin
  if is_month_closed(new.income_date) then
    raise exception 'MONTH_CLOSED: The accounting month for % is closed. To correct a closed month, reverse the original entry and post an adjustment in the current month instead of backdating a new one.', new.income_date;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_check_income_month_open on income;
create trigger trg_check_income_month_open
  before insert on income
  for each row execute function check_income_month_open();

-- ----------------------------------------------------------------------------
-- expenses — guard on expense_date.
-- ----------------------------------------------------------------------------
create or replace function check_expense_month_open() returns trigger as $$
begin
  if is_month_closed(new.expense_date) then
    raise exception 'MONTH_CLOSED: The accounting month for % is closed. To correct a closed month, reverse the original entry and post an adjustment in the current month instead of backdating a new one.', new.expense_date;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_check_expense_month_open on expenses;
create trigger trg_check_expense_month_open
  before insert on expenses
  for each row execute function check_expense_month_open();

-- ----------------------------------------------------------------------------
-- salary_payments — guard on paid_on (the actual payout date; `month` is the
-- payroll month the salary_record belongs to, not necessarily today).
-- ----------------------------------------------------------------------------
create or replace function check_salary_payment_month_open() returns trigger as $$
begin
  if is_month_closed(new.paid_on) then
    raise exception 'MONTH_CLOSED: The accounting month for % is closed. To correct a closed month, reverse the original entry and post an adjustment in the current month instead of backdating a new one.', new.paid_on;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_check_salary_payment_month_open on salary_payments;
create trigger trg_check_salary_payment_month_open
  before insert on salary_payments
  for each row execute function check_salary_payment_month_open();
