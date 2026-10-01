-- ============================================================================
-- 20. SECURE FEE GENERATION
-- ============================================================================
-- get_or_create_fee_record() is SECURITY DEFINER (it has to be — a Cashier
-- has no direct RLS write access to fee_records, only to fee_payments; this
-- function is the one narrow, trusted gateway that lets them trigger "make
-- sure this month's bill exists" without handing them general fee_records
-- write access). But SECURITY DEFINER means it runs with the function
-- owner's privileges, not the caller's — RLS on fee_records never even gets
-- consulted. `grant execute ... to authenticated` (0001_init.sql) currently
-- means literally any signed-in user can call it directly, Teacher and
-- Principal included, and have it silently create real financial records.
--
-- Confirmed this is reachable today, not just theoretical: the only actual
-- caller is Payment Entry's getBillPreview() (app/(app)/fees/payments/
-- actions.js), and that page has no requireRole guard — so a Teacher who
-- simply navigates to /fees/payments directly (the sidebar just doesn't
-- link them there) could already trigger it.
--
-- Desired matrix:
--   Super Admin  → YES      Principal    → NO
--   Accountant   → YES      Teacher      → NO
--   Cashier      → YES
--
-- The check has to live INSIDE the function, not in a fresh RLS policy —
-- SECURITY DEFINER functions bypass RLS by design, so RLS on fee_records
-- literally cannot see or stop this call. current_role_name() already
-- exists (0002_rls.sql) for exactly this kind of in-function check.
--
-- The fee-generation logic itself is untouched — this is the same body as
-- 0008_previous_balance_robust.sql, with an authorization check added at
-- the top and nothing else changed.
create or replace function get_or_create_fee_record(p_student_id uuid, p_month date)
returns uuid as $$
declare
  v_role            text;
  v_month           date := date_trunc('month', p_month)::date;
  v_fee_record_id   uuid;
  v_class_id        uuid;
  v_monthly_fee     numeric(12,2);
  v_prev_balance    numeric(12,2) := 0;
  v_discount        numeric(12,2) := 0;
begin
  select current_role_name() into v_role;
  if v_role is null or v_role not in ('Super Admin', 'Accountant', 'Cashier') then
    raise exception 'Not authorized to generate fee records.';
  end if;

  -- ---- existing fee-generation logic (unchanged from 0008) ----
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

-- Belt-and-suspenders: the in-function check above is what actually
-- matters (PostgreSQL doesn't check argument types on REVOKE/GRANT against
-- overloads you don't have, so this targets the exact (uuid, date) overload
-- that exists). Re-stating the grant makes the intent explicit in the
-- migration history even though `to authenticated` was already the grant —
-- the real tightening is the role check inside the function, not this.
revoke execute on function get_or_create_fee_record(uuid, date) from public;
grant execute on function get_or_create_fee_record(uuid, date) to authenticated;
