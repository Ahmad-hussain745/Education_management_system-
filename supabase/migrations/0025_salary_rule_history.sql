-- ============================================================================
-- 30. SALARY RULE HISTORY — percentage changes stop overwriting the past
--
-- salary_rules has always been mutated in place: both createSalaryRule()
-- (app/(app)/salary/config/actions.js) and assign_teacher_class_with_salary()
-- (0018_atomic_teacher_assignment.sql) do a plain
--   update salary_rules set percentage = <new value> ...
-- The moment that runs, the OLD percentage is gone. generate_salary_records()
-- (0001_init.sql, re-secured in 0014) reads salary_rules.percentage directly
-- with no notion of "as of which month" — so generating (or regenerating) an
-- unlocked PAST month after a rate change silently applies TODAY's rate to
-- THAT month's already-collected fees. A teacher's August share could
-- retroactively change just because their September rate was set in
-- between. Locked months are already safe (generate_salary_records skips
-- them, and 0011's immutable-ledger trigger blocks editing salary_items
-- directly) — this fixes the same problem for anything not yet locked.
--
-- Fix, in three parts:
--   1. salary_rule_history — an append-only ledger of every percentage this
--      rule has ever had and the date range it applied to.
--   2. Two triggers on salary_rules (not on the two separate app-layer
--      write paths) so history logging is enforced once, centrally,
--      regardless of which of those two paths — or any future one — does
--      the write.
--   3. generate_salary_records() now looks up the percentage that was
--      actually in effect during p_month from salary_rule_history, instead
--      of trusting salary_rules.percentage's current value.
--
-- Existing rows: this migration backfills one history row per existing
-- salary_rules row, dated from that row's `effective_from` (added below,
-- defaulting to today since the true original start date was never
-- recorded before now). That's an honest limit, not a bug this migration
-- can fix — a percentage change that already happened before this
-- migration ran has no recoverable history; only changes from this point
-- forward are protected.
-- ============================================================================

alter table salary_rules add column if not exists effective_from date not null default current_date;

create table salary_rule_history (
  id              uuid primary key default gen_random_uuid(),
  salary_rule_id  uuid not null references salary_rules(id) on delete cascade,
  -- Denormalized rather than joined back to salary_rules for every read:
  -- a historical record should stay readable/reportable even if the
  -- salary_rules row it came from is later deactivated, and payroll
  -- generation (below) needs to filter by teacher/class/section directly
  -- without caring what salary_rules looks like today.
  teacher_id      uuid not null references teachers(id) on delete cascade,
  class_id        uuid not null references classes(id) on delete cascade,
  section_id      uuid references sections(id) on delete cascade,
  percentage      numeric(5,2) not null check (percentage >= 0 and percentage <= 100),
  effective_from  date not null,
  effective_to    date,  -- null = this is the currently-open segment
  changed_by      uuid references users(id),
  changed_at      timestamptz not null default now(),
  constraint chk_salary_rule_history_dates check (effective_to is null or effective_to >= effective_from)
);
create index idx_salary_rule_history_lookup on salary_rule_history(teacher_id, class_id, section_id, effective_from);

alter table salary_rule_history enable row level security;

-- Same viewers as salary_rules itself (0002_rls.sql) — finance staff/
-- Principal see everyone's, a Teacher sees only their own rate history.
create policy "view: finance staff any, teacher own only" on salary_rule_history
  for select
  using (can_view_finance() or teacher_id = current_teacher_id());

-- No insert/update/delete policy — rows are only ever written by the two
-- triggers below (table-owner-privileged, same shape as
-- get_or_create_fee_record's SECURITY DEFINER write to fee_records). A
-- history row is a record of what happened, not something any role edits
-- directly, including Super Admin.

-- ----------------------------------------------------------------------------
-- New rule created (a brand new teacher/class/section/percentage
-- assignment) — log its opening segment.
-- ----------------------------------------------------------------------------
create or replace function log_salary_rule_creation() returns trigger as $$
begin
  insert into salary_rule_history (salary_rule_id, teacher_id, class_id, section_id, percentage, effective_from, changed_by)
    values (new.id, new.teacher_id, new.class_id, new.section_id, new.percentage, new.effective_from, current_users_id());
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_log_salary_rule_creation
  after insert on salary_rules
  for each row execute function log_salary_rule_creation();

-- ----------------------------------------------------------------------------
-- Existing rule's percentage changes — close the previously-open segment
-- and open a new one, instead of silently overwriting.
--
-- Guards, both there specifically because "historical payroll remains
-- correct" is the actual point of this feature, not just bookkeeping:
--   - EFFECTIVE_DATE_MUST_ADVANCE: the new segment can't start before the
--     current one did — that would rewrite when the CURRENT rate began,
--     which is itself a piece of history.
--   - LOCKED_PAYROLL_CONFLICT: if a payroll month at or after the new
--     effective date is already locked for this teacher, refuse — the new
--     rate would apply to a month whose payslip is already approved and
--     handed out. Same "reverse an approved thing, don't silently rewrite
--     it" stance as 0011_immutable_ledger.sql, just applied to a rate
--     instead of a ledger row.
-- ----------------------------------------------------------------------------
create or replace function enforce_salary_rule_percentage_change() returns trigger as $$
declare
  v_locked_conflict boolean;
begin
  if new.percentage is distinct from old.percentage then
    if new.effective_from is null then
      new.effective_from := current_date;
    end if;

    if new.effective_from < old.effective_from then
      raise exception 'EFFECTIVE_DATE_MUST_ADVANCE: The new effective date (%) can''t be earlier than this rule''s current effective date (%).', new.effective_from, old.effective_from;
    end if;

    select exists(
      select 1 from salary_records
      where teacher_id = old.teacher_id
        and locked
        and month >= date_trunc('month', new.effective_from)::date
    ) into v_locked_conflict;
    if v_locked_conflict then
      raise exception 'LOCKED_PAYROLL_CONFLICT: A payroll month on or after % is already locked for this teacher — starting the new rate there would change an already-approved payslip. Choose a later effective date instead.', new.effective_from;
    end if;

    update salary_rule_history
      set effective_to = new.effective_from - 1
      where salary_rule_id = old.id and effective_to is null;

    insert into salary_rule_history (salary_rule_id, teacher_id, class_id, section_id, percentage, effective_from, changed_by)
      values (new.id, new.teacher_id, new.class_id, new.section_id, new.percentage, new.effective_from, current_users_id());
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_enforce_salary_rule_percentage_change
  before update on salary_rules
  for each row execute function enforce_salary_rule_percentage_change();

-- ----------------------------------------------------------------------------
-- Backfill: one opening history row per existing salary_rules row, dated
-- from its (just-added) effective_from. See the migration header comment
-- above for the honest limit here — this can't recover rate changes that
-- already happened before today.
-- ----------------------------------------------------------------------------
insert into salary_rule_history (salary_rule_id, teacher_id, class_id, section_id, percentage, effective_from)
  select id, teacher_id, class_id, section_id, percentage, effective_from from salary_rules
  where not exists (select 1 from salary_rule_history where salary_rule_id = salary_rules.id);

-- ----------------------------------------------------------------------------
-- generate_salary_records() — same body as 0014, except the percentage
-- used for each rule is now looked up from salary_rule_history AS OF
-- p_month instead of read live off salary_rules.percentage.
-- ----------------------------------------------------------------------------
create or replace function generate_salary_records(p_month date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role     text;
  t          record;
  r          record;
  rec_id     uuid;
  pct_total  numeric(12,2);
  base_amt   numeric(12,2);
  collected  numeric(12,2);
  share      numeric(12,2);
  fee_per    numeric(12,2);
  scount     int;
  v_pct      numeric(5,2);
  v_month_end date;
begin
  select current_role_name() into v_role;
  if v_role is null or v_role not in ('Super Admin', 'Accountant') then
    raise exception 'Only Super Admin or Accountant can generate payroll.';
  end if;

  v_month_end := (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date;

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
        -- The historically-correct rate for THIS month, not whatever
        -- salary_rules.percentage says right now — the whole point of this
        -- migration. Picks the history segment covering p_month: started
        -- on/before the month ends, and either still open or didn't end
        -- before the month started.
        select percentage into v_pct
          from salary_rule_history
          where salary_rule_id = r.id
            and effective_from <= v_month_end
            and (effective_to is null or effective_to >= p_month)
          order by effective_from desc
          limit 1;
        -- Safety net only — every row should have at least its creation
        -- history entry (backfilled above / logged going forward).
        if v_pct is null then
          v_pct := r.percentage;
        end if;

        select count(*) into scount from students
          where class_id = r.class_id and (r.section_id is null or section_id = r.section_id) and status = 'active';
        select monthly_fee into fee_per from fee_structures where class_id = r.class_id and student_id is null;
        collected := class_collected_amount(r.class_id, r.section_id, p_month);
        share     := round(collected * (v_pct / 100), 2);
        pct_total := pct_total + share;

        insert into salary_items (salary_record_id, item_type, class_id, section_id, students_count, fee_per_student, expected_amount, collected_amount, percentage, amount, note)
          values (rec_id, 'percentage_share', r.class_id, r.section_id, scount, fee_per, coalesce(scount,0) * coalesce(fee_per,0), collected, v_pct, share,
                  'Auto-generated ' || to_char(p_month, 'Mon YYYY'));
      end loop;
    end if;

    update salary_records set percentage_total = pct_total where id = rec_id;
  end loop;
end;
$$;

revoke execute on function generate_salary_records(date) from public;
grant execute on function generate_salary_records(date) to authenticated;
