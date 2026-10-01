-- ============================================================================
-- 0035 — Multi-tenancy: turn this single-school app into a platform that
-- serves many institutes from one shared database, with hard isolation
-- enforced by Postgres itself (not just app code).
--
-- Approach:
--   1. A new `institutes` table — one row per school/academy using the app.
--   2. Every existing tenant-owned table gets an `institute_id` column.
--   3. A trigger auto-fills `institute_id` on insert from the signed-in
--      user's own institute, so existing app code (server actions) does
--      NOT need to be rewritten to pass institute_id explicitly.
--   4. A RESTRICTIVE policy on every tenant table requires
--      institute_id = current_institute_id() on top of whatever the
--      existing 0002_rls.sql policies already allow. RESTRICTIVE policies
--      are AND-ed with permissive ones, so this adds a hard tenant
--      boundary underneath the existing role logic without touching or
--      risking any of that existing, already-proven logic.
--   5. `roles` is deliberately left OUT of tenant scoping — it's a small
--      fixed lookup table (Super Admin / Principal / Accountant / Teacher
--      / Cashier), not per-institute data.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Institutes
-- ----------------------------------------------------------------------------
create table if not exists institutes (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text unique,                 -- for a future /register?institute=slug join-link
  logo_url     text,
  address      text,
  phone        text,
  email        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table users add column if not exists institute_id uuid references institutes(id) on delete cascade;
create index if not exists idx_users_institute_id on users(institute_id);

-- ----------------------------------------------------------------------------
-- 2. Helper: the caller's institute, or null if not signed in / not
--    assigned to one yet. security definer + stable, same pattern as the
--    existing current_role_name()/current_teacher_id() in 0002_rls.sql.
-- ----------------------------------------------------------------------------
create or replace function current_institute_id() returns uuid as $$
  select institute_id from users where auth_user_id = auth.uid() limit 1;
$$ language sql stable security definer;

-- ----------------------------------------------------------------------------
-- 3. Generic auto-fill trigger — only sets institute_id if the inserting
--    code didn't already supply one (the institute-registration flow sets
--    it explicitly for the founding admin, before they have one to infer).
-- ----------------------------------------------------------------------------
create or replace function set_institute_id() returns trigger as $$
begin
  if new.institute_id is null then
    new.institute_id := current_institute_id();
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- ----------------------------------------------------------------------------
-- 4. Apply institute_id + trigger + restrictive isolation policy to every
--    tenant-owned table. Listed explicitly (not discovered dynamically) so
--    a future new table doesn't silently end up unscoped.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
  tenant_tables text[] := array[
    'users',
    'students', 'teachers', 'parent_students',
    'classes', 'sections', 'subjects',
    'teacher_classes',
    'student_attendance', 'teacher_attendance',
    'fee_structures', 'fee_discounts', 'fee_records', 'fee_payments', 'fee_generation_runs',
    'salary_rules', 'salary_rule_history', 'salary_records', 'salary_items', 'salary_payments',
    'accounts', 'transactions', 'income', 'expenses', 'cashier_closings', 'monthly_closing',
    'exam_types', 'exams', 'exam_classes', 'exam_subjects', 'exam_marks', 'exam_results', 'grade_rules',
    'syllabus_chapters', 'syllabus_topics', 'syllabus_progress',
    'inventory_categories', 'inventory_items', 'inventory_suppliers', 'inventory_purchases', 'inventory_stock_movements',
    'notifications', 'notification_templates', 'notification_logs',
    'audit_logs'
  ];
begin
  foreach t in array tenant_tables loop
    -- users already got institute_id added above; skip re-adding.
    if t <> 'users' then
      execute format('alter table %I add column if not exists institute_id uuid references institutes(id) on delete cascade', t);
      execute format('create index if not exists idx_%s_institute_id on %I(institute_id)', t, t);
    end if;

    execute format('drop trigger if exists trg_set_institute_id on %I', t);
    execute format('create trigger trg_set_institute_id before insert on %I for each row execute function set_institute_id()', t);

    execute format('drop policy if exists institute_isolation on %I', t);
    execute format(
      'create policy institute_isolation on %I as restrictive for all using (institute_id = current_institute_id()) with check (institute_id = current_institute_id())',
      t
    );
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Logo storage — a public bucket so login/dashboard pages can show a
--    logo without an authenticated request. Only the institute-registration
--    server action (using the service-role key) writes to it, so RLS on
--    the bucket itself just needs to allow public reads.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('institute-logos', 'institute-logos', true)
on conflict (id) do nothing;

drop policy if exists "Public read institute logos" on storage.objects;
create policy "Public read institute logos" on storage.objects
  for select using (bucket_id = 'institute-logos');
