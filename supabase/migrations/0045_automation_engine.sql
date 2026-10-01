-- ============================================================================
-- 45. AUTOMATION SUBSYSTEM
--
-- Until now each automated task was a standalone Vercel cron route with no
-- record that it ran. If monthly fee generation silently failed for one
-- institute at 4am, nobody would know until a parent asked why they never
-- got a bill. These three tables make automation observable:
--
--   automation_jobs   — the registry: what jobs exist, their schedule,
--                       whether they're enabled. Global (not per-institute):
--                       a job is a piece of code, and the runner fans it
--                       out across institutes itself.
--   automation_runs   — one row per job per institute per execution, with
--                       counts and duration. This is the "did it run, and
--                       what did it do" record.
--   automation_errors — failures, separated from runs so a run row always
--                       exists even when the thing blew up, and so errors
--                       can be listed without scanning every successful run.
--
-- Also fixes generate_salary_records() (0014_secure_payroll_generation.sql),
-- which has the same two defects previously found and fixed in fee
-- generation (0037) and fee reminders (0038):
--   1. It loops `teachers where status = 'active'` with NO institute
--      filter, so one institute's accountant generating payroll would
--      generate it for EVERY institute's teachers.
--   2. It requires current_role_name() to be Super Admin/Accountant, which
--      needs a signed-in session — so a cron job could never call it.
-- Both are fixed the same way as before: keep the interactive entry point
-- exactly as-is for the UI, add a service-role-only variant that takes the
-- institute explicitly.
-- ============================================================================

create table if not exists automation_jobs (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,      -- 'fee-generation', 'inventory-alerts', ...
  name        text not null,
  description text,
  schedule    text not null,             -- cron expression, documentation for humans
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists automation_runs (
  id            uuid primary key default gen_random_uuid(),
  job_key       text not null references automation_jobs(key) on update cascade,
  institute_id  uuid references institutes(id) on delete cascade,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running' check (status in ('running', 'success', 'failed', 'skipped')),
  items_processed int not null default 0,
  summary       jsonb,                   -- job-specific counts, e.g. {"generated": 40, "skipped": 2}
  duration_ms   int
);
create index if not exists idx_automation_runs_job on automation_runs(job_key, started_at desc);
create index if not exists idx_automation_runs_institute on automation_runs(institute_id, started_at desc);

create table if not exists automation_errors (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid references automation_runs(id) on delete cascade,
  job_key      text not null,
  institute_id uuid references institutes(id) on delete cascade,
  message      text not null,
  detail       jsonb,
  occurred_at  timestamptz not null default now()
);
create index if not exists idx_automation_errors_job on automation_errors(job_key, occurred_at desc);

alter table automation_jobs enable row level security;
alter table automation_runs enable row level security;
alter table automation_errors enable row level security;

-- Read-only for signed-in admins so the app can show a status page.
-- Writes happen only through the service-role client in the cron runner,
-- which bypasses RLS — there is deliberately no insert/update policy for
-- authenticated users: automation history isn't something a user edits.
create policy "signed-in can read jobs" on automation_jobs
  for select using (auth.uid() is not null);

create policy "read own institute runs" on automation_runs
  for select using (institute_id = current_institute_id() or institute_id is null);

create policy "read own institute errors" on automation_errors
  for select using (institute_id = current_institute_id() or institute_id is null);

insert into automation_jobs (key, name, description, schedule) values
  ('fee-generation',   'Monthly Fee Generation', 'Creates each active student''s fee record for the new month.', '0 4 1 * *'),
  ('fee-reminders',    'Fee Reminder Scheduling', 'Queues reminder/overdue notices on the 10th, 20th and 25th.', '0 3 * * *'),
  ('reconciliation',   'Ledger Reconciliation',   'Checks fee_records.paid_total against fee_payments and flags drift.', '0 2 * * *'),
  ('inventory-alerts', 'Low Stock Alerts',        'Flags items at or below their reorder level.', '0 6 * * 1'),
  ('payroll',          'Monthly Payroll Drafting','Drafts (never pays) each active teacher''s salary record.', '0 5 1 * *'),
  ('backups',          'Backup Verification',     'Verifies row counts and recent write activity; does not itself take a backup.', '0 1 * * *')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Payroll: institute-scoped worker + cron-only entry point
-- ---------------------------------------------------------------------------
create or replace function generate_salary_records_for_institute(p_institute_id uuid, p_month date)
returns int
language plpgsql security definer set search_path = public
as $$
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
  v_count    int := 0;
begin
  -- Body mirrors generate_salary_records() (0014) exactly, with two
  -- changes: the teacher loop is scoped by institute_id, and the
  -- students/fee_structures lookups inside it are too — without that, a
  -- percentage-share teacher's salary would be computed from every
  -- institute's student counts.
  for t in select * from teachers where status = 'active' and institute_id = p_institute_id loop

    if exists (select 1 from salary_records where teacher_id = t.id and month = p_month and locked) then
      continue;
    end if;

    pct_total := 0;
    base_amt  := case when t.salary_mode in ('fixed', 'hybrid') then t.fixed_salary else 0 end;

    insert into salary_records (teacher_id, month, base_salary, percentage_total, institute_id)
      values (t.id, p_month, base_amt, 0, p_institute_id)
      on conflict (teacher_id, month) do update set base_salary = excluded.base_salary
      returning id into rec_id;

    delete from salary_items where salary_record_id = rec_id and item_type = 'percentage_share';

    if t.salary_mode in ('percentage', 'hybrid') then
      for r in select * from salary_rules where teacher_id = t.id and active and institute_id = p_institute_id loop
        select count(*) into scount from students
          where class_id = r.class_id and (r.section_id is null or section_id = r.section_id)
            and status = 'active' and institute_id = p_institute_id;
        select monthly_fee into fee_per from fee_structures
          where class_id = r.class_id and student_id is null and institute_id = p_institute_id;
        collected := class_collected_amount(r.class_id, r.section_id, p_month);
        share     := round(collected * (r.percentage / 100), 2);
        pct_total := pct_total + share;

        insert into salary_items (salary_record_id, item_type, class_id, section_id, students_count, fee_per_student, expected_amount, collected_amount, percentage, amount, note, institute_id)
          values (rec_id, 'percentage_share', r.class_id, r.section_id, scount, fee_per, coalesce(scount,0) * coalesce(fee_per,0), collected, r.percentage, share,
                  'Auto-generated ' || to_char(p_month, 'Mon YYYY'), p_institute_id);
      end loop;
    end if;

    update salary_records set percentage_total = pct_total where id = rec_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function run_payroll_generation_for_institute(p_institute_id uuid, p_month date)
returns int
language plpgsql security definer set search_path = public
as $$
begin
  return generate_salary_records_for_institute(p_institute_id, p_month);
end;
$$;

revoke execute on function generate_salary_records_for_institute(uuid, date) from public, authenticated;
revoke execute on function run_payroll_generation_for_institute(uuid, date) from public, authenticated;
grant execute on function run_payroll_generation_for_institute(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- Reconciliation: read-only integrity check. Reports drift, never "fixes"
-- it — an automated job silently rewriting financial figures is exactly
-- the kind of thing that turns a small bug into an unexplainable ledger.
-- ---------------------------------------------------------------------------
create or replace function reconcile_fee_totals(p_institute_id uuid)
returns table(fee_record_id uuid, student_id uuid, stored_paid numeric, actual_paid numeric, drift numeric)
language sql stable security definer set search_path = public
as $$
  select fr.id, fr.student_id, fr.paid_total,
         coalesce((select sum(p.amount) from fee_payments p where p.fee_record_id = fr.id), 0),
         fr.paid_total - coalesce((select sum(p.amount) from fee_payments p where p.fee_record_id = fr.id), 0)
  from fee_records fr
  where fr.institute_id = p_institute_id
    and fr.paid_total <> coalesce((select sum(p.amount) from fee_payments p where p.fee_record_id = fr.id), 0);
$$;

revoke execute on function reconcile_fee_totals(uuid) from public;
grant execute on function reconcile_fee_totals(uuid) to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- Low stock: items at or below reorder_level (null = not tracked).
-- ---------------------------------------------------------------------------
create or replace function low_stock_items(p_institute_id uuid)
returns table(item_id uuid, item_name text, unit text, remaining numeric, reorder_level numeric)
language sql stable security definer set search_path = public
as $$
  select i.id, i.name, i.unit, get_item_stock(i.id, current_date), i.reorder_level
  from inventory_items i
  where i.active
    and i.institute_id = p_institute_id
    and i.reorder_level is not null
    and get_item_stock(i.id, current_date) <= i.reorder_level;
$$;

revoke execute on function low_stock_items(uuid) from public;
grant execute on function low_stock_items(uuid) to service_role, authenticated;
