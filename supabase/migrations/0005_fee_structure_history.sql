-- ============================================================================
-- 17. FEE STRUCTURE HISTORY — real dated fee changes, not a single frozen row
-- ============================================================================
-- 0001_init.sql's uq_fee_structure_class / uq_fee_structure_student allowed
-- exactly ONE fee_structures row per class (or per student override), ever —
-- there was no way to schedule "Class 10 becomes Rs. 8,500 starting next
-- July" without overwriting the current row and losing what it used to be.
-- get_or_create_fee_record() (0003_fee_generation.sql) matched that: a plain
-- lookup with no date filtering, since there was only ever one row to find.
--
-- This migration makes effective_from do what its name says: a class or a
-- student override can now have several rows over time, each taking effect
-- on its own date, and the fee a new month's bill uses is whichever row's
-- effective_from is the most recent one on or before that month — not
-- "whatever the single row currently says." Existing fee_records are
-- unaffected: fee_records.monthly_fee is a plain stored number written once
-- at generation time, not a live reference to fee_structures, so past bills
-- keep whatever fee was resolved for them at the time.

alter table fee_structures add column if not exists active boolean not null default true;

drop index if exists uq_fee_structure_class;
drop index if exists uq_fee_structure_student;

-- The real constraint now is "no two rows for the same class/student take
-- effect on the same date" (a genuine duplicate), not "only one row ever."
create unique index if not exists uq_fee_structure_class_effective
  on fee_structures(class_id, effective_from) where student_id is null;
create unique index if not exists uq_fee_structure_student_effective
  on fee_structures(student_id, effective_from) where student_id is not null;

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

  -- Student-specific override wins if one is in effect by this month;
  -- otherwise fall back to the class-level fee in effect by this month.
  -- "In effect by this month" = the most recent active row whose
  -- effective_from is on or before the month being billed — a row
  -- scheduled for a future month is correctly ignored until then.
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

  select greatest(total_payable - paid_total, 0) into v_prev_balance
    from fee_records
    where student_id = p_student_id and month < v_month
    order by month desc
    limit 1;
  v_prev_balance := coalesce(v_prev_balance, 0);

  select coalesce(sum(amount), 0) into v_discount
    from fee_discounts where student_id = p_student_id and active;

  insert into fee_records (student_id, month, monthly_fee, previous_balance, discount)
    values (p_student_id, v_month, v_monthly_fee, v_prev_balance, v_discount)
    returning id into v_fee_record_id;

  return v_fee_record_id;
end;
$$ language plpgsql security definer set search_path = public;
