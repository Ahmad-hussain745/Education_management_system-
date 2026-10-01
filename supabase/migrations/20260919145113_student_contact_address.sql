-- ============================================================================
-- 59. Phase 31 support — the one schema change the low-risk/high-risk
-- conflict split needs: `address` didn't exist as a column at all, so it
-- couldn't have been offline-editable with any policy, LWW or otherwise.
--
-- No RLS change needed — students already carries the institute_isolation
-- restrictive policy (0035_multi_tenancy.sql) and the existing "read: any
-- signed-in user" / "write: admin+staff" permissive policies from
-- 0002_rls.sql apply to every column on the row, this one included.
-- ============================================================================

alter table students add column if not exists address text;
