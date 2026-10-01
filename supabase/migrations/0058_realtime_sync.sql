-- ============================================================================
-- 58. Real-time synchronization — Supabase Realtime for postgres_changes.
--
-- WHY THIS IS SAFE TO TURN ON (checked before writing a line of app code,
-- given 0051's audit history and DashboardLiveRefresh.js's earlier decision
-- to avoid Realtime until this was verified):
--   • Realtime's postgres_changes has broadcast RLS-checked payloads since
--     Dec 2021 (Supabase "Realtime Postgres RLS") — it is not the
--     unauthenticated broadcast-everything mode that made that earlier
--     caution reasonable to raise.
--   • Every table enabled below already carries the RESTRICTIVE
--     `institute_isolation` policy from 0035_multi_tenancy.sql
--     (institute_id = current_institute_id()), AND-ed under `for all`, so
--     it already governs SELECT — which is exactly what Realtime evaluates
--     per change before deciding whether to deliver it to a given socket.
--   • The browser client (lib/supabase/client.js) is always created with
--     the anon key + the signed-in user's session, never the service-role
--     key — so a Realtime socket opened from it authenticates, and is
--     RLS-scoped, as that user. There is no separate "admin" Realtime path
--     for the app to accidentally use.
--   • REPLICA IDENTITY FULL is set below on every enabled table so UPDATE
--     events carry the old row too. That's needed for correct RLS
--     evaluation on UPDATE/DELETE (Postgres has to see the old row to
--     check the policy against it), not just for payload completeness.
--
-- Tables enabled, matching the five event types asked for:
--   fee_payments               — "New payment"
--   fee_records                — "Fee update"
--   student_attendance         — "Attendance"
--   inventory_stock_movements  — "Inventory"
--   notifications              — "Notifications"
--
-- Deliberately NOT enabled: anything holding another institute's-eye-view
-- aggregate (there are none of those as base tables) and audit_logs (no UI
-- need for it to be live, and it's the one table where "quietly widened
-- who gets a live feed of this" is worth a separate, explicit decision
-- rather than a side effect of this migration).
-- ============================================================================

do $$
declare
  t text;
  realtime_tables text[] := array[
    'fee_payments',
    'fee_records',
    'student_attendance',
    'inventory_stock_movements',
    'notifications'
  ];
begin
  foreach t in array realtime_tables loop
    execute format('alter table %I replica identity full', t);

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
