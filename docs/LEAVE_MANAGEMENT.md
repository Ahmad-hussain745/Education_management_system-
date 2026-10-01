# Leave Management

```
Leave request → Supervisor → Approve / reject → Attendance → Payroll
```

Route: `/leave` (self-service + supervisor inbox, everyone but Parent).
`/hr/leave` (HR migration) becomes the HR override view — same decision
function, used when there's no supervisor or HR needs to step in.

## What HR (previous migration) already had, and what's new here

HR admins could log and decide leave for anyone, and an approved request
wrote attendance. This migration adds the actual **request → supervisor →
approve/reject** chain for teachers and staff themselves:

- `employees.supervisor_id` — who a request routes to. Snapshotted onto
  `leave_requests.supervisor_id` at application time, so re-parenting an
  employee later doesn't silently re-route a request already in flight.
- `apply_for_leave` — anyone applies for **themselves**; HR can still log
  one for anybody. Blocks overlapping pending/approved requests.
- `decide_leave_request` — only the request's supervisor or an HR admin
  may decide it, and **nobody decides their own request**, checked before
  the approve/reject branch either way.
- `current_employee_id()` — resolves the signed-in session to an employee
  row via `user_id` OR, for a teacher with no portal-linked employee
  record, via `teacher_id` — tested explicitly (a teacher with no
  `employees.user_id` still resolves correctly).
- `get_leave_inbox()` — a supervisor's pending requests. Returns named
  columns only; a supervisor is **not** thereby granted read access to
  `employees` itself (tested: `select count(*) from employees` returns 0
  for a supervisor with no HR role).

## The salary deduction integration

Leave types now carry `annual_quota`. At approval, `_leave_paid_days()`
splits the request's working days into **paid** (up to whatever quota
remains, first-come) and **unpaid** (the rest) — for an unpaid-type
request, all days are unpaid regardless of quota. Attendance is written
day-by-day in that order: the first N days `leave`, the rest `absent`.
Payroll's existing rule (`0049`, unmodified) only deducts `absent`, so:

- a paid leave type, within quota → `leave` → **not deducted**
- a paid leave type, beyond quota → `absent` for the excess → **deducted**
- an unpaid leave type → `absent` for every day → **deducted**

**`preview_leave_impact()`** shows this before anyone applies or decides —
called live as the date fields change on `/leave`'s apply form, and
attached to every pending request in the supervisor inbox. It mirrors
0049's per-day rate (`fixed_salary / days_in_month`, fixed/hybrid teachers
only) and flags two states explicitly, because both would otherwise fail
silently: the target month's payroll is **already locked** (0049 skips
locked months — the deduction needs a manual adjustment), or a **draft
already exists** (needs a refresh to pick up the new absence). Both are
tested. Non-teaching staff and percentage-only teachers get a plain note
that no deduction applies, because this app's payroll doesn't process
non-teaching pay and has no fixed base to prorate for a pure-percentage
teacher.

The preview is an estimate; the actual deduction always comes from
payroll's own draft, generated the normal way.

## Verified against real PostgreSQL, not just read

Wrote a throwaway schema (stubbed `institutes`/`users`/`teachers`/RLS
helpers matching this app's real signatures) into Postgres 16 and ran both
this migration and the HR one against it, then exercised the workflow as
different roles via `set_config`: quota exhaustion splitting a request
paid+unpaid, Sunday exclusion, self-approval and cross-employee blocks,
existing `present` attendance preserved vs. existing `absent` correctly
overwritten by approved leave, the locked-month and existing-draft
warnings, non-teaching and percentage-only-teacher cases, no-supervisor
routing to HR, and cancel-before-decision. All passed. The screens
(`/leave`, updated `/hr/leave`) were parsed with esbuild (real JSX
parsing, not just brace-matching) but not run in a browser — no Node
environment was available in this session to actually boot the app.

## v1 limits

No leave-balance carry-over across years, no half-day requests, no
editing a decided request (HR corrects by hand if needed), and approving
never un-writes an already-generated payroll draft — refreshing that
draft is a manual step, same as before this migration.
