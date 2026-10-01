-- ============================================================================
-- Real, severe, currently-live bug found while running the complete
-- Priority 3 test suite end-to-end (not something a security audit was
-- looking for specifically — it just makes the whole fee engine
-- unreachable, which blocked most of the test suite from running at all).
--
-- calculate_student_fee_dues() (0039_canonical_fee_engine.sql) declares
-- `discount` as an OUT column in its RETURNS TABLE signature, which
-- PL/pgSQL implicitly turns into a variable of that name in scope for the
-- whole function body. Its previous-balance query also selects
-- `monthly_fee - discount` from fee_records, which ALSO has a `discount`
-- column — an unqualified reference, so Postgres can't tell which
-- `discount` is meant and raises "column reference is ambiguous" rather
-- than guessing. Confirmed this isn't conditional on any particular data
-- shape (no prior fee_records, one prior record, doesn't matter) — it's a
-- parse-time ambiguity, so it fails on literally every call, for every
-- student, unconditionally. get_or_create_fee_record() calls this
-- directly, and it's the function the whole app's fee generation goes
-- through — this was not a narrow edge case.
--
-- Fixed by qualifying the column reference with the table name
-- (fee_records.discount) rather than renaming the OUT parameter — the OUT
-- column is also referenced by name elsewhere in this same file
-- (get_or_create_fee_record's `v_dues.discount`), so qualifying the one
-- ambiguous reference is the smaller, safer change with no external
-- signature change at all.
-- ============================================================================

create or replace function calculate_student_fee_dues(p_student_id uuid, p_month date)
returns table(
  effective_month  date,
  class_fee        numeric,
  discount         numeric,
  previous_balance numeric,
  total_payable    numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_month      date := date_trunc('month', p_month)::date;
  v_class_id   uuid;
  v_fee        numeric(12,2);
  v_discount   numeric(12,2);
  v_prev       numeric(12,2);
begin
  select class_id into v_class_id from students where id = p_student_id;

  v_fee := resolve_monthly_fee(p_student_id, v_class_id, v_month);

  select coalesce(sum(amount), 0) into v_discount
    from fee_discounts
    where student_id = p_student_id and active and institute_id = current_institute_id();

  select coalesce(sum(fee_records.monthly_fee - fee_records.discount), 0) - coalesce((
      select sum(amount) from fee_payments
      where student_id = p_student_id and month < v_month and institute_id = current_institute_id()
    ), 0)
    into v_prev
    from fee_records
    where student_id = p_student_id and month < v_month and institute_id = current_institute_id();

  return query select v_month, v_fee, v_discount, coalesce(v_prev, 0), v_fee + coalesce(v_prev, 0) - v_discount;
end;
$$;

revoke execute on function calculate_student_fee_dues(uuid, date) from public;
grant execute on function calculate_student_fee_dues(uuid, date) to authenticated, service_role;
