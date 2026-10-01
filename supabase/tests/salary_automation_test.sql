-- ============================================================================
-- SALARY AUTOMATION TEST — run in the Supabase SQL Editor against your
-- actual project. Exercises the real functions/triggers the app calls
-- (generate_salary_records, class_collected_amount, the salary_payments
-- trigger) — not a simulation — then ROLLBACKs, so it's safe to run
-- against production data.
--
-- Read the RAISE NOTICE output after running: every step prints PASS/FAIL.
-- ============================================================================

begin;

do $$
declare
  v_class_id       uuid;
  v_teacher_id     uuid;
  v_student_id     uuid;
  v_fee_record_id  uuid;
  v_record_id      uuid;
  v_gross          numeric;
  v_status         text;
  v_collected_item numeric;
  v_pct_item       numeric;
  v_share_item     numeric;
  v_month          date := '2026-08-01';  -- change if this month is already closed in your project
  v_caught         text;
begin
  -------------------------------------------------------------------------
  -- 1. SETUP — Ahmed, teaching Class 10 at a 60% share
  -------------------------------------------------------------------------
  insert into classes (name, sort_order) values ('TEST Class 10 (salary)', 9998) returning id into v_class_id;
  insert into fee_structures (class_id, monthly_fee, effective_from, active)
    values (v_class_id, 8000, '2026-01-01', true);
  insert into students (name, class_id, status) values ('TEST Student (salary)', v_class_id, 'active') returning id into v_student_id;

  insert into teachers (name, subject_id, status, salary_mode, fixed_salary)
    values ('TEST Ahmed', null, 'active', 'percentage', 0)
    returning id into v_teacher_id;

  insert into salary_rules (teacher_id, class_id, section_id, percentage, active)
    values (v_teacher_id, v_class_id, null, 60, true);

  raise notice 'Setup complete: Ahmed at 60%% on Class 10';

  -------------------------------------------------------------------------
  -- 2. ACTUAL AUGUST COLLECTION — Rs. 50,000 posted against this class
  -- (one payment for simplicity; class_collected_amount() sums by class,
  -- not by student, so how it's split doesn't matter)
  -------------------------------------------------------------------------
  v_fee_record_id := get_or_create_fee_record(v_student_id, v_month);
  update fee_records set monthly_fee = 50000 where id = v_fee_record_id; -- force this one bill to 50,000 so one payment can cover it
  insert into fee_payments (fee_record_id, student_id, month, amount, method, paid_on)
    values (v_fee_record_id, v_student_id, v_month, 50000, 'Cash', '2026-08-10');

  if class_collected_amount(v_class_id, null, v_month) <> 50000 then
    raise exception 'FAIL — class_collected_amount should be Rs. 50,000, got Rs. %', class_collected_amount(v_class_id, null, v_month);
  end if;
  raise notice 'PASS — Actual August collection = Rs. %', class_collected_amount(v_class_id, null, v_month);

  -------------------------------------------------------------------------
  -- 3. GENERATE PAYROLL — 50,000 x 60%% should = 30,000
  -------------------------------------------------------------------------
  perform generate_salary_records(v_month);

  select id, gross_salary, status into v_record_id, v_gross, v_status
    from salary_records where teacher_id = v_teacher_id and month = v_month;

  if v_gross <> 30000 then
    raise exception 'FAIL — Salary should be Rs. 30,000 (50,000 x 60%%), got Rs. %', v_gross;
  end if;
  if v_status <> 'unpaid' then
    raise exception 'FAIL — Status should be Pending/unpaid before any payment, got %', v_status;
  end if;
  -- NOTE: the enum value is 'unpaid', not 'Pending'. The badge in
  -- PayrollRecordCard.js renders {record.status} verbatim, so the app
  -- actually shows "unpaid" here, not "Pending" — see the write-up.
  raise notice 'PASS — Payroll generated: Salary = Rs. %, Status = % (app displays this literally, not "Pending")', v_gross, v_status;

  select collected_amount, percentage, amount into v_collected_item, v_pct_item, v_share_item
    from salary_items where salary_record_id = v_record_id and item_type = 'percentage_share';

  if v_collected_item <> 50000 or v_pct_item <> 60 or v_share_item <> 30000 then
    raise exception 'FAIL — payroll line item should read Collection=50,000/Percentage=60/Share=30,000, got Collection=%/Percentage=%/Share=%', v_collected_item, v_pct_item, v_share_item;
  end if;
  raise notice 'PASS — Payroll line item reads exactly: Collection=Rs. %, Percentage=%%%, Salary=Rs. %', v_collected_item, v_pct_item, v_share_item;

  -------------------------------------------------------------------------
  -- 4. PAY Rs. 30,000 — status should become "paid"
  -------------------------------------------------------------------------
  insert into salary_payments (salary_record_id, teacher_id, month, amount, method, paid_on)
    values (v_record_id, v_teacher_id, v_month, 30000, 'Bank Transfer', '2026-08-20');

  select status into v_status from salary_records where id = v_record_id;
  if v_status <> 'paid' then
    raise exception 'FAIL — Status should be "paid" after paying the full 30,000, got %', v_status;
  end if;
  raise notice 'PASS — After paying Rs. 30,000, Status = %', v_status;

  -------------------------------------------------------------------------
  -- 5. TRY Rs. 35,000 MORE — must be rejected (remaining is now Rs. 0)
  -------------------------------------------------------------------------
  begin
    insert into salary_payments (salary_record_id, teacher_id, month, amount, method, paid_on)
      values (v_record_id, v_teacher_id, v_month, 35000, 'Bank Transfer', '2026-08-21');
    raise exception 'FAIL — a Rs. 35,000 payment was ACCEPTED after the salary was already fully paid.';
  exception
    when others then
      get stacked diagnostics v_caught = message_text;
      if v_caught like '%exceeds remaining salary%' then
        raise notice 'PASS — Rs. 35,000 payment correctly rejected: %', v_caught;
      else
        raise; -- unexpected error — surface it
      end if;
  end;

  raise notice '=== ALL CHECKS PASSED ===';
end $$;

-- Leaves your real data untouched either way.
rollback;
