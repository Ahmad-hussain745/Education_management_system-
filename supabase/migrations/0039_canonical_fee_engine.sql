-- ============================================================================
-- 39. CANONICAL FEE ENGINE
--
-- Before this migration, a student's monthly bill was assembled from three
-- separate function calls inside get_or_create_fee_record(): resolve_monthly_fee()
-- (class fee vs. student override, by effective month), previous_outstanding()
-- (arrears), and an inline discount lookup. Every page that DISPLAYS a bill
-- (Student page, Payment page, Dashboard, Reports, Notifications) was
-- already reading the single stored result — fee_records.total_payable, a
-- generated column — rather than recalculating it themselves, so this
-- migration is not fixing five different answers to "what does this
-- student owe." It's fixing:
--
--   (a) three functions instead of one computing the bill in the first
--       place, and
--   (b) a real bug: previous_outstanding() floored arrears at zero, so an
--       overpayment in one month was silently discarded instead of
--       reducing the next month's bill. Removing that floor lets
--       previous_balance go negative (credit), which total_payable's
--       existing formula (monthly_fee + previous_balance - discount)
--       already handles correctly — a negative previous_balance reduces
--       what's owed, exactly as advance credit should.
--
-- calculate_student_fee_dues() below is now the one function that computes
-- a bill from scratch. get_or_create_fee_record() calls only this. Nothing
-- outside it re-derives class fee, override, discount, arrears, or advance
-- independently anywhere in the codebase (verified against every page that
-- reads fee data).
--
-- resolve_monthly_fee() is kept as-is, unmodified — it's also used
-- standalone by the student list preview (0029_scalable_listings.sql),
-- which only needs "what would this student's fee be," not a full bill.
-- previous_outstanding() is superseded (no longer called from
-- get_or_create_fee_record) but left in place rather than dropped, same
-- reasoning as prior migrations: dropping a function a running deployment
-- might still reference mid-deploy is riskier than an unused leftover.
-- ============================================================================

create or replace function calculate_student_fee_dues(p_student_id uuid, p_month date)
returns table(
  effective_month  date,
  class_fee        numeric,
  discount         numeric,
  previous_balance numeric,  -- positive = arrears owed, negative = advance credit
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

  -- Class fee vs. student-specific override, whichever is effective as of
  -- this month — unchanged logic, just called from one place now.
  v_fee := resolve_monthly_fee(p_student_id, v_class_id, v_month);

  select coalesce(sum(amount), 0) into v_discount
    from fee_discounts
    where student_id = p_student_id and active and institute_id = current_institute_id();

  -- Net of everything billed vs. everything paid before this month — no
  -- floor at zero, so a running credit (advance payment) carries forward
  -- as a negative previous_balance instead of being discarded.
  select coalesce(sum(monthly_fee - discount), 0) - coalesce((
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

-- get_or_create_fee_record() — same name/signature/role-check/institute-check
-- as 0037_fix_fee_generation_isolation.sql, only the fee-resolution lines
-- change: one call to the canonical function instead of three separate ones.
create or replace function get_or_create_fee_record(p_student_id uuid, p_month date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role            text;
  v_month           date := date_trunc('month', p_month)::date;
  v_fee_record_id   uuid;
  v_student_inst    uuid;
  v_dues            record;
begin
  select current_role_name() into v_role;
  if v_role is null or v_role not in ('Super Admin', 'Accountant', 'Cashier') then
    raise exception 'Not authorized to generate fee records.';
  end if;

  select institute_id into v_student_inst from students where id = p_student_id;
  if v_student_inst is null or v_student_inst != current_institute_id() then
    raise exception 'Student does not belong to your institute.';
  end if;

  select id into v_fee_record_id from fee_records
    where student_id = p_student_id and month = v_month and institute_id = current_institute_id();
  if v_fee_record_id is not null then
    return v_fee_record_id;
  end if;

  select * into v_dues from calculate_student_fee_dues(p_student_id, v_month);

  insert into fee_records (student_id, month, monthly_fee, previous_balance, discount)
    values (p_student_id, v_month, v_dues.class_fee, v_dues.previous_balance, v_dues.discount)
    returning id into v_fee_record_id;

  return v_fee_record_id;
end;
$$;
