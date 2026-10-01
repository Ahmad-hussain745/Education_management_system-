-- ============================================================================
-- 24. BULK MONTHLY FEE GENERATION
--
-- Today, a fee_records row only comes into existence when a cashier opens
-- Payment Entry for one specific student — get_or_create_fee_record() is the
-- ONLY caller that ever creates one. That means Expected Fees, Collection %,
-- and Outstanding on the Dashboard/Reports only ever reflect however many
-- students someone happened to look up that month — not the whole academy.
-- With 500 students and 150 visited, the other 350 are invisible to every
-- financial total, not just absent from a list.
--
-- This migration does NOT create a second fee-calculation algorithm. The
-- per-student resolution logic (effective monthly fee → previous balance →
-- discount → total_payable) is pulled out of get_or_create_fee_record() into
-- its own function, resolve_monthly_fee(), and get_or_create_fee_record() is
-- redefined to call it — same behavior, now shared. generate_monthly_fee_records()
-- then just loops active students and calls get_or_create_fee_record() per
-- student, literally the same function Payment Entry already calls one at a
-- time. "Skip if already exists" isn't new logic either — it's the existing
-- early-return in get_or_create_fee_record() when a row for that student/month
-- already exists.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extracted: resolve a student's effective monthly fee for a given month
--    (student-specific override first, falling back to the class-level rate)
--    — exactly the logic that used to be inlined in get_or_create_fee_record().
-- ----------------------------------------------------------------------------
create or replace function resolve_monthly_fee(p_student_id uuid, p_class_id uuid, p_month date)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fee numeric(12,2);
begin
  select monthly_fee into v_fee
    from fee_structures
    where student_id = p_student_id and active and effective_from <= p_month
    order by effective_from desc limit 1;

  if v_fee is null then
    select monthly_fee into v_fee
      from fee_structures
      where class_id = p_class_id and student_id is null and active and effective_from <= p_month
      order by effective_from desc limit 1;
  end if;

  return coalesce(v_fee, 0);
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. get_or_create_fee_record() — same signature, same role check, same
--    return value. Only the fee-resolution lines change, to call the newly
--    extracted function instead of duplicating its logic inline.
-- ----------------------------------------------------------------------------
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
  v_class_id        uuid;
  v_monthly_fee     numeric(12,2);
  v_prev_balance    numeric(12,2) := 0;
  v_discount        numeric(12,2) := 0;
begin
  select current_role_name() into v_role;
  if v_role is null or v_role not in ('Super Admin', 'Accountant', 'Cashier') then
    raise exception 'Not authorized to generate fee records.';
  end if;

  select id into v_fee_record_id from fee_records
    where student_id = p_student_id and month = v_month;
  if v_fee_record_id is not null then
    return v_fee_record_id; -- "skip if already exists"
  end if;

  select class_id into v_class_id from students where id = p_student_id;

  v_monthly_fee := resolve_monthly_fee(p_student_id, v_class_id, v_month);
  v_prev_balance := previous_outstanding(p_student_id, v_month);

  select coalesce(sum(amount), 0) into v_discount
    from fee_discounts where student_id = p_student_id and active;

  insert into fee_records (student_id, month, monthly_fee, previous_balance, discount)
    values (p_student_id, v_month, v_monthly_fee, v_prev_balance, v_discount)
    returning id into v_fee_record_id;

  return v_fee_record_id;
end;
$$;

revoke execute on function get_or_create_fee_record(uuid, date) from public;
grant execute on function get_or_create_fee_record(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Preview — read-only, no inserts, powers the /fees/generate screen
--    before anyone commits to running the real generation.
-- ----------------------------------------------------------------------------
create or replace function preview_monthly_fee_generation(p_month date)
returns table(active_students int, already_generated int, to_generate int, expected_amount numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role  text;
  v_month date := date_trunc('month', p_month)::date;
begin
  select current_role_name() into v_role;
  if v_role is null or v_role not in ('Super Admin', 'Accountant', 'Cashier') then
    raise exception 'Not authorized to preview fee generation.';
  end if;

  return query
  select
    (select count(*) from students where status = 'active')::int,
    (select count(*) from fee_records fr join students s on s.id = fr.student_id
       where fr.month = v_month and s.status = 'active')::int,
    (select count(*) from students s where s.status = 'active'
       and not exists (select 1 from fee_records fr where fr.student_id = s.id and fr.month = v_month))::int,
    coalesce((
      select sum(
        resolve_monthly_fee(s.id, s.class_id, v_month)
        + previous_outstanding(s.id, v_month)
        - coalesce((select sum(amount) from fee_discounts where student_id = s.id and active), 0)
      )
      from students s
      where s.status = 'active'
        and not exists (select 1 from fee_records fr where fr.student_id = s.id and fr.month = v_month)
    ), 0);
end;
$$;

revoke execute on function preview_monthly_fee_generation(date) from public;
grant execute on function preview_monthly_fee_generation(date) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. The actual bulk generation — one call, loops active students, calls
--    get_or_create_fee_record() per student (the same function Payment Entry
--    already uses one at a time). Idempotent: re-running for a month that's
--    already fully generated just skips everyone via that function's own
--    early return, and costs nothing extra to run again.
-- ----------------------------------------------------------------------------
create or replace function generate_monthly_fee_records(p_month date)
returns table(generated_count int, skipped_count int, total_expected numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role      text;
  v_month     date := date_trunc('month', p_month)::date;
  v_student   record;
  v_generated int := 0;
  v_skipped   int := 0;
  v_existed   boolean;
begin
  select current_role_name() into v_role;
  if v_role is null or v_role not in ('Super Admin', 'Accountant', 'Cashier') then
    raise exception 'Not authorized to generate fee records.';
  end if;

  for v_student in select id from students where status = 'active' loop
    select exists(select 1 from fee_records where student_id = v_student.id and month = v_month) into v_existed;

    perform get_or_create_fee_record(v_student.id, v_month);

    if v_existed then
      v_skipped := v_skipped + 1;
    else
      v_generated := v_generated + 1;
    end if;
  end loop;

  return query
    select v_generated, v_skipped,
      coalesce((select sum(total_payable) from fee_records where month = v_month), 0);
end;
$$;

revoke execute on function generate_monthly_fee_records(date) from public;
grant execute on function generate_monthly_fee_records(date) to authenticated;
