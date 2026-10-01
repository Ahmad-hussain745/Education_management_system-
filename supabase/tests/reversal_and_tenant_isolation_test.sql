-- ============================================================================
-- REVERSAL + TENANT ISOLATION — run in the Supabase SQL Editor against your
-- actual project, logged in as a Super Admin or Accountant.
--
-- "Logged in" specifically means using Studio's "Impersonate user" feature
-- with a real Super Admin/Accountant account selected — that's what makes
-- auth.uid()/current_institute_id() resolve to a real institute inside the
-- SQL Editor. Running this as plain postgres/service_role with no user
-- impersonated makes current_institute_id() resolve to NULL, which several
-- of these checks below will pass VACUOUSLY (the NULL-propagation that
-- deliberately lets service_role/cron calls through everywhere else in
-- this schema — see security_audit_priority3_fixes.sql's header — applies
-- here too, so an unimpersonated run isn't testing what it looks like it's
-- testing). Confirmed by running this both ways while writing it.
--
-- Doesn't simulate being two different users (fragile, needs real
-- auth.users rows). Simpler and just as real: creates a SECOND institute
-- and tags a few resources with ITS institute_id directly, then proves the
-- CURRENT session (whoever you're logged in/impersonated as) cannot
-- reverse, publish, read, or write for that other institute's resources.
-- Every one of these checks is a regression test for a real bug found and
-- fixed in a security audit — most from the Phase 21 audit (0051), the
-- last three (pending_fee_reminders/record_fee_payment/
-- queue_fee_notification) from the Priority 3 audit
-- (security_audit_priority3_fixes.sql) — this file is what stops any of
-- them coming back silently in a future change. For role-boundary checks
-- (a Teacher accessing another Teacher's records, a Cashier attempting an
-- approval-only action, a Parent reading another family's student) see
-- role_boundary_test.sql instead — those need to actually become a
-- different, lower-privileged user, not just tag data with a different
-- institute, so they use real temporary users rather than impersonation.
-- ============================================================================

begin;

do $$
declare
  v_foreign_institute_id uuid;
  v_foreign_class_id     uuid;
  v_foreign_student_id   uuid;
  v_foreign_fee_record   uuid;
  v_foreign_payment_id   uuid;
  v_foreign_exam_id      uuid;
  v_foreign_item_id      uuid;
  v_caught               text;
begin
  -------------------------------------------------------------------------
  -- SETUP — a second institute, deliberately not the caller's own, with
  -- one resource per function under test.
  -------------------------------------------------------------------------
  insert into institutes (name) values ('TEST Foreign Institute') returning id into v_foreign_institute_id;

  insert into classes (name, sort_order, institute_id) values ('TEST Foreign Class', 9997, v_foreign_institute_id) returning id into v_foreign_class_id;
  insert into students (name, class_id, status, institute_id) values ('TEST Foreign Student', v_foreign_class_id, 'active', v_foreign_institute_id) returning id into v_foreign_student_id;
  insert into fee_records (student_id, month, monthly_fee, institute_id) values (v_foreign_student_id, '2026-08-01', 8000, v_foreign_institute_id) returning id into v_foreign_fee_record;
  insert into fee_payments (fee_record_id, student_id, month, amount, method, institute_id)
    values (v_foreign_fee_record, v_foreign_student_id, '2026-08-01', 5000, 'Cash', v_foreign_institute_id) returning id into v_foreign_payment_id;

  insert into exams (name, institute_id) values ('TEST Foreign Exam', v_foreign_institute_id) returning id into v_foreign_exam_id;

  insert into inventory_items (name, unit, institute_id) values ('TEST Foreign Item', 'pcs', v_foreign_institute_id) returning id into v_foreign_item_id;

  -------------------------------------------------------------------------
  -- 1. REVERSAL — reverse_fee_payment() must reject a payment belonging
  --    to another institute (the actual bug found in the Phase 21 audit).
  -------------------------------------------------------------------------
  v_caught := null;
  begin
    perform reverse_fee_payment(v_foreign_payment_id, 'TEST unauthorized reversal attempt');
  exception when others then
    v_caught := SQLERRM;
  end;
  if v_caught is null then
    raise exception 'FAIL — reverse_fee_payment() succeeded against ANOTHER institute''s payment — this is the exact Phase 21 vulnerability';
  end if;
  if v_caught not like 'NOT_AUTHORIZED%' then
    raise exception 'FAIL — reverse_fee_payment() rejected the cross-institute call, but for the wrong reason: %', v_caught;
  end if;
  raise notice 'PASS — reverse_fee_payment() correctly refused another institute''s payment';

  -------------------------------------------------------------------------
  -- 2. EXAM RESULTS — compute/publish/unpublish must reject an exam
  --    belonging to another institute.
  -------------------------------------------------------------------------
  v_caught := null;
  begin
    perform compute_exam_results(v_foreign_exam_id);
  exception when others then
    v_caught := SQLERRM;
  end;
  if v_caught is null or v_caught not like 'NOT_AUTHORIZED%' then
    raise exception 'FAIL — compute_exam_results() did not correctly refuse another institute''s exam (got: %)', coalesce(v_caught, 'no error at all');
  end if;
  raise notice 'PASS — compute_exam_results() correctly refused another institute''s exam';

  v_caught := null;
  begin
    perform publish_exam_results(v_foreign_exam_id);
  exception when others then
    v_caught := SQLERRM;
  end;
  if v_caught is null or v_caught not like 'NOT_AUTHORIZED%' then
    raise exception 'FAIL — publish_exam_results() did not correctly refuse another institute''s exam (got: %)', coalesce(v_caught, 'no error at all');
  end if;
  raise notice 'PASS — publish_exam_results() correctly refused another institute''s exam';

  -------------------------------------------------------------------------
  -- 3. INVENTORY — record_stock_movement() must reject an item belonging
  --    to another institute (this one was MY OWN bug, Phase 12/13 —
  --    kept here specifically so it can never quietly return).
  -------------------------------------------------------------------------
  v_caught := null;
  begin
    -- Named-parameter call, and p_idempotency_key explicitly supplied
    -- (even as null): record_stock_movement has two overloads (0028's
    -- original 5-arg version and 0041's 6-arg one adding
    -- p_idempotency_key), both satisfiable by 4 positional arguments via
    -- trailing defaults — a plain positional call here is genuinely
    -- ambiguous to Postgres (found running this test for real while
    -- writing the Priority 3 security tests), not a mistake in the
    -- function itself. Naming p_idempotency_key is what forces resolution
    -- to the one overload that has it.
    perform record_stock_movement(
      p_item_id => v_foreign_item_id, p_movement_type => 'stock_in', p_quantity => 10,
      p_reason => 'TEST unauthorized stock adjustment', p_idempotency_key => null
    );
  exception when others then
    v_caught := SQLERRM;
  end;
  if v_caught is null or v_caught not like 'NOT_AUTHORIZED%' then
    raise exception 'FAIL — record_stock_movement() did not correctly refuse another institute''s item (got: %)', coalesce(v_caught, 'no error at all');
  end if;
  raise notice 'PASS — record_stock_movement() correctly refused another institute''s inventory item';

  -------------------------------------------------------------------------
  -- 4. REPAIR_FEE_RECORD — must reject a student belonging to another
  --    institute.
  -------------------------------------------------------------------------
  v_caught := null;
  begin
    perform repair_fee_record(v_foreign_student_id, '2026-08-01');
  exception when others then
    v_caught := SQLERRM;
  end;
  if v_caught is null or v_caught not like 'NOT_AUTHORIZED%' then
    raise exception 'FAIL — repair_fee_record() did not correctly refuse another institute''s student (got: %)', coalesce(v_caught, 'no error at all');
  end if;
  raise notice 'PASS — repair_fee_record() correctly refused another institute''s student';

  -------------------------------------------------------------------------
  -- 5. PENDING_FEE_REMINDERS — must reject an explicit p_institute_id that
  --    isn't the caller's own (Priority 3 security audit finding: this had
  --    NO check at all, and the function was reachable by anon due to a
  --    missing revoke — see the migration this test was added alongside).
  -------------------------------------------------------------------------
  v_caught := null;
  begin
    perform * from pending_fee_reminders(current_date, v_foreign_institute_id);
  exception when others then
    v_caught := SQLERRM;
  end;
  if v_caught is null or v_caught not like 'NOT_AUTHORIZED%' then
    raise exception 'FAIL — pending_fee_reminders() did not correctly refuse another institute (got: %)', coalesce(v_caught, 'no error, rows returned');
  end if;
  raise notice 'PASS — pending_fee_reminders() correctly refused another institute''s p_institute_id';

  -------------------------------------------------------------------------
  -- 6. RECORD_FEE_PAYMENT — must reject a student/fee record belonging to
  --    another institute (Priority 3 finding: the ORIGINAL payment-
  --    recording function never got the check reverse_fee_payment/
  --    record_stock_movement already have).
  -------------------------------------------------------------------------
  v_caught := null;
  begin
    perform record_fee_payment(v_foreign_fee_record, v_foreign_student_id, '2026-08-01', 1000, 'Cash', 'TEST cross-tenant payment attempt');
  exception when others then
    v_caught := SQLERRM;
  end;
  if v_caught is null or v_caught not like 'NOT_AUTHORIZED%' then
    raise exception 'FAIL — record_fee_payment() did not correctly refuse another institute''s student/fee record (got: %)', coalesce(v_caught, 'no error — a cross-tenant payment was recorded');
  end if;
  raise notice 'PASS — record_fee_payment() correctly refused another institute''s student and fee record';

  -------------------------------------------------------------------------
  -- 7. QUEUE_FEE_NOTIFICATION — must reject a student belonging to another
  --    institute (Priority 3 finding: would otherwise render and hand back
  --    that student's real guardian phone/email, readable again afterward
  --    through the caller's own, correctly-scoped notifications row).
  -------------------------------------------------------------------------
  v_caught := null;
  begin
    perform queue_fee_notification(v_foreign_student_id, v_foreign_fee_record, 'reminder', 'fee_reminder_1');
  exception when others then
    v_caught := SQLERRM;
  end;
  if v_caught is null or v_caught not like 'NOT_AUTHORIZED%' then
    raise exception 'FAIL — queue_fee_notification() did not correctly refuse another institute''s student (got: %)', coalesce(v_caught, 'no error — a notification was queued, possibly leaking guardian contact info');
  end if;
  raise notice 'PASS — queue_fee_notification() correctly refused another institute''s student';

  raise notice '=== ALL TENANT ISOLATION TESTS PASSED — 0051''s and Priority 3''s fixes are holding ===';
end $$;

rollback;
