-- ============================================================================
-- 18. ACCOUNTING-SAFE FINANCE: Posted → Immutable → Correction → Reversal →
--     New Transaction
--
-- The ledger triggers (post_transaction() and friends, section 12) only
-- fire on INSERT. That means an UPDATE to fee_payments.amount after the
-- fact — previously allowed for finance staff under "for all" / update
-- policies — would silently desync the row from the transactions ledger
-- and the account balance it already posted to. A DELETE is worse: the
-- sync triggers recompute paid_total from a sum, so the money vanishes
-- from fee_records/salary_records too, with no trace it ever happened.
--
-- The fix: fee_payments, income, expenses and salary_payments become
-- append-only. A correction never touches the original row's business
-- columns — it calls reverse_fee_payment() / reverse_income() /
-- reverse_expense() / reverse_salary_payment(), which:
--   1. marks the original row `reversed_at` (soft flag only — amount,
--      method, date etc. are still exactly what was originally posted)
--   2. posts a NEW, opposite-direction transaction to the ledger
--   3. lets the existing sync triggers recompute paid_total/status,
--      simply by excluding reversed rows from their sum
--
-- Both the RLS policies AND a pair of hard triggers enforce this — the
-- triggers apply even to a service-role/admin client, since triggers (unlike
-- RLS) can't be bypassed by switching keys. Even a Super Admin corrects a
-- posted payment by reversing it, not by editing it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Reversal-marker columns. Nullable, soft flag only — never removes or
--    changes what was actually posted.
-- ----------------------------------------------------------------------------
alter table fee_payments    add column if not exists reversed_at timestamptz;
alter table fee_payments    add column if not exists reversed_by uuid references users(id);
alter table fee_payments    add column if not exists reversal_reason text;

alter table income          add column if not exists reversed_at timestamptz;
alter table income          add column if not exists reversed_by uuid references users(id);
alter table income          add column if not exists reversal_reason text;

alter table expenses        add column if not exists reversed_at timestamptz;
alter table expenses        add column if not exists reversed_by uuid references users(id);
alter table expenses        add column if not exists reversal_reason text;

alter table salary_payments add column if not exists reversed_at timestamptz;
alter table salary_payments add column if not exists reversed_by uuid references users(id);
alter table salary_payments add column if not exists reversal_reason text;

-- ----------------------------------------------------------------------------
-- 2. Teach the existing "keep the total in sync" triggers to exclude
--    reversed rows — this is what actually makes a reversal reduce
--    paid_total/status, with no other change needed anywhere else.
-- ----------------------------------------------------------------------------
create or replace function sync_fee_record_totals() returns trigger as $$
declare
  rec_id  uuid := coalesce(new.fee_record_id, old.fee_record_id);
  total   numeric(12,2);
  payable numeric(12,2);
begin
  select coalesce(sum(amount), 0) into total from fee_payments where fee_record_id = rec_id and reversed_at is null;
  select total_payable into payable from fee_records where id = rec_id;
  update fee_records
    set paid_total = total,
        status = (case when total <= 0 then 'unpaid'
                       when total < payable then 'partial'
                       else 'paid' end)::fee_status
    where id = rec_id;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function sync_salary_record_paid() returns trigger as $$
declare
  rec_id uuid := coalesce(new.salary_record_id, old.salary_record_id);
  total  numeric(12,2);
  gross  numeric(12,2);
begin
  select coalesce(sum(amount), 0) into total from salary_payments where salary_record_id = rec_id and reversed_at is null;
  select gross_salary into gross from salary_records where id = rec_id;
  update salary_records
    set paid_total = total,
        status = (case when total <= 0 then 'unpaid'
                       when total < gross then 'partial'
                       else 'paid' end)::fee_status
    where id = rec_id;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 3. Immutability triggers — generic, works across all four tables by
--    comparing OLD vs NEW as jsonb with only the reversal-marker columns
--    excluded. Any other change (amount, method, date, category...) is
--    rejected outright.
-- ----------------------------------------------------------------------------
create or replace function enforce_ledger_row_immutable() returns trigger as $$
declare
  old_core jsonb := to_jsonb(old) - 'reversed_at' - 'reversed_by' - 'reversal_reason';
  new_core jsonb := to_jsonb(new) - 'reversed_at' - 'reversed_by' - 'reversal_reason';
begin
  if old_core is distinct from new_core then
    raise exception 'IMMUTABLE_LEDGER_ROW: % rows are immutable once posted. Every column is locked except the reversal markers — use the matching reverse_*() function to correct this instead of editing it.', tg_table_name;
  end if;
  return new;
end;
$$ language plpgsql;

create or replace function block_ledger_row_delete() returns trigger as $$
begin
  raise exception 'IMMUTABLE_LEDGER_ROW: % rows can never be deleted, including reversed ones — the reversal itself IS the correction, and deleting would destroy the audit trail. Use reverse_*() instead.', tg_table_name;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['fee_payments', 'income', 'expenses', 'salary_payments'] loop
    execute format('drop trigger if exists trg_%1$s_immutable_update on %1$s', t);
    execute format('create trigger trg_%1$s_immutable_update before update on %1$s for each row execute function enforce_ledger_row_immutable()', t);
    execute format('drop trigger if exists trg_%1$s_immutable_delete on %1$s', t);
    execute format('create trigger trg_%1$s_immutable_delete before delete on %1$s for each row execute function block_ledger_row_delete()', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 4. RLS — remove the update/delete policies entirely for these four
--    tables. There is no direct-edit path left; the SECURITY DEFINER
--    reverse_*() functions below are the only sanctioned way to touch a
--    posted row, and they bypass RLS by design (same pattern as
--    post_transaction() itself).
-- ----------------------------------------------------------------------------
drop policy if exists "only finance staff edit/delete payments" on fee_payments;
drop policy if exists "only finance staff delete payments" on fee_payments;

drop policy if exists "finance staff manage income" on income;
create policy "finance staff read income" on income for select using (is_finance_staff());
create policy "finance staff insert income" on income for insert with check (is_finance_staff());

drop policy if exists "finance staff manage expenses" on expenses;
create policy "finance staff read expenses" on expenses for select using (is_finance_staff());
create policy "finance staff insert expenses" on expenses for insert with check (is_finance_staff());

drop policy if exists "finance staff manage salary payments" on salary_payments;
create policy "finance staff read salary payments" on salary_payments for select using (is_finance_staff());
create policy "finance staff insert salary payments" on salary_payments for insert with check (is_finance_staff());

-- ----------------------------------------------------------------------------
-- 5. Reversal functions — one per source table. SECURITY DEFINER (like
--    post_transaction), with an explicit role check inside since RLS no
--    longer applies to them at all. Each: marks the row reversed, then
--    posts an opposite-direction transaction; the sync triggers above
--    handle recomputing paid_total/status automatically.
-- ----------------------------------------------------------------------------
create or replace function reverse_fee_payment(p_id uuid, p_reason text) returns void as $$
declare
  v_row fee_payments%rowtype;
  v_user_id uuid;
begin
  if not is_finance_staff() then
    raise exception 'Only finance staff can reverse a fee payment.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to reverse a payment.';
  end if;

  select * into v_row from fee_payments where id = p_id;
  if v_row.id is null then raise exception 'Payment not found.'; end if;
  if v_row.reversed_at is not null then raise exception 'This payment was already reversed.'; end if;

  select id into v_user_id from users where auth_user_id = auth.uid();

  update fee_payments set reversed_at = now(), reversed_by = v_user_id, reversal_reason = p_reason where id = p_id;

  perform post_transaction('fee_payment', 'out', v_row.amount, v_row.method, current_date,
    'Reversal: ' || p_reason, 'fee_payments', v_row.id);
end;
$$ language plpgsql security definer set search_path = public;

create or replace function reverse_income(p_id uuid, p_reason text) returns void as $$
declare
  v_row income%rowtype;
  v_user_id uuid;
begin
  if not is_finance_staff() then
    raise exception 'Only finance staff can reverse an income entry.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to reverse an entry.';
  end if;

  select * into v_row from income where id = p_id;
  if v_row.id is null then raise exception 'Income entry not found.'; end if;
  if v_row.reversed_at is not null then raise exception 'This entry was already reversed.'; end if;

  select id into v_user_id from users where auth_user_id = auth.uid();

  update income set reversed_at = now(), reversed_by = v_user_id, reversal_reason = p_reason where id = p_id;

  perform post_transaction('income', 'out', v_row.amount, v_row.method, current_date,
    'Reversal: ' || p_reason, 'income', v_row.id);
end;
$$ language plpgsql security definer set search_path = public;

create or replace function reverse_expense(p_id uuid, p_reason text) returns void as $$
declare
  v_row expenses%rowtype;
  v_user_id uuid;
begin
  if not is_finance_staff() then
    raise exception 'Only finance staff can reverse an expense.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to reverse an entry.';
  end if;

  select * into v_row from expenses where id = p_id;
  if v_row.id is null then raise exception 'Expense not found.'; end if;
  if v_row.reversed_at is not null then raise exception 'This expense was already reversed.'; end if;

  select id into v_user_id from users where auth_user_id = auth.uid();

  update expenses set reversed_at = now(), reversed_by = v_user_id, reversal_reason = p_reason where id = p_id;

  -- Money comes back in — the original expense posted 'out'.
  perform post_transaction('expense', 'in', v_row.amount, v_row.method, current_date,
    'Reversal: ' || p_reason, 'expenses', v_row.id);
end;
$$ language plpgsql security definer set search_path = public;

create or replace function reverse_salary_payment(p_id uuid, p_reason text) returns void as $$
declare
  v_row salary_payments%rowtype;
  v_user_id uuid;
begin
  if not is_finance_staff() then
    raise exception 'Only finance staff can reverse a salary payment.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to reverse a payment.';
  end if;

  select * into v_row from salary_payments where id = p_id;
  if v_row.id is null then raise exception 'Salary payment not found.'; end if;
  if v_row.reversed_at is not null then raise exception 'This payment was already reversed.'; end if;

  select id into v_user_id from users where auth_user_id = auth.uid();

  update salary_payments set reversed_at = now(), reversed_by = v_user_id, reversal_reason = p_reason where id = p_id;

  -- Money comes back in — the original salary payout posted 'out'.
  perform post_transaction('salary_payment', 'in', v_row.amount, v_row.method, current_date,
    'Reversal: ' || p_reason, 'salary_payments', v_row.id);
end;
$$ language plpgsql security definer set search_path = public;
