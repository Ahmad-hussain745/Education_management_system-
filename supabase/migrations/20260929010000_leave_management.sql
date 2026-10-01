-- ============================================================================
-- LEAVE MANAGEMENT
--
--   Leave request  →  Supervisor  →  Approve / reject  →  Attendance  →  Payroll
--
-- 20260928010000 (HR) built the workflow's back half: an approved request
-- writes attendance rows, which payroll's existing absent-day deduction
-- (0049) then reads. But only HR admins could apply or decide. This
-- migration adds the front half, for teachers AND staff:
--
--   * employees can apply for their own leave (apply_for_leave, extended)
--   * every employee has a supervisor (employees.supervisor_id); a request
--     is routed to that supervisor at application time, and the supervisor
--     — or an HR admin (Super Admin/Principal) as override — decides it
--   * nobody can decide their own request
--   * leave types carry a quota: paid days beyond the annual quota become
--     UNPAID days, automatically, at approval time — this is what ties
--     leave to the salary deduction rule, not just paid/unpaid types
--   * a payroll impact preview (preview_leave_impact) shows, BEFORE anyone
--     applies or approves, how many days will be paid vs. unpaid and what
--     the deduction will be under payroll's own rule
--
-- PAYROLL IS NOT MODIFIED. The integration works by writing the right
-- attendance status and letting 0049's rule do the deducting:
--     paid day    -> teacher_attendance 'leave'   -> never deducted
--     unpaid day  -> teacher_attendance 'absent'  -> deducted at
--                    fixed_salary / days-in-month per day (fixed/hybrid
--                    teachers only)
-- _leave_impact() below MIRRORS that rule to produce its estimate; it is a
-- preview, and the amount payroll actually deducts always comes from
-- payroll's own draft. Two states it warns about explicitly, because both
-- are silent failures otherwise:
--     - month already LOCKED: payroll skips locked months entirely, so the
--       unpaid days would not be deducted at all
--     - a draft already EXISTS: payroll only re-reads attendance when the
--       draft is refreshed
--
-- Non-teaching staff have no payroll record in this app (payroll only
-- processes teachers), so for them leave still routes, approves and writes
-- attendance, and the preview says plainly that no deduction applies.
-- ============================================================================

alter table employees add column if not exists supervisor_id uuid references employees(id) on delete set null;
alter table employees drop constraint if exists employees_supervisor_not_self;
alter table employees add constraint employees_supervisor_not_self check (supervisor_id is null or supervisor_id <> id);

alter table leave_requests add column if not exists supervisor_id uuid references employees(id) on delete set null;
alter table leave_requests add column if not exists applied_by uuid references users(id);
alter table leave_requests add column if not exists days_paid int;
alter table leave_requests add column if not exists days_unpaid int;
alter table leave_requests add column if not exists payroll_note text;
alter table leave_requests add column if not exists decided_as text;
alter table leave_requests drop constraint if exists leave_requests_decided_as_check;
alter table leave_requests add constraint leave_requests_decided_as_check check (decided_as in ('supervisor', 'hr_admin', 'employee'));
create index if not exists idx_leave_requests_supervisor on leave_requests(supervisor_id, status);

-- Requests logged by the HR migration predate the paid/unpaid split.
update leave_requests lr
  set days_paid = case when coalesce(lt.is_paid, true) then lr.days_count else 0 end,
      days_unpaid = case when coalesce(lt.is_paid, true) then 0 else lr.days_count end
  from leave_types lt
  where lt.id = lr.leave_type_id and lr.days_paid is null;
update leave_requests set days_paid = days_count, days_unpaid = 0 where days_paid is null;

-- ----------------------------------------------------------------------------
-- Who is the signed-in person, as an employee? Via their own login
-- (employees.user_id) or, for a teacher whose employee row is linked only
-- through teachers, via that link. Exited employees resolve to null.
-- Must be executable by `authenticated`: it's used inside RLS policies,
-- which run as the invoker.
-- ----------------------------------------------------------------------------
create or replace function current_employee_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select e.id from employees e
  where e.institute_id = current_institute_id()
    and e.status <> 'exited'
    and (
      e.user_id = (select u.id from users u where u.auth_user_id = auth.uid())
      or (current_teacher_id() is not null and e.teacher_id = current_teacher_id())
    )
  limit 1;
$$;
revoke execute on function current_employee_id() from public;
grant execute on function current_employee_id() to authenticated;

create policy "employee reads own leave requests" on leave_requests for select
  using (employee_id = current_employee_id());
create policy "supervisor reads reports' leave requests" on leave_requests for select
  using (supervisor_id is not null and supervisor_id = current_employee_id());

-- ----------------------------------------------------------------------------
-- Internal helpers (not callable by clients).
-- ----------------------------------------------------------------------------

-- Working days in a range. Sundays are excluded — the same assumption the
-- HR migration made for attendance (no per-institute working-week setting
-- exists), so a request's day count and the attendance rows written for it
-- always agree.
create or replace function _leave_working_days(p_from date, p_to date)
returns int
language sql immutable as $$
  select count(*)::int
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
  where extract(dow from g) <> 0;
$$;
revoke execute on function _leave_working_days(date, date) from public, authenticated;

-- How many of p_days are PAID, given the leave type and what the employee
-- has already used this year. Unpaid type -> 0. Paid type with no quota ->
-- all. Paid type with a quota -> whatever quota remains; the rest is
-- unpaid. Only APPROVED requests consume quota (a pending request must
-- not block, or shrink, the quota for another).
create or replace function _leave_paid_days(p_employee_id uuid, p_leave_type_id uuid, p_year int, p_days int)
returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_is_paid boolean;
  v_quota int;
  v_used int;
begin
  if p_leave_type_id is null then return p_days; end if;
  select is_paid, annual_quota into v_is_paid, v_quota from leave_types where id = p_leave_type_id;
  if v_is_paid is null then return p_days; end if;
  if not v_is_paid then return 0; end if;
  if v_quota is null then return p_days; end if;

  select coalesce(sum(days_paid), 0) into v_used from leave_requests
    where employee_id = p_employee_id and leave_type_id = p_leave_type_id and status = 'approved'
      and extract(year from date_from)::int = p_year;
  return least(p_days, greatest(v_quota - v_used, 0));
end;
$$;
revoke execute on function _leave_paid_days(uuid, uuid, int, int) from public, authenticated;

create or replace function _can_view_employee_leave(p_employee_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select can_approve()
    or p_employee_id = current_employee_id()
    or exists (
      select 1 from employees e
      where e.id = p_employee_id and e.institute_id = current_institute_id()
        and e.supervisor_id is not null and e.supervisor_id = current_employee_id()
    );
$$;
revoke execute on function _can_view_employee_leave(uuid) from public, authenticated;

-- The payroll consequence of a leave request, as jsonb:
--   { working_days, paid_days, unpaid_days, payroll_applicable, note,
--     months: [{ month, unpaid_days, day_rate, estimated_deduction, payroll_state }] }
-- The unpaid days are the LAST unpaid_days working days of the range (the
-- quota covers the earliest days first), grouped by calendar month because
-- payroll deducts per month at that month's own day rate. The rate mirrors
-- 0049 exactly: round(fixed_salary / days_in_month, 2) per day, fixed or
-- hybrid teachers only.
create or replace function _leave_impact(p_employee_id uuid, p_leave_type_id uuid, p_date_from date, p_date_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_days int;
  v_paid int;
  v_unpaid int;
  v_teacher_id uuid;
  v_t teachers%rowtype;
  v_applicable boolean := false;
  v_note text;
  v_months jsonb := '[]'::jsonb;
begin
  v_days := _leave_working_days(p_date_from, p_date_to);
  v_paid := _leave_paid_days(p_employee_id, p_leave_type_id, extract(year from p_date_from)::int, v_days);
  v_unpaid := v_days - v_paid;

  select teacher_id into v_teacher_id from employees where id = p_employee_id;
  if v_teacher_id is null then
    v_note := 'This employee is not on payroll (payroll only processes teaching staff), so no salary deduction applies.';
  else
    select * into v_t from teachers where id = v_teacher_id;
    if v_t.salary_mode not in ('fixed', 'hybrid') or coalesce(v_t.fixed_salary, 0) <= 0 then
      v_note := 'This teacher''s pay has no fixed base to prorate, so unpaid days are not deducted.';
    else
      v_applicable := true;
    end if;
  end if;

  if v_applicable and v_unpaid > 0 then
    v_months := (
      with plan as (
        select g::date as d, row_number() over (order by g) as rn
        from generate_series(p_date_from::timestamp, p_date_to::timestamp, interval '1 day') g
        where extract(dow from g) <> 0
      ),
      grouped as (
        select date_trunc('month', d)::date as m, count(*)::int as n from plan where rn > v_paid group by 1
      ),
      rated as (
        select m, n, round(v_t.fixed_salary / extract(day from (m + interval '1 month' - interval '1 day'))::int, 2) as rate from grouped
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'month', m, 'unpaid_days', n, 'day_rate', rate, 'estimated_deduction', round(rate * n, 2),
        'payroll_state', coalesce(
          (select case when sr.locked then 'locked' else 'draft' end from salary_records sr where sr.teacher_id = v_teacher_id and sr.month = rated.m limit 1),
          'not_generated')
      ) order by m), '[]'::jsonb)
      from rated
    );
  end if;

  return jsonb_build_object(
    'working_days', v_days, 'paid_days', v_paid, 'unpaid_days', v_unpaid,
    'payroll_applicable', v_applicable, 'note', v_note, 'months', v_months
  );
end;
$$;
revoke execute on function _leave_impact(uuid, uuid, date, date) from public, authenticated;

-- ----------------------------------------------------------------------------
-- Client-facing functions.
-- ----------------------------------------------------------------------------

create or replace function preview_leave_impact(p_employee_id uuid, p_leave_type_id uuid, p_date_from date, p_date_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not _can_view_employee_leave(p_employee_id) then
    raise exception 'NOT_AUTHORIZED: Not authorized to view this employee''s leave.';
  end if;
  if p_date_to < p_date_from then
    raise exception 'INVALID_RANGE: End date must be on or after the start date.';
  end if;
  return _leave_impact(p_employee_id, p_leave_type_id, p_date_from, p_date_to);
end;
$$;
revoke execute on function preview_leave_impact(uuid, uuid, date, date) from public;
grant execute on function preview_leave_impact(uuid, uuid, date, date) to authenticated;

-- Replaces the HR migration's HR-admin-only version (same signature).
-- Anyone may apply for THEMSELVES; an HR admin may log one for anybody.
-- The supervisor is snapshotted onto the request now, so re-parenting an
-- employee later doesn't silently re-route requests already in flight.
create or replace function apply_for_leave(p_employee_id uuid, p_leave_type_id uuid, p_date_from date, p_date_to date, p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_emp employees%rowtype;
  v_user uuid;
  v_days int;
  v_id uuid;
begin
  select * into v_emp from employees where id = p_employee_id and institute_id = current_institute_id();
  if v_emp.id is null then raise exception 'NOT_FOUND: Employee not found.'; end if;
  if v_emp.status = 'exited' then raise exception 'EXITED: This employee has left; leave can''t be requested.'; end if;
  if not (can_approve() or p_employee_id = current_employee_id()) then
    raise exception 'NOT_AUTHORIZED: You can only apply for your own leave.';
  end if;
  if p_leave_type_id is not null and not exists (select 1 from leave_types where id = p_leave_type_id and institute_id = current_institute_id()) then
    raise exception 'INVALID_TYPE: Unknown leave type.';
  end if;
  if p_date_to < p_date_from then
    raise exception 'INVALID_RANGE: End date must be on or after the start date.';
  end if;

  v_days := _leave_working_days(p_date_from, p_date_to);
  if v_days < 1 then
    raise exception 'NO_WORKING_DAYS: That range has no working days (Sundays are excluded).';
  end if;

  if exists (
    select 1 from leave_requests
    where employee_id = p_employee_id and status in ('pending', 'approved')
      and date_from <= p_date_to and date_to >= p_date_from
  ) then
    raise exception 'OVERLAP: This employee already has a pending or approved leave request overlapping those dates.';
  end if;

  select id into v_user from users where auth_user_id = auth.uid();

  insert into leave_requests (institute_id, employee_id, leave_type_id, date_from, date_to, days_count, reason, supervisor_id, applied_by)
    values (current_institute_id(), p_employee_id, p_leave_type_id, p_date_from, p_date_to, v_days, nullif(trim(p_reason), ''), v_emp.supervisor_id, v_user)
    returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function apply_for_leave(uuid, uuid, date, date, text) from public;
grant execute on function apply_for_leave(uuid, uuid, date, date, text) to authenticated;

-- Replaces the HR migration's version (same signature). Who may decide:
-- the request's supervisor, or an HR admin as override (also the only
-- route when the employee has no supervisor, or the supervisor has left).
-- Nobody decides their own request.
create or replace function decide_leave_request(p_id uuid, p_status text, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := current_employee_id();
  v_by uuid;
  v_req leave_requests%rowtype;
  v_is_hr boolean := can_approve();
  v_is_supervisor boolean;
  v_teacher_id uuid;
  v_days int;
  v_paid int;
  v_unpaid int;
  v_impact jsonb;
  v_note text;
  v_att attendance_status;
  v_i int := 0;
  d date;
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'INVALID_STATUS: % is not a valid decision.', p_status;
  end if;

  select * into v_req from leave_requests
    where id = p_id and status = 'pending' and institute_id = current_institute_id() for update;
  if v_req.id is null then raise exception 'NOT_FOUND: Request not found, or already decided.'; end if;

  v_is_supervisor := v_req.supervisor_id is not null and v_req.supervisor_id = v_me;
  if not (v_is_hr or v_is_supervisor) then
    raise exception 'NOT_AUTHORIZED: Only this employee''s supervisor or HR can decide this request.';
  end if;
  if v_me is not null and v_req.employee_id = v_me then
    raise exception 'SELF_APPROVAL: You can''t decide your own leave request — it needs someone else.';
  end if;

  select id into v_by from users where auth_user_id = auth.uid();

  if p_status = 'rejected' then
    update leave_requests
      set status = 'rejected', decided_by = v_by, decided_at = now(), decision_note = nullif(trim(p_note), ''),
          decided_as = case when v_is_supervisor then 'supervisor' else 'hr_admin' end
      where id = p_id;
    return;
  end if;

  -- Approve. Recount working days from the dates themselves (self-heals
  -- requests logged before days were counted this way), split the days
  -- into paid/unpaid against the quota, and capture the payroll impact
  -- BEFORE this request's status changes.
  v_days := _leave_working_days(v_req.date_from, v_req.date_to);
  v_paid := _leave_paid_days(v_req.employee_id, v_req.leave_type_id, extract(year from v_req.date_from)::int, v_days);
  v_unpaid := v_days - v_paid;
  v_impact := _leave_impact(v_req.employee_id, v_req.leave_type_id, v_req.date_from, v_req.date_to);

  if v_unpaid > 0 then
    if (v_impact->>'payroll_applicable')::boolean then
      select string_agg(
        case m->>'payroll_state'
          when 'locked' then 'Payroll for ' || to_char((m->>'month')::date, 'Mon YYYY') || ' is already locked: the ' || (m->>'unpaid_days') || ' unpaid day(s) will NOT be deducted automatically — record an adjustment if intended.'
          when 'draft' then 'A payroll draft for ' || to_char((m->>'month')::date, 'Mon YYYY') || ' exists: refresh it to deduct ' || (m->>'unpaid_days') || ' unpaid day(s) (est. Rs. ' || (m->>'estimated_deduction') || ').'
          else (m->>'unpaid_days') || ' unpaid day(s) will be deducted when payroll for ' || to_char((m->>'month')::date, 'Mon YYYY') || ' is generated (est. Rs. ' || (m->>'estimated_deduction') || ').'
        end, ' ')
      into v_note
      from jsonb_array_elements(v_impact->'months') m;
    else
      v_note := v_impact->>'note';
    end if;
  end if;

  update leave_requests
    set status = 'approved', decided_by = v_by, decided_at = now(), decision_note = nullif(trim(p_note), ''),
        decided_as = case when v_is_supervisor then 'supervisor' else 'hr_admin' end,
        days_count = v_days, days_paid = v_paid, days_unpaid = v_unpaid, payroll_note = v_note
    where id = p_id;

  -- Attendance: the first v_paid working days are 'leave', the rest
  -- 'absent'. An existing 'absent' mark is overwritten (leave approved
  -- after the fact is the common case); present/late/leave marks never are.
  select teacher_id into v_teacher_id from employees where id = v_req.employee_id;

  for d in
    select g::date from generate_series(v_req.date_from::timestamp, v_req.date_to::timestamp, interval '1 day') g
    where extract(dow from g) <> 0 order by g
  loop
    v_i := v_i + 1;
    v_att := (case when v_i <= v_paid then 'leave' else 'absent' end)::attendance_status;
    if v_teacher_id is not null then
      insert into teacher_attendance (teacher_id, date, status, marked_by)
        values (v_teacher_id, d, v_att, v_by)
        on conflict (teacher_id, date) do update set status = excluded.status, marked_by = excluded.marked_by
        where teacher_attendance.status = 'absent';
    else
      insert into employee_attendance (institute_id, employee_id, date, status, marked_by)
        values (v_req.institute_id, v_req.employee_id, d, v_att, v_by)
        on conflict (employee_id, date) do update set status = excluded.status, marked_by = excluded.marked_by
        where employee_attendance.status = 'absent';
    end if;
  end loop;
end;
$$;
revoke execute on function decide_leave_request(uuid, text, text) from public;
grant execute on function decide_leave_request(uuid, text, text) to authenticated;

-- Withdrawing a request before anyone has decided it. (Reversing an
-- APPROVED request would mean unwinding attendance already written, and
-- possibly a payroll draft — deliberately not offered; that's an HR
-- correction, not a self-service button.)
create or replace function cancel_leave_request(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req leave_requests%rowtype;
  v_by uuid;
begin
  select * into v_req from leave_requests where id = p_id and status = 'pending' and institute_id = current_institute_id() for update;
  if v_req.id is null then raise exception 'NOT_FOUND: Request not found, or already decided.'; end if;
  if not (can_approve() or v_req.employee_id = current_employee_id()) then
    raise exception 'NOT_AUTHORIZED: You can only cancel your own request.';
  end if;

  select id into v_by from users where auth_user_id = auth.uid();
  update leave_requests set status = 'cancelled', decided_by = v_by, decided_at = now(), decided_as = 'employee' where id = p_id;
end;
$$;
revoke execute on function cancel_leave_request(uuid) from public;
grant execute on function cancel_leave_request(uuid) to authenticated;

-- Per-type balance for one employee and year. used = paid days from
-- APPROVED requests (what actually consumed quota); remaining is null
-- when there's no quota to run out of (unpaid type, or no quota set).
create or replace function get_leave_balances(p_employee_id uuid, p_year int default null)
returns table(leave_type_id uuid, leave_type_name text, is_paid boolean, annual_quota int, days_taken int, paid_days_used int, pending_days int, remaining int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_year int := coalesce(p_year, extract(year from current_date)::int);
begin
  if not _can_view_employee_leave(p_employee_id) then
    raise exception 'NOT_AUTHORIZED: Not authorized to view this employee''s leave balance.';
  end if;

  return query
  select lt.id, lt.name, lt.is_paid, lt.annual_quota,
    coalesce(sum(lr.days_count) filter (where lr.status = 'approved'), 0)::int,
    coalesce(sum(lr.days_paid) filter (where lr.status = 'approved'), 0)::int,
    coalesce(sum(lr.days_count) filter (where lr.status = 'pending'), 0)::int,
    case when lt.is_paid and lt.annual_quota is not null
      then greatest(lt.annual_quota - coalesce(sum(lr.days_paid) filter (where lr.status = 'approved'), 0), 0)::int
      else null end
  from leave_types lt
  left join leave_requests lr on lr.leave_type_id = lt.id and lr.employee_id = p_employee_id
    and extract(year from lr.date_from)::int = v_year
  where lt.institute_id = current_institute_id()
  group by lt.id, lt.name, lt.is_paid, lt.annual_quota
  order by lt.name;
end;
$$;
revoke execute on function get_leave_balances(uuid, int) from public;
grant execute on function get_leave_balances(uuid, int) to authenticated;

-- The signed-in person as an employee, for the self-service page.
create or replace function get_my_leave_context()
returns table(employee_id uuid, employee_name text, supervisor_name text, is_supervisor boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, s.name,
    exists (select 1 from employees r where r.supervisor_id = e.id and r.status <> 'exited')
  from employees e
  left join employees s on s.id = e.supervisor_id
  where e.id = current_employee_id();
$$;
revoke execute on function get_my_leave_context() from public;
grant execute on function get_my_leave_context() to authenticated;

-- A supervisor's inbox: their reports' requests, pending first, with the
-- payroll impact attached to the ones still awaiting a decision. Returns
-- named columns only — a supervisor is not thereby granted read access to
-- their reports' employee records (national ID, address, reviews...).
create or replace function get_leave_inbox()
returns table(
  id uuid, employee_id uuid, employee_name text, leave_type_name text, is_paid boolean,
  date_from date, date_to date, days_count int, days_paid int, days_unpaid int,
  reason text, status text, decision_note text, payroll_note text, impact jsonb
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := current_employee_id();
begin
  if v_me is null then return; end if;
  return query
  select lr.id, lr.employee_id, e.name, lt.name, lt.is_paid,
    lr.date_from, lr.date_to, lr.days_count, lr.days_paid, lr.days_unpaid,
    lr.reason, lr.status, lr.decision_note, lr.payroll_note,
    case when lr.status = 'pending' then _leave_impact(lr.employee_id, lr.leave_type_id, lr.date_from, lr.date_to) else null end
  from leave_requests lr
  join employees e on e.id = lr.employee_id
  left join leave_types lt on lt.id = lr.leave_type_id
  where lr.supervisor_id = v_me and lr.institute_id = current_institute_id()
  order by (lr.status = 'pending') desc, lr.date_from desc
  limit 100;
end;
$$;
revoke execute on function get_leave_inbox() from public;
grant execute on function get_leave_inbox() to authenticated;
