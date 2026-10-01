-- ============================================================================
-- HR & EMPLOYEE MANAGEMENT
--
--   HR
--   ├── Employee master   employees (new) — every staff member, teaching
--   │                      and non-teaching, one row each
--   ├── Joining            employees.joining_date/probation_end_date — an
--   │                      event on the employee row, not a separate table
--   ├── Contracts          employee_contracts (new)
--   ├── Documents          employee_documents (new) — external links, same
--   │                      "no file storage bucket wired up yet" scope
--   │                      decision as Learning's Resources
--   ├── Leave              leave_types + leave_requests (new) — a real
--   │                      apply/approve/reject workflow
--   ├── Attendance         teacher_attendance (REUSED, unchanged) for
--   │                      teaching staff; employee_attendance (new) for
--   │                      everyone else — see the note below
--   ├── Performance        performance_reviews (new)
--   ├── Training           trainings + training_participants (new)
--   ├── Salary history     NOT a new table — a read-only view onto the
--   │                      EXISTING salary_records/salary_payments,
--   │                      joined through employees.teacher_id
--   └── Exit/offboarding   employee_exits (new) + offboard_employee()
--
--       HR
--        ↓
--   Attendance
--        ↓
--    Payroll
--
-- What's new on top of it: approving a leave request (decide_leave_request)
-- now writes the attendance rows for those dates — 'leave' for a paid
-- leave type, 'absent' for an unpaid one — so payroll's existing
-- absent-day deduction handles unpaid leave correctly without any change
-- to payroll. That's the concrete HR -> Attendance -> Payroll link.
--
-- This pipeline already existed for teachers before this migration —
-- 0049_payroll_allowances_deductions_attendance.sql wired teacher_attendance
-- into _draft_payroll_for_institute()'s deduction calculation. This
-- migration deliberately does NOT touch that: teacher_attendance keeps its
-- existing shape (teacher_id, not employee_id), payroll keeps reading it
-- exactly as before, and an employee row that's also a teacher
-- (employees.teacher_id set) simply points HR's own Attendance view at that
-- same table instead of a new one, real and already-wired rather than a
-- second parallel attendance record. employee_attendance (new) covers
-- non-teaching staff — genuine HR attendance tracking, honestly documented
-- as NOT feeding any payroll calculation, because this app's payroll engine
-- doesn't process non-teaching pay at all today. Building that is a
-- payroll-system change ("your payroll system is strong" — the request
-- asked for HR to sit alongside it, not to rewrite it), not an HR one.
--
-- Employee Master, Contracts, Documents, Performance, Training, Exit are
-- deliberately admin-only reads (can_approve(): Super Admin/Principal), a
-- step stricter than most tables in this app (which default to
-- is_active_staff() — any signed-in staff member). CNIC numbers, emergency
-- contacts, home addresses, performance review notes, and exit reasons are
-- a different category of sensitive than a subject list or a class
-- timetable; this app's own precedent for that distinction is
-- salary/payroll itself, gated tighter than most other reads.
-- ============================================================================

create table if not exists employees (
  id                     uuid primary key default gen_random_uuid(),
  institute_id           uuid not null references institutes(id) on delete cascade,
  user_id                uuid unique references users(id) on delete set null,
  teacher_id             uuid unique references teachers(id) on delete set null,
  employee_code          text,
  name                   text not null,
  designation            text,
  department             text,
  employment_type        text not null default 'full_time' check (employment_type in ('full_time', 'part_time', 'contract')),
  date_of_birth          date,
  gender                 text,
  national_id             text,
  personal_phone         text,
  personal_email         text,
  address                text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  joining_date           date,
  probation_end_date     date,
  status                 text not null default 'active' check (status in ('active', 'on_leave', 'exited')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (institute_id, employee_code)
);
create index if not exists idx_employees_institute on employees(institute_id, status);

drop trigger if exists trg_set_institute_id on employees;
create trigger trg_set_institute_id before insert on employees
  for each row execute function set_institute_id();

alter table employees enable row level security;

create policy institute_isolation on employees as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

create policy "HR admin manages employees" on employees for all
  using (can_approve()) with check (can_approve());

-- ----------------------------------------------------------------------------
-- Contracts
-- ----------------------------------------------------------------------------
create table if not exists employee_contracts (
  id             uuid primary key default gen_random_uuid(),
  institute_id   uuid not null references institutes(id) on delete cascade,
  employee_id    uuid not null references employees(id) on delete cascade,
  contract_type  text not null default 'permanent' check (contract_type in ('permanent', 'probation', 'fixed_term', 'contract')),
  start_date     date not null,
  end_date       date,
  salary_amount  numeric(12, 2),
  terms          text,
  document_url   text,
  status         text not null default 'active' check (status in ('active', 'expired', 'terminated')),
  created_at     timestamptz not null default now()
);
create index if not exists idx_employee_contracts_employee on employee_contracts(employee_id, start_date desc);

drop trigger if exists trg_set_institute_id on employee_contracts;
create trigger trg_set_institute_id before insert on employee_contracts
  for each row execute function set_institute_id();

alter table employee_contracts enable row level security;

create policy institute_isolation on employee_contracts as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

create policy "HR admin manages contracts" on employee_contracts for all
  using (can_approve()) with check (can_approve());

-- ----------------------------------------------------------------------------
-- Documents — title + type + an external link, same scope decision as
-- Learning's Resources (20260927010000): no storage bucket wired up yet.
-- ----------------------------------------------------------------------------
create table if not exists employee_documents (
  id             uuid primary key default gen_random_uuid(),
  institute_id   uuid not null references institutes(id) on delete cascade,
  employee_id    uuid not null references employees(id) on delete cascade,
  title          text not null,
  document_type  text not null default 'other' check (document_type in ('cnic', 'certificate', 'contract', 'resume', 'offer_letter', 'other')),
  url            text,
  uploaded_by    uuid references users(id),
  created_at     timestamptz not null default now()
);
create index if not exists idx_employee_documents_employee on employee_documents(employee_id, created_at desc);

drop trigger if exists trg_set_institute_id on employee_documents;
create trigger trg_set_institute_id before insert on employee_documents
  for each row execute function set_institute_id();

alter table employee_documents enable row level security;

create policy institute_isolation on employee_documents as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

create policy "HR admin manages documents" on employee_documents for all
  using (can_approve()) with check (can_approve());

-- ----------------------------------------------------------------------------
-- Leave — a real apply/approve/reject workflow, not just a log. Applying
-- and deciding both go through functions (not raw RLS writes) for the
-- same "an action, not a column edit" reasoning as everywhere else in this
-- app's newer modules — a leave request's status is a real state machine
-- (pending -> approved/rejected, decided once), and day-count validation
-- belongs in one place.
-- ----------------------------------------------------------------------------
create table if not exists leave_types (
  id            uuid primary key default gen_random_uuid(),
  institute_id  uuid not null references institutes(id) on delete cascade,
  name          text not null,
  annual_quota  int,
  is_paid       boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (institute_id, name)
);

drop trigger if exists trg_set_institute_id on leave_types;
create trigger trg_set_institute_id before insert on leave_types
  for each row execute function set_institute_id();

alter table leave_types enable row level security;

create policy institute_isolation on leave_types as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

create policy "staff read leave types" on leave_types for select using (is_active_staff());
create policy "HR admin manages leave types" on leave_types for all using (can_approve()) with check (can_approve());

-- Starter types for every existing institute — names and paid/unpaid only;
-- annual_quota is deliberately left null rather than inventing a leave
-- policy this school never set. Editable/extendable (HR admin policy above).
insert into leave_types (institute_id, name, is_paid)
select i.id, v.name, v.is_paid
from institutes i
cross join (values ('Casual Leave', true), ('Sick Leave', true), ('Annual Leave', true), ('Unpaid Leave', false)) as v(name, is_paid)
on conflict (institute_id, name) do nothing;

create table if not exists leave_requests (
  id             uuid primary key default gen_random_uuid(),
  institute_id   uuid not null references institutes(id) on delete cascade,
  employee_id    uuid not null references employees(id) on delete cascade,
  leave_type_id  uuid references leave_types(id) on delete set null,
  date_from      date not null,
  date_to        date not null,
  days_count     int not null,
  reason         text,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by     uuid references users(id),
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  check (date_to >= date_from)
);
create index if not exists idx_leave_requests_employee on leave_requests(employee_id, date_from desc);
create index if not exists idx_leave_requests_status on leave_requests(institute_id, status, date_from);

drop trigger if exists trg_set_institute_id on leave_requests;
create trigger trg_set_institute_id before insert on leave_requests
  for each row execute function set_institute_id();

alter table leave_requests enable row level security;

create policy institute_isolation on leave_requests as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

create policy "HR admin reads all leave requests" on leave_requests for select using (can_approve());

create or replace function apply_for_leave(p_employee_id uuid, p_leave_type_id uuid, p_date_from date, p_date_to date, p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_days int;
begin
  if not can_approve() then
    raise exception 'NOT_AUTHORIZED: Only HR (Super Admin/Principal) can log a leave request in this version.';
  end if;
  if not exists (select 1 from employees where id = p_employee_id) then
    raise exception 'NOT_FOUND: Employee not found.';
  end if;
  if p_date_to < p_date_from then
    raise exception 'INVALID_RANGE: End date must be on or after the start date.';
  end if;

  v_days := (p_date_to - p_date_from) + 1;

  insert into leave_requests (institute_id, employee_id, leave_type_id, date_from, date_to, days_count, reason)
    values (current_institute_id(), p_employee_id, p_leave_type_id, p_date_from, p_date_to, v_days, p_reason)
    returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function apply_for_leave(uuid, uuid, date, date, text) from public;
grant execute on function apply_for_leave(uuid, uuid, date, date, text) to authenticated;

create or replace function decide_leave_request(p_id uuid, p_status text, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_by uuid;
  v_req leave_requests%rowtype;
  v_teacher_id uuid;
  v_paid boolean;
  d date;
begin
  if not can_approve() then
    raise exception 'NOT_AUTHORIZED: Only Super Admin/Principal can decide a leave request.';
  end if;
  if p_status not in ('approved', 'rejected', 'cancelled') then
    raise exception 'INVALID_STATUS: % is not a valid decision.', p_status;
  end if;

  select id into v_by from users where auth_user_id = auth.uid();

  select * into v_req from leave_requests
    where id = p_id and status = 'pending' and institute_id = current_institute_id() for update;
  if v_req.id is null then raise exception 'NOT_FOUND: Request not found, or already decided.'; end if;

  update leave_requests
    set status = p_status, decided_by = v_by, decided_at = now(), decision_note = nullif(trim(p_note), '')
    where id = p_id;

  -- THE "HR -> Attendance -> Payroll" LINK. An approved leave writes the
  -- attendance rows for its dates, and payroll's existing attendance-
  -- based deduction (0049: counts status = 'absent' only, never 'leave')
  -- then does the right thing with NO change to payroll itself:
  --   paid leave type   -> attendance 'leave'  -> not deducted
  --   unpaid leave type -> attendance 'absent' -> deducted, same as any absence
  -- Sundays are skipped — an assumption (this app has no per-institute
  -- working-week setting), chosen because over-marking a non-working day
  -- 'absent' would over-deduct pay, while under-marking one just means
  -- HR corrects a row by hand. Existing marks are never overwritten
  -- (on conflict do nothing) — a day the employee was actually marked
  -- present stays present.
  if p_status = 'approved' then
    select teacher_id into v_teacher_id from employees where id = v_req.employee_id;
    select is_paid into v_paid from leave_types where id = v_req.leave_type_id;
    v_paid := coalesce(v_paid, true);

    for d in select g::date from generate_series(v_req.date_from, v_req.date_to, interval '1 day') g loop
      continue when extract(dow from d) = 0;
      if v_teacher_id is not null then
        insert into teacher_attendance (teacher_id, date, status, marked_by)
          values (v_teacher_id, d, (case when v_paid then 'leave' else 'absent' end)::attendance_status, v_by)
          on conflict (teacher_id, date) do nothing;
      else
        insert into employee_attendance (institute_id, employee_id, date, status, marked_by)
          values (v_req.institute_id, v_req.employee_id, d, (case when v_paid then 'leave' else 'absent' end)::attendance_status, v_by)
          on conflict (employee_id, date) do nothing;
      end if;
    end loop;
  end if;
end;
$$;

revoke execute on function decide_leave_request(uuid, text, text) from public;
grant execute on function decide_leave_request(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Attendance for non-teaching staff. Teaching staff keep using
-- teacher_attendance (unchanged) — see this file's header for why.
-- ----------------------------------------------------------------------------
create table if not exists employee_attendance (
  id          uuid primary key default gen_random_uuid(),
  institute_id uuid not null references institutes(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  date        date not null,
  status      attendance_status not null,
  check_in    time,
  check_out   time,
  marked_by   uuid references users(id),
  created_at  timestamptz not null default now(),
  unique (employee_id, date)
);
create index if not exists idx_employee_attendance_date on employee_attendance(date);

drop trigger if exists trg_set_institute_id on employee_attendance;
create trigger trg_set_institute_id before insert on employee_attendance
  for each row execute function set_institute_id();

alter table employee_attendance enable row level security;

create policy institute_isolation on employee_attendance as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

create policy "HR admin manages employee attendance" on employee_attendance for all
  using (can_approve()) with check (can_approve());

-- ----------------------------------------------------------------------------
-- Performance
-- ----------------------------------------------------------------------------
create table if not exists performance_reviews (
  id                    uuid primary key default gen_random_uuid(),
  institute_id          uuid not null references institutes(id) on delete cascade,
  employee_id           uuid not null references employees(id) on delete cascade,
  review_period         text not null,
  reviewer_id           uuid references users(id),
  rating                numeric(3, 1),
  strengths             text,
  areas_for_improvement text,
  goals                 text,
  status                text not null default 'draft' check (status in ('draft', 'finalized')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_performance_reviews_employee on performance_reviews(employee_id, created_at desc);

drop trigger if exists trg_set_institute_id on performance_reviews;
create trigger trg_set_institute_id before insert on performance_reviews
  for each row execute function set_institute_id();

alter table performance_reviews enable row level security;

create policy institute_isolation on performance_reviews as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

create policy "HR admin manages performance reviews" on performance_reviews for all
  using (can_approve()) with check (can_approve());

-- ----------------------------------------------------------------------------
-- Training — a shared catalog (a workshop several employees attend)
-- rather than one row per employee per training, so "who attended the
-- fire-safety session" is a real query, not duplicated title/date text.
-- ----------------------------------------------------------------------------
create table if not exists trainings (
  id            uuid primary key default gen_random_uuid(),
  institute_id  uuid not null references institutes(id) on delete cascade,
  title         text not null,
  provider      text,
  training_date date,
  duration_hours numeric(5, 1),
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_trainings_institute on trainings(institute_id, training_date desc);

drop trigger if exists trg_set_institute_id on trainings;
create trigger trg_set_institute_id before insert on trainings
  for each row execute function set_institute_id();

alter table trainings enable row level security;

create policy institute_isolation on trainings as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

create policy "HR admin manages trainings" on trainings for all using (can_approve()) with check (can_approve());

create table if not exists training_participants (
  id                 uuid primary key default gen_random_uuid(),
  institute_id       uuid not null references institutes(id) on delete cascade,
  training_id        uuid not null references trainings(id) on delete cascade,
  employee_id        uuid not null references employees(id) on delete cascade,
  completion_status  text not null default 'enrolled' check (completion_status in ('enrolled', 'completed', 'no_show')),
  certificate_url    text,
  created_at         timestamptz not null default now(),
  unique (training_id, employee_id)
);
create index if not exists idx_training_participants_employee on training_participants(employee_id);

drop trigger if exists trg_set_institute_id on training_participants;
create trigger trg_set_institute_id before insert on training_participants
  for each row execute function set_institute_id();

alter table training_participants enable row level security;

create policy institute_isolation on training_participants as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

create policy "HR admin manages training participants" on training_participants for all
  using (can_approve()) with check (can_approve());

-- ----------------------------------------------------------------------------
-- Exit / offboarding — one function, so "mark an employee exited" always
-- keeps employees.status, the linked teachers.status (if any), and the
-- exit record itself consistent, rather than three separate writes a
-- caller could do in the wrong order or only partially. Salary/payroll
-- history for a former teacher is never touched — see the header.
-- ----------------------------------------------------------------------------
create table if not exists employee_exits (
  id                    uuid primary key default gen_random_uuid(),
  institute_id          uuid not null references institutes(id) on delete cascade,
  employee_id           uuid not null unique references employees(id) on delete cascade,
  exit_type             text not null check (exit_type in ('resignation', 'termination', 'end_of_contract', 'retirement', 'other')),
  notice_date           date,
  last_working_date     date not null,
  reason                text,
  exit_interview_notes  text,
  clearance_status      text not null default 'pending' check (clearance_status in ('pending', 'cleared')),
  initiated_by          uuid references users(id),
  created_at            timestamptz not null default now()
);

drop trigger if exists trg_set_institute_id on employee_exits;
create trigger trg_set_institute_id before insert on employee_exits
  for each row execute function set_institute_id();

alter table employee_exits enable row level security;

create policy institute_isolation on employee_exits as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

create policy "HR admin manages exits" on employee_exits for all using (can_approve()) with check (can_approve());

create or replace function offboard_employee(p_employee_id uuid, p_exit_type text, p_last_working_date date, p_reason text, p_notice_date date default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_by uuid;
  v_teacher_id uuid;
  v_id uuid;
begin
  if not can_approve() then
    raise exception 'NOT_AUTHORIZED: Only Super Admin/Principal can offboard an employee.';
  end if;
  if p_exit_type not in ('resignation', 'termination', 'end_of_contract', 'retirement', 'other') then
    raise exception 'INVALID_TYPE: % is not recognized.', p_exit_type;
  end if;

  select id into v_by from users where auth_user_id = auth.uid();
  select teacher_id into v_teacher_id from employees where id = p_employee_id;
  if v_teacher_id is null and not exists (select 1 from employees where id = p_employee_id) then
    raise exception 'NOT_FOUND: Employee not found.';
  end if;

  insert into employee_exits (institute_id, employee_id, exit_type, notice_date, last_working_date, reason, initiated_by)
    values (current_institute_id(), p_employee_id, p_exit_type, p_notice_date, p_last_working_date, p_reason, v_by)
  on conflict (employee_id) do update
    set exit_type = excluded.exit_type, notice_date = excluded.notice_date, last_working_date = excluded.last_working_date,
        reason = excluded.reason, initiated_by = excluded.initiated_by
  returning id into v_id;

  update employees set status = 'exited', updated_at = now() where id = p_employee_id;
  -- Salary HISTORY (salary_records/salary_payments) is never touched —
  -- only whether the teacher counts as currently active, same as any
  -- other status flip in this app.
  if v_teacher_id is not null then
    update teachers set status = 'inactive', updated_at = now() where id = v_teacher_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function offboard_employee(uuid, text, date, text, date) from public;
grant execute on function offboard_employee(uuid, text, date, text, date) to authenticated;
