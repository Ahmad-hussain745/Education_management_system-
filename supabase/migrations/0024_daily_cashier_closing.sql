-- ============================================================================
-- 29. DAILY CASHIER CLOSING
--
-- New reconciliation record: at the end of the day, a Cashier counts the
-- physical cash in hand and compares it against what the system says should
-- be there. Expected Cash is Cash Collections (fee payments taken as Cash
-- today) plus Other Income taken as Cash today — deliberately NOT Bank
-- Collections, since a bank/cheque/Easypaisa/JazzCash/Card payment never
-- touches the physical drawer. Bank Collections is still shown on the slip
-- for a full picture of the day, it just isn't part of the cash math.
--
-- Same "never trust the client's numbers" stance as the rest of this
-- schema (check_fee_payment_within_remaining, check_salary_payment_*,
-- assign_teacher_class_with_salary): the two RPCs below both recompute
-- Cash/Bank/Other-Income straight from fee_payments/income at call time.
-- close_cashier_day() does this again right before inserting — the
-- preview a Cashier saw a few seconds earlier on the page is never what
-- actually gets written, only what the database itself just computed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: the caller's own users.id — cashier_closings needs to compare
-- "whose day is this" against "who is asking", the same way
-- current_teacher_id() already does for teachers (0002_rls.sql).
-- ----------------------------------------------------------------------------
create or replace function current_users_id() returns uuid as $$
  select id from users where auth_user_id = auth.uid() limit 1;
$$ language sql stable security definer;

create table cashier_closings (
  id                uuid primary key default gen_random_uuid(),
  cashier_id        uuid not null references users(id),
  closing_date      date not null default current_date,
  cash_collections  numeric(12,2) not null,
  bank_collections  numeric(12,2) not null,
  other_income_cash numeric(12,2) not null,
  expected_cash     numeric(12,2) not null,
  actual_cash       numeric(12,2) not null check (actual_cash >= 0),
  difference        numeric(12,2) not null,   -- actual_cash - expected_cash; negative = shortage
  reason            text,
  closed_by         uuid references users(id),  -- who actually submitted (may differ from cashier_id if finance staff closed on the cashier's behalf)
  closed_at         timestamptz not null default now(),

  -- A shortage or overage of any size must be explained — matches the
  -- "require a reason" behavior asked for, enforced here rather than only
  -- in the UI so it can't be skipped by calling the table directly either.
  constraint chk_cashier_closing_reason_required
    check (actual_cash = expected_cash or (reason is not null and length(trim(reason)) > 0)),

  -- One closing per cashier per day — the real guard against double-closing,
  -- same role a unique constraint plays everywhere else in this schema.
  constraint uq_cashier_closing_day unique (cashier_id, closing_date)
);
create index idx_cashier_closings_date on cashier_closings(closing_date);

alter table cashier_closings enable row level security;

-- Read: finance staff/Principal see every cashier's closings (oversight);
-- a Cashier sees only their own — never another cashier's drawer.
create policy "view: finance staff any, cashier own only" on cashier_closings
  for select
  using (can_view_finance() or cashier_id = current_users_id());

-- No insert/update/delete policies at all: rows are only ever created by
-- close_cashier_day() below, which runs SECURITY DEFINER and therefore
-- bypasses RLS as its owner — exactly the same shape as
-- get_or_create_fee_record() (0003_fee_generation.sql) being the only way
-- to write fee_records despite Cashier having no direct insert policy
-- there either. A closed day is never editable or deletable by anyone,
-- including Super Admin — it's a record of what was physically counted,
-- not a ledger entry with a reverse/adjust path.

-- ----------------------------------------------------------------------------
-- Shared aggregation, used by both RPCs below so the preview a Cashier sees
-- and the numbers actually written can never be computed two different ways.
-- ----------------------------------------------------------------------------
create or replace function compute_cashier_closing_totals(p_cashier_id uuid, p_date date)
returns table (cash_collections numeric, bank_collections numeric, other_income_cash numeric, expected_cash numeric)
language sql stable security definer set search_path = public as $$
  select
    coalesce((select sum(amount) from fee_payments
      where received_by = p_cashier_id and paid_on = p_date and method = 'Cash'), 0) as cash_collections,
    coalesce((select sum(amount) from fee_payments
      where received_by = p_cashier_id and paid_on = p_date and method <> 'Cash'), 0) as bank_collections,
    coalesce((select sum(amount) from income
      where received_by = p_cashier_id and income_date = p_date and method = 'Cash'), 0) as other_income_cash,
    coalesce((select sum(amount) from fee_payments
      where received_by = p_cashier_id and paid_on = p_date and method = 'Cash'), 0)
    + coalesce((select sum(amount) from income
      where received_by = p_cashier_id and income_date = p_date and method = 'Cash'), 0) as expected_cash;
$$;

-- ----------------------------------------------------------------------------
-- Preview for the page, before a Cashier has typed in what they counted.
-- SECURITY DEFINER because a Cashier has no SELECT policy on `income` at
-- all ("finance staff manage income" / "principal views income" —
-- 0002_rls.sql doesn't mention Cashier); this hands back only the four
-- aggregate totals, never a raw income row, so it doesn't actually widen
-- what a Cashier can see. The authorization check below is what a normal
-- RLS policy would otherwise be doing.
-- ----------------------------------------------------------------------------
create or replace function get_cashier_closing_summary(p_cashier_id uuid, p_date date)
returns table (cash_collections numeric, bank_collections numeric, other_income_cash numeric, expected_cash numeric, already_closed boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (can_view_finance() or (current_role_name() = 'Cashier' and current_users_id() = p_cashier_id)) then
    raise exception 'NOT_AUTHORIZED: You can only view your own cashier closing.';
  end if;

  return query
    select t.cash_collections, t.bank_collections, t.other_income_cash, t.expected_cash,
      exists(select 1 from cashier_closings c where c.cashier_id = p_cashier_id and c.closing_date = p_date) as already_closed
    from compute_cashier_closing_totals(p_cashier_id, p_date) t;
end;
$$;

grant execute on function get_cashier_closing_summary(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- The actual "Close Day" action. Recomputes everything fresh (never trusts
-- whatever the client displayed a moment ago), enforces the reason
-- requirement server-side too, and inserts.
-- ----------------------------------------------------------------------------
create or replace function close_cashier_day(p_cashier_id uuid, p_date date, p_actual_cash numeric, p_reason text default null)
returns cashier_closings
language plpgsql security definer set search_path = public as $$
declare
  v_totals record;
  v_diff numeric;
  v_closed_by uuid;
  v_row cashier_closings;
begin
  if not (is_finance_staff() or (current_role_name() = 'Cashier' and current_users_id() = p_cashier_id)) then
    raise exception 'NOT_AUTHORIZED: You can only close your own cashier day.';
  end if;

  if p_actual_cash is null or p_actual_cash < 0 then
    raise exception 'INVALID_ACTUAL_CASH: Enter the actual cash counted (0 or more).';
  end if;

  select * into v_totals from compute_cashier_closing_totals(p_cashier_id, p_date);
  v_diff := p_actual_cash - v_totals.expected_cash;

  if v_diff <> 0 and (p_reason is null or length(trim(p_reason)) = 0) then
    raise exception 'REASON_REQUIRED: A reason is required when actual cash does not match expected cash.';
  end if;

  v_closed_by := current_users_id();

  insert into cashier_closings (
    cashier_id, closing_date, cash_collections, bank_collections, other_income_cash,
    expected_cash, actual_cash, difference, reason, closed_by
  ) values (
    p_cashier_id, p_date, v_totals.cash_collections, v_totals.bank_collections, v_totals.other_income_cash,
    v_totals.expected_cash, p_actual_cash, v_diff, nullif(trim(coalesce(p_reason, '')), ''), v_closed_by
  ) returning * into v_row;

  return v_row;
exception
  when unique_violation then
    raise exception 'ALREADY_CLOSED: This cashier''s day for % has already been closed.', p_date;
end;
$$;

grant execute on function close_cashier_day(uuid, date, numeric, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Finance staff/Principal need to pick WHICH cashier's day they're viewing
-- or closing on behalf of — but users' own RLS ("read own row",
-- 0002_rls.sql) only lets Super Admin read every users row; Accountant and
-- Principal can only read their own. Without this, their cashier picker on
-- the page would come back empty for those two roles. Security definer,
-- gated to the same can_view_finance() tier as everything else on this
-- page, returning only id/name — no email, phone, or anything else off
-- that row.
-- ----------------------------------------------------------------------------
create or replace function list_cashiers()
returns table (id uuid, name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can_view_finance() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  return query
    select u.id, u.name from users u
    join roles r on r.id = u.role_id
    where r.name = 'Cashier' and u.status = 'active'
    order by u.name;
end;
$$;

grant execute on function list_cashiers() to authenticated;
