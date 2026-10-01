-- ============================================================================
-- 18. ROBUST PREVIOUS BALANCE — sum ALL earlier outstanding months, not just
--     the most recent one
-- ============================================================================
-- get_or_create_fee_record() (0003/0005) previously did:
--
--     select greatest(total_payable - paid_total, 0) from fee_records
--       where student_id = X and month < this_month
--       order by month desc limit 1
--
-- i.e. it only ever looked at the single most-recent prior fee_record. If
-- that chain is ever unbroken (every month generated in order, none
-- skipped), it happens to work, because each month's total_payable already
-- has the one before it folded in. But that's a fragile assumption for a
-- finance system — a month can go ungenerated (no fee_records row at all:
-- the student wasn't billed that month for whatever reason, or generation
-- ran late), and the moment that happens, everything owed before the gap
-- silently vanishes from every bill after it.
--
-- The fix: sum outstanding across every earlier unpaid/partial month
-- independently, rather than trusting a chain. Importantly this sums each
-- month's own (monthly_fee - discount - paid_total) — NOT that month's
-- total_payable, which would double-count: total_payable already has ITS
-- OWN previous_balance folded in, so summing total_payable across several
-- months would count the same old arrears once per month they were carried
-- through. Summing the month's own fee net of its own discount and its own
-- payments avoids that while still catching every unpaid month, chained or
-- not.
--
-- Worked example matching the one this was specced against: June's own net
-- (fee 8,000, unpaid) = 8,000. July's own net (unpaid) = 5,000 — regardless
-- of whether June ever fed into July's previous_balance. August bill:
--   August fee        8,000
--   Previous balance  13,000   (8,000 + 5,000, summed independently)
--   ---------------------------
--   Total             21,000
-- ============================================================================

create or replace function previous_outstanding(p_student_id uuid, p_before_month date) returns numeric as $$
  select coalesce(sum(greatest(monthly_fee - discount - paid_total, 0)), 0)
    from fee_records
    where student_id = p_student_id
      and month < date_trunc('month', p_before_month)::date
      and status in ('unpaid', 'partial');
$$ language sql stable;

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
  select id into v_fee_record_id from fee_records
    where student_id = p_student_id and month = v_month;
  if v_fee_record_id is not null then
    return v_fee_record_id;
  end if;

  select class_id into v_class_id from students where id = p_student_id;

  select monthly_fee into v_monthly_fee
    from fee_structures
    where student_id = p_student_id and active and effective_from <= v_month
    order by effective_from desc limit 1;

  if v_monthly_fee is null then
    select monthly_fee into v_monthly_fee
      from fee_structures
      where class_id = v_class_id and student_id is null and active and effective_from <= v_month
      order by effective_from desc limit 1;
  end if;
  v_monthly_fee := coalesce(v_monthly_fee, 0);

  v_prev_balance := previous_outstanding(p_student_id, v_month);

  select coalesce(sum(amount), 0) into v_discount
    from fee_discounts where student_id = p_student_id and active;

  insert into fee_records (student_id, month, monthly_fee, previous_balance, discount)
    values (p_student_id, v_month, v_monthly_fee, v_prev_balance, v_discount)
    returning id into v_fee_record_id;

  return v_fee_record_id;
end;
$$ language plpgsql security definer set search_path = public;
