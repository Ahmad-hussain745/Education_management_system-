-- ============================================================================
-- 60. Phase 32 — immutable event/outbox model for financial operations.
--
-- Audited the existing schema against "Command → Event → Ledger, derive
-- the balance, never UPDATE balance = X" before writing anything, since
-- most of this already exists and predates this phase:
--
--   COMMAND  → a person recording a payment/expense/income/salary payout
--   EVENT    → the row itself. fee_payments/income/expenses/salary_payments
--              are already append-only + immutable (0011_immutable_ledger.sql
--              — triggers reject UPDATE/DELETE outright; a correction posts
--              a new reversal event, it never edits the original). Each
--              insert also emits a real domain event (PAYMENT_CREATED etc.,
--              0057_event_driven_architecture.sql, domain_events table) for
--              async subscribers (notifications, audit).
--   LEDGER   → transactions (0001_init.sql) — one immutable row per posting,
--              written by post_transaction(), never updated or deleted.
--   DERIVED  → fee_records.paid_total and salary_records.paid_total are
--              already SUM(...) triggers over the event rows (excluding
--              reversed ones), not stored counters someone increments.
--              inventory stock is the same story: no stored quantity
--              column exists at all — get_item_stock() (0028_inventory.sql)
--              derives it from inventory_stock_movements every time it's
--              read.
--
-- THE ONE PLACE THIS WASN'T TRUE: accounts.current_balance. post_transaction()
-- was doing exactly the anti-pattern this phase calls out —
-- `update accounts set current_balance = current_balance + amount` — a
-- stored running total, mutated incrementally, that only stays correct if
-- every single post_transaction() call over the account's entire history
-- ran cleanly with no missed step, no partial migration, no manual fix.
-- Nothing currently exploits that fragility, but it's the literal
-- UPDATE-balance pattern the phase asks to replace, so it's what changes
-- below — everything above it was already the pattern being asked for and
-- is left alone.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. account_balance_as_of() — the read-side derivation, same shape as
--    get_item_stock(): opening_balance + sum(in) - sum(out) from the
--    immutable transactions ledger, as of a given date. This is the
--    function to trust; current_balance below is a cache of it, not a
--    second source of truth.
-- ----------------------------------------------------------------------------
create or replace function account_balance_as_of(p_account_id uuid, p_as_of date default current_date)
returns numeric
language sql stable set search_path = public as $$
  select coalesce((select opening_balance from accounts where id = p_account_id), 0)
    + coalesce((select sum(amount) from transactions
        where account_id = p_account_id and direction = 'in' and txn_date <= p_as_of), 0)
    - coalesce((select sum(amount) from transactions
        where account_id = p_account_id and direction = 'out' and txn_date <= p_as_of), 0);
$$;

grant execute on function account_balance_as_of(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. post_transaction() — no more incremental `current_balance + amount`.
--    A full recompute from the ledger every time a transaction posts:
--    self-healing (a stored value that ever drifted for any reason
--    corrects itself on the very next posting instead of compounding the
--    error forever) and, more to the point, honest about what
--    current_balance actually is — a cache of account_balance_as_of(),
--    refreshed on every write, never an independently-trusted counter.
-- ----------------------------------------------------------------------------
create or replace function post_transaction(
  p_type txn_type, p_direction txn_direction, p_amount numeric,
  p_method payment_method, p_date date, p_desc text, p_ref_table text, p_ref_id uuid
) returns void as $$
declare acc_id uuid := default_account_id(p_method);
begin
  if acc_id is null then return; end if;   -- no accounts seeded yet — skip silently
  insert into transactions (account_id, type, direction, amount, txn_date, description, reference_table, reference_id)
    values (acc_id, p_type, p_direction, p_amount, p_date, p_desc, p_ref_table, p_ref_id);
  update accounts set current_balance = account_balance_as_of(acc_id) where id = acc_id;
end;
$$ language plpgsql security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 3. verify_account_balances() — the actual auditing payoff of deriving
--    the balance at all: compares the cached current_balance against a
--    fresh account_balance_as_of() for every account and reports any
--    mismatch. Under the old incremental-UPDATE design a drift, if one
--    ever occurred, would just be silently wrong forever with no way to
--    even detect it short of re-deriving by hand. Now "re-deriving by
--    hand" is a one-line function call.
--
--    Deliberately NOT security definer, unlike post_transaction() above —
--    this one runs as the calling user on purpose, so accounts' own
--    institute_isolation RLS policy (0035_multi_tenancy.sql) scopes it to
--    their institute for free, same as a plain `select * from accounts`
--    already would. account_balance_as_of() (step 1) is also plain
--    security-invoker — it only runs with post_transaction()'s elevated
--    context when post_transaction() itself calls it, exactly like
--    default_account_id() already does in the same function.
-- ----------------------------------------------------------------------------
create or replace function verify_account_balances()
returns table (account_id uuid, account_name text, stored_balance numeric, derived_balance numeric, matches boolean)
language sql stable set search_path = public as $$
  select a.id, a.name, a.current_balance, account_balance_as_of(a.id),
         a.current_balance = account_balance_as_of(a.id)
    from accounts a;
$$;

grant execute on function verify_account_balances() to authenticated;
