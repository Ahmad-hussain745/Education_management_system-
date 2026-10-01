-- ============================================================================
-- REPAIR SCRIPT — run this by hand in the Supabase SQL Editor, AFTER
-- 0034_fix_fee_effective_month.sql has been applied. Not a migration
-- itself (not in supabase/migrations/) — this touches specific existing
-- data, which should be reviewed, not auto-applied on every deploy.
--
-- What it does: finds fee_records rows generated while the effective-date
-- bug was live that resolved to a wrong (usually 0) monthly_fee, and
-- re-resolves them via repair_fee_record() — which only ever touches a
-- row with paid_total = 0, so nothing with a real payment against it is
-- rewritten.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1 — DIAGNOSE FIRST. Just a SELECT — run this alone and read the
-- output before touching STEP 2. Every row here is a bill that came out to
-- Rs. 0 (or below what its class/override should charge) with nothing paid
-- against it yet.
-- ----------------------------------------------------------------------------
select
  fr.id,
  fr.month,
  fr.monthly_fee        as current_monthly_fee,
  fr.previous_balance,
  fr.discount,
  fr.total_payable      as current_total_payable,
  fr.paid_total,
  fr.status,
  s.name,
  s.student_code,
  -- what it WOULD become after repair, for comparison — repair_fee_record()
  -- itself is what actually applies this, this is read-only.
  resolve_monthly_fee(s.id, s.class_id, date_trunc('month', fr.month)::date) as would_resolve_to
from fee_records fr
join students s on s.id = fr.student_id
where fr.paid_total = 0
  and fr.monthly_fee <> resolve_monthly_fee(s.id, s.class_id, date_trunc('month', fr.month)::date)
order by fr.month desc, s.name;

-- ----------------------------------------------------------------------------
-- STEP 2 — REPAIR. Only run this after checking STEP 1's output looks
-- right. Repairs every row STEP 1 found, one at a time, via
-- repair_fee_record() (0034_fix_fee_effective_month.sql) — the exact same
-- function you could call for a single student from the app/SQL editor.
-- Safe to re-run: a row that's already correct just doesn't match the
-- WHERE clause a second time.
-- ----------------------------------------------------------------------------
do $$
declare
  v_rec record;
  v_count int := 0;
begin
  for v_rec in
    select fr.student_id, fr.month
    from fee_records fr
    join students s on s.id = fr.student_id
    where fr.paid_total = 0
      and fr.monthly_fee <> resolve_monthly_fee(s.id, s.class_id, date_trunc('month', fr.month)::date)
  loop
    perform repair_fee_record(v_rec.student_id, v_rec.month);
    v_count := v_count + 1;
  end loop;
  raise notice 'Repaired % fee_records row(s).', v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- STEP 3 — VERIFY. Should return zero rows if the repair fully worked.
-- ----------------------------------------------------------------------------
select fr.id, fr.month, fr.monthly_fee, s.name
from fee_records fr
join students s on s.id = fr.student_id
where fr.paid_total = 0
  and fr.monthly_fee <> resolve_monthly_fee(s.id, s.class_id, date_trunc('month', fr.month)::date);
