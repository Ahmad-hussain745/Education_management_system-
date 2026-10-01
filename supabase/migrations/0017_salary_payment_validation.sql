-- ============================================================================
-- 25. SALARY PAYMENT VALIDATION — reject amount > remaining balance
--
-- Same shape as 0007_fee_payment_validation.sql's check on fee_payments,
-- applied to salary_payments: the app-layer check in
-- app/(app)/salary/payroll/actions.js (recordSalaryPayment) computed
--   remaining = gross_salary - paid_total
-- and rejected an over-large amount there — but that's the application
-- layer only. Anyone/anything writing directly to salary_payments (a future
-- API route, a script, a different client, a bug in a later refactor of
-- this action) bypasses that check entirely. The database needs to enforce
-- the same rule itself, not just trust that every future caller remembers
-- to ask first.
--
-- `select ... for update` locks the salary_records row for the duration of
-- this transaction, so two concurrent payment inserts against the same
-- record can't both read the same pre-payment paid_total and each pass the
-- check — the second one blocks until the first commits (and its trigger's
-- AFTER-insert sync updates paid_total), then re-reads the now-current
-- total. Without this lock, two simultaneous payments could each be valid
-- alone but together exceed gross_salary.
--
-- Deliberately strict, same stance as 0007: no "advance salary" feature
-- exists, so an overpayment is rejected outright rather than silently
-- accepted as a credit.
-- ============================================================================

create or replace function validate_salary_payment()
returns trigger
language plpgsql
as $$
declare
  v_gross numeric;
  v_paid numeric;
begin

  select gross_salary, paid_total
  into v_gross, v_paid
  from salary_records
  where id = new.salary_record_id
  for update;

  if new.amount <= 0 then
    raise exception 'Salary payment must be greater than zero.';
  end if;

  if new.amount > greatest(v_gross - v_paid, 0) then
    raise exception 'Salary payment exceeds remaining salary.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_salary_payment
on salary_payments;

create trigger trg_validate_salary_payment
before insert on salary_payments
for each row
execute function validate_salary_payment();

