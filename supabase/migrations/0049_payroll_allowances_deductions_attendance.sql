-- ============================================================================
-- 49. PAYROLL: ALLOWANCES, DEDUCTIONS, ATTENDANCE
--
-- Phase 18. The draft pipeline was Fee Collection → Salary Rules → Payroll
-- Draft — Teacher Attendance (a table that's existed since 0001) and any
-- standing allowance/deduction never fed into the number at all. This adds
-- both, and along the way fixes something that was actively wrong: the
-- interactive generate_salary_records() (0025) and the cron-safe
-- generate_salary_records_for_institute() (0045) were two independently
-- maintained copies of the same ~60-line calculation, and they'd already
-- drifted — 0045's cron path never picked up 0025's point-in-time
-- salary_rule_history lookup, so an automatic 1st-of-the-month draft could
-- silently use today's percentage instead of the rate that actually applied
-- during the month being drafted. Both entry points now delegate to one
-- internal function, _draft_payroll_for_institute() — new logic (or a new
-- fix) only ever needs writing once, and the two can no longer drift apart.
--
-- Nothing here changes the approval gate: _draft_payroll_for_institute()
-- only ever writes salary_records/salary_items, the same two tables
-- Generate already wrote to. Locking (Approve & Lock) and paying
-- (Record Payment) remain separate, human-only actions untouched by this
-- migration — a bigger, more accurate draft is still only ever a draft.
-- ============================================================================

-- 'base' + 'percentage_share' already covered "how a teacher earns pay
-- from teaching"; 'adjustment' already covered "a human corrected a
-- locked record after the fact". Neither fits "a standing Rs. 3,000
-- transport allowance" or "an attendance-based deduction the system
-- itself calculated" — those need their own types so a salary slip can
-- honestly label what each line is, not lump everything under the
-- post-lock-correction type.
alter type salary_item_type add value if not exists 'allowance';
alter type salary_item_type add value if not exists 'deduction';

-- The standing config — mirrors salary_rules' role for percentage shares.
-- A teacher can have several (Transport + House Rent; an ongoing advance
-- recovery), each independently toggled off rather than deleted, so
-- payroll history for months it WAS applied stays intact (matches how
-- salary_rules.active already works).
create table if not exists salary_recurring_items (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references teachers(id) on delete cascade,
  item_type   salary_item_type not null check (item_type in ('allowance', 'deduction')),
  label       text not null,
  amount      numeric(12,2) not null check (amount > 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_salary_recurring_items_teacher on salary_recurring_items(teacher_id);

-- Same tenant-scoping boilerplate 0035_multi_tenancy.sql applied to every
-- table that existed at the time — this table didn't, so it needs its own
-- copy: institute_id, the auto-fill trigger, and the RESTRICTIVE isolation
-- policy underneath the permissive ones below.
alter table salary_recurring_items add column if not exists institute_id uuid references institutes(id) on delete cascade;
create index if not exists idx_salary_recurring_items_institute on salary_recurring_items(institute_id);
drop trigger if exists trg_set_institute_id on salary_recurring_items;
create trigger trg_set_institute_id before insert on salary_recurring_items
  for each row execute function set_institute_id();

alter table salary_recurring_items enable row level security;
drop policy if exists institute_isolation on salary_recurring_items;
create policy institute_isolation on salary_recurring_items as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

-- Same shape as salary_rules' own two policies (0002_rls.sql).
create policy "finance staff manage salary recurring items" on salary_recurring_items for all
  using (is_finance_staff()) with check (is_finance_staff());
create policy "teacher and principal view salary recurring items" on salary_recurring_items for select
  using (can_view_finance() or teacher_id = current_teacher_id());

-- Housekeeping found on the way past: student_code_counters (0043) is only
-- ever touched by create_student(), a security-definer function — it never
-- needed a permissive policy — but it was never explicitly locked down
-- either, meaning it relied entirely on absence-of-grants rather than a
-- real deny-by-default. Enabling RLS with no policies here is what
-- actually closes that off; security-definer functions still bypass RLS
-- as their own owner regardless, so create_student() is unaffected.
alter table student_code_counters enable row level security;

-- ----------------------------------------------------------------------------
-- salary_records: two new running totals, and gross_salary's formula grows
-- to include them. A generated column's expression can't be ALTERed in
-- place — drop and recreate it, same net effect, existing stored values
-- are recomputed from the row's own other columns automatically.
--
-- v_salary_slip (0001_init.sql) reads gross_salary, which blocks the DROP
-- COLUMN below outright (found running this migration against a fresh
-- database while building Phase 33's test suite — it had never actually
-- been applied end-to-end before that). Drop and recreate the view around
-- the column swap; recreated with the same shape plus the two new totals,
-- since a salary slip that includes allowances/deductions in gross_salary
-- but doesn't show them as their own lines would be more confusing after
-- this migration than before it.
-- ----------------------------------------------------------------------------
drop view if exists v_salary_slip;

alter table salary_records add column if not exists allowances_total numeric(12,2) not null default 0;
alter table salary_records add column if not exists deductions_total numeric(12,2) not null default 0;

alter table salary_records drop column if exists gross_salary;
alter table salary_records add column gross_salary numeric(12,2)
  generated always as (base_salary + percentage_total + allowances_total - deductions_total + adjustments_total) stored;

create or replace view v_salary_slip as
  select sr.id, t.name as teacher_name, sr.month, sr.base_salary, sr.percentage_total,
         sr.allowances_total, sr.deductions_total, sr.adjustments_total,
         sr.gross_salary, sr.paid_total, sr.status, sr.locked
    from salary_records sr
    join teachers t on t.id = sr.teacher_id;

-- ----------------------------------------------------------------------------
-- The one shared calculation. p_use_history exists only because the OLD
-- 0014-era cron path didn't have salary_rule_history to look up yet at the
-- time — always true from both of today's real entry points below; kept
-- as a parameter rather than hardcoded so a future test/backfill script
-- can ask for the live-rate behavior explicitly instead of duplicating
-- this whole function to get it.
-- ----------------------------------------------------------------------------
create or replace function _draft_payroll_for_institute(p_institute_id uuid, p_month date, p_use_history boolean default true)
returns int
language plpgsql security definer set search_path = public as $$
declare
  t               record;
  r               record;
  ri              record;
  rec_id          uuid;
  pct_total       numeric(12,2);
  base_amt        numeric(12,2);
  collected       numeric(12,2);
  share           numeric(12,2);
  fee_per         numeric(12,2);
  scount          int;
  v_pct           numeric(5,2);
  v_month_end     date;
  v_days_in_month int;
  v_absent_days   int;
  v_day_rate      numeric(12,2);
  v_deduction     numeric(12,2);
  v_allow_total   numeric(12,2);
  v_deduct_total  numeric(12,2);
  v_count         int := 0;
begin
  v_month_end     := (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date;
  v_days_in_month := extract(day from v_month_end)::int;

  for t in select * from teachers where status = 'active' and institute_id = p_institute_id loop

    -- Don't touch an already-approved month — same rule every version of
    -- this function has always had.
    if exists (select 1 from salary_records where teacher_id = t.id and month = p_month and locked) then
      continue;
    end if;

    pct_total := 0;
    base_amt  := case when t.salary_mode in ('fixed', 'hybrid') then t.fixed_salary else 0 end;

    insert into salary_records (teacher_id, month, base_salary, percentage_total, institute_id)
      values (t.id, p_month, base_amt, 0, p_institute_id)
      on conflict (teacher_id, month) do update set base_salary = excluded.base_salary
      returning id into rec_id;

    -- Re-running (Generate/Refresh, or a re-triggered cron tick) must be
    -- idempotent: clear every auto-computed line before recomputing.
    -- 'adjustment' is deliberately excluded — those are post-lock manual
    -- corrections, untouched by a draft re-run.
    delete from salary_items where salary_record_id = rec_id and item_type in ('percentage_share', 'allowance', 'deduction');

    -- Percentage share — unchanged from 0025, now shared by both entry
    -- points instead of only the interactive one.
    if t.salary_mode in ('percentage', 'hybrid') then
      for r in select * from salary_rules where teacher_id = t.id and active and institute_id = p_institute_id loop
        v_pct := r.percentage;
        if p_use_history then
          select percentage into v_pct
            from salary_rule_history
            where salary_rule_id = r.id
              and effective_from <= v_month_end
              and (effective_to is null or effective_to >= p_month)
            order by effective_from desc
            limit 1;
          if v_pct is null then
            v_pct := r.percentage;
          end if;
        end if;

        select count(*) into scount from students
          where class_id = r.class_id and (r.section_id is null or section_id = r.section_id)
            and status = 'active' and institute_id = p_institute_id;
        select monthly_fee into fee_per from fee_structures
          where class_id = r.class_id and student_id is null and institute_id = p_institute_id;
        collected := class_collected_amount(r.class_id, r.section_id, p_month);
        share     := round(collected * (v_pct / 100), 2);
        pct_total := pct_total + share;

        insert into salary_items (salary_record_id, item_type, class_id, section_id, students_count, fee_per_student, expected_amount, collected_amount, percentage, amount, note, institute_id)
          values (rec_id, 'percentage_share', r.class_id, r.section_id, scount, fee_per, coalesce(scount, 0) * coalesce(fee_per, 0), collected, v_pct, share,
                  'Auto-generated ' || to_char(p_month, 'Mon YYYY'), p_institute_id);
      end loop;
    end if;

    -- Standing allowances/deductions (salary_recurring_items, above).
    v_allow_total  := 0;
    v_deduct_total := 0;
    for ri in select * from salary_recurring_items where teacher_id = t.id and active and institute_id = p_institute_id loop
      if ri.item_type = 'allowance' then
        v_allow_total := v_allow_total + ri.amount;
      else
        v_deduct_total := v_deduct_total + ri.amount;
      end if;
      insert into salary_items (salary_record_id, item_type, amount, note, institute_id)
        values (rec_id, ri.item_type, ri.amount, ri.label, p_institute_id);
    end loop;

    -- Attendance-based deduction. Policy, spelled out because it's a
    -- choice, not a fact: only 'absent' days count (late is a lesser HR
    -- matter, leave is presumed pre-approved — neither reduces pay here),
    -- charged at fixed_salary / days-in-month per absent day, and only for
    -- fixed/hybrid teachers — a percentage-only teacher's pay already IS
    -- what they actually taught/collected, with no base figure to prorate
    -- against. A teacher with zero recorded attendance that month (not yet
    -- marked, or a month with no school days) gets no deduction — silence
    -- in the data is never read as "was absent every day."
    if t.salary_mode in ('fixed', 'hybrid') and t.fixed_salary > 0 then
      select count(*) into v_absent_days from teacher_attendance
        where teacher_id = t.id and status = 'absent'
          and date >= date_trunc('month', p_month)::date and date <= v_month_end
          and institute_id = p_institute_id;

      if v_absent_days > 0 then
        v_day_rate  := round(t.fixed_salary / v_days_in_month, 2);
        v_deduction := round(v_day_rate * v_absent_days, 2);
        v_deduct_total := v_deduct_total + v_deduction;
        insert into salary_items (salary_record_id, item_type, amount, note, institute_id)
          values (rec_id, 'deduction', v_deduction,
                  v_absent_days || ' absent day(s) in ' || to_char(p_month, 'Mon YYYY') || ' @ Rs. ' || v_day_rate || '/day',
                  p_institute_id);
      end if;
    end if;

    update salary_records
      set percentage_total = pct_total, allowances_total = v_allow_total, deductions_total = v_deduct_total
      where id = rec_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function _draft_payroll_for_institute(uuid, date, boolean) from public, authenticated;

-- Interactive entry point — same role check as before, now just resolves
-- the caller's own institute and delegates.
create or replace function generate_salary_records(p_month date)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role      text;
  v_institute uuid;
begin
  select current_role_name() into v_role;
  if v_role is null or v_role not in ('Super Admin', 'Accountant') then
    raise exception 'Only Super Admin or Accountant can generate payroll.';
  end if;

  v_institute := current_institute_id();
  perform _draft_payroll_for_institute(v_institute, p_month, true);
end;
$$;

revoke execute on function generate_salary_records(date) from public;
grant execute on function generate_salary_records(date) to authenticated;

-- Cron-safe entry point — same signature as 0045, now delegates instead of
-- carrying its own copy of the calculation.
create or replace function generate_salary_records_for_institute(p_institute_id uuid, p_month date)
returns int
language plpgsql security definer set search_path = public as $$
begin
  return _draft_payroll_for_institute(p_institute_id, p_month, true);
end;
$$;

revoke execute on function generate_salary_records_for_institute(uuid, date) from public, authenticated;
