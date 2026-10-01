-- ============================================================================
-- 34. GLOBAL SEARCH
--
-- One search bar, top of every page (AppShell), one RPC, one round trip.
-- global_search() UNIONs three independently-filtered result sets —
-- students, teachers, receipts — into a single normalized shape
-- (result_type/id/title/subtitle/meta) so the frontend renders one list
-- without needing to know which table a given row came from.
--
-- Deliberately NOT SECURITY DEFINER: this is a plain `language sql`
-- function, so it runs with the calling user's own privileges and every
-- existing RLS policy on students/teachers/fee_payments/fee_records
-- applies exactly as if each branch were queried directly. A Teacher
-- searching "Ahmed" gets student and teacher matches but never a receipt
-- match — not because this function special-cases their role, but because
-- fee_payments' own read policy (can_view_fees(), 0002_rls.sql) already
-- excludes Teacher. Same reasoning as reusing RLS elsewhere in this
-- project instead of re-deriving authorization in application code.
--
-- The one thing that DOES need an explicit role check is the per-student
-- "Outstanding" figure bundled into a student result's `meta` — see the
-- CASE inside student_matches for why a plain coalesce(...,0) would have
-- been actively misleading rather than just "empty".
-- ============================================================================

-- Search targets not already indexed by 0029_scalable_listings.sql's
-- trigram indexes (which covered students.name/student_code/guardian_name,
-- but not guardian_phone — now a stated search target — nor teachers or
-- receipts at all).
create index if not exists idx_students_guardian_phone_trgm on students using gin (guardian_phone gin_trgm_ops);
create index if not exists idx_teachers_name_trgm on teachers using gin (name gin_trgm_ops);
create index if not exists idx_teachers_phone_trgm on teachers using gin (phone gin_trgm_ops);
create index if not exists idx_fee_payments_receipt_no_trgm on fee_payments using gin (receipt_no gin_trgm_ops);

create or replace function global_search(p_query text, p_limit int default 8)
returns table (result_type text, id uuid, title text, subtitle text, meta jsonb)
language sql stable set search_path = public as $$
  with q as (select trim(coalesce(p_query, '')) as term),
  lim as (select greatest(1, least(coalesce(p_limit, 8), 20)) as n),

  student_matches as (
    select
      'student'::text as result_type,
      s.id,
      s.name as title,
      trim(both ' · ' from
        coalesce(s.student_code, '') || ' · ' ||
        coalesce(c.name, '') || coalesce('-' || sec.name, '')
      ) as subtitle,
      jsonb_build_object(
        'student_code', s.student_code,
        'class_name', c.name,
        'section_name', sec.name,
        'guardian_phone', s.guardian_phone,
        'status', s.status,
        -- NULL (not 0) when the signed-in role has no read policy on
        -- fee_records — "we can't tell you" is not the same fact as
        -- "this student owes nothing", and the two must never render the
        -- same in the mini-card. See components/GlobalSearch.js.
        'outstanding', case when can_view_fees() then
          coalesce((select sum(fr.total_payable - fr.paid_total) from fee_records fr where fr.student_id = s.id and fr.status <> 'paid'), 0)
        else null end
      ) as meta
    from students s
    left join classes c on c.id = s.class_id
    left join sections sec on sec.id = s.section_id
    cross join q
    cross join lim
    where q.term <> '' and (
      s.name ilike '%'||q.term||'%' or
      s.student_code ilike '%'||q.term||'%' or
      s.guardian_phone ilike '%'||q.term||'%'
    )
    order by s.name
    limit (select n from lim)
  ),

  teacher_matches as (
    select
      'teacher'::text,
      t.id,
      t.name,
      trim(both ' · ' from 'Teacher' || coalesce(' · ' || sub.name, '') || coalesce(' · ' || t.phone, '')),
      jsonb_build_object('phone', t.phone, 'subject_name', sub.name, 'status', t.status)
    from teachers t
    left join subjects sub on sub.id = t.subject_id
    cross join q
    cross join lim
    where q.term <> '' and (t.name ilike '%'||q.term||'%' or t.phone ilike '%'||q.term||'%')
    order by t.name
    limit (select n from lim)
  ),

  receipt_matches as (
    select
      'receipt'::text,
      fp.id,
      'Receipt ' || fp.receipt_no,
      s.name || ' · Rs. ' || round(fp.amount)::text || ' · ' || to_char(fp.paid_on, 'DD Mon YYYY'),
      jsonb_build_object('student_id', fp.student_id, 'student_name', s.name, 'amount', fp.amount, 'paid_on', fp.paid_on, 'receipt_no', fp.receipt_no)
    from fee_payments fp
    join students s on s.id = fp.student_id
    cross join q
    cross join lim
    where q.term <> '' and fp.receipt_no ilike '%'||q.term||'%'
    order by fp.paid_on desc
    limit (select n from lim)
  )

  select * from student_matches
  union all
  select * from teacher_matches
  union all
  select * from receipt_matches;
$$;

revoke execute on function global_search(text, int) from public;
grant execute on function global_search(text, int) to authenticated;
