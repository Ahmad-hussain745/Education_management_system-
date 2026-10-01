# supabase/tests/ — running the security/regression suite

Every `*_test.sql` file here is a self-contained `BEGIN; ... ROLLBACK;`
script: it creates its own test data, asserts against it with
`RAISE EXCEPTION` on the first failure and `RAISE NOTICE 'PASS — ...'` on
each success, and always rolls back — nothing it does is ever actually
committed, pass or fail.

## Running against your real Supabase project

The most realistic way to run these — real RLS, real roles, real grants,
exactly as production behaves:

1. Supabase Dashboard → SQL Editor.
2. For `reversal_and_tenant_isolation_test.sql` and the other single-role
   test files: use **Impersonate user** (top right of the SQL Editor) and
   pick a real Super Admin or Accountant account first. Without this,
   `current_institute_id()`/`auth.uid()` resolve to nothing and several
   checks pass for the wrong reason (see that file's own header).
3. For `role_boundary_test.sql`: do **not** impersonate anyone — run it as
   the default connection. The script switches identity internally
   between several temporary users it creates itself (a Teacher, a
   Cashier, two Parents, ...), which needs the elevated starting
   connection Impersonate-user would otherwise constrain.
4. Paste the file's contents in and run. Read the `NOTICE` output.

## Running locally / in CI, without a live Supabase project

`local_ci_bootstrap_stub.sql` is a minimal stand-in for the pieces a real
Supabase project provides automatically as platform infrastructure — the
`auth`/`storage` schemas, the `anon`/`authenticated`/`service_role` roles
and their baseline table grants, and the `supabase_realtime` publication.
None of this app's own migrations create these; they're assumed to
already exist, same as they do on any real project.

```bash
createdb msa_ci_test
psql -d msa_ci_test -f supabase/tests/local_ci_bootstrap_stub.sql
for f in supabase/migrations/*.sql; do psql -d msa_ci_test -v ON_ERROR_STOP=1 -f "$f" || break; done
for f in supabase/tests/*_test.sql; do psql -d msa_ci_test -v ON_ERROR_STOP=1 -f "$f" || break; done
dropdb msa_ci_test
```

This is genuinely the same authorization path a real PostgREST request
goes through, not an approximation — `auth.uid()` in the stub reads
`request.jwt.claim.sub` exactly like the real one does, so
`select set_config('request.jwt.claim.sub', '<uuid>', false);` before a
query is the same mechanism Studio's Impersonate-user feature uses under
the hood. The one thing to get right, and the one mistake worth naming
because it's easy to make (found while writing `role_boundary_test.sql`):
running a check as the `postgres` superuser bypasses RLS entirely
regardless of which JWT claim is set, since Postgres exempts table owners
and superusers from RLS by default. Any check that relies on a table's RLS
policy directly — not a `SECURITY DEFINER` function's own internal
`raise exception` logic — needs `SET ROLE authenticated;` (granted to
`postgres` by the bootstrap stub for exactly this) before it means
anything, and `RESET ROLE;` after.

## What's covered, file by file

- `fee_workflow_test.sql`, `finance_test.sql`, `operations_test.sql`,
  `salary_automation_test.sql`, `salary_lock_regression_test.sql`,
  `duplicate_payment_and_receipt_test.sql` — functional regression tests
  for the areas named (fee generation, previous balance, discounts,
  payments, receipts, duplicate-sync idempotency, salary generation,
  payroll locking).
- `reversal_and_tenant_isolation_test.sql` — institute isolation for every
  `SECURITY DEFINER` function found to need it across two security audits
  (0051, and the Priority 3 audit that added `pending_fee_reminders`/
  `record_fee_payment`/`queue_fee_notification` to this file).
- `role_boundary_test.sql` — the role-boundary checks that specifically
  need to become a different, lower-privileged real user rather than just
  tag data with a different institute: a Teacher reading another
  Teacher's records, a Cashier attempting a Principal-only approval, a
  Parent reading another family's student, and an authenticated
  non-service-role caller hitting a cron-only function directly.
- `admissions_test.sql` — the full Enquiry → Applicant → Application →
  Interview/Test → Decision → Enrollment flow end to end, including that
  the applicant's details carry through to the enrolled student without
  retyping, that re-enrolling an already-enrolled application is a no-op
  rather than a second student, and tenant isolation for the module's
  three write-authorization-checked RPCs
  (`convert_enquiry_to_applicant`/`decide_admission`/
  `enroll_admission_application`).
