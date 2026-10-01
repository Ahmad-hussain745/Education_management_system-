-- ============================================================================
-- SALARY LOCK — separation of duties. Run in the Supabase SQL Editor.
--
-- This is a regression test for a real, previously-exploitable bug (fixed
-- in 0057): enforce_approve_only() let is_finance_staff() (Super
-- Admin/Accountant) bypass the can_approve() check entirely, meaning an
-- Accountant could lock their own payroll draft by calling the lock
-- action directly — the UI hides that button from anyone but a Principal,
-- but nothing in the database actually stopped it before this fix. The
-- "Principal Approval" step was a button-hiding convention, not an
-- enforced boundary.
--
-- Self-adapting: this file doesn't assume which role is running it. It
-- reads current_role_name() and checks the outcome that role SHOULD get —
-- Principal/Super Admin locking should succeed, anyone else's lock attempt
-- should fail with NOT_AUTHORIZED. Run it once as an Accountant and once
-- as a Principal for full coverage; either run on its own still proves
-- that role's own boundary is holding.
-- ============================================================================

begin;

do $$
declare
  v_teacher_id  uuid;
  v_record_id   uuid;
  v_role        text;
  v_caught      text;
begin
  select current_role_name() into v_role;
  if v_role is null then
    raise exception 'ABORT — current_role_name() is null; this must be run logged in as a real app user, not a raw superuser session';
  end if;

  -------------------------------------------------------------------------
  -- SETUP — a drafted, unlocked salary record.
  -------------------------------------------------------------------------
  insert into teachers (name, salary_mode, fixed_salary, status) values ('TEST Lock Teacher', 'fixed', 50000, 'active') returning id into v_teacher_id;
  insert into salary_records (teacher_id, month, base_salary, locked) values (v_teacher_id, '2026-08-01', 50000, false) returning id into v_record_id;

  -------------------------------------------------------------------------
  -- Attempt to lock it directly (bypassing approveAndLock()'s own app-level
  -- code entirely — a raw UPDATE, exactly what a determined Accountant
  -- calling the underlying trigger's protection directly would attempt).
  -------------------------------------------------------------------------
  v_caught := null;
  begin
    update salary_records set locked = true, locked_at = now() where id = v_record_id;
  exception when others then
    v_caught := SQLERRM;
  end;

  if v_role in ('Super Admin', 'Principal') then
    if v_caught is not null then
      raise exception 'FAIL — % should be able to lock payroll, but got: %', v_role, v_caught;
    end if;
    raise notice 'PASS — % (can_approve()) successfully locked the payroll record, as expected', v_role;
  else
    if v_caught is null then
      raise exception 'FAIL — % locked a payroll record directly, bypassing Principal approval. THIS IS THE 0057 REGRESSION.', v_role;
    end if;
    if v_caught not like '%NOT_AUTHORIZED%' then
      raise exception 'FAIL — % was blocked, but for the wrong reason: %', v_role, v_caught;
    end if;
    raise notice 'PASS — % was correctly refused: only a Principal or Super Admin can lock payroll', v_role;
  end if;

  raise notice '=== SALARY LOCK TEST PASSED for role: % ===', v_role;
end $$;

rollback;
