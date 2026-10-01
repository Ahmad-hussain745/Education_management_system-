-- ============================================================================
-- 22. SECURE AUTOMATIC PAYROLL GENERATION
-- ============================================================================
-- generate_salary_records() was defined in 0001_init.sql as plain
-- `language plpgsql` — not SECURITY DEFINER, and with no role check inside
-- it at all. Two problems with that, same shape as the get_or_create_fee_record
-- gap fixed in 0013_security_and_finance_fixes.sql:
--
-- 1. Without SECURITY DEFINER, the function runs as the CALLER, so its
--    writes to salary_records/salary_items are still subject to RLS —
--    which happens to reject non-finance-staff callers today. But that's
--    an accident of the current RLS policies, not something this function
--    asserts for itself; if salary_records' RLS ever changed shape (e.g. to
--    grant Principal a broader "view/approve" write), this function would
--    silently start allowing payroll generation for a role that was only
--    ever meant to approve, not generate.
--
-- 2. The app already gates the "Generate Payroll" button to
--    isFinanceStaff (app/(app)/salary/payroll/page.js) — but that's a UI
--    convenience. Nothing stopped calling the function directly.
--
-- The fix: make it SECURITY DEFINER with its own explicit, self-contained
-- role check — exactly the "Only Super Admin or Accountant can generate
-- payroll" gate, checked with current_role_name() (0002_rls.sql), the same
-- pattern as every other trusted-gateway function in this schema
-- (post_transaction, reverse_*, get_or_create_fee_record).
--
-- The generation logic itself is byte-for-byte the same body as
-- 0001_init.sql — only the signature (security definer, search_path) and
-- the role check at the top are new.
-- ============================================================================

create or replace function generate_salary_records(p_month date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role     text;
  t          record;
  r          record;
  rec_id     uuid;
  pct_total  numeric(12,2);
  base_amt   numeric(12,2);
  collected  numeric(12,2);
  share      numeric(12,2);
  fee_per    numeric(12,2);
  scount     int;
begin
  select current_role_name() into v_role;
  if v_role is null or v_role not in ('Super Admin', 'Accountant') then
    raise exception 'Only Super Admin or Accountant can generate payroll.';
  end if;

  -- ---- existing generate_salary_records logic (unchanged from 0001) ----
  for t in select * from teachers where status = 'active' loop

    -- don't touch an already-approved month
    if exists (select 1 from salary_records where teacher_id = t.id and month = p_month and locked) then
      continue;
    end if;

    pct_total := 0;
    base_amt  := case when t.salary_mode in ('fixed', 'hybrid') then t.fixed_salary else 0 end;

    -- upsert the header row first so salary_items can reference it
    insert into salary_records (teacher_id, month, base_salary, percentage_total)
      values (t.id, p_month, base_amt, 0)
      on conflict (teacher_id, month) do update set base_salary = excluded.base_salary
      returning id into rec_id;

    -- clear old percentage_share items for this month so re-running is idempotent
    delete from salary_items where salary_record_id = rec_id and item_type = 'percentage_share';

    if t.salary_mode in ('percentage', 'hybrid') then
      for r in select * from salary_rules where teacher_id = t.id and active loop
        select count(*) into scount from students
          where class_id = r.class_id and (r.section_id is null or section_id = r.section_id) and status = 'active';
        select monthly_fee into fee_per from fee_structures where class_id = r.class_id and student_id is null;
        collected := class_collected_amount(r.class_id, r.section_id, p_month);
        share     := round(collected * (r.percentage / 100), 2);
        pct_total := pct_total + share;

        insert into salary_items (salary_record_id, item_type, class_id, section_id, students_count, fee_per_student, expected_amount, collected_amount, percentage, amount, note)
          values (rec_id, 'percentage_share', r.class_id, r.section_id, scount, fee_per, coalesce(scount,0) * coalesce(fee_per,0), collected, r.percentage, share,
                  'Auto-generated ' || to_char(p_month, 'Mon YYYY'));
      end loop;
    end if;

    update salary_records set percentage_total = pct_total where id = rec_id;
  end loop;
end;
$$;

-- Belt-and-suspenders, same rationale as 0013's identical statement for
-- get_or_create_fee_record: the in-function check above is what actually
-- matters, this just makes the intent explicit in the migration history.
revoke execute on function generate_salary_records(date) from public;
grant execute on function generate_salary_records(date) to authenticated;
