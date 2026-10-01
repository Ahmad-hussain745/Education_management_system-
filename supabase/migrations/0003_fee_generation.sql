-- ============================================================================
-- 14. FEE RECORD GENERATION — the missing half of the "enter once" pipeline
-- ============================================================================
-- generate_salary_records() (0001) auto-builds a teacher's monthly payroll
-- from live data. This is the same idea for the *fee* side: a cashier should
-- never manually type "Monthly Fee: 8000, Previous Balance: 2000" into a
-- fee_records row — those numbers are derived from fee_structures,
-- fee_discounts and last month's fee_records, every time.
--
-- Cashiers have INSERT on fee_payments but deliberately do NOT have INSERT
-- on fee_records (see 0002_rls.sql, "write: finance staff" is for-all on
-- fee_records) — the bill itself is a finance-controlled number, not
-- something a cashier types. So this runs SECURITY DEFINER, exactly like
-- sync_fee_record_totals() and post_transaction(): a narrow, trusted function
-- a cashier is allowed to call, even though they can't touch the table
-- directly.
--
-- Resolution order, mirrors the comment on fee_structures:
--   monthly_fee      = student-specific fee_structures row, else the
--                       student's class-level row
--   previous_balance = (total_payable − paid_total) from that student's most
--                       recent fee_records row before this month, floored at 0
--   discount         = sum of that student's active fee_discounts
-- Idempotent: if a fee_records row already exists for (student, month), it's
-- returned as-is and never overwritten — a cashier calling this mid-month
-- must never reset a bill that already has payments against it.

create or replace function get_or_create_fee_record(p_student_id uuid, p_month date)
returns uuid as $$
declare
  v_month           date := date_trunc('month', p_month)::date;
  v_fee_record_id   uuid;
  v_class_id        uuid;
  v_monthly_fee     numeric(12,2);
  v_prev_balance    numeric(12,2) := 0;
  v_discount        numeric(12,2) := 0;
begin
  -- already generated (and possibly already paid against) — just hand it back
  select id into v_fee_record_id from fee_records
    where student_id = p_student_id and month = v_month;
  if v_fee_record_id is not null then
    return v_fee_record_id;
  end if;

  select class_id into v_class_id from students where id = p_student_id;

  select monthly_fee into v_monthly_fee
    from fee_structures where student_id = p_student_id;
  if v_monthly_fee is null then
    select monthly_fee into v_monthly_fee
      from fee_structures where class_id = v_class_id and student_id is null;
  end if;
  v_monthly_fee := coalesce(v_monthly_fee, 0);

  select greatest(total_payable - paid_total, 0) into v_prev_balance
    from fee_records
    where student_id = p_student_id and month < v_month
    order by month desc
    limit 1;
  v_prev_balance := coalesce(v_prev_balance, 0);

  select coalesce(sum(amount), 0) into v_discount
    from fee_discounts where student_id = p_student_id and active;

  insert into fee_records (student_id, month, monthly_fee, previous_balance, discount)
    values (p_student_id, v_month, v_monthly_fee, v_prev_balance, v_discount)
    returning id into v_fee_record_id;

  return v_fee_record_id;
end;
$$ language plpgsql security definer set search_path = public;

-- Cashier needs to call the function above (not the table) — grant execute
-- explicitly since security definer functions aren't auto-exposed otherwise.
grant execute on function get_or_create_fee_record(uuid, date) to authenticated;
