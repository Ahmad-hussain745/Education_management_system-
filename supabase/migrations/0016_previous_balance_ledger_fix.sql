-- ============================================================================
-- 24. PREVIOUS BALANCE — total charges vs total payments, not paid_total
-- ============================================================================
-- previous_outstanding() (0008_previous_balance_robust.sql) summed each
-- prior month's own (monthly_fee - discount - paid_total), but only for
-- rows whose status was 'unpaid' or 'partial'. paid_total is a real,
-- correctly-synced number (the trigger in 0001_init.sql keeps it accurate)
-- — the bug isn't that it's wrong, it's that a single fee_payments row can
-- only ever point at ONE fee_record (fee_payments.fee_record_id), so a
-- payment larger than the month it was recorded against inflates that
-- month's paid_total past its own total_payable, flips its status to
-- 'paid', and 0008's status filter then excludes it from the sum entirely
-- — discarding the surplus instead of carrying it forward.
--
-- Concretely, the clearest case where 0008 and this fix actually diverge
-- (verified against a live database, not just worked by hand — see the
-- test-case run this migration shipped alongside):
--   June fee 8,000, paid 12,000 in June       → status 'paid' (4,000 surplus)
--   July fee 8,000, paid 3,000 in July itself → status 'partial'
--   0008: June is 'paid' → excluded entirely from the sum. July is
--   'partial' → contributes greatest(8,000 - 0 - 3,000, 0) = 5,000.
--   August's previous_balance under 0008: 5,000.
--   True position: charged 16,000 (June+July), paid 15,000 (12,000+3,000)
--   → actually owed 1,000. 0008 says 5,000 — wrong by exactly June's
--   unused 4,000 surplus, silently dropped the moment June's status
--   flipped to 'paid' rather than carried forward to offset July's own
--   shortfall.
--
-- The fix: stop reasoning about individual fee_records' status at all.
-- Previous Balance = (sum of every prior month's own net charge) minus
-- (sum of every payment actually recorded against a prior month), floored
-- at zero. This never depends on which specific fee_record a payment's
-- row happened to point at — only on the month it was recorded for
-- (fee_payments.month, denormalised alongside fee_record_id for exactly
-- this kind of query) — so a payment that overshoots the month it was
-- paid against still nets out correctly against everything before it.

create or replace function previous_outstanding(p_student_id uuid, p_before_month date) returns numeric as $$
  select greatest(
    coalesce((
      select sum(monthly_fee - discount)
      from fee_records
      where student_id = p_student_id
        and month < date_trunc('month', p_before_month)::date
    ), 0)
    -
    coalesce((
      select sum(amount)
      from fee_payments
      where student_id = p_student_id
        and month < date_trunc('month', p_before_month)::date
    ), 0),
    0
  );
$$ language sql stable;

-- get_or_create_fee_record() itself is unchanged — it already calls
-- previous_outstanding(), so redefining that function above is the whole
-- fix. Re-declared here only as a comment marker for anyone diffing this
-- migration against 0008: no second definition follows: intentionally.
