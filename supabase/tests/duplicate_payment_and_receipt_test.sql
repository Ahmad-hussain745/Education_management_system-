-- ============================================================================
-- DUPLICATE PAYMENT (THE MANDATORY TEST), RECEIPT, PREVIOUS BALANCE,
-- DISCOUNT — run in the Supabase SQL Editor against your actual project.
--
-- This is the SQL-level twin of the mandatory test in
-- lib/offline/repositories/__tests__/payments-offline.test.js. That file
-- runs constantly (npm test, no live database needed) against a faithful
-- JS reproduction of record_fee_payment()'s logic. THIS file calls the
-- real function for real, which the JS test explicitly cannot — run this
-- one before trusting a production deploy, not just the JS suite.
--
-- Read the RAISE NOTICE output after running: every step prints PASS/FAIL.
-- ============================================================================

begin;

do $$
declare
  v_class_id       uuid;
  v_student_id     uuid;
  v_fee_record_id  uuid;
  v_month          date := '2026-08-01';
  v_key            uuid := gen_random_uuid();
  v_payment_1      record;
  v_payment_2      record;
  v_payment_count  int;
  v_receipt_1      text;
  v_receipt_2      text;
begin
  -------------------------------------------------------------------------
  -- SETUP
  -------------------------------------------------------------------------
  insert into classes (name, sort_order) values ('TEST Class Dup', 9998) returning id into v_class_id;
  insert into fee_structures (class_id, monthly_fee, effective_from, active) values (v_class_id, 8000, '2026-01-01', true);
  insert into students (name, class_id, status) values ('TEST Duplicate Student', v_class_id, 'active') returning id into v_student_id;
  v_fee_record_id := get_or_create_fee_record(v_student_id, v_month);

  -------------------------------------------------------------------------
  -- THE MANDATORY TEST: call record_fee_payment TWICE with the SAME
  -- idempotency key — exactly what a dropped-response sync retry does.
  -------------------------------------------------------------------------
  select * into v_payment_1 from record_fee_payment(v_fee_record_id, v_student_id, v_month, 3000, 'Cash', null, false, v_key);
  select * into v_payment_2 from record_fee_payment(v_fee_record_id, v_student_id, v_month, 3000, 'Cash', null, false, v_key);

  select count(*) into v_payment_count from fee_payments where idempotency_key = v_key;
  if v_payment_count != 1 then
    raise exception 'FAIL — duplicate sync produced % payment rows, expected exactly 1', v_payment_count;
  end if;
  raise notice 'PASS — retried sync with the same idempotency key produced exactly ONE payment row';

  if v_payment_1.id != v_payment_2.id then
    raise exception 'FAIL — the two calls returned DIFFERENT payment ids (% vs %)', v_payment_1.id, v_payment_2.id;
  end if;
  raise notice 'PASS — both calls returned the SAME payment id (%), not a new one', v_payment_1.id;

  -- Three more retries for good measure — not just "the second one was fine."
  perform record_fee_payment(v_fee_record_id, v_student_id, v_month, 3000, 'Cash', null, false, v_key);
  perform record_fee_payment(v_fee_record_id, v_student_id, v_month, 3000, 'Cash', null, false, v_key);
  perform record_fee_payment(v_fee_record_id, v_student_id, v_month, 3000, 'Cash', null, false, v_key);
  select count(*) into v_payment_count from fee_payments where idempotency_key = v_key;
  if v_payment_count != 1 then
    raise exception 'FAIL — after 5 total retries, % rows exist, expected 1', v_payment_count;
  end if;
  raise notice 'PASS — five total retries, still exactly ONE payment row';

  -------------------------------------------------------------------------
  -- A genuinely SECOND payment (different idempotency key) must NOT be
  -- deduplicated against the first — two real payments are two real rows.
  -------------------------------------------------------------------------
  perform record_fee_payment(v_fee_record_id, v_student_id, v_month, 1000, 'Cash', null, false, gen_random_uuid());
  select count(*) into v_payment_count from fee_payments where fee_record_id = v_fee_record_id;
  if v_payment_count != 2 then
    raise exception 'FAIL — a genuinely different payment was incorrectly deduplicated (% rows, expected 2)', v_payment_count;
  end if;
  raise notice 'PASS — a genuinely separate payment (different idempotency key) was NOT merged with the first';

  -------------------------------------------------------------------------
  -- RECEIPT — assigned, non-null, unique, correct format.
  -------------------------------------------------------------------------
  select receipt_no into v_receipt_1 from fee_payments where id = v_payment_1.id;
  if v_receipt_1 is null then
    raise exception 'FAIL — receipt_no was not assigned';
  end if;
  if v_receipt_1 !~ '^RCP-\d{4}-\d{6}$' then
    raise exception 'FAIL — receipt_no "%" does not match the expected RCP-YYYY-NNNNNN format', v_receipt_1;
  end if;
  raise notice 'PASS — receipt assigned in the correct format: %', v_receipt_1;

  select receipt_no into v_receipt_2 from fee_payments
    where fee_record_id = v_fee_record_id and amount = 1000 order by paid_on desc limit 1;
  if v_receipt_2 = v_receipt_1 then
    raise exception 'FAIL — two different payments got the SAME receipt number';
  end if;
  raise notice 'PASS — the second, separate payment got a different receipt number (%)', v_receipt_2;

  -------------------------------------------------------------------------
  -- PREVIOUS BALANCE / ARREARS — next month's bill carries forward what's
  -- still owed (8000 - 4000 paid so far = 4000 arrears).
  -------------------------------------------------------------------------
  declare
    v_next_month date := '2026-09-01';
    v_next_record uuid;
    v_next_prev_balance numeric;
  begin
    v_next_record := get_or_create_fee_record(v_student_id, v_next_month);
    select previous_balance into v_next_prev_balance from fee_records where id = v_next_record;
    if v_next_prev_balance != 4000 then
      raise exception 'FAIL — expected 4000 in arrears carried forward, got %', v_next_prev_balance;
    end if;
    raise notice 'PASS — arrears of Rs. 4000 correctly carried into next month''s bill';
  end;

  -------------------------------------------------------------------------
  -- DISCOUNT — a Rs. 1000 active discount reduces the NEXT bill generated
  -- (existing fee_records aren't retroactively changed by a new discount).
  -------------------------------------------------------------------------
  declare
    v_disc_month date := '2026-10-01';
    v_disc_record uuid;
    v_disc_fee numeric;
    v_disc_amount numeric;
    v_disc_total numeric;
    v_disc_prev numeric;
  begin
    insert into fee_discounts (student_id, amount, active, reason) values (v_student_id, 1000, true, 'TEST scholarship');
    v_disc_record := get_or_create_fee_record(v_student_id, v_disc_month);
    select monthly_fee, discount, total_payable, previous_balance into v_disc_fee, v_disc_amount, v_disc_total, v_disc_prev from fee_records where id = v_disc_record;
    if v_disc_amount != 1000 then
      raise exception 'FAIL — discount amount on the new bill is %, expected 1000', v_disc_amount;
    end if;
    -- total_payable = this month's fee + whatever arrears/credit carried
    -- forward (the earlier block in this same test deliberately built up
    -- arrears before reaching October) - the discount. Not just fee minus
    -- discount on its own — previous_balance is a real, expected input
    -- here, not something to ignore.
    if v_disc_total != (v_disc_fee + v_disc_prev - 1000) then
      raise exception 'FAIL — total_payable (%) does not reflect monthly_fee (%) + previous_balance (%) minus the 1000 discount', v_disc_total, v_disc_fee, v_disc_prev;
    end if;
    raise notice 'PASS — active discount of Rs. 1000 correctly reduced the new bill''s total_payable';
  end;

  raise notice '=== ALL DUPLICATE PAYMENT / RECEIPT / BALANCE / DISCOUNT TESTS PASSED ===';
end $$;

rollback;
