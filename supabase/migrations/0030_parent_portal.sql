-- ============================================================================
-- 31. PARENT/STUDENT PORTAL — a new role, deliberately the narrowest one yet
-- ============================================================================
-- Every existing role (Super Admin, Principal, Accountant, Cashier, Teacher)
-- is school staff — is_active_user() (0020_active_user_read_gate.sql) gives
-- any of them broad read access to classes/students/teachers/subjects/
-- syllabus, because every one of them legitimately needs the general school
-- directory. A Parent is not staff. Adding 'Parent' to the roles table and
-- letting them become an ordinary active user would, without the change
-- below, silently hand them that same broad visibility — every student's
-- name, every class, every teacher — through policies that were never
-- designed with a non-staff role in mind. That's the opposite of what
-- "strict RLS" means here, so the first thing this migration does is close
-- that door before opening a much narrower one.

insert into roles (name, permissions) values
  ('Parent', '["portal.own_children"]')
on conflict (name) do nothing;

create or replace function is_active_staff() returns boolean as $$
  select exists (
    select 1 from users u join roles r on r.id = u.role_id
    where u.auth_user_id = auth.uid() and u.status = 'active' and r.name <> 'Parent'
  );
$$ language sql stable security definer set search_path = public;

drop policy if exists "read: any signed-in user" on classes;
create policy "read: any signed-in user" on classes for select using (is_active_staff());
drop policy if exists "read: any signed-in user" on sections;
create policy "read: any signed-in user" on sections for select using (is_active_staff());
drop policy if exists "read: any signed-in user" on subjects;
create policy "read: any signed-in user" on subjects for select using (is_active_staff());
drop policy if exists "read roles" on roles;
create policy "read roles" on roles for select using (is_active_staff());
drop policy if exists "read: any signed-in user" on students;
create policy "read: any signed-in user" on students for select using (is_active_staff());
drop policy if exists "read: any signed-in user" on teachers;
create policy "read: any signed-in user" on teachers for select using (is_active_staff());
drop policy if exists "read: any signed-in user" on teacher_classes;
create policy "read: any signed-in user" on teacher_classes for select using (is_active_staff());
drop policy if exists "read: any signed-in user" on syllabus_chapters;
create policy "read: any signed-in user" on syllabus_chapters for select using (is_active_staff());
drop policy if exists "read: any signed-in user" on syllabus_topics;
create policy "read: any signed-in user" on syllabus_topics for select using (is_active_staff());
drop policy if exists "read: any signed-in user" on syllabus_progress;
create policy "read: any signed-in user" on syllabus_progress for select using (is_active_staff());

create table parent_students (
  id           uuid primary key default gen_random_uuid(),
  parent_user_id uuid not null references users(id) on delete cascade,
  student_id   uuid not null references students(id) on delete cascade,
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  unique (parent_user_id, student_id)
);

alter table parent_students enable row level security;

create policy "parent reads own links" on parent_students for select
  using (parent_user_id = (select id from users where auth_user_id = auth.uid()));
create policy "admin manages parent links" on parent_students for all
  using (is_admin()) with check (is_admin());

create or replace function is_parent_of(p_student_id uuid) returns boolean as $$
  select exists (
    select 1 from parent_students ps
    join users u on u.id = ps.parent_user_id
    where u.auth_user_id = auth.uid() and u.status = 'active' and ps.student_id = p_student_id
  );
$$ language sql stable security definer set search_path = public;

create or replace function is_parent_of_class(p_class_id uuid) returns boolean as $$
  select exists (
    select 1 from parent_students ps
    join users u on u.id = ps.parent_user_id
    join students s on s.id = ps.student_id
    where u.auth_user_id = auth.uid() and u.status = 'active' and s.class_id = p_class_id
  );
$$ language sql stable security definer set search_path = public;

revoke execute on function is_active_staff() from public;
grant execute on function is_active_staff() to authenticated;
revoke execute on function is_parent_of(uuid) from public;
grant execute on function is_parent_of(uuid) to authenticated;
revoke execute on function is_parent_of_class(uuid) from public;
grant execute on function is_parent_of_class(uuid) to authenticated;

create policy "parent reads own children" on students for select using (is_parent_of(id));
create policy "parent reads own child's class" on classes for select using (is_parent_of_class(id));
create policy "parent reads own child's section" on sections for select using (is_parent_of_class(class_id));

create policy "parent reads own children's attendance" on student_attendance for select using (is_parent_of(student_id));

create policy "parent reads own children's fee records" on fee_records for select using (is_parent_of(student_id));
create policy "parent reads own children's payments" on fee_payments for select using (is_parent_of(student_id));

create policy "parent reads own child's syllabus chapters" on syllabus_chapters for select using (is_parent_of_class(class_id));
create policy "parent reads own child's syllabus topics" on syllabus_topics for select using (
  exists (select 1 from syllabus_chapters c where c.id = syllabus_topics.chapter_id and is_parent_of_class(c.class_id))
);
create policy "parent reads own child's syllabus progress" on syllabus_progress for select using (
  exists (
    select 1 from syllabus_topics t join syllabus_chapters c on c.id = t.chapter_id
    where t.id = syllabus_progress.topic_id and is_parent_of_class(c.class_id)
  )
);

create policy "parent reads own children's notifications" on notifications for select using (is_parent_of(student_id));
