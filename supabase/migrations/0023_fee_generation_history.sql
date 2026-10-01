-- ============================================================================
-- 28. FEE GENERATION HISTORY
-- ============================================================================
-- generate_monthly_fee_records() (0021_bulk_fee_generation.sql) already does
-- the real work — this migration adds the one thing a real academy actually
-- needs afterward: a permanent record of what happened, not just a toast
-- message on GenerateFeesButton.js that's gone the moment someone navigates
-- away. "Did anyone already run August's billing? When? Did anything fail?"
-- are real questions an accountant asks weeks later, not just right after
-- clicking the button.
--
-- Also closes a real gap the old version had: get_or_create_fee_record()
-- can raise (a bad fee_structures row, an unexpected constraint violation,
-- anything) — and since generate_monthly_fee_records() called it directly
-- in a loop with no exception handling, ONE bad student aborted the ENTIRE
-- run, silently discarding every fee_records row already generated for
-- students processed before the failure (the whole function's writes roll
-- back together, since PL/pgSQL doesn't commit per statement). With 500
-- students, one bad row could mean zero bills generated and no indication
-- why. Each student's generation now runs in its own subtransaction — one
-- failure is caught, counted, and the run continues.

create table fee_generation_runs (
  id               uuid primary key default gen_random_uuid(),
  month            date not null,
  started_at       timestamptz not null default now(),
  completed_at     timestamptz,
  total_students   int not null default 0,
  generated_count  int not null default 0,
  skipped_count    int not null default 0,
  failed_count     int not null default 0,
  expected_amount  numeric(12,2) not null default 0,
  generated_by     uuid references users(id),
  status           text not null default 'running' check (status in ('running', 'completed', 'failed')),
  error_detail     text
);

create index idx_fee_generation_runs_month on fee_generation_runs(month);

alter table fee_generation_runs enable row level security;

-- Same viewing audience as Fee Records/Reports (can_view_fees(): Super
-- Admin, Principal, Accountant, Cashier) — a run's summary isn't more
-- sensitive than the bills it produced. No insert/update/delete policy for
-- anyone: the only writer is generate_monthly_fee_records() below, which
-- is SECURITY DEFINER and so writes regardless of RLS — a direct
-- insert/update from the app or an API call is never legitimate here.
create policy "read: fee staff and principal" on fee_generation_runs for select using (can_view_fees());

-- CREATE OR REPLACE can't change a function's return-table shape (adding
-- run_id and failed_count here) — must drop the old signature first.
drop function if exists generate_monthly_fee_records(date);

create or replace function generate_monthly_fee_records(p_month date)
returns table(run_id uuid, generated_count int, skipped_count int, failed_count int, total_expected numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role       text;
  v_month      date := date_trunc('month', p_month)::date;
  v_student    record;
  v_generated  int := 0;
  v_skipped    int := 0;
  v_failed     int := 0;
  v_existed    boolean;
  v_run_id     uuid;
  v_by         uuid;
  v_total      int;
begin
  select current_role_name() into v_role;
  if v_role is null or v_role not in ('Super Admin', 'Accountant', 'Cashier') then
    raise exception 'Not authorized to generate fee records.';
  end if;

  select id into v_by from users where auth_user_id = auth.uid();
  select count(*) into v_total from students where status = 'active';

  insert into fee_generation_runs (month, total_students, generated_by, status)
    values (v_month, v_total, v_by, 'running')
    returning id into v_run_id;

  for v_student in select id from students where status = 'active' loop
    select exists(select 1 from fee_records where student_id = v_student.id and month = v_month) into v_existed;

    -- Each student generates in its own subtransaction: a failure here
    -- (raised by get_or_create_fee_record itself, or anything underneath
    -- it) is caught and counted, not left to silently roll back every
    -- other student already generated earlier in this same loop.
    begin
      perform get_or_create_fee_record(v_student.id, v_month);
      if v_existed then
        v_skipped := v_skipped + 1;
      else
        v_generated := v_generated + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  update fee_generation_runs set
    completed_at = now(),
    generated_count = v_generated,
    skipped_count = v_skipped,
    failed_count = v_failed,
    expected_amount = coalesce((select sum(total_payable) from fee_records where month = v_month), 0),
    status = case when v_failed > 0 and v_generated = 0 then 'failed' else 'completed' end
  where id = v_run_id;

  return query
    select v_run_id, v_generated, v_skipped, v_failed,
      coalesce((select sum(total_payable) from fee_records where month = v_month), 0);
end;
$$;

revoke execute on function generate_monthly_fee_records(date) from public;
grant execute on function generate_monthly_fee_records(date) to authenticated;
