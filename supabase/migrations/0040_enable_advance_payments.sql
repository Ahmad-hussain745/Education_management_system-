-- ============================================================================
-- 40. ADVANCE PAYMENTS — deliberate opt-in, not a loosened guard
--
-- 0007_fee_payment_validation.sql's own comment left the exact instruction
-- this migration follows: "If advance payments become an intentional
-- feature later, add an explicit p_allow_advance flag ... rather than
-- loosening this check." That's what this does — the guard against
-- accidental overpayment stays exactly as strict as before for every
-- normal payment; it only steps aside when the payment is explicitly
-- flagged as an advance, which the UI (PaymentEntryForm.js) only sets
-- after the cashier ticks a checkbox that appears specifically when the
-- amount they've typed exceeds what's currently due — never by default,
-- never silently.
--
-- Combined with 0039_canonical_fee_engine.sql's removal of the floor in
-- previous_balance, an advance recorded this way correctly reduces next
-- month's bill: calculate_student_fee_dues() nets total billed vs. total
-- paid with no floor, so the credit surfaces as a negative
-- previous_balance next time get_or_create_fee_record() runs for this
-- student.
-- ============================================================================

alter table fee_payments add column if not exists is_advance boolean not null default false;

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

  if new.amount > v_remaining and not new.is_advance then
    raise exception 'PAYMENT_EXCEEDS_REMAINING: Rs. % exceeds the remaining balance of Rs. % (total payable Rs. %, already paid Rs. %). Tick "This is an advance payment" to collect more than what''s currently due.',
      new.amount, v_remaining, v_total_payable, v_paid_total;
  end if;

  return new;
end;
$$ language plpgsql;

-- Trigger itself is unchanged — check_fee_payment_within_remaining() is
-- redefined above, the trigger binding stays the same.
