-- ============================================================================
-- PRIORITY 5 — FINISH TRUE SCALABLE PAGINATION
--
-- Four fixed-limit pages found by reading the actual current code:
--   - Fee Reports:      .limit(2000) on fee_records, grouped by month/class in JS
--   - Salary Reports:   .limit(500) on salary_records, grouped by month/teacher in JS
--   - Financial Reports: summary sums re-derived from a capped 500-row
--     transactions pull (now uses get_month_financial_summary, Priority 4);
--     Payment Method Breakdown pulled EVERY fee_payments row for the month
--     with no limit at all just to bucket into 4 totals; the Transaction
--     Ledger table showed the same capped 500 rows with no real pagination.
--   - Audit Log:        .limit(200), no search, no date filter, no sort control
-- Plus one flagged "large one-shot read": Ask MSA's students_unpaid_months
-- pulled up to 5,000 arrears rows via fee_arrears_accounts just to filter
-- by months-overdue and sort in JS.
--
-- Two different fixes for two different shapes of problem:
--   - A REPORT (Fee/Salary Reports, the method breakdown) is inherently a
--     small result once aggregated — 12 months, N classes/teachers, 4
--     payment methods. These get a GROUP BY aggregate RPC, not pagination;
--     there is no "page 2" of 12 months worth showing.
--   - A LIST of individual rows that grows without bound (Audit Log, the
--     Transaction Ledger, Ask MSA's per-student arrears answer) gets real
--     server-side pagination — search_students()/list_students()/
--     list_transactions()'s existing shape (0029_scalable_listings.sql),
--     not a new pattern.
-- list_transactions() already exists and needs no change here — Financial
-- Reports' ledger just needs to actually call it instead of the capped
-- inline query.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- FEE REPORTS
-- ----------------------------------------------------------------------------
create or replace function get_fee_collection_by_month(p_institute_id uuid, p_months int default 12)
returns table(month date, expected numeric, collected numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_institute_access(p_institute_id);
  return query
  select fr.month, sum(fr.total_payable), sum(fr.paid_total)
  from fee_records fr
  where fr.institute_id = p_institute_id
  group by fr.month
  order by fr.month desc
  limit greatest(1, least(coalesce(p_months, 12), 60));
end;
$$;

create or replace function get_fee_collection_by_class(p_institute_id uuid)
returns table(class_name text, expected numeric, collected numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_institute_access(p_institute_id);
  return query
  select coalesce(c.name, 'Unassigned'), sum(fr.total_payable), sum(fr.paid_total)
  from fee_records fr
  join students s on s.id = fr.student_id
  left join classes c on c.id = s.class_id
  where fr.institute_id = p_institute_id
  group by c.name
  order by sum(fr.total_payable) desc;
end;
$$;

-- ----------------------------------------------------------------------------
-- SALARY REPORTS
--
-- IMPORTANT: unlike the other report RPCs in this migration,
-- assert_institute_access() alone is NOT enough here. The plain query this
-- replaces was subject to salary_records' own RLS ("teacher and principal
-- view salary rules", 0002_rls.sql: can_view_finance() OR teacher_id =
-- current_teacher_id()) — a Teacher could only ever see their OWN rows.
-- Being SECURITY DEFINER, these functions bypass that RLS entirely, so
-- they re-implement the same restriction explicitly: finance staff/
-- Principal see the whole institute, a Teacher only ever sees themselves,
-- for both the month breakdown AND the by-teacher breakdown (which, for a
-- Teacher, correctly collapses to their own single row rather than
-- showing every colleague's salary).
-- ----------------------------------------------------------------------------
create or replace function get_salary_by_month(p_institute_id uuid, p_months int default 12)
returns table(month date, gross numeric, paid numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_institute_access(p_institute_id);
  return query
  select sr.month, sum(sr.gross_salary), sum(sr.paid_total)
  from salary_records sr
  where sr.institute_id = p_institute_id
    and (can_view_finance() or sr.teacher_id = current_teacher_id())
  group by sr.month
  order by sr.month desc
  limit greatest(1, least(coalesce(p_months, 12), 60));
end;
$$;

create or replace function get_salary_by_teacher(p_institute_id uuid)
returns table(teacher_name text, months bigint, gross numeric, paid numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_institute_access(p_institute_id);
  return query
  select coalesce(t.name, 'Unknown'), count(*), sum(sr.gross_salary), sum(sr.paid_total)
  from salary_records sr
  join teachers t on t.id = sr.teacher_id
  where sr.institute_id = p_institute_id
    and (can_view_finance() or sr.teacher_id = current_teacher_id())
  group by t.name
  order by sum(sr.gross_salary) desc;
end;
$$;

-- ----------------------------------------------------------------------------
-- FINANCIAL REPORTS — payment method breakdown. Was: pull every
-- fee_payments row for the month with no limit at all, just to bucket into
-- 4 totals in JS. The Cash/Bank Transfer/Online/Cheque bucketing stays
-- identical to the existing app code (Easypaisa/JazzCash/Card -> Online),
-- just computed with a CASE inside the GROUP BY instead of a JS
-- lookup table.
-- ----------------------------------------------------------------------------
create or replace function get_payment_method_breakdown(p_institute_id uuid, p_start_date date, p_end_date date)
returns table(method_bucket text, total numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_institute_access(p_institute_id);
  return query
  select
    case fp.method
      when 'Easypaisa' then 'Online'
      when 'JazzCash' then 'Online'
      when 'Card' then 'Online'
      else fp.method::text
    end,
    sum(fp.amount)
  from fee_payments fp
  where fp.institute_id = p_institute_id and fp.paid_on >= p_start_date and fp.paid_on < p_end_date
  group by 1;
end;
$$;

-- ----------------------------------------------------------------------------
-- AUDIT LOG — replaces .limit(200) with real search + date filter + sort +
-- pagination, same shape as list_students/list_transactions
-- (0029_scalable_listings.sql). Search matches action, table_name, or the
-- acting user's name/email — covers "show me everything Ahmad did" and
-- "show me every payroll lock" from the same one box.
-- ----------------------------------------------------------------------------
create or replace function list_audit_logs(
  p_search text default null,
  p_start_date date default null,
  p_end_date date default null,
  p_sort text default 'date_desc',
  p_page int default 1,
  p_page_size int default 50
)
returns table (
  id uuid, action text, table_name text, record_id uuid, old_value jsonb, new_value jsonb,
  created_at timestamptz, user_name text, user_email text, total_count bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_offset int := greatest(0, coalesce(p_page, 1) - 1) * greatest(1, least(coalesce(p_page_size, 50), 200));
  v_limit  int := greatest(1, least(coalesce(p_page_size, 50), 200));
  v_inst   uuid := current_institute_id();
begin
  if current_role_name() <> 'Super Admin' then
    raise exception 'NOT_AUTHORIZED: Only Super Admin can view the audit log.';
  end if;

  return query
  with filtered as (
    select al.*, u.name as u_name, u.email as u_email
    from audit_logs al
    left join users u on u.id = al.user_id
    where al.institute_id = v_inst
      and (p_start_date is null or al.created_at >= p_start_date)
      and (p_end_date is null or al.created_at < p_end_date)
      and (
        p_search is null or p_search = ''
        or al.action ilike '%' || p_search || '%'
        or al.table_name ilike '%' || p_search || '%'
        or u.name ilike '%' || p_search || '%'
        or u.email ilike '%' || p_search || '%'
      )
  ),
  counted as (
    select *, count(*) over() as total_count from filtered
  )
  select id, action, table_name, record_id, old_value, new_value, created_at, u_name, u_email, total_count
  from counted
  order by
    case when p_sort = 'date_asc' then created_at end asc nulls last,
    created_at desc
  limit v_limit offset v_offset;
end;
$$;

revoke execute on function get_fee_collection_by_month(uuid, int) from public;
revoke execute on function get_fee_collection_by_class(uuid) from public;
revoke execute on function get_salary_by_month(uuid, int) from public;
revoke execute on function get_salary_by_teacher(uuid) from public;
revoke execute on function get_payment_method_breakdown(uuid, date, date) from public;
revoke execute on function list_audit_logs(text, date, date, text, int, int) from public;
grant execute on function get_fee_collection_by_month(uuid, int) to authenticated;
grant execute on function get_fee_collection_by_class(uuid) to authenticated;
grant execute on function get_salary_by_month(uuid, int) to authenticated;
grant execute on function get_salary_by_teacher(uuid) to authenticated;
grant execute on function get_payment_method_breakdown(uuid, date, date) to authenticated;
grant execute on function list_audit_logs(text, date, date, text, int, int) to authenticated;

-- ----------------------------------------------------------------------------
-- ASK MSA — students_unpaid_months pulled up to 5,000 rows via
-- fee_arrears_accounts (paginated for the Reports screen, but "all of
-- them, once" for this one-shot answer) just to filter by months-overdue
-- and sort in JS. This does the filter/sort/limit in SQL instead, and
-- returns a real total count alongside the (small) list actually shown.
-- ----------------------------------------------------------------------------
create or replace function get_students_with_unpaid_months(p_min_months int, p_limit int default 10)
returns table(student_name text, class_name text, months_count int, total_arrears numeric, total_count bigint)
language plpgsql stable set search_path = public as $$
begin
  return query
  with filtered as (
    select * from fee_arrears_filtered(null, null, null, null, null, 0)
    where months_count >= p_min_months
  ),
  counted as (
    select *, count(*) over() as total_count from filtered
  )
  select student_name, class_name, months_count, total_arrears, total_count
  from counted
  order by months_count desc, total_arrears desc
  limit greatest(1, least(coalesce(p_limit, 10), 100));
end;
$$;

revoke execute on function get_students_with_unpaid_months(int, int) from public;
grant execute on function get_students_with_unpaid_months(int, int) to authenticated;
