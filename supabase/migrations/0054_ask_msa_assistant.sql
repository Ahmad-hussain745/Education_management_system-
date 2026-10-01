-- ============================================================================
-- 54. ASK MSA — NATURAL-LANGUAGE MANAGEMENT ASSISTANT
--
-- Phase 24. The assistant itself is application-layer (lib/assistant/) —
-- a rule-based intent parser, then one parameterized query per intent
-- against real tables/RPCs the rest of the app already reads, then a
-- template that only ever interpolates the verified numbers those queries
-- returned. Nothing here is a new "smart" database object; this migration
-- is just the audit trail for it, plus a fix found on the way.
--
-- FOUND WHILE WIRING THIS UP: low_stock_items(uuid) and
-- reconcile_fee_totals(uuid) (0045) are exactly the class of bug 0051's
-- security audit was built to catch — security definer, take
-- p_institute_id as a caller-supplied parameter, granted to `authenticated`
-- — but neither is in 0051's list, and neither actually checks the
-- parameter against current_institute_id(). Any signed-in user, at any
-- institute, could already call either with someone else's institute id
-- and read that institute's inventory stock or fee-total drift. Giving the
-- assistant a new reason to call low_stock_items is what surfaced this on
-- re-reading it; the right fix is the same one 0051 already used for
-- preview_monthly_fee_generation — split into a cron-safe variant that
-- keeps taking an explicit id (service_role only) and an interactive
-- variant that derives its own institute from the session and never
-- trusts a parameter for it (authenticated). The service_role-called
-- automation jobs (lib/automation/jobs/inventory-alerts.js,
-- reconciliation.js) keep using the (uuid) forms unchanged.
--
-- Second, related gap in the same two functions: being SECURITY DEFINER,
-- they bypass inventory_items'/fee_records' own RLS policies entirely, and
-- neither had the can_view_finance() check those policies enforce — so
-- even a same-institute Teacher or Cashier could call them directly and
-- read data RLS was supposed to keep from that role. Added below too.
-- ============================================================================

revoke execute on function low_stock_items(uuid) from authenticated;
revoke execute on function reconcile_fee_totals(uuid) from authenticated;

create or replace function low_stock_items()
returns table(item_id uuid, item_name text, unit text, remaining numeric, reorder_level numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  -- This function is SECURITY DEFINER, so it bypasses inventory_items' own
  -- RLS policy ("finance staff manage" / "principal views") entirely —
  -- the institute check above stops a cross-institute read, but without
  -- this it would still hand any signed-in Teacher or Cashier the same
  -- stock levels RLS exists to keep from them on the underlying table.
  if not can_view_finance() then
    raise exception 'NOT_AUTHORIZED: Not authorized to view inventory.';
  end if;

  return query
  select i.id, i.name, i.unit, get_item_stock(i.id, current_date), i.reorder_level
  from inventory_items i
  where i.active
    and i.institute_id = current_institute_id()
    and i.reorder_level is not null
    and get_item_stock(i.id, current_date) <= i.reorder_level;
end;
$$;
grant execute on function low_stock_items() to authenticated;

create or replace function reconcile_fee_totals()
returns table(fee_record_id uuid, student_id uuid, stored_paid numeric, actual_paid numeric, drift numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can_view_finance() then
    raise exception 'NOT_AUTHORIZED: Not authorized to view fee reconciliation.';
  end if;

  return query
  select fr.id, fr.student_id, fr.paid_total,
         coalesce((select sum(p.amount) from fee_payments p where p.fee_record_id = fr.id), 0),
         fr.paid_total - coalesce((select sum(p.amount) from fee_payments p where p.fee_record_id = fr.id), 0)
  from fee_records fr
  where fr.institute_id = current_institute_id()
    and fr.paid_total <> coalesce((select sum(p.amount) from fee_payments p where p.fee_record_id = fr.id), 0);
end;
$$;
grant execute on function reconcile_fee_totals() to authenticated;

-- ----------------------------------------------------------------------------
-- Every question asked, what it was understood as, and the verified answer
-- given back — the actual mechanism behind "should query your database,
-- not invent answers" is auditable, not just true in the moment: anyone
-- can later see exactly which real query backed a given answer. A
-- question the parser didn't recognize is logged too (matched_intent
-- null), since "the assistant didn't know how to answer this" is itself
-- useful signal for what to add next.
-- ----------------------------------------------------------------------------
create table if not exists assistant_queries (
  id              uuid primary key default gen_random_uuid(),
  institute_id    uuid not null references institutes(id) on delete cascade,
  asked_by        uuid references users(id),
  question        text not null,
  matched_intent  text,
  params          jsonb,
  answer          text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_assistant_queries_institute on assistant_queries(institute_id, created_at desc);

drop trigger if exists trg_set_institute_id on assistant_queries;
create trigger trg_set_institute_id before insert on assistant_queries
  for each row execute function set_institute_id();

alter table assistant_queries enable row level security;

create policy institute_isolation on assistant_queries as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

-- Every finance-tier role can see the institute's own question history
-- (useful for "what has anyone been asking"), but a row can only ever be
-- inserted as the asker themselves — enforced below, not just assumed from
-- the app always setting asked_by correctly.
create policy "finance staff read assistant queries" on assistant_queries for select
  using (can_view_finance());

create policy "user logs own assistant queries" on assistant_queries for insert
  with check (asked_by = (select id from users where auth_user_id = auth.uid()));
