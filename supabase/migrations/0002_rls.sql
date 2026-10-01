-- ============================================================================
-- 0002 — Row Level Security, enforcing the role matrix:
--
--   Role           Fees          Salary        Attendance   Syllabus  Finance
--   Super Admin    Full          Full          Full         Full      Full
--   Principal      View/Approve  View/Approve  View         View      View/Approve
--   Accountant     Full          Payroll       View         —         Full
--   Teacher        —             View own      Manage       Manage    —
--   Cashier        Payment       —             —            —        Collection
--
-- This runs AFTER 0001_init.sql. It links auth.users → public.users (so a
-- Supabase Auth login resolves to a role) and links teachers → auth users
-- (so "Teacher: view own salary" is enforceable, not just a UI convention).
-- ============================================================================

-- Link every app user row to its real Supabase Auth account.
alter table users add column if not exists auth_user_id uuid references auth.users(id) on delete cascade;
create unique index if not exists uq_users_auth_user_id on users(auth_user_id) where auth_user_id is not null;

-- Link a teacher to the login they use (needed for "view own salary").
alter table teachers add column if not exists user_id uuid references users(id) on delete set null;

-- ----------------------------------------------------------------------------
-- Helper: the caller's role name, or null if not signed in / not linked yet.
-- ----------------------------------------------------------------------------
create or replace function current_role_name() returns text as $$
  select r.name from users u
  join roles r on r.id = u.role_id
  where u.auth_user_id = auth.uid()
  limit 1;
$$ language sql stable security definer;

create or replace function current_teacher_id() returns uuid as $$
  select t.id from teachers t
  join users u on u.id = t.user_id
  where u.auth_user_id = auth.uid()
  limit 1;
$$ language sql stable security definer;

-- Role tiers, matching the matrix above exactly:
--   is_admin()          Super Admin only — unrestricted, incl. user/role mgmt
--   is_finance_staff()  Super Admin, Accountant — "Full" write on fees/salary/finance
--   can_view_finance()  + Principal — "View" everything money-related
--   can_approve()       Super Admin, Principal — the specific approve/lock action
--   can_view_fees()     + Cashier — Cashier can see fee records/payments too
create or replace function is_admin() returns boolean as $$
  select current_role_name() = 'Super Admin';
$$ language sql stable;

create or replace function is_finance_staff() returns boolean as $$
  select current_role_name() in ('Super Admin', 'Accountant');
$$ language sql stable;

create or replace function can_view_finance() returns boolean as $$
  select current_role_name() in ('Super Admin', 'Principal', 'Accountant');
$$ language sql stable;

create or replace function can_approve() returns boolean as $$
  select current_role_name() in ('Super Admin', 'Principal');
$$ language sql stable;

create or replace function can_view_fees() returns boolean as $$
  select current_role_name() in ('Super Admin', 'Principal', 'Accountant', 'Cashier');
$$ language sql stable;

-- Principal's "Approve" right on salary_records / monthly_closing is meant to
-- be exactly that — flipping locked on — not general editing power. Postgres
-- RLS can't restrict a policy to "only these columns changed", so this
-- trigger enforces it explicitly: anyone who isn't full finance staff may
-- only touch the lock-related columns.
create or replace function enforce_approve_only() returns trigger as $$
begin
  if is_finance_staff() then
    return new;
  end if;
  if not can_approve() then
    raise exception 'not authorized to modify this row';
  end if;
  if to_jsonb(new) - 'locked' - 'locked_at' - 'locked_by' - 'updated_at'
     is distinct from to_jsonb(old) - 'locked' - 'locked_at' - 'locked_by' - 'updated_at' then
    raise exception 'Principal may only approve/lock this record, not edit its figures';
  end if;
  return new;
end;
$$ language plpgsql;

-- ----------------------------------------------------------------------------
-- Enable RLS everywhere. Default-deny: nothing is readable/writable until a
-- policy below explicitly allows it.
-- ----------------------------------------------------------------------------
alter table roles               enable row level security;
alter table users               enable row level security;
alter table classes             enable row level security;
alter table sections            enable row level security;
alter table subjects            enable row level security;
alter table students            enable row level security;
alter table teachers            enable row level security;
alter table teacher_classes     enable row level security;
alter table fee_structures      enable row level security;
alter table fee_discounts       enable row level security;
alter table fee_records         enable row level security;
alter table fee_payments        enable row level security;
alter table student_attendance  enable row level security;
alter table teacher_attendance  enable row level security;
alter table salary_rules        enable row level security;
alter table salary_records      enable row level security;
alter table salary_items        enable row level security;
alter table salary_payments     enable row level security;
alter table syllabus_chapters   enable row level security;
alter table syllabus_topics     enable row level security;
alter table syllabus_progress   enable row level security;
alter table income              enable row level security;
alter table expenses            enable row level security;
alter table accounts            enable row level security;
alter table transactions        enable row level security;
alter table monthly_closing     enable row level security;
alter table audit_logs          enable row level security;

-- ----------------------------------------------------------------------------
-- Reference data — every signed-in role can read; only admins write.
-- ----------------------------------------------------------------------------
create policy "read: any signed-in user" on classes  for select using (auth.uid() is not null);
create policy "read: any signed-in user" on sections for select using (auth.uid() is not null);
create policy "read: any signed-in user" on subjects for select using (auth.uid() is not null);
create policy "write: admin only" on classes  for all using (is_admin()) with check (is_admin());
create policy "write: admin only" on sections for all using (is_admin()) with check (is_admin());
create policy "write: admin only" on subjects for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- Users & roles — only admins manage accounts; everyone can read their own row.
-- ----------------------------------------------------------------------------
create policy "read own row" on users for select using (auth_user_id = auth.uid() or is_admin());
create policy "admin manages users" on users for all using (is_admin()) with check (is_admin());
create policy "read roles" on roles for select using (auth.uid() is not null);
create policy "admin manages roles" on roles for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- Students — Fees column: Super Admin/Principal/Accountant/Cashier = Full/View,
-- Teacher = no fee access, but everyone with a login can look students up by
-- name (needed for attendance/syllabus). Writes are Full for admin/finance staff.
-- ----------------------------------------------------------------------------
create policy "read: any signed-in user" on students for select using (auth.uid() is not null);
create policy "write: finance staff" on students for all
  using (is_finance_staff()) with check (is_finance_staff());

-- ----------------------------------------------------------------------------
-- Teachers directory — readable by all; writable by admin/finance staff.
-- ----------------------------------------------------------------------------
create policy "read: any signed-in user" on teachers for select using (auth.uid() is not null);
create policy "write: finance staff" on teachers for all
  using (is_finance_staff()) with check (is_finance_staff());
create policy "read: any signed-in user" on teacher_classes for select using (auth.uid() is not null);
create policy "write: admin only" on teacher_classes for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- Fees — Cashier can create payments ("Payment" permission) but not edit fee
-- structures/discounts; Accountant/Admin have full control; Principal views.
-- ----------------------------------------------------------------------------
create policy "read: fee staff and principal" on fee_records for select
  using (can_view_fees());
create policy "write: finance staff" on fee_records for all
  using (is_finance_staff()) with check (is_finance_staff());

create policy "read: fee staff and principal" on fee_payments for select
  using (can_view_fees());
create policy "cashier can record payments" on fee_payments for insert
  with check (is_finance_staff() or current_role_name() = 'Cashier');
create policy "only finance staff edit/delete payments" on fee_payments for update
  using (is_finance_staff()) with check (is_finance_staff());
create policy "only finance staff delete payments" on fee_payments for delete
  using (is_finance_staff());

create policy "write: finance staff" on fee_structures for all
  using (is_finance_staff()) with check (is_finance_staff());
create policy "write: finance staff" on fee_discounts for all
  using (is_finance_staff()) with check (is_finance_staff());
create policy "read: finance staff" on fee_structures for select using (is_finance_staff());
create policy "read: finance staff" on fee_discounts for select using (is_finance_staff());

-- ----------------------------------------------------------------------------
-- Attendance — Teacher "Manage" (their own classes' students, and their own
-- check-in), Admin/Principal view everything, Accountant views for payroll.
-- ----------------------------------------------------------------------------
create policy "read: any signed-in user" on student_attendance for select using (auth.uid() is not null);
create policy "teacher manages own classes' attendance" on student_attendance for all
  using (
    is_admin() or
    exists (select 1 from teacher_classes tc where tc.teacher_id = current_teacher_id() and tc.class_id = student_attendance.class_id)
  )
  with check (
    is_admin() or
    exists (select 1 from teacher_classes tc where tc.teacher_id = current_teacher_id() and tc.class_id = student_attendance.class_id)
  );

create policy "read: any signed-in user" on teacher_attendance for select using (auth.uid() is not null);
create policy "office staff mark any, teacher marks own" on teacher_attendance for all
  using (can_view_finance() or teacher_id = current_teacher_id())
  with check (can_view_finance() or teacher_id = current_teacher_id());

-- ----------------------------------------------------------------------------
-- Salary — Teacher can only ever SELECT their own records ("View own");
-- everything else (rules, generation, locking, payment) is finance staff.
-- ----------------------------------------------------------------------------
create policy "teacher and principal view salary" on salary_records for select
  using (can_view_finance() or teacher_id = current_teacher_id());
create policy "finance staff manage payroll" on salary_records for all
  using (is_finance_staff()) with check (is_finance_staff());
create policy "principal can approve payroll" on salary_records for update
  using (can_approve()) with check (can_approve());
create trigger trg_salary_records_approve_only
  before update on salary_records for each row execute function enforce_approve_only();

create policy "teacher and principal view salary items" on salary_items for select
  using (can_view_finance() or exists (
    select 1 from salary_records sr where sr.id = salary_items.salary_record_id and sr.teacher_id = current_teacher_id()
  ));
create policy "finance staff manage salary items" on salary_items for all
  using (is_finance_staff()) with check (is_finance_staff());

create policy "teacher and principal view salary payments" on salary_payments for select
  using (can_view_finance() or teacher_id = current_teacher_id());
create policy "finance staff manage salary payments" on salary_payments for all
  using (is_finance_staff()) with check (is_finance_staff());

create policy "finance staff manage salary rules" on salary_rules for all
  using (is_finance_staff()) with check (is_finance_staff());
create policy "teacher and principal view salary rules" on salary_rules for select
  using (can_view_finance() or teacher_id = current_teacher_id());

-- ----------------------------------------------------------------------------
-- Syllabus — Teacher "Manage" for their own classes; everyone else views.
-- ----------------------------------------------------------------------------
create policy "read: any signed-in user" on syllabus_chapters for select using (auth.uid() is not null);
create policy "read: any signed-in user" on syllabus_topics for select using (auth.uid() is not null);
create policy "read: any signed-in user" on syllabus_progress for select using (auth.uid() is not null);

create policy "teacher manages own classes' syllabus" on syllabus_chapters for all
  using (is_admin() or exists (select 1 from teacher_classes tc where tc.teacher_id = current_teacher_id() and tc.class_id = syllabus_chapters.class_id))
  with check (is_admin() or exists (select 1 from teacher_classes tc where tc.teacher_id = current_teacher_id() and tc.class_id = syllabus_chapters.class_id));

create policy "teacher manages own classes' topics" on syllabus_topics for all
  using (is_admin() or exists (
    select 1 from syllabus_chapters ch join teacher_classes tc on tc.class_id = ch.class_id
    where ch.id = syllabus_topics.chapter_id and tc.teacher_id = current_teacher_id()
  ))
  with check (is_admin() or exists (
    select 1 from syllabus_chapters ch join teacher_classes tc on tc.class_id = ch.class_id
    where ch.id = syllabus_topics.chapter_id and tc.teacher_id = current_teacher_id()
  ));

create policy "teacher marks own classes' progress" on syllabus_progress for all
  using (is_admin() or exists (
    select 1 from syllabus_topics t join syllabus_chapters ch on ch.id = t.chapter_id
    join teacher_classes tc on tc.class_id = ch.class_id
    where t.id = syllabus_progress.topic_id and tc.teacher_id = current_teacher_id()
  ))
  with check (is_admin() or exists (
    select 1 from syllabus_topics t join syllabus_chapters ch on ch.id = t.chapter_id
    join teacher_classes tc on tc.class_id = ch.class_id
    where t.id = syllabus_progress.topic_id and tc.teacher_id = current_teacher_id()
  ));

-- ----------------------------------------------------------------------------
-- Finance — Cashier gets "Collection" (read collection-relevant transactions
-- only, e.g. fee_payment rows); everything else is finance-staff only.
-- ----------------------------------------------------------------------------
create policy "finance staff manage income" on income for all
  using (is_finance_staff()) with check (is_finance_staff());
create policy "principal views income" on income for select using (can_view_finance());
create policy "finance staff manage expenses" on expenses for all
  using (is_finance_staff()) with check (is_finance_staff());
create policy "principal views expenses" on expenses for select using (can_view_finance());
create policy "finance staff manage accounts" on accounts for all
  using (is_finance_staff()) with check (is_finance_staff());
create policy "principal views accounts" on accounts for select using (can_view_finance());
create policy "finance staff manage monthly closing" on monthly_closing for all
  using (is_finance_staff()) with check (is_finance_staff());
create policy "principal views monthly closing" on monthly_closing for select using (can_view_finance());
create policy "principal can approve monthly closing" on monthly_closing for update
  using (can_approve()) with check (can_approve());
create trigger trg_monthly_closing_approve_only
  before update on monthly_closing for each row execute function enforce_approve_only();

create policy "finance staff read all transactions" on transactions for select using (can_view_finance());
create policy "cashier reads collection transactions" on transactions for select
  using (current_role_name() = 'Cashier' and type = 'fee_payment');
-- transactions rows are written only by the trigger functions in 0001 (which
-- run as the inserting statement's owner) — no direct insert/update/delete
-- policy is granted here, so the ledger can't be edited by hand from the app.

-- ----------------------------------------------------------------------------
-- Audit logs — admins only, and even they can only read (append-only from
-- the application layer via a service-role Route Handler, never edited).
-- ----------------------------------------------------------------------------
create policy "admin reads audit log" on audit_logs for select using (is_admin());
