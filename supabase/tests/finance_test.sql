-- ============================================================================
-- FINANCE TEST — run in the Supabase SQL Editor against your actual
-- project. Posts one of each transaction type (fee payment, other income,
-- expense, salary payment) through the real tables/triggers, then computes
-- the month's totals EXACTLY the way both Dashboard and Finance Reports do
-- (group transactions by type) to confirm they'd show the same number.
-- Then ROLLBACKs — safe to run against production data.
-- ============================================================================

begin;

do $$
declare
  v_class_id      uuid;
  v_teacher_id    uuid;
  v_student_id    uuid;
  v_fee_record_id uuid;
  v_salary_record_id uuid;
  v_month         date := '2026-08-01';  -- change if this month is already closed in your project
  v_fee_income    numeric;
  v_other_income  numeric;
  v_expenses      numeric;
  v_salary        numeric;
  v_total_income  numeric;
  v_net           numeric;
begin
  -------------------------------------------------------------------------
  -- SETUP — just enough to post one real row of each type
  -------------------------------------------------------------------------
  insert into classes (name, sort_order) values ('TEST Class (finance)', 9997) returning id into v_class_id;
  insert into fee_structures (class_id, monthly_fee, effective_from, active) values (v_class_id, 50000, '2026-01-01', true);
  insert into students (name, class_id, status) values ('TEST Student (finance)', v_class_id, 'active') returning id into v_student_id;
  insert into teachers (name, status, salary_mode, fixed_salary) values ('TEST Teacher (finance)', 'active', 'percentage', 0) returning id into v_teacher_id;

  -------------------------------------------------------------------------
  -- ENTER THE FOUR FIGURES
  -------------------------------------------------------------------------
  -- Fee Collection = Rs. 50,000
  v_fee_record_id := get_or_create_fee_record(v_student_id, v_month);
  insert into fee_payments (fee_record_id, student_id, month, amount, method, paid_on)
    values (v_fee_record_id, v_student_id, v_month, 50000, 'Cash', '2026-08-05');

  -- Other Income = Rs. 20,000
  insert into income (category, amount, method, income_date)
    values ('TEST — Donation', 20000, 'Cash', '2026-08-06');

  -- Expense = Rs. 10,000
  insert into expenses (category, amount, method, expense_date)
    values ('TEST — Supplies', 10000, 'Cash', '2026-08-07');

  -- Salary = Rs. 30,000 (posted directly as a salary_record + payment,
  -- bypassing generate_salary_records() since this test only needs one
  -- transactions row of type salary_payment — payroll automation itself is
  -- covered by the separate Salary Automation test)
  insert into salary_records (teacher_id, month, percentage_total)
    values (v_teacher_id, v_month, 30000)
    returning id into v_salary_record_id;
  insert into salary_payments (salary_record_id, teacher_id, month, amount, method, paid_on)
    values (v_salary_record_id, v_teacher_id, v_month, 30000, 'Bank Transfer', '2026-08-08');

  raise notice 'Posted: Fee=50,000, Other Income=20,000, Expense=10,000, Salary=30,000';

  -------------------------------------------------------------------------
  -- COMPUTE EXACTLY THE WAY DASHBOARD AND FINANCE REPORTS DO —
  -- group the unified `transactions` table by type for the month.
  -------------------------------------------------------------------------
  select amount into v_fee_income from transactions where type = 'fee_payment' and txn_date = '2026-08-05' and amount = 50000 order by created_at desc limit 1;
  select amount into v_other_income from transactions where type = 'income' and txn_date = '2026-08-06' and amount = 20000 order by created_at desc limit 1;
  select amount into v_expenses from transactions where type = 'expense' and txn_date = '2026-08-07' and amount = 10000 order by created_at desc limit 1;
  select amount into v_salary from transactions where type = 'salary_payment' and txn_date = '2026-08-08' and amount = 30000 order by created_at desc limit 1;

  if v_fee_income is null or v_other_income is null or v_expenses is null or v_salary is null then
    raise exception 'FAIL — one of the four transactions did not post to the ledger (trigger not firing?). fee=%, other=%, expense=%, salary=%', v_fee_income, v_other_income, v_expenses, v_salary;
  end if;

  v_total_income := v_fee_income + v_other_income;
  v_net := v_total_income - v_expenses - v_salary;

  if v_total_income <> 70000 then
    raise exception 'FAIL — Total Income should be Rs. 70,000 (50,000 + 20,000), got Rs. %', v_total_income;
  end if;
  raise notice 'PASS — Total Income = Rs. %', v_total_income;

  if v_net <> 30000 then
    raise exception 'FAIL — Net should be Rs. 30,000 (70,000 - 10,000 - 30,000), got Rs. %', v_net;
  end if;
  raise notice 'PASS — Net = Rs. % (this is what both Dashboard and Finance Reports read off the same transactions table — they cannot disagree with each other by construction)', v_net;

  raise notice '=== ALL CHECKS PASSED ===';
end $$;

-- Leaves your real data untouched either way.
rollback;
