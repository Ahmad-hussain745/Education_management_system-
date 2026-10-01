-- ============================================================================
-- FEE WORKFLOW TEST — run this in the Supabase SQL Editor against your
-- actual project. It exercises the real functions/triggers the app calls
-- (get_or_create_fee_record, the fee_payments INSERT triggers), not a
-- simulation — then ROLLBACKs, so it leaves no test data behind either way.
--
-- Read the RAISE NOTICE output after running: every step prints PASS/FAIL.
-- If anything fails, the whole block raises and you'll see which assertion
-- and why.
-- ============================================================================

begin;

do $$
declare
  v_class_id       uuid;
  v_section_id     uuid;
  v_student_ids    uuid[] := '{}';
  v_sid            uuid;
  v_fee_record_id  uuid;
  v_expected       numeric;
  v_collected      numeric;
  v_remaining      numeric;
  -- Pick a month with no monthly_closing row yet in your project, or this
  -- step will fail with MONTH_CLOSED (which is itself correct behaviour,
  -- just not what this test is checking) — change if needed.
  v_month          date := '2026-08-01';
  v_i              int;
  v_caught         text;
begin
  -------------------------------------------------------------------------
  -- 1. SETUP — Class 10, Section A, 10 students, monthly fee Rs. 8,000
  -------------------------------------------------------------------------
  insert into classes (name, sort_order) values ('TEST Class 10', 9999) returning id into v_class_id;
  insert into sections (class_id, name) values (v_class_id, 'A') returning id into v_section_id;
  insert into fee_structures (class_id, monthly_fee, effective_from, active)
    values (v_class_id, 8000, '2026-01-01', true);

  for v_i in 1..10 loop
    insert into students (name, class_id, section_id, status)
      values ('TEST Student ' || v_i, v_class_id, v_section_id, 'active')
      returning id into v_sid;
    v_student_ids := array_append(v_student_ids, v_sid);
  end loop;
  raise notice 'Setup complete: % students in Class 10 / Section A at Rs. 8,000/month', array_length(v_student_ids, 1);

  -------------------------------------------------------------------------
  -- 2. GENERATE AUGUST FEES
  --
  -- NOTE: there is no single "Generate fees for a class/month" button in
  -- the app today. Bills are created lazily, one student at a time, via
  -- get_or_create_fee_record() — currently only called from Payment
  -- Entry's getBillPreview(). This loop reproduces that by calling the
  -- same function once per student, which is functionally what happens
  -- if a cashier opens Payment Entry for all 10 students.
  -------------------------------------------------------------------------
  foreach v_sid in array v_student_ids loop
    perform get_or_create_fee_record(v_sid, v_month);
  end loop;

  select coalesce(sum(total_payable), 0) into v_expected
    from fee_records where student_id = any(v_student_ids) and month = v_month;

  if v_expected <> 80000 then
    raise exception 'FAIL — Expected should be Rs. 80,000 (10 x 8,000), got Rs. %', v_expected;
  end if;
  raise notice 'PASS — Expected = Rs. % (10 x 8,000)', v_expected;

  -------------------------------------------------------------------------
  -- 3. COLLECT Rs. 50,000 total — Rs. 5,000 from each of the 10 students
  -------------------------------------------------------------------------
  foreach v_sid in array v_student_ids loop
    select id into v_fee_record_id from fee_records where student_id = v_sid and month = v_month;
    insert into fee_payments (fee_record_id, student_id, month, amount, method, paid_on)
      values (v_fee_record_id, v_sid, v_month, 5000, 'Cash', '2026-08-15');
  end loop;

  select coalesce(sum(total_payable), 0), coalesce(sum(paid_total), 0)
    into v_expected, v_collected
    from fee_records where student_id = any(v_student_ids) and month = v_month;
  v_remaining := v_expected - v_collected;

  if v_collected <> 50000 or v_remaining <> 30000 then
    raise exception 'FAIL — expected Collected=50,000/Remaining=30,000, got Collected=%/Remaining=%', v_collected, v_remaining;
  end if;
  raise notice 'PASS — Expected=Rs. %, Collected=Rs. %, Remaining=Rs. %', v_expected, v_collected, v_remaining;

  -------------------------------------------------------------------------
  -- 4. TRY A Rs. 40,000 PAYMENT — must be rejected
  --
  -- Important nuance: the guard (0007_fee_payment_validation.sql) checks
  -- remaining on the ONE STUDENT'S bill being paid, not the class-wide
  -- Rs. 30,000 remaining across all 10. Each student's own bill here is
  -- Rs. 8,000 with Rs. 5,000 already paid, so their individual remaining
  -- is Rs. 3,000 — a Rs. 40,000 payment fails for that reason regardless.
  -- There's no path in this app to pay one lump sum against a class's
  -- combined balance; every payment is per student, per month.
  -------------------------------------------------------------------------
  v_sid := v_student_ids[1];
  select id into v_fee_record_id from fee_records where student_id = v_sid and month = v_month;

  begin
    insert into fee_payments (fee_record_id, student_id, month, amount, method, paid_on)
      values (v_fee_record_id, v_sid, v_month, 40000, 'Cash', '2026-08-16');
    raise exception 'FAIL — a Rs. 40,000 payment was ACCEPTED. It should have been rejected.';
  exception
    when others then
      get stacked diagnostics v_caught = message_text;
      if v_caught like 'PAYMENT_EXCEEDS_REMAINING%' then
        raise notice 'PASS — Rs. 40,000 payment correctly rejected: %', v_caught;
      else
        raise; -- some other, unexpected error — surface it
      end if;
  end;

  raise notice '=== ALL CHECKS PASSED ===';
end $$;

-- Leaves your real data untouched either way.
rollback;
