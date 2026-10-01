-- ============================================================================
-- 42. PAYMENT IDEMPOTENCY
--
-- The scenario 0041_idempotent_sync.sql doesn't cover: a cashier is
-- recording a live, ONLINE payment (not something queued offline —
-- lib/offline/repositories/payments.js deliberately never queues a
-- payment; see that file for why) and the connection drops or times out
-- between the INSERT committing and the response reaching the browser.
-- The cashier sees no confirmation, so they press Save again. Without
-- something to recognize "this is the same attempt," that's a second real
-- row: Rs. 5,000 becomes Rs. 10,000 against fee_records.paid_total, a
-- second receipt number gets burned, and the ledger triggers
-- (trg_fee_payments_sync, trg_fee_payments_ledger) post the extra amount
-- as if a second real payment happened.
--
-- Same fix as 0041, same reasoning: the CLIENT decides once, generates one
-- idempotency_key per submission attempt (PaymentEntryForm.js — see that
-- file's comment), and reuses that exact key on every retry of the same
-- attempt. A real unique constraint on the server turns a retried insert
-- into a safe "return what already happened" instead of a duplicate row.
--
-- Why this is a new RPC (record_fee_payment) instead of relaxing the
-- existing raw insert: fee_payments' INSERT is currently authorized by a
-- genuine RLS policy ("cashier can record payments", 0002_rls.sql) — a
-- SECURITY DEFINER function bypasses RLS entirely, so it must repeat that
-- exact same role check inside itself or it would silently widen who can
-- call it. This mirrors the same class of fix the README's "Recent
-- security hardening" section already made for get_or_create_fee_record()
-- and generate_salary_records() — a DEFINER function checking its own
-- authorization, not trusting RLS or a hidden UI button.
-- ============================================================================

alter table fee_payments add column if not exists idempotency_key uuid unique;

create or replace function record_fee_payment(
  p_fee_record_id uuid,
  p_student_id uuid,
  p_month date,
  p_amount numeric,
  p_method text,
  p_remarks text default null,
  p_is_advance boolean default false,
  p_idempotency_key uuid default null
)
returns fee_payments
language plpgsql security definer set search_path = public as $$
declare
  v_row fee_payments;
begin
  -- Checked FIRST, before authorization or any business-rule validation —
  -- same ordering as record_stock_movement() in 0041, and for the same
  -- reason: a retry of an already-successful payment must never be
  -- rejected by state the first successful attempt itself changed (e.g.
  -- "remaining balance" is now smaller because this exact payment already
  -- reduced it). If the key matches, the payment already happened; hand
  -- back that same row and stop, before touching anything else.
  if p_idempotency_key is not null then
    select * into v_row from fee_payments where idempotency_key = p_idempotency_key;
    if found then
      return v_row;
    end if;
  end if;

  if not (is_finance_staff() or current_role_name() = 'Cashier') then
    raise exception 'NOT_AUTHORIZED: Not authorized to record a payment.';
  end if;

  -- Deliberately no amount/remaining or month-closed check here — that
  -- stays exactly where it already was: check_fee_payment_within_remaining()
  -- and check_fee_payment_month_open() are BEFORE INSERT triggers already
  -- attached to fee_payments (0007/0019/0040), so they still fire on this
  -- INSERT exactly as they did on the raw client insert this replaces. Two
  -- enforcement points for the same rule would only invite them drifting
  -- apart.
  insert into fee_payments (
    fee_record_id, student_id, month, amount, method, remarks, is_advance, idempotency_key
  ) values (
    p_fee_record_id, p_student_id, p_month, p_amount, p_method, p_remarks, p_is_advance, p_idempotency_key
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function record_fee_payment(uuid, uuid, date, numeric, text, text, boolean, uuid) from public;
grant execute on function record_fee_payment(uuid, uuid, date, numeric, text, text, boolean, uuid) to authenticated;
