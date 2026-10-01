-- ============================================================================
-- 48. DAILY RECONCILIATION — Receipts = Payments = Ledger, then Cashier
-- Closing, with a real Finance Alert when something doesn't match.
--
-- reconcile_fee_totals() (used by the existing reconciliation job) checks
-- one thing: does fee_records.paid_total agree with the sum of its own
-- payments. That's a different, narrower question than what Phase 17
-- asks for — whether the day's money, as recorded in fee_payments/income,
-- agrees with what actually landed in the transactions ledger, and
-- whether what a Cashier physically counted agrees with what the system
-- expected. Three new functions, one for each:
--
--   reconcile_ledger_totals()      — fee_payments/income vs transactions
--   cashier_closing_discrepancies() — closed days where actual != expected
--   missing_cashier_closings()      — cashiers who collected cash but
--                                      never closed their day at all
--
-- A NOTE ON REVERSALS, because it's the one way this check could produce a
-- false alarm if it weren't handled deliberately: reverse_fee_payment()
-- (0011) posts its compensating 'out' transaction dated to the day of the
-- REVERSAL (current_date at that moment), not the original paid_on date —
-- and it never touches the original 'in' transaction's txn_date either.
-- So reconcile_ledger_totals() deliberately does NOT filter fee_payments/
-- income by reversed_at: it compares "what was recorded as received on
-- day X" (a fact that doesn't change later) against "the 'in' transactions
-- dated day X" (also permanent) — both sides of that comparison are
-- historically stable regardless of any reversal that happens afterward,
-- on a different day, with its own 'out' entry belonging to THAT day's
-- reconciliation instead. Filtering out reversed rows here would make a
-- perfectly correct day look unbalanced the moment something gets
-- reversed weeks later — exactly the kind of false alarm a finance system
-- can't afford to cry wolf about.
-- ============================================================================

create or replace function reconcile_ledger_totals(p_institute_id uuid, p_date date)
returns table(source text, records_total numeric, ledger_total numeric, balanced boolean)
language sql stable security definer set search_path = public as $$
  select
    'fee_payments'::text as source,
    coalesce((select sum(amount) from fee_payments
      where institute_id = p_institute_id and paid_on = p_date), 0) as records_total,
    coalesce((select sum(amount) from transactions
      where institute_id = p_institute_id and reference_table = 'fee_payments'
        and txn_date = p_date and direction = 'in'), 0) as ledger_total,
    coalesce((select sum(amount) from fee_payments
      where institute_id = p_institute_id and paid_on = p_date), 0)
    = coalesce((select sum(amount) from transactions
      where institute_id = p_institute_id and reference_table = 'fee_payments'
        and txn_date = p_date and direction = 'in'), 0) as balanced
  union all
  select
    'income'::text,
    coalesce((select sum(amount) from income
      where institute_id = p_institute_id and income_date = p_date), 0),
    coalesce((select sum(amount) from transactions
      where institute_id = p_institute_id and reference_table = 'income'
        and txn_date = p_date and direction = 'in'), 0),
    coalesce((select sum(amount) from income
      where institute_id = p_institute_id and income_date = p_date), 0)
    = coalesce((select sum(amount) from transactions
      where institute_id = p_institute_id and reference_table = 'income'
        and txn_date = p_date and direction = 'in'), 0);
$$;

revoke execute on function reconcile_ledger_totals(uuid, date) from public, authenticated;
grant execute on function reconcile_ledger_totals(uuid, date) to service_role;

-- Every closed day where a Cashier's physical count didn't match what the
-- system expected — cashier_closings already stores expected/actual/
-- difference (0024), this just surfaces the ones worth an alert. A
-- difference here is normal day-to-day variance (a miscounted drawer),
-- not a software bug, which is why the job below reports these rather
-- than throwing — unlike reconcile_ledger_totals drift, which is.
create or replace function cashier_closing_discrepancies(p_institute_id uuid, p_date date)
returns table(cashier_id uuid, cashier_name text, expected_cash numeric, actual_cash numeric, difference numeric, reason text)
language sql stable security definer set search_path = public as $$
  select c.cashier_id, u.name, c.expected_cash, c.actual_cash, c.difference, c.reason
  from cashier_closings c
  join users u on u.id = c.cashier_id
  where c.institute_id = p_institute_id and c.closing_date = p_date and c.difference <> 0
  order by abs(c.difference) desc;
$$;

revoke execute on function cashier_closing_discrepancies(uuid, date) from public, authenticated;
grant execute on function cashier_closing_discrepancies(uuid, date) to service_role;

-- A cashier who took cash that day but never ran Close Day at all —
-- arguably more worth an admin's attention than a small counted
-- difference, since it means that day's drawer was never reconciled
-- against the system in the first place.
create or replace function missing_cashier_closings(p_institute_id uuid, p_date date)
returns table(cashier_id uuid, cashier_name text, expected_cash numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select t.cashier_id, u.name, totals.expected_cash
  from (
    select distinct received_by as cashier_id from fee_payments
      where institute_id = p_institute_id and paid_on = p_date and method = 'Cash' and received_by is not null
    union
    select distinct received_by as cashier_id from income
      where institute_id = p_institute_id and income_date = p_date and method = 'Cash' and received_by is not null
  ) t
  join users u on u.id = t.cashier_id
  cross join lateral compute_cashier_closing_totals(t.cashier_id, p_date) totals
  where not exists (
    select 1 from cashier_closings c where c.cashier_id = t.cashier_id and c.closing_date = p_date
  )
  and totals.expected_cash > 0;
end;
$$;

revoke execute on function missing_cashier_closings(uuid, date) from public, authenticated;
grant execute on function missing_cashier_closings(uuid, date) to service_role;
