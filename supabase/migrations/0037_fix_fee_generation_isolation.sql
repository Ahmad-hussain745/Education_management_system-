-- ============================================================================
-- 37. FEE GENERATION INSTITUTE ISOLATION FIX
--
-- get_or_create_fee_record() and generate_monthly_fee_records()
-- (0021_bulk_fee_generation.sql / 0023_fee_generation_history.sql) both
-- predate multi-tenancy (0035_multi_tenancy.sql) and run `security
-- definer`, which bypasses RLS entirely. Neither was ever updated to
-- filter by institute, so as they stand today:
--   - generate_monthly_fee_records() loops over EVERY institute's active
--     students, not just the caller's — any institute's admin running
--     "Generate Monthly Fees" creates fee records for every other
--     institute too.
--   - get_or_create_fee_record() never checks that p_student_id belongs
--     to the caller's institute.
-- This migration re-defines both, scoped by current_institute_id() (from
-- 0035_multi_tenancy.sql), and adds a service-role-only variant so the
-- monthly automation cron (added alongside this migration) can generate
-- fees for one specific institute without a signed-in session — the same
-- split already used for fee reminders (see run_fee_reminder_schedule()
-- in 0027_notifications.sql vs. the user-facing reminder actions).
--
-- NOTE — this fixes fee generation specifically because it's what today's
-- automation work touches. It does not audit the other ~20 pre-0035
-- security-definer functions across the codebase for the same gap; that
-- is a separate, larger pass that still needs doing before this app is
-- trusted with more than one real institute's live data.
-- ============================================================================

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
  v_student_inst    uuid;
begin
  select current_role_name() into v_role;
  if v_role is null or v_role not in ('Super Admin', 'Accountant', 'Cashier') then
    raise exception 'Not authorized to generate fee records.';
  end if;

  select institute_id, class_id into v_student_inst, v_class_id
    from students where id = p_student_id;

  if v_student_inst is null or v_student_inst != current_institute_id() then
    raise exception 'Student does not belong to your institute.';
  end if;

  select id into v_fee_record_id from fee_records
    where student_id = p_student_id and month = v_month and institute_id = current_institute_id();
  if v_fee_record_id is not null then
    return v_fee_record_id; -- "skip if already exists"
  end if;

  v_monthly_fee := resolve_monthly_fee(p_student_id, v_class_id, v_month);
  v_prev_balance := previous_outstanding(p_student_id, v_month);

  select coalesce(sum(amount), 0) into v_discount
    from fee_discounts where student_id = p_student_id and active and institute_id = current_institute_id();

  insert into fee_records (student_id, month, monthly_fee, previous_balance, discount)
    values (p_student_id, v_month, v_monthly_fee, v_prev_balance, v_discount)
    returning id into v_fee_record_id;

  return v_fee_record_id;
end;
$$;

-- Shared worker: does the actual generation loop for one explicit
-- institute. Not granted to anyone directly — both the interactive,
-- role-checked wrapper and the cron-only wrapper below call this.
create or replace function generate_monthly_fee_records_for_institute(p_institute_id uuid, p_month date, p_generated_by uuid)
returns table(run_id uuid, generated_count int, skipped_count int, failed_count int, total_expected numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month      date := date_trunc('month', p_month)::date;
  v_student    record;
  v_generated  int := 0;
  v_skipped    int := 0;
  v_failed     int := 0;
  v_existed    boolean;
  v_run_id     uuid;
  v_total      int;
begin
  select count(*) into v_total from students where status = 'active' and institute_id = p_institute_id;

  insert into fee_generation_runs (month, total_students, generated_by, status, institute_id)
    values (v_month, v_total, p_generated_by, 'running', p_institute_id)
    returning id into v_run_id;

  for v_student in select id from students where status = 'active' and institute_id = p_institute_id loop
    select exists(
      select 1 from fee_records where student_id = v_student.id and month = v_month and institute_id = p_institute_id
    ) into v_existed;

    begin
      perform get_or_create_fee_record(v_student.id, v_month);
      if v_existed then
        v_skipped := v_skipped + 1;
      else
        v_generated := v_generated + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  update fee_generation_runs set
    completed_at = now(),
    generated_count = v_generated,
    skipped_count = v_skipped,
    failed_count = v_failed,
    expected_amount = coalesce((select sum(total_payable) from fee_records where month = v_month and institute_id = p_institute_id), 0),
    status = case when v_failed > 0 and v_generated = 0 then 'failed' else 'completed' end
  where id = v_run_id;

  return query
    select v_run_id, v_generated, v_skipped, v_failed,
      coalesce((select sum(total_payable) from fee_records where month = v_month and institute_id = p_institute_id), 0);
end;
$$;

-- Interactive, role-checked entry point — same name/signature the app's
-- GenerateFeesButton.js already calls, so no frontend change is needed.
-- get_or_create_fee_record() runs inside the loop as the same signed-in
-- caller (security definer functions still see the original auth.uid()),
-- so its own role + institute checks apply on top of this one too.
create or replace function generate_monthly_fee_records(p_month date)
returns table(run_id uuid, generated_count int, skipped_count int, failed_count int, total_expected numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_by   uuid;
begin
  select current_role_name() into v_role;
  if v_role is null or v_role not in ('Super Admin', 'Accountant', 'Cashier') then
    raise exception 'Not authorized to generate fee records.';
  end if;

  select id into v_by from users where auth_user_id = auth.uid();

  return query
    select * from generate_monthly_fee_records_for_institute(current_institute_id(), p_month, v_by);
end;
$$;

-- Cron-only entry point — no signed-in user, so it takes the institute
-- explicitly instead of reading current_institute_id(). Restricted to
-- service_role so it can only ever be called from a trusted server
-- context (the cron route, using the admin client), never from a
-- signed-in user's own session — identical reasoning to
-- run_fee_reminder_schedule() in 0027_notifications.sql.
create or replace function run_monthly_fee_generation_for_institute(p_institute_id uuid, p_month date)
returns table(run_id uuid, generated_count int, skipped_count int, failed_count int, total_expected numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select * from generate_monthly_fee_records_for_institute(p_institute_id, p_month, null::uuid);
end;
$$;

alter table fee_generation_runs add column if not exists institute_id uuid references institutes(id) default current_institute_id();

revoke execute on function generate_monthly_fee_records_for_institute(uuid, date, uuid) from public, authenticated;
revoke execute on function run_monthly_fee_generation_for_institute(uuid, date) from public, authenticated;
grant execute on function run_monthly_fee_generation_for_institute(uuid, date) to service_role;
