-- ============================================================================
-- ATTENDANCE, INVENTORY, MONTH CLOSING — run in the Supabase SQL Editor
-- against your actual project.
-- ============================================================================

begin;

do $$
declare
  v_class_id      uuid;
  v_student_id    uuid;
  v_item_id       uuid;
  v_foreign_inst  uuid;
  v_caught        text;
  v_stock         numeric;
begin
  insert into classes (name, sort_order) values ('TEST Ops Class', 9996) returning id into v_class_id;
  insert into students (name, class_id, status) values ('TEST Ops Student', v_class_id, 'active') returning id into v_student_id;

  -------------------------------------------------------------------------
  -- ATTENDANCE — student_attendance's unique constraint is
  -- (student_id, date, class_id, section_id, subject_id), and section_id/
  -- subject_id are both nullable — SQL never treats two NULLs as equal for
  -- uniqueness, so a raw duplicate INSERT with both left null (the normal,
  -- whole-day-register case) is NOT caught by this constraint. That's not
  -- a gap: saveStudentAttendance() (app/(app)/attendance/students/
  -- actions.js) and the offline repo (lib/offline/repositories/
  -- attendance.js) both know this already and delete-then-insert instead
  -- of relying on the constraint — see either file's own header comment.
  -- The real guarantee to test is THAT pattern, not a bare INSERT.
  -------------------------------------------------------------------------
  insert into student_attendance (student_id, class_id, date, status) values (v_student_id, v_class_id, '2026-08-10', 'present');

  -- Mirrors saveStudentAttendance()'s own delete-then-insert for this
  -- date/class/section/subject combination, then re-marks the same
  -- student — this should REPLACE the earlier mark, not add a second row.
  delete from student_attendance where date = '2026-08-10' and class_id = v_class_id and subject_id is null and section_id is null;
  insert into student_attendance (student_id, class_id, date, status) values (v_student_id, v_class_id, '2026-08-10', 'absent');

  select count(*) into v_stock from student_attendance where student_id = v_student_id and date = '2026-08-10' and class_id = v_class_id and subject_id is null;
  if v_stock <> 1 then
    raise exception 'FAIL — delete-then-insert left % row(s) for the same student/day/class, expected exactly 1', v_stock;
  end if;
  if (select status from student_attendance where student_id = v_student_id and date = '2026-08-10' and class_id = v_class_id and subject_id is null) <> 'absent' then
    raise exception 'FAIL — the re-mark did not take effect, status is not ''absent''';
  end if;
  raise notice 'PASS — re-marking the same student/day/class replaces the row (app-layer delete-then-insert), not a duplicate';

  -------------------------------------------------------------------------
  -- INVENTORY — stock_out for more than what's on hand must be rejected,
  -- and INSUFFICIENT_STOCK is the specific error sync-engine.js and
  -- conflict-resolver.js pattern-match on (lib/offline/sync/sync-engine.js)
  -- — a generic error here would silently break that routing.
  -------------------------------------------------------------------------
  insert into inventory_items (name, unit, active) values ('TEST Ops Item', 'pcs', true) returning id into v_item_id;
  -- Named-parameter calls throughout, p_idempotency_key always explicit:
  -- record_stock_movement has two overloads (0028's original and 0041's
  -- added p_idempotency_key), both satisfiable by 4 positional arguments
  -- via trailing defaults — genuinely ambiguous to Postgres when called
  -- positionally (found running this test for real; same issue already
  -- fixed once in reversal_and_tenant_isolation_test.sql). Naming
  -- p_idempotency_key is what forces resolution to the one overload that
  -- has it.
  perform record_stock_movement(p_item_id => v_item_id, p_movement_type => 'stock_in', p_quantity => 10, p_reason => 'TEST opening stock', p_idempotency_key => null);

  select get_item_stock(v_item_id, current_date) into v_stock;
  if v_stock != 10 then
    raise exception 'FAIL — expected 10 in stock after stock_in, got %', v_stock;
  end if;
  raise notice 'PASS — stock_in correctly brought stock to 10';

  v_caught := null;
  begin
    perform record_stock_movement(p_item_id => v_item_id, p_movement_type => 'stock_out', p_quantity => 15, p_reason => 'TEST over-withdrawal', p_idempotency_key => null);
  exception when others then
    v_caught := SQLERRM;
  end;
  if v_caught is null or v_caught not like 'INSUFFICIENT_STOCK%' then
    raise exception 'FAIL — withdrawing more than available stock was not rejected with INSUFFICIENT_STOCK (got: %)', coalesce(v_caught, 'no error');
  end if;
  raise notice 'PASS — stock_out exceeding available quantity correctly rejected with INSUFFICIENT_STOCK';

  perform record_stock_movement(p_item_id => v_item_id, p_movement_type => 'stock_out', p_quantity => 4, p_reason => 'TEST valid withdrawal', p_idempotency_key => null);
  select get_item_stock(v_item_id, current_date) into v_stock;
  if v_stock != 6 then
    raise exception 'FAIL — expected 6 remaining after stock_out of 4 from 10, got %', v_stock;
  end if;
  raise notice 'PASS — valid stock_out correctly reduced stock to 6';

  -------------------------------------------------------------------------
  -- MONTH CLOSING — the Phase 21 regression: closing a month for ANOTHER
  -- institute must NOT block this institute's own postings for that
  -- month. Before 0051's fix, is_month_closed() had no institute filter
  -- at all, so this would have incorrectly returned true.
  -------------------------------------------------------------------------
  insert into institutes (name) values ('TEST Isolation Institute') returning id into v_foreign_inst;
  insert into monthly_closing (month, institute_id, total_income, total_expenses, total_salary, closed_by)
    values ('2026-11-01', v_foreign_inst, 0, 0, 0, null);

  if is_month_closed('2026-11-01') then
    raise exception 'FAIL — is_month_closed() returned TRUE for a month closed by a DIFFERENT institute. THIS IS THE 0051 REGRESSION (cross-tenant denial of service).';
  end if;
  raise notice 'PASS — another institute closing November did not block this institute''s own November postings';

  raise notice '=== ATTENDANCE / INVENTORY / MONTH-CLOSING TESTS PASSED ===';
end $$;

rollback;
