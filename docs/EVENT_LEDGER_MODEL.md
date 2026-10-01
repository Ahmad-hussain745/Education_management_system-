# Phase 32 — Command → Event → Ledger, derive the balance

Audited against the existing schema before writing anything — most of this
pattern already existed, under different names, from earlier phases. This
document maps the request's diagram onto what's actually here, and records
the one real gap that got fixed.

## The mapping

| Requested | Existing implementation |
|---|---|
| **Command** — someone records a payment/expense/income/salary payout | The interactive form / server action / offline sync |
| **Event** — `PAYMENT_RECEIVED +5000`, not `UPDATE balance = 5000` | `fee_payments`/`income`/`expenses`/`salary_payments` rows. Append-only and immutable since `0011_immutable_ledger.sql` — a trigger rejects any `UPDATE`/`DELETE` outright. A correction posts a *new* reversal event (`reverse_fee_payment()` etc.); it never edits the original. Each insert also emits a real domain event (`PAYMENT_CREATED`, `domain_events` table, `0057_event_driven_architecture.sql`) for async subscribers — notifications, audit. |
| **Ledger** | `transactions` (`0001_init.sql`) — one immutable row per posting, written by `post_transaction()`, never updated or deleted. |
| **Derive the balance** | `fee_records.paid_total` / `salary_records.paid_total`: already `SUM(...)` triggers over the event rows, excluding reversed ones — not counters anyone increments. Inventory: no stored quantity column exists at all; `get_item_stock()` derives it from `inventory_stock_movements` on every read. |

That covers fee payments, salary, income, expenses, and inventory — all
already event-sourced with derived totals, not in-place mutation.

## The one gap: `accounts.current_balance`

This was the literal anti-pattern the phase calls out:
`post_transaction()` did `update accounts set current_balance =
current_balance + amount` — a stored running total, mutated incrementally,
correct only for as long as every posting over the account's entire
history ran perfectly. Nothing was exploiting that fragility, but it's
exactly the pattern being asked to replace, so it's what changed —
everything in the table above was left alone because it already was the
pattern being asked for.

**`supabase/migrations/0060_derived_account_balances.sql`:**
- `account_balance_as_of(account_id, date)` — the real derivation:
  `opening_balance + sum(in) - sum(out)` from `transactions`, same shape as
  `get_item_stock()`.
- `post_transaction()` now does a full recompute (`current_balance =
  account_balance_as_of(acc_id)`) instead of an incremental `+=`. Self-
  healing, and honest about what the column actually is: a cache of the
  derivation, refreshed on every write, never an independent source of
  truth.
- `verify_account_balances()` — the actual payoff of deriving it at all:
  compares the cached value against a fresh derivation for every account
  and reports any mismatch. Under the old design there was nothing to
  compare against; a drift, had one occurred, would have been invisible.
  Wired to a "Verify Balances" button on `/finance/accounts`
  (`VerifyBalancesButton.js`).

No application code elsewhere needed to change — every existing read of
`accounts.current_balance` still works exactly as before, it's just
computed differently underneath.
