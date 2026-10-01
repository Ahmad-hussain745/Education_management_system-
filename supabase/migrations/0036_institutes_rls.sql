-- ============================================================================
-- 36. INSTITUTES TABLE RLS — 0035_multi_tenancy.sql added institute_id
-- isolation to every tenant-owned table, but never turned on Row Level
-- Security for the `institutes` table itself. Without RLS enabled, Supabase's
-- default grants leave that table fully open: any signed-in user at any
-- institute could read or edit every other institute's name, logo, address,
-- phone, and email. This closes that gap.
--
-- registerInstitute() and updateInstituteProfile() both write through the
-- service-role admin client, which bypasses RLS entirely — so these
-- policies only affect the normal, non-privileged client the rest of the
-- app uses (e.g. getRoleContext()'s institute:institutes(...) read).
-- ============================================================================

alter table institutes enable row level security;

create policy "read own institute" on institutes
  for select using (id = current_institute_id());

create policy "admin can update own institute" on institutes
  for update using (id = current_institute_id() and is_admin())
  with check (id = current_institute_id() and is_admin());

-- No insert/delete policy for the authenticated/anon roles — institute
-- creation and removal only ever happen through the admin client
-- (registerInstitute()), which bypasses RLS, exactly like `roles` in
-- 0002_rls.sql has no anon/authenticated insert path either.
