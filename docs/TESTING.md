# Testing (Phase 33)

Two separate suites, for a reason worth understanding before running either:

## `npm test` — runs automatically, no live database needed

```
npm test
```

Covers: offline sync (`lib/offline/sync/__tests__/`), the offline payment
guardrails and **the mandatory duplicate-sync test**
(`lib/offline/repositories/__tests__/payments-offline.test.js`), and
conflict handling. Uses `fake-indexeddb` to run real Dexie code in Node —
these are genuine executions of the actual offline-layer code, not
descriptions of what it should do.

**The mandatory test is split in two, deliberately:**
- The JS version mocks the *server* side (a faithful copy of
  `record_fee_payment()`'s own idempotency-check-first logic) so it can
  run on every commit, in CI, with nothing else set up.
- `supabase/tests/duplicate_payment_and_receipt_test.sql` calls the real
  function, for real, against an actual Supabase project. Run this one
  before trusting a production deploy — the JS test proves the *algorithm*
  is right; this one proves the *deployed function* is.

Two real bugs were found by actually running this suite, not by reading
the code — both fixed as part of this phase:
1. `sync_conflicts.resolved` was declared as an indexed field and queried
   with `.where("resolved").equals(false)`. Boolean isn't a valid
   IndexedDB key per spec — this would have thrown in every real browser
   the first time anyone opened the conflict-review panel, not just in
   this test's `fake-indexeddb`. Fixed in `lib/offline/db.js` v6.
2. `listPendingProvisional()` included voided payments in its "pending"
   list — fixed to mean what its name says.

## SQL files in `supabase/tests/` — run manually, against a real project

```
fee_workflow_test.sql            (pre-existing)
finance_test.sql                 (pre-existing)
salary_automation_test.sql       (pre-existing)
duplicate_payment_and_receipt_test.sql
reversal_and_tenant_isolation_test.sql
salary_lock_regression_test.sql
operations_test.sql
```

Each is a self-contained `BEGIN ... ROLLBACK` block — paste into the
Supabase SQL Editor, run, read the `RAISE NOTICE` output for PASS/FAIL per
step, nothing is left behind either way. These need a live Postgres with
this schema loaded, which isn't available in an automated CI run here —
that's not a gap being glossed over, it's why the JS suite exists
alongside them for the parts that can be verified without one.

**A third real bug was found writing these, before they were ever run**:
`monthly_closing.month` had a bare, global `unique` constraint inherited
from `0001_init.sql`, never updated when multi-tenancy was added. The
0051 audit fixed the *read-side* check (`is_month_closed()`) to respect
institute boundaries, but the table itself would still have rejected a
second institute's attempt to close a month any other institute had
already closed — a guaranteed collision the moment a real second
institute exists, not a leak but a hard write failure. Fixed in
`0059_fix_monthly_closing_uniqueness.sql`.

## Coverage against the requested 16

| Area | Where |
|---|---|
| Fee generation | `fee_workflow_test.sql` (existing) |
| Payment | `fee_workflow_test.sql`, `duplicate_payment_and_receipt_test.sql` |
| Duplicate payment | **mandatory test**, both suites |
| Receipt | `duplicate_payment_and_receipt_test.sql` |
| Reversal | `reversal_and_tenant_isolation_test.sql` |
| Previous balance | `duplicate_payment_and_receipt_test.sql` |
| Discount | `duplicate_payment_and_receipt_test.sql` |
| Salary | `salary_automation_test.sql` (existing) |
| Salary lock | `salary_lock_regression_test.sql` |
| Attendance | `operations_test.sql` |
| Cashier closing | not yet covered — see below |
| Month closing | `operations_test.sql` |
| Inventory | `operations_test.sql` |
| Tenant isolation | `reversal_and_tenant_isolation_test.sql` |
| Offline sync | `lib/offline/sync/__tests__/` |
| Conflict handling | `lib/offline/sync/__tests__/conflict-resolver.test.js` |

**Cashier closing is the one honest gap in this pass** —
`compute_cashier_closing_totals()`/`close_cashier_day()` need a real
`users` row with a matching `auth.users` identity to test meaningfully
(the function checks `current_users_id() = p_cashier_id` for a Cashier's
own close), which needs either a second authenticated test identity or
running logged in specifically as a Cashier. Worth writing next, not
silently skipped.
