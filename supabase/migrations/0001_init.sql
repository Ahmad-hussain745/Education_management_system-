-- ============================================================================
-- Modern Science Academy — PostgreSQL / Supabase Schema (v2)
-- ============================================================================
-- Table names match exactly what was requested for the migration:
--   students, classes, sections, teachers, teacher_classes, fee_structures,
--   fee_records, fee_payments, fee_discounts, student_attendance,
--   teacher_attendance, salary_rules, salary_records, salary_items,
--   salary_payments, subjects, syllabus_chapters, syllabus_topics,
--   syllabus_progress, income, expenses, accounts, transactions, users,
--   roles, audit_logs
--
-- Grounded in the logic already built in the app prototype:
--   • fee due = class fee (or per-student override) − discount, plus any
--     unpaid balance carried forward from earlier months
--   • partial / multiple payments per student per month (fee_payments)
--   • teacher pay: fixed, percentage-of-collection-per-class, or hybrid,
--     with one salary_rules row per (teacher, class, section) they earn from
--   • month-end payroll: generate → review → lock/approve → slip → paid,
--     with post-lock corrections going through salary_items adjustments
--   • attendance marked per (date, class, section, subject, student) for
--     students, and per (date, teacher) for staff — two separate systems
--   • syllabus tracked as chapters → topics → per-class/section progress
--   • a single unified ledger (transactions) drives the Cash / Bank reports
--
-- Conventions:
--   • uuid primary keys (gen_random_uuid()); money is numeric(12,2), never float
--   • people/entities with financial history are soft-deleted via `status`,
--     never hard-deleted (students, teachers, classes, users, accounts)
--   • created_at / updated_at are set automatically (see triggers at bottom)
--   • tables are ordered so every foreign key points at a table already
--     defined above it — this file runs top to bottom with no forward refs
--   • RLS is scaffolded (enabled + one example policy) at the very end —
--     extend per-table policies to match your actual roles before going live
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- ENUM TYPES
-- ----------------------------------------------------------------------------
create type person_status     as enum ('active', 'inactive');
create type payment_method    as enum ('Cash', 'Bank Transfer', 'Cheque', 'Easypaisa', 'JazzCash', 'Card');
create type fee_status        as enum ('unpaid', 'partial', 'paid');
create type salary_mode       as enum ('fixed', 'percentage', 'hybrid');
create type salary_item_type  as enum ('base', 'percentage_share', 'adjustment');
create type account_kind      as enum ('cash', 'bank');
create type txn_type          as enum ('fee_payment', 'income', 'expense', 'salary_payment');
create type txn_direction     as enum ('in', 'out');
create type attendance_status as enum ('present', 'absent', 'late', 'leave');


-- ============================================================================
-- 1. USERS & ROLES
-- ============================================================================
-- Defined first because payments, expenses, payouts, closings, and the audit
-- log all record "who did this" via users(id).

create table roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,               -- Owner, Accountant, Cashier, Teacher, Front Desk
  permissions jsonb not null default '[]',         -- e.g. ["fees.write", "salary.read"]
  created_at  timestamptz not null default now()
);

create table users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text unique,
  phone         text,
  role_id       uuid references roles(id) on delete restrict,
  status        person_status not null default 'active',
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);


-- ============================================================================
-- 2. ACADEMIC STRUCTURE
-- ============================================================================

create table classes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,                -- "Nursery", "Class 10", "Class 11th"
  sort_order int not null default 0,
  status     person_status not null default 'active',
  created_at timestamptz not null default now()
);

create table sections (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references classes(id) on delete cascade,
  name       text not null,                        -- "A", "B", "Morning"
  created_at timestamptz not null default now(),
  unique (class_id, name)
);

create table subjects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,                 -- "Mathematics", "Physics"
  created_at timestamptz not null default now()
);


-- ============================================================================
-- 3. STUDENTS
-- ============================================================================

create table students (
  id             uuid primary key default gen_random_uuid(),
  student_code   text unique,                      -- human ID, e.g. "MSA-2026-014"
  name           text not null,
  guardian_name  text,
  guardian_phone text,
  class_id       uuid references classes(id) on delete restrict,
  section_id     uuid references sections(id) on delete set null,
  admission_date date not null default current_date,
  status         person_status not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_students_class  on students(class_id);
create index idx_students_status on students(status);


-- ============================================================================
-- 4. TEACHERS
-- ============================================================================

create table teachers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  subject_id   uuid references subjects(id) on delete set null,
  phone        text,
  status       person_status not null default 'active',
  salary_mode  salary_mode not null default 'fixed',
  fixed_salary numeric(12,2) not null default 0,   -- used when salary_mode = 'fixed', or as the base of 'hybrid'
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Which classes/sections a teacher teaches — informational for every teacher
-- (drives the "Classes" / "Students" columns on the staff directory). This is
-- separate from salary_rules: a teacher can teach a class without earning a
-- percentage from it, e.g. a fixed-salary teacher covering a free period.
create table teacher_classes (
  id         uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers(id) on delete cascade,
  class_id   uuid not null references classes(id) on delete cascade,
  section_id uuid references sections(id) on delete cascade,
  subject_id uuid references subjects(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (teacher_id, class_id, section_id, subject_id)
);


-- ============================================================================
-- 5. FEES
-- ============================================================================

-- Default monthly fee per class, plus optional one-off overrides per student
-- (a row with student_id set beats the class-level row with student_id null).
create table fee_structures (
  id              uuid primary key default gen_random_uuid(),
  class_id        uuid references classes(id) on delete cascade,
  student_id      uuid references students(id) on delete cascade,
  monthly_fee     numeric(12,2) not null check (monthly_fee >= 0),
  effective_from  date not null default current_date,
  created_at      timestamptz not null default now(),
  check (
    (class_id is not null and student_id is null) or
    (class_id is null and student_id is not null)
  )
);
create unique index uq_fee_structure_class   on fee_structures(class_id)   where student_id is null;
create unique index uq_fee_structure_student on fee_structures(student_id) where student_id is not null;

-- A standing monthly discount for a student (sibling discount, scholarship,
-- staff-child waiver, etc). Kept as its own row — not a students column — so
-- the reason and history survive even after the amount changes.
create table fee_discounts (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  amount     numeric(12,2) not null default 0 check (amount >= 0),
  reason     text,
  active     boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_fee_discounts_student on fee_discounts(student_id);

-- One row per student per month — the "bill" the cashier opens in Payment
-- Entry: Monthly Fee + Previous Balance − Discount = Total Payable. Snapshot
-- values so history stays correct even if the class fee or discount changes
-- later. paid_total / status are kept in sync by a trigger on fee_payments.
create table fee_records (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references students(id) on delete cascade,
  month            date not null,                  -- always the 1st of the month, e.g. 2026-08-01
  monthly_fee      numeric(12,2) not null,
  previous_balance numeric(12,2) not null default 0,
  discount         numeric(12,2) not null default 0,
  total_payable    numeric(12,2) generated always as (monthly_fee + previous_balance - discount) stored,
  paid_total       numeric(12,2) not null default 0,
  status           fee_status not null default 'unpaid',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (student_id, month)
);
create index idx_fee_records_month  on fee_records(month);
create index idx_fee_records_status on fee_records(status);

-- Every individual payment — a fee_record can have several rows (partial /
-- installment payments), which is what makes "Partial" status work.
create table fee_payments (
  id            uuid primary key default gen_random_uuid(),
  fee_record_id uuid not null references fee_records(id) on delete restrict,
  student_id    uuid not null references students(id) on delete restrict,   -- denormalised for fast lookups
  month         date not null,                     -- denormalised, matches fee_records.month
  amount        numeric(12,2) not null check (amount > 0),
  method        payment_method not null default 'Cash',
  remarks       text,
  paid_on       date not null default current_date,
  received_by   uuid references users(id),
  created_at    timestamptz not null default now()
);
create index idx_fee_payments_student_month on fee_payments(student_id, month);
create index idx_fee_payments_paid_on       on fee_payments(paid_on);


-- ============================================================================
-- 6. ATTENDANCE — two separate systems
-- ============================================================================

-- One row per (date, class, section, subject, student) — matches how the app
-- marks a register: pick a date/class/section/subject, then tick each student
-- Present / Absent / Late / Leave.
create table student_attendance (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  class_id   uuid not null references classes(id) on delete cascade,
  section_id uuid references sections(id) on delete set null,
  subject_id uuid references subjects(id) on delete set null,
  date       date not null,
  status     attendance_status not null,
  marked_by  uuid references users(id),
  created_at timestamptz not null default now(),
  unique (student_id, date, class_id, section_id, subject_id)
);
create index idx_student_attendance_date          on student_attendance(date);
create index idx_student_attendance_student_month on student_attendance(student_id, date);

-- Daily attendance for staff — deliberately separate from student_attendance.
create table teacher_attendance (
  id         uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers(id) on delete cascade,
  date       date not null,
  status     attendance_status not null,
  check_in   time,
  check_out  time,
  marked_by  uuid references users(id),
  created_at timestamptz not null default now(),
  unique (teacher_id, date)
);
create index idx_teacher_attendance_date on teacher_attendance(date);


-- ============================================================================
-- 7. SALARY / PAYROLL
-- ============================================================================

-- The standing rule behind a percentage/hybrid teacher's pay: X% of the fee
-- collected from one class+section. A teacher can have several rows — one
-- per class they earn a share from (10-A → 60%, 10-B → 60%, 9-A → 50%, ...).
create table salary_rules (
  id                        uuid primary key default gen_random_uuid(),
  teacher_id                uuid not null references teachers(id) on delete cascade,
  class_id                  uuid not null references classes(id) on delete cascade,
  section_id                uuid references sections(id) on delete cascade,
  percentage                numeric(5,2) not null check (percentage >= 0 and percentage <= 100),
  fee_per_student_override  numeric(12,2),          -- null = use fee_structures for that class
  student_count_override    int,                    -- null = use live headcount
  active                    boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (teacher_id, class_id, section_id)
);
create index idx_salary_rules_teacher on salary_rules(teacher_id);

-- One row per teacher per month — the actual payroll statement, matching the
-- app's workflow: generate (draft, unlocked) → review → lock/approve → slip
-- → paid. Once locked, numbers freeze; corrections go through salary_items
-- of type 'adjustment' rather than editing the frozen totals.
create table salary_records (
  id                 uuid primary key default gen_random_uuid(),
  teacher_id         uuid not null references teachers(id) on delete cascade,
  month              date not null,
  base_salary        numeric(12,2) not null default 0,   -- fixed pay, or the base half of hybrid
  percentage_total   numeric(12,2) not null default 0,   -- sum of percentage_share items
  adjustments_total  numeric(12,2) not null default 0,   -- sum of adjustment items (can be negative)
  gross_salary       numeric(12,2) generated always as (base_salary + percentage_total + adjustments_total) stored,
  paid_total         numeric(12,2) not null default 0,
  status             fee_status not null default 'unpaid',    -- unpaid = "Pending" in the app's wording
  locked             boolean not null default false,
  locked_at          timestamptz,
  locked_by          uuid references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (teacher_id, month)
);
create index idx_salary_records_month on salary_records(month);

-- The line items behind a salary_record — one row per class share, plus any
-- post-lock adjustment entries. This is what prints on the salary slip.
create table salary_items (
  id                uuid primary key default gen_random_uuid(),
  salary_record_id  uuid not null references salary_records(id) on delete cascade,
  item_type         salary_item_type not null,
  class_id          uuid references classes(id),
  section_id        uuid references sections(id),
  students_count    int,               -- snapshot: students in that class/section that month
  fee_per_student   numeric(12,2),     -- snapshot: fee used for the calc
  expected_amount   numeric(12,2),     -- students_count × fee_per_student
  collected_amount  numeric(12,2),     -- actual fee collected from that class that month
  percentage        numeric(5,2),
  amount            numeric(12,2) not null,   -- final Rs. value of this line
  note              text,
  created_at        timestamptz not null default now()
);
create index idx_salary_items_record on salary_items(salary_record_id);

create table salary_payments (
  id                uuid primary key default gen_random_uuid(),
  salary_record_id  uuid not null references salary_records(id) on delete restrict,
  teacher_id        uuid not null references teachers(id) on delete restrict,  -- denormalised
  month             date not null,
  amount            numeric(12,2) not null check (amount > 0),
  method            payment_method not null default 'Bank Transfer',
  paid_on           date not null default current_date,
  paid_by           uuid references users(id),
  created_at        timestamptz not null default now()
);
create index idx_salary_payments_teacher_month on salary_payments(teacher_id, month);


-- ============================================================================
-- 8. SYLLABUS
-- ============================================================================

create table syllabus_chapters (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references classes(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  title      text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index idx_syllabus_chapters_class_subject on syllabus_chapters(class_id, subject_id);

create table syllabus_topics (
  id         uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references syllabus_chapters(id) on delete cascade,
  title      text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index idx_syllabus_topics_chapter on syllabus_topics(chapter_id);

-- Per-class-section progress against a topic — a teacher ticks it off once
-- taught. section_id null = tracked at the whole-class level, no section split.
create table syllabus_progress (
  id           uuid primary key default gen_random_uuid(),
  topic_id     uuid not null references syllabus_topics(id) on delete cascade,
  section_id   uuid references sections(id) on delete cascade,
  completed    boolean not null default false,
  completed_on date,
  completed_by uuid references users(id),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (topic_id, section_id)
);
create index idx_syllabus_progress_topic on syllabus_progress(topic_id);


-- ============================================================================
-- 9. OTHER FINANCE — INCOME, EXPENSES, ACCOUNTS, LEDGER
-- ============================================================================

create table income (
  id          uuid primary key default gen_random_uuid(),
  category    text not null,             -- "Admission Fee", "Donation", "Other"
  description text,
  amount      numeric(12,2) not null check (amount > 0),
  method      payment_method not null default 'Cash',
  income_date date not null default current_date,
  received_by uuid references users(id),
  created_at  timestamptz not null default now()
);
create index idx_income_date on income(income_date);

create table expenses (
  id           uuid primary key default gen_random_uuid(),
  category     text not null,            -- "Utilities", "Maintenance & Repairs", "Rent", ...
  description  text,
  amount       numeric(12,2) not null check (amount > 0),
  method       payment_method not null default 'Cash',
  expense_date date not null default current_date,
  paid_by      uuid references users(id),
  created_at   timestamptz not null default now()
);
create index idx_expenses_date on expenses(expense_date);

-- A single cash-in-hand account plus any number of bank/digital accounts —
-- one table discriminated by `kind`, so every ledger row just points at
-- whichever account moved, instead of two parallel account tables.
create table accounts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,          -- "Cash in Hand", "HBL Current Account"
  kind            account_kind not null,
  opening_balance numeric(12,2) not null default 0,
  current_balance numeric(12,2) not null default 0,
  status          person_status not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The single unified ledger every money-moving action writes to — this is
-- what powers the Cash / Bank reports and running balances without
-- re-joining four separate tables each time.
create table transactions (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id) on delete restrict,
  type            txn_type not null,
  direction       txn_direction not null,
  amount          numeric(12,2) not null check (amount > 0),
  txn_date        date not null default current_date,
  description     text,
  reference_table text not null,          -- 'fee_payments' | 'income' | 'expenses' | 'salary_payments'
  reference_id    uuid not null,
  created_at      timestamptz not null default now()
);
create index idx_transactions_account_date on transactions(account_id, txn_date);
create index idx_transactions_reference    on transactions(reference_table, reference_id);


-- ============================================================================
-- 10. MONTH-END CLOSING
-- ============================================================================
-- Locks a month's books once reviewed — matches the app's Monthly Closing
-- screen. After closing, corrections should go through fee_discounts /
-- salary_items adjustments rather than editing frozen historical rows.
create table monthly_closing (
  id               uuid primary key default gen_random_uuid(),
  month            date not null unique,
  closed_by        uuid references users(id),
  closed_at        timestamptz not null default now(),
  total_income     numeric(12,2) not null,
  total_expenses   numeric(12,2) not null,
  total_salary     numeric(12,2) not null,
  net_income       numeric(12,2) generated always as (total_income - total_expenses - total_salary) stored,
  snapshot         jsonb not null default '{}',   -- frozen dashboard figures at close time
  notes            text,
  created_at       timestamptz not null default now()
);


-- ============================================================================
-- 11. AUDIT LOG
-- ============================================================================

create table audit_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references users(id),
  action     text not null,               -- "fee_payment.create", "salary_record.lock", ...
  table_name text not null,
  record_id  uuid,
  old_value  jsonb,
  new_value  jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);
create index idx_audit_logs_table_record on audit_logs(table_name, record_id);
create index idx_audit_logs_user         on audit_logs(user_id);


-- ============================================================================
-- 12. AUTOMATION — the core cascade
--     FEE PAYMENT → FEE RECORD STATUS → CLASS COLLECTION → TEACHER % →
--     TEACHER SALARY → LEDGER → CASH/BANK BALANCE → FINANCE → NET INCOME
-- ============================================================================
-- Entering one fee_payments row automatically:
--   1) recomputes that fee_records row's paid_total and status
--   2) posts a matching row to transactions and moves the account balance
-- Class Collection, Teacher Percentage, Teacher Salary, Finance and Net
-- Income are never separately "updated" — they're queries/views that read
-- these same rows live, so they're always current the instant a payment is
-- saved. The same wiring applies to expenses, income and salary_payments.

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  for t in select unnest(array[
    'users','teachers','students','fee_discounts','fee_records',
    'salary_rules','salary_records','accounts','syllabus_progress'
  ]) loop
    execute format(
      'create trigger trg_%1$s_updated_at before update on %1$s
       for each row execute function set_updated_at();', t);
  end loop;
end $$;

-- Keep fee_records.paid_total / status in sync whenever a payment is added,
-- edited, or removed — mirrors the app's Payment Entry auto-calculation.
-- SECURITY DEFINER: a Cashier can INSERT fee_payments but has no RLS UPDATE
-- right on fee_records itself — this trusted, narrow function is the one
-- exception, exactly like post_transaction() below.
create or replace function sync_fee_record_totals() returns trigger as $$
declare
  rec_id  uuid := coalesce(new.fee_record_id, old.fee_record_id);
  total   numeric(12,2);
  payable numeric(12,2);
begin
  select coalesce(sum(amount), 0) into total from fee_payments where fee_record_id = rec_id;
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

create trigger trg_fee_payments_sync
  after insert or update or delete on fee_payments
  for each row execute function sync_fee_record_totals();

-- Same idea for payroll: keep salary_records.paid_total / status in sync.
create or replace function sync_salary_record_paid() returns trigger as $$
declare
  rec_id uuid := coalesce(new.salary_record_id, old.salary_record_id);
  total  numeric(12,2);
  gross  numeric(12,2);
begin
  select coalesce(sum(amount), 0) into total from salary_payments where salary_record_id = rec_id;
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

create trigger trg_salary_payments_sync
  after insert or update or delete on salary_payments
  for each row execute function sync_salary_record_paid();


-- ============================================================================
-- 12b. TEACHER SALARY AUTOMATION — the percentage engine, server-side
-- ============================================================================
-- Mirrors the app's computeAssignmentRow / computeTeacherSalary logic exactly,
-- so a real Supabase deployment produces byte-identical numbers to what the
-- app already shows from local state — this doesn't redesign that logic, it
-- just runs the same formula as a query against real rows:
--     collected = sum(fee_payments.amount) for students in that class/section,
--                 for that month
--     share     = collected × (salary_rules.percentage / 100)
-- Example (exactly the one in the spec): Mr. Ahmed, Class 10-A, 60%, with
-- Rs. 280,000 actually collected from 10-A in August → share = Rs. 168,000.

-- Actual fee collected from one class(+section) in one month — the same
-- number the app calls "Actual Collection", not the billed/expected amount.
create or replace function class_collected_amount(p_class_id uuid, p_section_id uuid, p_month date) returns numeric as $$
declare total numeric(12,2);
begin
  select coalesce(sum(fp.amount), 0) into total
    from fee_payments fp
    join students st on st.id = fp.student_id
    where st.class_id = p_class_id
      and (p_section_id is null or st.section_id = p_section_id)
      and fp.month = p_month;
  return total;
end;
$$ language plpgsql stable;

-- Generates (or refreshes) one salary_records + salary_items set per active
-- teacher for a given month — this is the "creates August Salary… Status:
-- Pending" step. Skips any teacher whose record for that month is already
-- locked (approved payroll is frozen; corrections go through salary_items
-- adjustments instead, exactly like the app's Adjustment Entry).
create or replace function generate_salary_records(p_month date) returns void as $$
declare
  t          record;
  r          record;
  rec_id     uuid;
  pct_total  numeric(12,2);
  base_amt   numeric(12,2);
  collected  numeric(12,2);
  share      numeric(12,2);
  fee_per    numeric(12,2);
  scount     int;
begin
  for t in select * from teachers where status = 'active' loop

    -- don't touch an already-approved month
    if exists (select 1 from salary_records where teacher_id = t.id and month = p_month and locked) then
      continue;
    end if;

    pct_total := 0;
    base_amt  := case when t.salary_mode in ('fixed', 'hybrid') then t.fixed_salary else 0 end;

    -- upsert the header row first so salary_items can reference it
    insert into salary_records (teacher_id, month, base_salary, percentage_total)
      values (t.id, p_month, base_amt, 0)
      on conflict (teacher_id, month) do update set base_salary = excluded.base_salary
      returning id into rec_id;

    -- clear old percentage_share items for this month so re-running is idempotent
    delete from salary_items where salary_record_id = rec_id and item_type = 'percentage_share';

    if t.salary_mode in ('percentage', 'hybrid') then
      for r in select * from salary_rules where teacher_id = t.id and active loop
        select count(*) into scount from students
          where class_id = r.class_id and (r.section_id is null or section_id = r.section_id) and status = 'active';
        select monthly_fee into fee_per from fee_structures where class_id = r.class_id and student_id is null;
        collected := class_collected_amount(r.class_id, r.section_id, p_month);
        share     := round(collected * (r.percentage / 100), 2);
        pct_total := pct_total + share;

        insert into salary_items (salary_record_id, item_type, class_id, section_id, students_count, fee_per_student, expected_amount, collected_amount, percentage, amount, note)
          values (rec_id, 'percentage_share', r.class_id, r.section_id, scount, fee_per, coalesce(scount,0) * coalesce(fee_per,0), collected, r.percentage, share,
                  'Auto-generated ' || to_char(p_month, 'Mon YYYY'));
      end loop;
    end if;

    update salary_records set percentage_total = pct_total where id = rec_id;
  end loop;
end;
$$ language plpgsql;

-- Convenience read view — one row per teacher per month, ready to display
-- exactly like the spec's "August Salary — Mr. Ahmed — Rs. 168,000 — Pending".
create or replace view v_salary_slip as
  select sr.id, t.name as teacher_name, sr.month, sr.base_salary, sr.percentage_total,
         sr.adjustments_total, sr.gross_salary, sr.paid_total, sr.status, sr.locked
    from salary_records sr
    join teachers t on t.id = sr.teacher_id;

-- Post one ledger row + move the account balance for every money-moving
-- insert. Picks the oldest active account of the right kind — for a
-- single-branch academy with one till and one bank account (the common
-- case) this "just works"; add an explicit account_id column to the source
-- table instead if a second bank account is introduced later.
create or replace function default_account_id(p_method payment_method) returns uuid as $$
declare acc_id uuid;
begin
  select id into acc_id from accounts
    where kind = case when p_method = 'Cash' then 'cash'::account_kind else 'bank'::account_kind end
      and status = 'active'
    order by created_at asc limit 1;
  return acc_id;
end;
$$ language plpgsql security definer set search_path = public;

-- SECURITY DEFINER is required here: a Cashier is allowed to record a fee
-- payment, but has no RLS write access to `transactions` or `accounts`
-- directly (by design — the ledger is only ever written by this trusted,
-- narrow function, never edited by hand). Without security definer, every
-- payment/expense/income/salary trigger below would silently fail to post
-- to the ledger for anyone except Super Admin.
create or replace function post_transaction(
  p_type txn_type, p_direction txn_direction, p_amount numeric,
  p_method payment_method, p_date date, p_desc text, p_ref_table text, p_ref_id uuid
) returns void as $$
declare acc_id uuid := default_account_id(p_method);
begin
  if acc_id is null then return; end if;   -- no accounts seeded yet — skip silently
  insert into transactions (account_id, type, direction, amount, txn_date, description, reference_table, reference_id)
    values (acc_id, p_type, p_direction, p_amount, p_date, p_desc, p_ref_table, p_ref_id);
  update accounts set current_balance = current_balance + case when p_direction = 'in' then p_amount else -p_amount end
    where id = acc_id;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function trg_fee_payments_ledger() returns trigger as $$
begin
  perform post_transaction('fee_payment', 'in', new.amount, new.method, new.paid_on, 'Fee payment', 'fee_payments', new.id);
  return new;
end;
$$ language plpgsql;
create trigger trg_fee_payments_ledger after insert on fee_payments
  for each row execute function trg_fee_payments_ledger();

create or replace function trg_income_ledger() returns trigger as $$
begin
  perform post_transaction('income', 'in', new.amount, new.method, new.income_date, new.category, 'income', new.id);
  return new;
end;
$$ language plpgsql;
create trigger trg_income_ledger after insert on income
  for each row execute function trg_income_ledger();

create or replace function trg_expenses_ledger() returns trigger as $$
begin
  perform post_transaction('expense', 'out', new.amount, new.method, new.expense_date, new.category, 'expenses', new.id);
  return new;
end;
$$ language plpgsql;
create trigger trg_expenses_ledger after insert on expenses
  for each row execute function trg_expenses_ledger();

create or replace function trg_salary_payments_ledger() returns trigger as $$
begin
  perform post_transaction('salary_payment', 'out', new.amount, new.method, new.paid_on, 'Teacher salary', 'salary_payments', new.id);
  return new;
end;
$$ language plpgsql;
create trigger trg_salary_payments_ledger after insert on salary_payments
  for each row execute function trg_salary_payments_ledger();


-- ============================================================================
-- 13. SEED DATA — required before the ledger triggers above will do anything
-- ============================================================================
insert into accounts (name, kind) values
  ('Cash in Hand', 'cash'),
  ('Main Bank Account', 'bank');

insert into roles (name, permissions) values
  ('Super Admin', '["*"]'),
  ('Principal',   '["fees.view","fees.approve","salary.view","salary.approve","attendance.view","syllabus.view","finance.view","finance.approve"]'),
  ('Accountant',  '["fees.write","salary.write","finance.write","reports.read"]'),
  ('Cashier',     '["fees.view","fees.payment","reports.read"]'),
  ('Teacher',     '["attendance.write","syllabus.write","salary.view_own"]');

-- Note: RLS is NOT enabled here — see 0002_rls.sql, which enables it on
-- every table and defines the full policy set matching the role matrix.
-- Run 0001 then 0002, in order.

