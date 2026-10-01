-- ============================================================================
-- 35. FIX: FEE EFFECTIVE-DATE COMPARED AGAINST THE WRONG GRANULARITY
--
-- Real bug, confirmed against this project's actual code — not a
-- hypothetical. Root cause:
--
--   fee_structures.effective_from defaults to current_date (0001_init.sql)
--   — a specific DAY (e.g. 2026-09-03) — but resolve_monthly_fee()
--   (0021_bulk_fee_generation.sql, unchanged since its origin in
--   0005_fee_structure_history.sql) compares it against a MONTH-START date:
--
--       where ... effective_from <= p_month     -- p_month is always day 1
--
--   so a fee entered on any day other than the 1st (which is nearly every
--   fee — a student added on the 3rd, a class fee changed on the 15th)
--   compares as "in the future" relative to the very month it was meant to
--   apply to, and gets silently skipped:
--
--       2026-09-03 <= 2026-09-01   →  false
--
--   resolve_monthly_fee() returns 0 for both the student override AND the
--   class fee (same comparison, same bug, in both branches), so
--   get_or_create_fee_record() bills the student Rs. 0 for that month.
--   Payment Entry then correctly shows "Maximum Rs. 0" — it isn't the bug,
--   it's accurately reporting a fee_records row that was already wrong
--   when it was created. The fee starts resolving correctly the FOLLOWING
--   month purely by accident, once effective_from's day-of-month no longer
--   matters (any date in September is <= any date in October).
--
-- FIX: compare month-to-month, not day-to-month. A fee takes effect from
-- the START of whichever month it was entered in, not the exact day — this
-- is also just the correct billing semantics (fee_records only ever bills
-- in whole months) and was already how the surrounding code assumed dates
-- worked. Nothing about WHAT effective_from stores changes (still the
-- exact day something was entered/scheduled, which has genuine
-- informational value); only how it's compared.
--
-- This is deliberately a database-level fix, not a "remember to pass
-- effective_from = the 1st" convention enforced in application code —
-- app/(app)/students/actions.js, app/(app)/fees/structure/actions.js, and
-- app/(app)/fees/overrides/actions.js all insert into fee_structures
-- independently, and a future page or a manual SQL-editor insert would
-- silently reintroduce the exact same bug if the fix lived only in one of
-- them. resolve_monthly_fee() is the one function every one of those paths
-- already funnels through (via get_or_create_fee_record()), so fixing it
-- there fixes every caller, present and future, at once.
-- ============================================================================

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
    where student_id = p_student_id and active and date_trunc('month', effective_from) <= p_month
    order by effective_from desc limit 1;

  if v_fee is null then
    select monthly_fee into v_fee
      from fee_structures
      where class_id = p_class_id and student_id is null and active and date_trunc('month', effective_from) <= p_month
      order by effective_from desc limit 1;
  end if;

  return coalesce(v_fee, 0);
end;
$$;

-- ----------------------------------------------------------------------------
-- Self-check — creates a throwaway class/student/fee_structures row with a
-- deliberately mid-month effective_from (the exact shape that triggered the
-- bug), asserts resolve_monthly_fee() now resolves it correctly for that
-- same month, then deletes the throwaway rows. If the assertion fails, the
-- RAISE EXCEPTION rolls back this entire migration — including the
-- function redefinition above — so a broken fix can never silently ship;
-- either this migration applies AND is proven correct, or it doesn't apply
-- at all.
-- ----------------------------------------------------------------------------
do $$
declare
  v_class_id   uuid;
  v_student_id uuid;
  v_month      date := date_trunc('month', current_date)::date;
  v_mid_month  date := v_month + 2; -- e.g. the 3rd — never the 1st
  v_resolved   numeric;
begin
  insert into classes (name, sort_order) values ('__self_check_0034', -1) returning id into v_class_id;
  insert into students (name, class_id, status) values ('__self_check_0034', v_class_id, 'active') returning id into v_student_id;
  insert into fee_structures (student_id, monthly_fee, effective_from, active)
    values (v_student_id, 8000, v_mid_month, true);

  v_resolved := resolve_monthly_fee(v_student_id, v_class_id, v_month);

  delete from fee_structures where student_id = v_student_id;
  delete from students where id = v_student_id;
  delete from classes where id = v_class_id;

  if v_resolved <> 8000 then
    raise exception '0034 self-check FAILED: a fee_structures row dated % resolved to % for the month of % (expected 8000). resolve_monthly_fee() still has the effective-date bug.',
      v_mid_month, v_resolved, v_month;
  end if;

  raise notice '0034 self-check passed: a mid-month fee (dated %) correctly resolves for its own month.', v_mid_month;
end;
$$;

-- ----------------------------------------------------------------------------
-- Repair — for a fee_records row that was already generated WHILE the bug
-- was live and came out wrong (monthly_fee resolved to 0 when it
-- shouldn't have). Deliberately narrow: only ever touches a row with
-- paid_total = 0 — the moment any payment has been recorded against a
-- bill, that bill is left alone rather than having its numbers rewritten
-- out from under a real payment (same "never silently rewrite financial
-- history" stance as the rest of this schema's immutable-ledger design;
-- see docs/BACKUP_AND_RECOVERY.md and 0011_immutable_ledger.sql). A row
-- with a genuine Rs. 0 fee (a fee waiver, a free-tuition case) is
-- unaffected either way, since re-resolving it returns the same 0 it
-- already had.
-- ----------------------------------------------------------------------------
create or replace function repair_fee_record(p_student_id uuid, p_month date)
returns fee_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role    text;
  v_month   date := date_trunc('month', p_month)::date;
  v_class_id uuid;
  v_row     fee_records;
begin
  select current_role_name() into v_role;
  if v_role is null or v_role not in ('Super Admin', 'Accountant') then
    raise exception 'NOT_AUTHORIZED: Not authorized to repair fee records.';
  end if;

  select class_id into v_class_id from students where id = p_student_id;
  if v_class_id is null and not exists (select 1 from students where id = p_student_id) then
    raise exception 'INVALID_STUDENT: That student does not exist.';
  end if;

  update fee_records set
    monthly_fee = resolve_monthly_fee(p_student_id, v_class_id, v_month),
    previous_balance = previous_outstanding(p_student_id, v_month),
    discount = coalesce((select sum(amount) from fee_discounts where student_id = p_student_id and active), 0)
  where student_id = p_student_id and month = v_month and paid_total = 0
  returning * into v_row;

  if v_row.id is null then
    raise exception 'NOT_REPAIRABLE: No fee_records row for that student/month with paid_total = 0 — either none exists yet, or it already has a payment against it and is intentionally left untouched.';
  end if;

  return v_row;
end;
$$;

revoke execute on function repair_fee_record(uuid, date) from public;
grant execute on function repair_fee_record(uuid, date) to authenticated;
