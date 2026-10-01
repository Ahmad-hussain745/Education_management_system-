-- ============================================================================
-- 32. SCALABLE LISTINGS — server-side pagination, search, filtering, sorting
--
-- Several pages fetched a large, fixed-size slice of a table (.limit(200) /
-- 500 / 1000 / 2000 / 3000) and did the real work — grouping, filtering,
-- summing — in JavaScript afterward. That's fine at the row counts a new
-- academy has. It stops being fine well before "5,000+ students": a fixed
-- limit either silently truncates the data (a report that quietly stops
-- being complete) or, if raised, ships steadily more rows to the browser on
-- every page load regardless of how many the person actually wants to see.
--
-- This migration moves the filtering, grouping, sorting, and page slicing
-- for the highest-traffic list/report pages into SQL, so the database does
-- what it's good at (index lookups, aggregation) and only the current
-- page's worth of rows ever crosses the wire:
--   search_students()       — typeahead source for any "pick a student"
--                              picker; replaces loading every student into
--                              a <select> (see components/StudentPicker.js)
--   list_students()          — Students page: search + class/section/status
--                              filter + sort + page, with each row's
--                              effective monthly fee resolved only for the
--                              ~50 rows actually being shown
--   list_transactions() /
--   transactions_totals()    — Transactions page: paginated rows and a
--                              separately-computed total-in/total-out that
--                              reflects the whole filtered month, not just
--                              whatever page is currently on screen
--   fee_arrears_filtered() / — Fee Arrears report: the same per-student
--   fee_arrears_accounts() /   arrears aggregation the old JS grouping did,
--   fee_arrears_summary()      now in SQL — accounts() paginates the list,
--                              summary() computes the five summary-card
--                              numbers over the FULL filtered set
--                              independent of which page is showing
--
-- Every list/count function below is a plain SQL or STABLE plpgsql function
-- with no SECURITY DEFINER — they run with the calling user's own
-- privileges, so existing RLS policies on students/fee_records/transactions
-- apply exactly as if the caller queried those tables directly. Pagination
-- is a presentation concern, not a new authorization boundary.
-- ============================================================================

-- Search by name gets meaningfully slower as a straight ILIKE '%term%' scan
-- once the table is in the thousands of rows, because a leading wildcard
-- can't use a plain btree index. A trigram index fixes that.
create extension if not exists pg_trgm;
create index if not exists idx_students_name_trgm on students using gin (name gin_trgm_ops);
create index if not exists idx_students_code_trgm on students using gin (student_code gin_trgm_ops);
create index if not exists idx_students_guardian_name_trgm on students using gin (guardian_name gin_trgm_ops);
-- The arrears aggregation below groups fee_records by student for every
-- non-paid row — this composite index is what makes that a fast index-only
-- scan instead of a sequential scan over the whole table as it grows.
create index if not exists idx_fee_records_student_status on fee_records(student_id, status);

-- ----------------------------------------------------------------------------
-- 1. Typeahead student search — small, fast, capped. This is what
--    components/StudentPicker.js calls on every keystroke (debounced); it
--    replaces every page that used to do
--    `supabase.from("students").select("id, name").order("name")` to fill
--    a <select> with every student in the school.
-- ----------------------------------------------------------------------------
create or replace function search_students(p_query text, p_limit int default 10)
returns table (id uuid, name text, student_code text, class_name text)
language sql stable set search_path = public as $$
  select s.id, s.name, s.student_code, c.name as class_name
  from students s
  left join classes c on c.id = s.class_id
  where p_query is not null and length(trim(p_query)) > 0
    and (s.name ilike '%'||p_query||'%' or s.student_code ilike '%'||p_query||'%')
  order by s.name
  limit greatest(1, least(coalesce(p_limit, 10), 25));
$$;

revoke execute on function search_students(text, int) from public;
grant execute on function search_students(text, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Students list — search + filter + sort + page, in one round trip.
--    p_sort is validated against a fixed whitelist inline (the CASE/ORDER BY
--    below) rather than built as a dynamic string, so there's no SQL
--    injection surface from it.
-- ----------------------------------------------------------------------------
create or replace function list_students(
  p_search text default null,
  p_class_id uuid default null,
  p_section_id uuid default null,
  p_status text default null,
  p_sort text default 'name_asc',
  p_page int default 1,
  p_page_size int default 50
)
returns table (
  id uuid, student_code text, name text, guardian_name text, guardian_phone text,
  class_id uuid, section_id uuid, status person_status,
  class_name text, section_name text, monthly_fee numeric, total_count bigint
)
language plpgsql stable set search_path = public as $$
declare
  v_offset int := greatest(0, coalesce(p_page, 1) - 1) * greatest(1, least(coalesce(p_page_size, 50), 200));
  v_limit  int := greatest(1, least(coalesce(p_page_size, 50), 200));
begin
  return query
  with filtered as (
    select s.*, c.name as class_name, sec.name as section_name
    from students s
    left join classes c on c.id = s.class_id
    left join sections sec on sec.id = s.section_id
    where (p_search is null or length(trim(p_search)) = 0 or
           s.name ilike '%'||p_search||'%' or
           s.student_code ilike '%'||p_search||'%' or
           s.guardian_name ilike '%'||p_search||'%' or
           s.guardian_phone ilike '%'||p_search||'%')
      and (p_class_id is null or s.class_id = p_class_id)
      and (p_section_id is null or s.section_id = p_section_id)
      and (p_status is null or p_status = '' or s.status::text = p_status)
  ),
  counted as (
    select *, count(*) over() as total_count from filtered
  )
  select
    f.id, f.student_code, f.name, f.guardian_name, f.guardian_phone,
    f.class_id, f.section_id, f.status, f.class_name, f.section_name,
    -- Bounded to this one page (≤200 rows), never the whole table — the
    -- reason this used to load every fee_structures row into JS instead.
    resolve_monthly_fee(f.id, f.class_id, current_date) as monthly_fee,
    f.total_count
  from counted f
  order by
    case when p_sort = 'name_asc' then f.name end asc nulls last,
    case when p_sort = 'name_desc' then f.name end desc nulls last,
    case when p_sort = 'student_code_asc' then f.student_code end asc nulls last,
    case when p_sort = 'student_code_desc' then f.student_code end desc nulls last,
    case when p_sort = 'class_asc' then f.class_name end asc nulls last,
    case when p_sort = 'class_desc' then f.class_name end desc nulls last,
    case when p_sort = 'status_asc' then f.status::text end asc nulls last,
    case when p_sort = 'status_desc' then f.status::text end desc nulls last,
    f.name asc
  limit v_limit offset v_offset;
end;
$$;

revoke execute on function list_students(text, uuid, uuid, text, text, int, int) from public;
grant execute on function list_students(text, uuid, uuid, text, text, int, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Transactions — paginated rows, plus a SEPARATE totals function. Totals
--    were previously computed by summing whatever page of rows happened to
--    be in memory — correct only because the limit (1000) usually exceeded
--    a month's real row count. Once it doesn't, that quietly becomes "total
--    of the first N transactions", not "total for the month". Computing it
--    with its own SUM ... FILTER query means it's always exact regardless
--    of how many rows are actually being displayed.
-- ----------------------------------------------------------------------------
create or replace function list_transactions(
  p_from date,
  p_to date,
  p_account_id uuid default null,
  p_type txn_type default null,
  p_sort text default 'date_desc',
  p_page int default 1,
  p_page_size int default 50
)
returns table (
  id uuid, type txn_type, direction txn_direction, amount numeric, txn_date date,
  description text, account_name text, created_at timestamptz, total_count bigint
)
language plpgsql stable set search_path = public as $$
declare
  v_offset int := greatest(0, coalesce(p_page, 1) - 1) * greatest(1, least(coalesce(p_page_size, 50), 200));
  v_limit  int := greatest(1, least(coalesce(p_page_size, 50), 200));
begin
  return query
  with filtered as (
    select t.*, a.name as account_name
    from transactions t
    left join accounts a on a.id = t.account_id
    where t.txn_date >= p_from and t.txn_date < p_to
      and (p_account_id is null or t.account_id = p_account_id)
      and (p_type is null or t.type = p_type)
  ),
  counted as (
    select *, count(*) over() as total_count from filtered
  )
  select
    c.id, c.type, c.direction, c.amount, c.txn_date, c.description, c.account_name, c.created_at, c.total_count
  from counted c
  order by
    case when p_sort = 'date_asc' then c.txn_date end asc nulls last,
    case when p_sort = 'amount_desc' then c.amount end desc nulls last,
    case when p_sort = 'amount_asc' then c.amount end asc nulls last,
    c.txn_date desc, c.created_at desc
  limit v_limit offset v_offset;
end;
$$;

revoke execute on function list_transactions(date, date, uuid, txn_type, text, int, int) from public;
grant execute on function list_transactions(date, date, uuid, txn_type, text, int, int) to authenticated;

create or replace function transactions_totals(
  p_from date, p_to date, p_account_id uuid default null, p_type txn_type default null
)
returns table (total_in numeric, total_out numeric)
language sql stable set search_path = public as $$
  select
    coalesce(sum(amount) filter (where direction = 'in'), 0),
    coalesce(sum(amount) filter (where direction = 'out'), 0)
  from transactions
  where txn_date >= p_from and txn_date < p_to
    and (p_account_id is null or account_id = p_account_id)
    and (p_type is null or type = p_type);
$$;

revoke execute on function transactions_totals(date, date, uuid, txn_type) from public;
grant execute on function transactions_totals(date, date, uuid, txn_type) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Fee Arrears — the per-student aggregation the report page used to do
--    by pulling up to 3000 raw fee_records rows into JS and grouping them
--    there. fee_arrears_filtered() is the shared core (same status
--    classification as before: oldest unpaid bill's age drives Current /
--    Partial / Overdue / Long Overdue — see the comment that used to live
--    in app/(app)/reports/pending-fees/page.js, now here instead since the
--    logic itself moved); accounts() paginates it, summary() aggregates it
--    without paginating, so the five summary cards always reflect the full
--    filtered set even while the list below them shows one page at a time.
-- ----------------------------------------------------------------------------
create or replace function fee_arrears_filtered(
  p_class_id uuid default null,
  p_section_id uuid default null,
  p_student_id uuid default null,
  p_month date default null,
  p_status text default null,
  p_min_balance numeric default 0
)
returns table (
  student_id uuid, student_name text, class_name text, section_name text, guardian_phone text,
  total_arrears numeric, months_count int, oldest_month date, months_overdue int, status_key text
)
language sql stable set search_path = public as $$
  with per_student as (
    select
      fr.student_id,
      sum(fr.total_payable - fr.paid_total) as total_arrears,
      count(*)::int as months_count,
      min(fr.month) as oldest_month,
      bool_or(fr.status = 'partial') as has_partial,
      bool_or(p_month is not null and date_trunc('month', fr.month) = date_trunc('month', p_month)) as matches_month
    from fee_records fr
    where fr.status <> 'paid'
    group by fr.student_id
  ),
  classified as (
    select
      ps.*,
      greatest(0,
        (extract(year from date_trunc('month', current_date)) - extract(year from ps.oldest_month)) * 12
        + (extract(month from date_trunc('month', current_date)) - extract(month from ps.oldest_month))
      )::int as months_overdue
    from per_student ps
  ),
  tagged as (
    select
      c.*,
      case
        when c.months_overdue >= 3 then 'long_overdue'
        when c.months_overdue >= 1 then 'overdue'
        when c.has_partial then 'partial'
        else 'current'
      end as status_key
    from classified c
  )
  select
    t.student_id, s.name as student_name, cl.name as class_name, sec.name as section_name, s.guardian_phone,
    t.total_arrears, t.months_count, t.oldest_month, t.months_overdue, t.status_key
  from tagged t
  join students s on s.id = t.student_id
  left join classes cl on cl.id = s.class_id
  left join sections sec on sec.id = s.section_id
  where (p_class_id is null or s.class_id = p_class_id)
    and (p_section_id is null or s.section_id = p_section_id)
    and (p_student_id is null or s.id = p_student_id)
    and (p_month is null or t.matches_month)
    and (p_status is null or p_status = '' or t.status_key = p_status)
    and t.total_arrears >= coalesce(p_min_balance, 0);
$$;

revoke execute on function fee_arrears_filtered(uuid, uuid, uuid, date, text, numeric) from public;
grant execute on function fee_arrears_filtered(uuid, uuid, uuid, date, text, numeric) to authenticated;

create or replace function fee_arrears_accounts(
  p_class_id uuid default null,
  p_section_id uuid default null,
  p_student_id uuid default null,
  p_month date default null,
  p_status text default null,
  p_min_balance numeric default 0,
  p_page int default 1,
  p_page_size int default 20
)
returns table (
  student_id uuid, student_name text, class_name text, section_name text, guardian_phone text,
  total_arrears numeric, months_count int, oldest_month date, months_overdue int, status_key text, total_count bigint
)
language plpgsql stable set search_path = public as $$
declare
  v_offset int := greatest(0, coalesce(p_page, 1) - 1) * greatest(1, least(coalesce(p_page_size, 20), 100));
  v_limit  int := greatest(1, least(coalesce(p_page_size, 20), 100));
begin
  return query
  with base as (
    select *, count(*) over() as total_count
    from fee_arrears_filtered(p_class_id, p_section_id, p_student_id, p_month, p_status, p_min_balance)
  )
  select student_id, student_name, class_name, section_name, guardian_phone,
    total_arrears, months_count, oldest_month, months_overdue, status_key, total_count
  from base
  order by
    case status_key when 'long_overdue' then 0 when 'overdue' then 1 when 'partial' then 2 else 3 end,
    total_arrears desc
  limit v_limit offset v_offset;
end;
$$;

revoke execute on function fee_arrears_accounts(uuid, uuid, uuid, date, text, numeric, int, int) from public;
grant execute on function fee_arrears_accounts(uuid, uuid, uuid, date, text, numeric, int, int) to authenticated;

create or replace function fee_arrears_summary(
  p_class_id uuid default null,
  p_section_id uuid default null,
  p_student_id uuid default null,
  p_month date default null,
  p_status text default null,
  p_min_balance numeric default 0
)
returns table (
  total_outstanding numeric, students_with_arrears bigint,
  one_month bigint, two_months bigint, three_plus_months bigint
)
language sql stable set search_path = public as $$
  select
    coalesce(sum(total_arrears), 0),
    count(*),
    count(*) filter (where months_count = 1),
    count(*) filter (where months_count = 2),
    count(*) filter (where months_count >= 3)
  from fee_arrears_filtered(p_class_id, p_section_id, p_student_id, p_month, p_status, p_min_balance);
$$;

revoke execute on function fee_arrears_summary(uuid, uuid, uuid, date, text, numeric) from public;
grant execute on function fee_arrears_summary(uuid, uuid, uuid, date, text, numeric) to authenticated;
