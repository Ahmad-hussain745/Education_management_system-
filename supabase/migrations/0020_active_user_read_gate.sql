-- ============================================================================
-- 25. ACTIVE-STATUS ENFORCEMENT — closing a gap self-registration opened
-- ============================================================================
-- current_role_name() and current_teacher_id() (0002_rls.sql) are the two
-- functions nearly every RLS policy in this schema is built on
-- (is_admin(), is_finance_staff(), can_view_finance(), can_approve(),
-- can_view_fees() all call current_role_name(); a large set of
-- teacher-scoped policies call current_teacher_id() directly). Neither one
-- checks users.status — both just match on auth_user_id = auth.uid() and
-- return whatever role/teacher link that row has, active or not.
--
-- Before app/register/actions.js existed, this was academic: the only way
-- to get a users row at all was a Super Admin creating one via Settings →
-- Users, which always came with role_id already set. The only real-world
-- case this gap could bite was a deactivated staff member's Auth session
-- somehow surviving past app/(app)/layout.js's status check (which signs
-- them out) — the app itself already prevents that.
--
-- Self-registration removes the "always came with a role" assumption:
-- someone can now hold a genuine, confirmed Auth session with a real
-- current_role_name() result of NULL (fine — every role check correctly
-- fails closed) — but the same reasoning applies the moment a Super Admin
-- *does* assign them a role while status is still 'inactive' (approving in
-- two steps: pick a role, then Activate — see settings/users/UserRow.js),
-- or to any deactivated former staff member calling the database directly
-- rather than through this app. Both cases, current_role_name() would
-- resolve to a real role, and is_finance_staff()/is_admin()/etc. would
-- return true, even though the app layer would never have let them in.
--
-- Fixing it here, in the two functions everything else is built on, closes
-- it everywhere at once — every is_admin()/is_finance_staff()/
-- can_view_finance()/can_approve()/can_view_fees()/current_teacher_id()
-- check across every table's policies now correctly requires status =
-- 'active', without touching each of those policies individually.

create or replace function current_role_name() returns text as $$
  select r.name from users u
  join roles r on r.id = u.role_id
  where u.auth_user_id = auth.uid() and u.status = 'active'
  limit 1;
$$ language sql stable security definer set search_path = public;

create or replace function current_teacher_id() returns uuid as $$
  select t.id from teachers t
  join users u on u.id = t.user_id
  where u.auth_user_id = auth.uid() and u.status = 'active'
  limit 1;
$$ language sql stable security definer set search_path = public;

-- The functions above cover every policy built on role/teacher checks.
-- What's left are tables whose read policy is a bare "signed in at all"
-- check with no role logic to fix — those need their own explicit patch.
-- (student_attendance and teacher_attendance are NOT in this list: their
-- read policies already go through is_admin()/can_view_finance()/
-- current_teacher_id() — see 0015_attendance_read_scoping.sql — so the fix
-- above already covers them. Adding a second, broader "any signed-in user"
-- policy on top would OR together with those and silently widen access
-- right back past what 0015 deliberately scoped, since Postgres combines
-- multiple permissive policies on the same command with OR, not AND.)

create or replace function is_active_user() returns boolean as $$
  select exists (
    select 1 from users where auth_user_id = auth.uid() and status = 'active'
  );
$$ language sql stable security definer set search_path = public;

drop policy if exists "read: any signed-in user" on classes;
create policy "read: any signed-in user" on classes for select using (is_active_user());

drop policy if exists "read: any signed-in user" on sections;
create policy "read: any signed-in user" on sections for select using (is_active_user());

drop policy if exists "read: any signed-in user" on subjects;
create policy "read: any signed-in user" on subjects for select using (is_active_user());

drop policy if exists "read roles" on roles;
create policy "read roles" on roles for select using (is_active_user());

drop policy if exists "read: any signed-in user" on students;
create policy "read: any signed-in user" on students for select using (is_active_user());

drop policy if exists "read: any signed-in user" on teachers;
create policy "read: any signed-in user" on teachers for select using (is_active_user());

drop policy if exists "read: any signed-in user" on teacher_classes;
create policy "read: any signed-in user" on teacher_classes for select using (is_active_user());

drop policy if exists "read: any signed-in user" on syllabus_chapters;
create policy "read: any signed-in user" on syllabus_chapters for select using (is_active_user());

drop policy if exists "read: any signed-in user" on syllabus_topics;
create policy "read: any signed-in user" on syllabus_topics for select using (is_active_user());

drop policy if exists "read: any signed-in user" on syllabus_progress;
create policy "read: any signed-in user" on syllabus_progress for select using (is_active_user());

-- "read own row" on users itself (0002_rls.sql) is deliberately untouched —
-- a pending registrant still needs to be able to read their OWN row (it's
-- how they'd ever see their own pending status reflected anywhere), and
-- that policy already scopes to auth_user_id = auth.uid(), which was never
-- the gap here.

