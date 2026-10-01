-- ============================================================================
-- 17. FEE PAYMENT VALIDATION — reject amount > remaining balance
--
-- fee_records.total_payable is monthly_fee + previous_balance - discount
-- (a generated column); paid_total is kept in sync by trg_fee_payments_sync
-- AFTER each insert, which means at the moment a new fee_payments row is
-- being inserted, fee_records.paid_total still reflects the total BEFORE
-- this payment — exactly what's needed to compute:
--
--     remaining = total_payable - paid_total
--
-- and reject NEW.amount > remaining. This is a BEFORE INSERT trigger, so it
-- runs (and can abort the insert) before trg_fee_payments_sync ever fires.
--
-- Deliberately strict for now: there is no "Advance Payment" feature, so
-- overpayment is rejected outright rather than silently accepted as a
-- credit. If advance payments become an intentional feature later, add an
-- explicit p_allow_advance flag / advance_payments table rather than
-- loosening this check — a silently-accepted overpayment is exactly the
-- kind of thing that should require a deliberate design decision, not a
-- side effect of relaxing a guard.
-- ============================================================================

create or replace function check_fee_payment_within_remaining() returns trigger as $$
declare
  v_total_payable numeric(12,2);
  v_paid_total    numeric(12,2);
  v_remaining     numeric(12,2);
begin
  select total_payable, paid_total into v_total_payable, v_paid_total
    from fee_records where id = new.fee_record_id;

  if v_total_payable is null then
    raise exception 'Fee record % not found.', new.fee_record_id;
  end if;

  v_remaining := v_total_payable - v_paid_total;

  if new.amount > v_remaining then
    raise exception 'PAYMENT_EXCEEDS_REMAINING: Rs. % exceeds the remaining balance of Rs. % (total payable Rs. %, already paid Rs. %). Overpayment/advance isn''t supported yet — reduce the amount or add an Advance Payment feature first.',
      new.amount, v_remaining, v_total_payable, v_paid_total;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_check_fee_payment_within_remaining on fee_payments;
create trigger trg_check_fee_payment_within_remaining
  before insert on fee_payments
  for each row execute function check_fee_payment_within_remaining();
