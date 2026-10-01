# MSA Academy Management System

Next.js 14 (App Router) + Supabase (Postgres, Auth). Matches this architecture:

```
USERS → VERCEL (Next.js, Server APIs) → SUPABASE (Postgres, Auth, Storage)
```

## Before you deploy for real

Read **[`docs/BACKUP_AND_RECOVERY.md`](docs/BACKUP_AND_RECOVERY.md)** — how to restore the
database, rotate keys, recover a locked-out admin account, roll back a bad deploy, and
undo a migration. Not optional reading once real student/fee data is involved.

## Recent security hardening

Two SECURITY DEFINER "trusted gateway" functions had no role check inside themselves,
relying only on RLS or a UI-level button being hidden — neither of which the function
itself can see once it's DEFINER:

- **`generate_salary_records()`** (`0014_secure_payroll_generation.sql`) — wasn't even
  SECURITY DEFINER before; now it is, with an explicit `current_role_name() not in
  ('Super Admin', 'Accountant') → raise exception` check at the top, matching the UI's
  existing `isFinanceStaff` gate on the Payroll page.
- **`get_or_create_fee_record()`** (`0013_security_and_finance_fixes.sql`) — same
  pattern, gated to Super Admin/Accountant/Cashier.

Also fixed: **`student_attendance`/`teacher_attendance` read policies**
(`0015_attendance_read_scoping.sql`) were a blanket "any signed-in user can read every
row" — found while tracing the test case "Teacher attempts another teacher's attendance
→ should be denied." A Teacher can now only read their own `teacher_attendance` row and
`student_attendance` for classes they're actually assigned to.

Also fixed: **`resolve_monthly_fee()`** (`0034_fix_fee_effective_month.sql`) compared a
`fee_structures` row's exact `effective_from` DAY against a month-START date — so any
fee entered on any day other than the 1st (a student added on the 3rd, a class fee
changed on the 15th) resolved to Rs. 0 for the month it was meant to bill, only
starting to work correctly the following month by accident. Symptoms looked like
"Already Paid"/"Monthly Fee not showing"/"Maximum Rs. 0" in Payment Entry, but the bug
was in fee resolution, not payment entry. Fixed at the one shared function every
insert path already funnels through (`get_or_create_fee_record()` calls it), rather
than patching each of the three separate `fee_structures`-inserting actions
individually — see that migration's own comment for the full trace, and
`supabase/repair_0034_zero_fee_records.sql` for repairing bills already generated
while the bug was live (only ever touches a bill with `paid_total = 0` — nothing with
a real payment against it is rewritten).

## Module status

Accurate as of the current source — re-check this against `app/(app)/` before trusting
it if it's been a while, since this file doesn't update itself.

### Implemented

Real end-to-end: a working UI, a Server Action or query hitting the real table, and RLS
enforcing who can do what. No mock data anywhere in this list.

- **Auth & session** — `/login` (real Supabase Auth), `middleware.js` (session refresh +
  redirect), `app/(app)/layout.js` (blocks a deactivated user even with a live session —
  see "Role-based UI" below), password reset (`app/login/ForgotPasswordForm.js` →
  Supabase `resetPasswordForEmail()` → emailed link → `app/auth/callback` exchanges the
  code for a session → `app/auth/reset-password` sets the new password via
  `updateUser()` and signs back out to `/login` — Supabase's own reset mechanism end to
  end, nothing custom)
- **Dashboard** — every stat is a live query, with a month picker (`?month=YYYY-MM-01`,
  capped at the current month) that re-runs every card against that month instead of
  always "right now"
- **Students** — list, Add (with fee override + discount at creation), Edit, Deactivate
  (never hard-deleted — a student with financial history can't be), per-student detail
  page with fee/payment history
- **Offline Student Registration** (Phase 9) — Add Student now also works with no
  connection: saved locally under a device-generated `local_id` (shown as
  `offline://device-x/uuid` — never presented as an official ID), synced through the
  same `create_student()` (`0043_offline_student_registration.sql`) the online form now
  also calls, which is where the real `MSA-YYYY-NNNNN` code is atomically assigned —
  never in the browser, so two offline devices can't ever claim the same number. That
  migration also replaced the old online student_code logic (a JS scan-and-guess with a
  known collision risk) with the same atomic counter. `OfflineStudentRegistrations.js`
  shows each local registration's live status (Pending Sync → Confirmed, or → Needs
  Review). Known limitation: a registration only becomes a real, referenceable student
  once it syncs — you can't collect fees or mark attendance for one offline before then
- **Academic Setup** — Classes, Sections, Subjects: full Create/Edit/Deactivate or
  Delete, guarded against destructive cascades (e.g. can't delete a class with sections
  or students still on it; a section already used in a generated payroll can't be
  deleted, only a class/subject/teacher can be deactivated instead)
- **Fee Management** — Fee Structure & Student Fee Override (dated history, not a single
  frozen row — a fee change can be scheduled ahead of time without losing what it used to
  be), Discounts, Fee Records, Payment Entry (auto-generates that month's bill on first
  use, prints a real receipt with a DB-assigned sequential number —
  `0010_receipt_numbers.sql` — via `Receipt.js` + `app/api/receipts`), Pending Fees, Fee
  Reports
- **Offline Fee Collection** (Phase 8) — Payment Entry now also works with no connection:
  a cashier collects against the last-synced cached bill (`lib/offline/repositories/
  fees.js`), capped at the cached remaining balance with no advance payments, and gets a
  provisional local receipt (`LOCAL-YYYY-NNNNN`, `OfflineReceiptStatus.js`) instead of a
  real one. `lib/offline/repositories/payments.js` has the full design — this is
  deliberately not the same "just queue it" pattern as attendance/expenses/inventory,
  because a rejected payment at sync time isn't a safe auto-resolve the way a rejected
  duplicate attendance mark is; rejections land in `sync_conflicts` for a human
  (`conflict-resolver.js`), and `OfflineFeeReceipts.js` on the Payment Entry page shows
  each local receipt's live status (Pending Sync → Confirmed, or → Needs Review)
- **Teachers** — Profiles (with optional login creation via Supabase Auth Admin API —
  same Auth → `public.users` → Role → Teacher Link chain as Settings → Users, scoped to
  one teacher, at `/teachers/profiles/[id]`), Class Assignment (setting a % here also
  writes the matching Salary Configuration rule in the same step)
- **Attendance** — Student & Teacher registers, Attendance Reports (Present/Absent/
  Late/Leave/%, per student and per teacher)
- **Offline Attendance** (Phase 10) — the Student Attendance register (Class → Section →
  Date → Present/Absent/Late/Leave → Save) now runs entirely client-side
  (`AttendanceRegisterApp.js`) instead of the old URL-search-param/server-navigation
  design, specifically so picking a class/section/date never needs a network round trip.
  Saving falls back from online to the offline queue automatically on a dropped
  connection (`lib/repositories/attendanceRepository.js`) — safe to do here (unlike
  Payments/Students) because sync-engine.js's push for this entity is a per-student
  delete-then-insert, so a resubmitted mark can never become a duplicate. This phase also
  closed a real gap in the offline module generally: `lib/offline/repositories/*`'s
  `refreshX()` cache-population functions existed since Phase 8 but nothing ever called
  them — `sync/prime-cache.js` (wired into `OfflineStatus.js`) is that missing call, so
  classes/sections/students/bills/payment history now actually populate before a device
  needs them, benefiting Phases 8–9 as well, not just this one
- **Salary** — Configuration (% rules), Allowances & Deductions (standing per-teacher
  amounts at `/salary/allowances`), Monthly Payroll (Generate from live `fee_payments` +
  Teacher Attendance + Allowances & Deductions → Review → Approve & Lock → Pay; a Teacher
  sees only their own slip, enforced by RLS not just hidden by the UI), Salary Reports,
  per-record printable slip at `/salary/payroll/[id]`
- **Automatic Payroll Drafting** (Phase 18) — the pipeline is Fee Collection → Salary
  Rules → Teacher Attendance → Allowances → Deductions → Payroll Draft
  (`0049_payroll_allowances_deductions_attendance.sql`), running automatically on the 1st
  of the month via the `payroll` automation job as well as on demand from the Payroll
  screen. Absent days (from Teacher Attendance) deduct at `fixed_salary / days-in-month`
  per day for fixed/hybrid teachers — a policy choice, not a given, spelled out in the
  migration's comments. The system only ever drafts: `salary_records`/`salary_items` get
  written, nothing pays or locks itself — Approve & Lock and Record Payment stay separate,
  human-only actions, same as before this phase. This also collapsed a real bug: the
  interactive and cron payroll-generation functions had quietly drifted apart (the cron
  path was missing 0025's point-in-time salary-rate lookup), now unified into one shared
  `_draft_payroll_for_institute()` so that can't happen again
- **Ask MSA** (Phase 24, `app/(app)/assistant/`) — a natural-language question box that
  only ever answers from real, live queries: a rule-based intent parser (`lib/assistant/
  intents.js`, no LLM call, so there's no step where an answer could be generated rather
  than looked up) matches a question against a fixed set of supported intents, each with
  its own parameterized query (`lib/assistant/queries.js` — the same RPCs/tables Reports
  and the Dashboard already read, e.g. `fee_arrears_summary`, `fee_arrears_accounts`, the
  `transactions` ledger) and a template that only interpolates the verified numbers that
  query returned (`lib/assistant/answer-templates.js`). A question outside the known set
  gets told so, with the actual list of what it can answer — never a guess. Every
  question and answer is logged to `assistant_queries` for audit. Found and fixed two
  real gaps while building this: `low_stock_items`/`reconcile_fee_totals` (0045) took a
  caller-supplied institute id with no check it matched the caller's own institute — the
  same class of bug 0051's security audit fixed everywhere else, just missed on these two
  — and neither had the `can_view_finance()` check their own underlying tables' RLS
  policies enforce, despite being SECURITY DEFINER functions that bypass RLS entirely.
  Both fixed in `0054_ask_msa_assistant.sql` by splitting each into a cron-safe `(uuid)`
  form (service_role only, unchanged callers) and a no-arg interactive form that derives
  its own institute and checks the role, matching the pattern 0051 already established
- **Role-Based Automation** (Phase 25, `app/(app)/automation/`) — the Automation Center is
  no longer Super-Admin-only: `SuperAdminView.js` (everything, full job controls),
  `PrincipalView.js` (Approvals/Alerts/Reports, no Run Now/Pause), `AccountantView.js`
  (Finance/Reconciliation/Payroll), `CashierView.js` (Fee Collection/Cash Closing/
  Receipts), `TeacherView.js` (Attendance/Syllabus/Marks/Own Salary) — each reading only
  the real data that role already has RLS access to, dispatched from one `page.js` by role
- **Approval Workflows** (Phase 26, `0056_approval_workflows.sql`) — two sensitive actions
  now require a second, different person's decision before anything posts, not just a role
  check: (1) **Large expenses** — `request_expense()` posts immediately below the
  institute's `large_expense_threshold` (configurable, defaults Rs. 10,000) exactly as
  before, but at or above it, it only creates a pending `expense_requests` row; a Super
  Admin or Principal (never the requester — enforced inside `decide_expense_request()`,
  not just in the UI) reviews it from `PendingExpenseApprovals.js` on the Expenses page.
  (2) **Fee reversal** — `reverse_fee_payment()` is no longer directly callable by
  authenticated users at all; `request_fee_reversal()` (reason required) files a request,
  and only `decide_fee_reversal()`, run by a different Super Admin/Principal, can actually
  call it. Both pending queues also surface as Approval cards on the Principal's
  Automation view. Salary already had this shape before this phase (Payroll → Review →
  Approve & Lock → Payment) and didn't need changing. Found the backend for this (the
  migration) already existed but the application layer didn't actually use any of it —
  `recordExpense` was still a raw insert with no threshold check, the offline sync queue's
  `expenses` entity was still a raw upsert (meaning an offline-recorded large expense would
  have skipped the approval workflow entirely), and the fee-payments page still rendered
  the generic direct-reversal `ReverseButton`, which would have failed outright since the
  RPC it called was revoked. All three wired through to the real workflow now; `income`/
  `expenses`(already-posted)/`salary_payments` reversal are unrelated and untouched, since
  Phase 26 only asked for large-expense and fee-reversal approval, not a rebuild of every
  correction path
- **Syllabus** — Classes → Subjects → Chapters → Topics → Progress, full CRUD on all of
  it (Add/Edit/Delete chapters and topics, Add/Edit/Deactivate subjects), progress
  tracked per section as well as whole-class
- **Exams** — `0031_exams_and_results.sql`. Setup (Exam Types, Exams, Exam Subjects,
  Grade Rules) is `can_approve()` (Super Admin/Principal); Marks Entry is scoped to
  whichever Teacher is actually assigned that class+subject via `teacher_classes`, with
  a database trigger that rejects any mark over the subject's `max_marks` and locks a
  student's marks the moment their result is published; Results has its own
  Calculate → Publish/Unpublish step (publishing is the point of no return for that
  exam's marks, so the UI now confirms before firing it — see below); Report Cards reads
  the same computed grade/percentage per student. Nothing here is scaffolded — this
  entire module, and every other one in this README, is real end-to-end.
- **Finance** — Income, Expenses, Accounts, Transactions, Monthly Closing (Super Admin/
  Accountant post, Principal can approve/view — `can_approve()`), Cashier Closing (a
  Cashier reconciles their own day's cash against what `fee_payments`/`income` actually
  say was collected — `0024_daily_cashier_closing.sql`), Financial Reports (all posting
  to a single `transactions` ledger — see "Accounting-safe finance" below)
- **Inventory** — Items/Categories/Suppliers, Purchases (posts an Expense automatically
  via `record_inventory_purchase()` — `0028_inventory.sql` — money and stock recorded in
  one transaction, never two separate entries that could drift apart), manual Stock In/
  Stock Out (no expense; can't take an item below zero on hand), Stock Report (Opening +
  Purchased − Used = Remaining, computed from the movement ledger, never a cached count)
- **Notifications** — fee reminders, queued automatically right after bulk fee
  generation (`0027_notifications.sql`: 1st → fee generated, 10th → reminder, 20th →
  second reminder, 25th → overdue, per bill). Sending itself is a real, one-click
  WhatsApp/SMS/email compose window (`wa.me`/`sms:`/`mailto:`) that a person still sends
  — no messaging provider is wired in, so nothing dispatches on its own; every send/skip
  is logged (`notification_logs`)
- **Reports** — a real hub, not an index: Fee Collection, Pending Fees, Student Ledger
  (a full per-student statement — the one report type that didn't already exist
  elsewhere), Teacher Salary, Attendance, Finance, Syllabus. Every report has real
  filters (date/month/class/section/teacher/student, whichever apply) and Print/Save as
  PDF + Export CSV
- **Settings** — Users (Create User → Supabase Auth → `public.users` → Role → optional
  Teacher Link, Super Admin only), Roles (read-only — the five role names are hard-coded
  into every RLS policy, so making them editable would break access control rather than
  improve it), Audit Log
- **Role-based UI** — `lib/auth/roles.js` mirrors the RLS helper functions in
  `0002_rls.sql` by name; `components/AppShell.js` filters the sidebar against it, and
  `lib/auth/guard.js`'s `requireRole()` hard-redirects the pages where a role has no
  legitimate view, not just no write access. Neither layer is the real security boundary
  — RLS is; delete both and every read/write is exactly as safe as today, just with
  worse error messages instead of a clean redirect or a hidden button
- **Accounting-safe finance** — `fee_payments`/`income`/`expenses`/`salary_payments` are
  append-only (`0011_immutable_ledger.sql`): a correction never edits the original row,
  it posts an opposite-direction reversal via `reverse_*()` (SECURITY DEFINER, finance
  staff only). `components/ReverseButton.js` is the one UI for it across all four ledger
  pages
- **Audit logging** — database triggers, not app code (`0012_audit_logging.sql`) — fires
  on a reversal, a payroll lock, a new login, or a teacher-account link, regardless of
  which code path caused it
- **Scalable listings** (`0029_scalable_listings.sql`) — Students, Transactions, and Fee
  Arrears do real server-side search/filter/sort/pagination instead of a fixed
  `.limit(N)` fetched into JS: `list_students()`, `list_transactions()` +
  `transactions_totals()` (a separate exact-aggregate query, so Total In/Out stays
  correct regardless of which page is on screen), and `fee_arrears_accounts()` +
  `fee_arrears_summary()` (same split, for the five summary cards vs. the paginated
  list). `search_students()` backs `components/StudentPicker.js`, a typeahead that
  replaced every `<select>` that used to list every student in the school (Fee Arrears,
  Receipts, Student Ledger). `components/Pagination.js` and `components/SortableTh.js`
  are the shared "Showing X–Y of Z" / sortable-column-header pieces — reusable for
  whichever list gets converted next (see below)

### Partially implemented

- **`/reports` role visibility** — each report's own page enforces the real RLS-backed
  role check; the hub's tile list mirrors those same role names by hand rather than
  importing a shared list, so a new report type needs its visibility rule added in two
  places (`app/(app)/reports/page.js` and the report's own `requireRole()` call)
- **Settings → Roles** — viewable, not editable (see above for why that's deliberate,
  not unfinished — but a genuine role-permission editor, if ever needed, would require
  rewriting every RLS policy to read from a table instead of a hard-coded role name)
- **Remaining fixed-limit pages** — the scalable-listings pass (above) covers the three
  highest-traffic cases; still on a plain `.limit(N)` fetched into JS rather than true
  server-side pagination: Fee Reports (2000), Financial Reports (500), Salary Reports
  (500), Audit Log (200). Same fix shape as `0029_scalable_listings.sql` — a paginated
  RPC (or `.range()` + `count: 'exact'` for the ones with no cross-row aggregation, the
  way Receipts was done) plus `components/Pagination.js` — just not done yet for these
  four

### Planned — not built at all

- Library
- True PDF generation — "Export PDF" today is the browser's own Print → Save as PDF, not
  a generated binary; a client-side PDF library isn't in this project's approved
  dependency set

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project.
2. Once it's ready, open **SQL Editor** and run every file in
   `supabase/migrations/` **in filename order, one at a time** — `0001_init.sql` through
   the highest-numbered file currently in that folder. The number is the order; each
   migration after `0001` builds on the ones before it (e.g. `0005_fee_structure_history.sql`
   redefines a function `0003_fee_generation.sql` created), so running them out of order
   will fail or silently produce the wrong behavior.
3. Go to **Authentication → Providers** and make sure Email is enabled.
4. Go to **Authentication → URL Configuration** and add `<your-deployed-url>/auth/callback`
   (and `http://localhost:3000/auth/callback` for local dev) to **Redirect URLs** — every
   Supabase Auth email link (password reset, invite, magic link) is rejected unless its
   destination is on this allow list. This is the only Supabase-side config the password
   reset flow (`app/login/ForgotPasswordForm.js` → `app/auth/callback` →
   `app/auth/reset-password`) needs beyond what's already required for the rest of the
   app's auth to work.
5. Go to **Settings → API** and copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (keep this secret — server-only)

## 2. Create your first user

New users are created by an admin, not self-signup — Settings → Users has a real
"Create User" flow (Supabase Auth → `public.users` → Role → optional Teacher Link), but
it only works if you're already signed in as a Super Admin. For the very first user
ever, that UI can't help you yet — bootstrap it once, by hand:

1. Supabase dashboard → **Authentication → Users → Add user** → set an email + password.
2. In **SQL Editor**, run:
   ```sql
   select bootstrap_super_admin('you@academy.edu', 'Your Name');
   ```
   This looks the auth user up by the email you just typed (no UUID copy-pasting —
   that step used to be a common source of "I can log in but the app bounces me back
   to /login" reports, since a mistyped or wrong UUID silently leaves the account
   unlinked). If the email doesn't match an Auth user yet, or is already linked,
   it tells you so directly instead of silently inserting something wrong.
3. Log in with that account, then create every other user (Principal, Accountant,
   Cashier, Teacher logins) from Settings → Users — never with raw SQL again.

## 3. Run it locally

```bash
npm install
cp .env.local.example .env.local   # fill in the three keys from step 1
npm run dev
```

Visit `http://localhost:3000` → redirects to `/login`.

## Troubleshooting: a list page shows 0 results even though data exists

Symptom: you add a student (or a payment, or anything else) and it saves without an
error, but the list on that page still shows "0" / stays empty after — Students,
Transactions, and Fee Arrears are the pages most likely to show this, since all three
load their list through a database function (`list_students()`, `list_transactions()`,
`fee_arrears_accounts()` — all in `0029_scalable_listings.sql`) rather than a plain
table read.

**Almost always the cause: that migration was never actually run against this specific
Supabase project.** This repo's migration files are the schema's source of truth, but
they only take effect once someone runs them (step 1 above) — uploading/committing the
`.sql` file doesn't apply it. It's easy to run migrations `0001`–`0026` once early on,
then add real data and keep using the app for weeks before a later migration
(`0027` onward) ships, and forget to go back and run the new one(s) — nothing in the UI
flags this on its own, because the page's own insert (adding the student) uses a plain
table write that doesn't depend on the missing function at all, so *that* half works
fine; it's specifically the *list* that's silently empty.

**Check it directly** — Supabase dashboard → SQL Editor:
```sql
select proname from pg_proc where proname in ('list_students', 'list_transactions', 'fee_arrears_accounts');
```
If this returns fewer than 3 rows, the corresponding function (and the migration that
creates it) is missing. Fix: open `supabase/migrations/0029_scalable_listings.sql`,
paste its full contents into the SQL Editor, and run it — then repeat for any
higher-numbered file you haven't run yet, in order.

These pages now also surface the actual database error inline (in red, above the list)
instead of just showing an empty state — if you see that banner, it names the specific
missing function.

## 4. Push to GitHub

```bash
git init
git add .
git commit -m "Initial MSA Academy Management System scaffold"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/msa-academy.git
git push -u origin main
```

## 5. Deploy on Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project** → import the GitHub repo.
2. In **Environment Variables**, add the same three keys from your `.env.local`
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
3. Deploy. Vercel gives you a `*.vercel.app` production URL immediately.
4. Every future `git push` to `main` auto-deploys — this is the `GitHub → Vercel →
   Production URL` pipeline.

## 6. Connect your own domain (later)

Vercel project → **Settings → Domains** → add `academy.yourdomain.com` (or the apex
domain) → follow the DNS records Vercel shows you → done. No code changes needed.

## Backup & Recovery

Not a UI module — this is the production runbook. The architecture the rest of this
README already implies:

```
Supabase (database + backups)
        ↓
Migration files in GitHub (supabase/migrations/, in order — this repo's real source
        of truth for schema; a backup restores data, migrations rebuild structure)
        ↓
Recovery procedure (below)
```

Verified against Supabase's and Vercel's current documentation (checked August 2026) —
re-check before relying on this if it's been a while, since backup plans, key formats,
and rollback tooling are all things these platforms actively change.

### How to restore the database

**What Supabase gives you automatically depends on plan:**
- **Free tier: no platform-managed backup at all.** Nothing to restore from if you're on
  Free — you must self-manage backups (see below) or accept the risk.
- **Pro:** 7 days of daily backups. **Team:** 14 days. **Enterprise:** 30 days. Restore
  from **Dashboard → Database → Backups** — pick a date, confirm, done.
- **Point-in-Time Recovery (PITR):** a paid add-on on top of any plan, giving
  continuous, second-level recovery instead of once-a-day snapshots. Worth it once real
  student/fee data exists — a day-granularity restore means losing up to 24 hours of
  fee payments if something goes wrong right before the next snapshot.
- Backups cover the **database only** — Supabase Storage files aren't included (only
  their metadata is). This project doesn't currently store files in Supabase Storage
  (receipts/slips are generated on the fly by `app/api/*`), so this doesn't apply yet —
  worth remembering if that changes.

**Self-managed backup (do this regardless of plan — Free tier needs it to have any
recovery option at all; every other plan should still do it as a second, off-platform
copy):**

```bash
# Requires Docker running locally (the Supabase CLI runs pg_dump inside a
# Supabase Postgres container, not your local Postgres tools)
supabase db dump --db-url "$SUPABASE_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$SUPABASE_DB_URL" -f schema.sql
supabase db dump --db-url "$SUPABASE_DB_URL" -f data.sql --data-only
```

Commit these to a **private** repo or push them somewhere off Supabase entirely (S3, a
private GitHub Actions artifact) — a backup that lives only inside the project it's
backing up isn't a real backup. Automating this on a schedule via GitHub Actions is
straightforward; search "Supabase GitHub Actions backup" for the current official
workflow if you want it scheduled rather than manual.

**To restore from a self-managed dump**, run the three files back in with `psql`
against the target database, in the same role → schema → data order.

### How to rotate keys

**As of 2026, Supabase's legacy `anon`/`service_role` keys (the ones this project's
`.env.local` uses) can no longer be rotated on their own** — regenerating them means
regenerating the entire JWT secret, which immediately invalidates every signed-in
session across the whole app, staff and (once built) parent portal alike. That's the
right emergency move if a key actually leaked, but not something to do routinely.

**The fix Supabase now recommends: migrate to the new key format** — `sb_publishable_*`
(replaces `anon`) and `sb_secret_*` (replaces `service_role`). These rotate
independently, in seconds, **without invalidating existing sessions**, and the new
secret key rejects any request that looks like it's coming from a browser. Both formats
work side by side during migration; nothing breaks switching over. **Dashboard → Project
Settings → API Keys** to generate them, then swap `NEXT_PUBLIC_SUPABASE_ANON_KEY` →
publishable key and `SUPABASE_SERVICE_ROLE_KEY` → secret key in Vercel's environment
variables and redeploy. Legacy keys are being phased out project-wide by the end of
2026 regardless, so this is worth doing before an emergency forces it.

**If a key leaks right now, before migrating:** rotate in the Dashboard immediately,
review Supabase's request logs for anything sent with the old key, check git history
and any build artifacts for the exposed value (deleting the line doesn't remove it from
history), then redeploy with the new key set in Vercel.

### How to recover the admin account

If every Super Admin login is somehow lost (forgotten password with no other admin able
to reset it, or the only Super Admin account was deactivated by mistake), the recovery
is the same manual bootstrap as creating the very first user (see "2. Create your first
user" above) — there's no separate "break glass" procedure, because this one already
doesn't depend on being logged in:

1. **Supabase Dashboard → Authentication → Users** — reset the password on an existing
   admin's Auth account directly, or **Add user** to create a fresh one.
2. **SQL Editor**, link (or relink) it to Super Admin:
   ```sql
   update users set status = 'active', role_id = (select id from roles where name = 'Super Admin')
   where email = 'the-admin-email@academy.edu';
   -- or, for a brand new Auth user, insert instead of update (see "2. Create your
   -- first user" above for the full insert statement).
   ```
3. Log in. From there, use Settings → Users normally — deactivate whatever caused the
   lockout, audit `Settings → Audit Log` for what happened, and rotate that account's
   password.

### How to deploy a previous version

Vercel's **Instant Rollback** repoints production at an earlier deployment with no
rebuild — it takes effect in seconds, not a redeploy cycle:

- **Dashboard:** project overview → the Production Deployment tile → **Instant
  Rollback** → pick an earlier deployment → confirm.
- **CLI:**
  ```bash
  vercel rollback <previous-deployment-url-or-id>
  vercel rollback status   # confirm it completed
  ```
- **Hobby plan:** can only roll back to the *immediately previous* production
  deployment. **Pro/Enterprise:** any prior deployment still within your project's
  retention window.

**Real caveats worth knowing before relying on this under pressure:** a rollback
reverts `vercel.json`'s cron schedule (this project's `/api/cron/fee-reminders`, see
"Notifications" above) to whatever that older deployment shipped with — if the rollback
target predates a cron change, the schedule silently reverts too. **Environment
variables are NOT rolled back** — Vercel keeps using your *current* env var values
against the *old* code, which matters most if a key rotation (above) happened between
the two deployments. And a rollback never touches the database — if the bad deployment
already ran a new migration or wrote bad data, rolling back the app code doesn't undo
either; that's a database restore (above), a separate action.

### How to roll back a migration

**This project has no down-migrations** — every file in `supabase/migrations/` is
forward-only, and that's deliberate, not an oversight: the established pattern all
through this project's history is a *new* migration that redefines what an earlier one
did (`0016_previous_balance_ledger_fix.sql` replacing `0008`'s formula,
`0020_active_user_read_gate.sql` tightening `0002`'s policies) — never editing or
reverting an old file in place. That matters here for the same reason it mattered
everywhere else: once a migration has run against real fee/salary data, "undo" isn't
well-defined the way "add a corrected version" is.

**If a migration you just ran turns out to be wrong:**
- **Schema/function/policy change, no data written yet under the new behavior** — write
  the next-numbered migration that reverts it (e.g. `create or replace function` back to
  the prior definition, or `drop` whatever the bad migration added). This is the normal
  case and the same motion as every other migration in this repo.
- **Data was already written under the bad migration's behavior** (e.g. a bug in a
  trigger silently wrote wrong `previous_balance` values before it was caught) — a
  forward-only fix migration can correct the logic going forward, but *existing* wrong
  rows need their own explicit UPDATE as part of that same migration, scoped precisely
  to the rows affected — don't guess at "everything since date X," query for the actual
  wrong state.
- **The migration corrupted data badly enough that neither of the above is safe** — this
  is what the backup/restore procedure above is actually for. Restore the database to
  a point before the bad migration ran (PITR if you have it — exact timestamp precision
  — or the most recent daily backup otherwise), then re-apply migrations from that point
  forward in the corrected order, skipping or replacing the bad one.

## Accounting-safe finance (immutable ledger + reversal)

`fee_payments`, `income`, `expenses` and `salary_payments` are append-only —
`supabase/migrations/0011_immutable_ledger.sql` adds hard triggers that reject any
UPDATE to their business columns and block DELETE outright, on top of removing the
update/delete RLS policies that used to allow it. This applies even to a service-role
client, since triggers (unlike RLS) can't be bypassed by switching keys.

```
Posted transaction → Immutable → Correction → Reversal / Adjustment → New Transaction
```

A correction never edits the original row. It calls `reverse_fee_payment()` /
`reverse_income()` / `reverse_expense()` / `reverse_salary_payment()` (each SECURITY
DEFINER, restricted to finance staff internally), which marks the row `reversed_at`
(a soft flag only — the original amount/method/date are untouched) and posts a brand
new, opposite-direction row to `transactions`. The existing "keep the total in sync"
triggers already recompute `paid_total`/`status` from a sum, so excluding reversed
rows from that sum is all it took to make reversal correctly reduce a balance — no
other code had to change.

`components/ReverseButton.js` is the one UI for this across all four ledger pages
(Payment Entry, Other Income, Expenses, Monthly Payroll) — it requires a reason and is
only shown to roles that can actually use it (Super Admin, Accountant).

## Audit logging

`audit_logs` existed in the schema from the start but nothing wrote to it. Logging is
implemented as **database triggers**, not app code calling a log function — that means
it fires no matter which code path caused the change, and can't be forgotten in some new
feature later: `0012_audit_logging.sql` adds triggers for a reversal (any of the four
`reverse_*()` functions), a payroll lock/approval, a new login being created, and a
teacher being linked to one. View it at Settings → Audit Log (Super Admin only) —
`audit_logs` has no update/delete RLS policy at all, so the log itself can't be edited
after the fact either.

## Role-based UI (two layers)

The database RLS in `supabase/migrations/0002_rls.sql` is the real security boundary — it
enforces access whether a request comes from this app, a script, or someone poking the
API directly. The frontend adds a second, separate layer purely for a good experience:

- **`lib/auth/roles.js`** — `getRoleContext()` returns one boolean per RLS helper
  function (`isAdmin`, `isFinanceStaff`, `canViewFinance`, `canApprove`, `canViewFees`,
  `isTeacher`, ...), named and computed identically to `is_admin()` /
  `is_finance_staff()` / etc. in `0002_rls.sql` — the two are meant to be kept
  byte-for-byte in sync by hand, not just similar. `components/AppShell.js` filters the
  sidebar against these flags, so a role never even sees a link it can't use.
- **`lib/auth/guard.js`** — `requireRole([...])` hard-redirects the pages where a role
  has no legitimate view at all (e.g. Academic Setup is Super Admin only, full stop).
  Where a role can view but not write (e.g. Principal can see Salary Configuration's
  rules but can't create one), the page itself gates just the write form/buttons with a
  `canWrite` flag from `getRoleContext()` instead of blocking the whole page.

Neither of these replaces RLS — if either were deleted entirely, every read/write would
still be exactly as safe as it is today, just with worse error messages (a rejected
Server Action instead of a hidden button or a clean redirect).

## Where to go next

Everything in the original roadmap is built (see "Module status" above). What's left is
in "Planned" above, plus general hardening as real usage surfaces edge cases —
particularly worth watching:

- The `/reports` hub's per-report role visibility is hand-copied from each report's own
  `requireRole()` list rather than imported from one shared source (see "Partially
  implemented" above) — if a report's allowed roles ever change, both places need it.
- No automated tests exist anywhere in this repo. Every verification so far has been a
  manual `next build` pass plus reading the RLS policies directly — real before deploying
  anything to production traffic.
