-- ============================================================================
-- PARENT PORTAL 2.0 — family dashboard: Timetable, Syllabus progress,
-- Homework, Announcements, Support requests, on top of the Attendance /
-- Fees / Payments / Exam results / Notifications 0030_parent_portal.sql
-- already covered with plain RLS.
--
-- Three new SECURITY DEFINER functions (get_child_timetable,
-- get_child_syllabus_progress, get_child_homework) instead of new
-- blanket RLS SELECT policies on `subjects`/`teachers`/`periods`/`rooms`.
-- Why: RLS is ROW-level, not column-level. `teachers` holds `phone` and
-- `fixed_salary` alongside `name` — a policy letting parents read rows
-- from that table would hand back every column on the row, salary
-- included, not just the name a timetable needs to display. Each
-- function below does its own is_parent_of()/is_active_staff() check
-- and its own joins, entirely self-contained (no nested call into
-- another RLS-dependent function — see get_student_risk_signals's own
-- header, migration 20260925020000, for why that distinction matters),
-- and returns ONLY the columns a parent should ever see.
--
-- Everything else new here (homework, announcements, support_requests)
-- has no such column-sensitivity problem, so those get ordinary RLS.
-- ============================================================================

create or replace function get_child_timetable(p_student_id uuid)
returns table(day_of_week int, period_name text, start_time time, end_time time, is_break boolean, subject_name text, teacher_name text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_class_id uuid;
  v_section_id uuid;
begin
  if not (is_parent_of(p_student_id) or is_active_staff()) then
    raise exception 'NOT_AUTHORIZED: Not authorized to view this student''s timetable.';
  end if;

  select class_id, section_id into v_class_id, v_section_id from students where id = p_student_id;
  if v_class_id is null then raise exception 'NOT_FOUND: Student not found.'; end if;

  return query
  select te.day_of_week, p.name, p.start_time, p.end_time, p.is_break, sub.name, t.name
  from timetable_entries te
  join periods p on p.id = te.period_id
  left join subjects sub on sub.id = te.subject_id
  left join teachers t on t.id = te.teacher_id
  where te.class_id = v_class_id and (te.section_id is null or te.section_id = v_section_id)
    and te.status = 'published'
  order by te.day_of_week, p.start_time;
end;
$$;

revoke execute on function get_child_timetable(uuid) from public;
grant execute on function get_child_timetable(uuid) to authenticated;

-- Whole-class pace, every subject — same shape as get_class_progress_
-- summary (Teacher Copilot, migration 20260924030000) but every subject
-- at once rather than one at a time, since a parent wants the whole
-- picture, not a subject drill-down.
create or replace function get_child_syllabus_progress(p_student_id uuid)
returns table(subject_name text, topics_total int, topics_completed int, completion_pct numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_class_id uuid;
  v_section_id uuid;
begin
  if not (is_parent_of(p_student_id) or is_active_staff()) then
    raise exception 'NOT_AUTHORIZED: Not authorized to view this student''s syllabus progress.';
  end if;

  select class_id, section_id into v_class_id, v_section_id from students where id = p_student_id;
  if v_class_id is null then raise exception 'NOT_FOUND: Student not found.'; end if;

  return query
  select sub.name, count(st.*)::int,
    count(*) filter (where sp.completed and (sp.section_id is null or sp.section_id = v_section_id))::int,
    case when count(st.*) = 0 then null
      else round(100.0 * count(*) filter (where sp.completed and (sp.section_id is null or sp.section_id = v_section_id)) / count(st.*), 1)
    end
  from syllabus_chapters sc
  join subjects sub on sub.id = sc.subject_id
  join syllabus_topics st on st.chapter_id = sc.id
  left join syllabus_progress sp on sp.topic_id = st.id
  where sc.class_id = v_class_id
  group by sub.name
  order by sub.name;
end;
$$;

revoke execute on function get_child_syllabus_progress(uuid) from public;
grant execute on function get_child_syllabus_progress(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Homework — a teacher posts it for a class/section; a parent sees it
-- for their own child's class. No sensitive columns, but subject_id
-- still needs the same treatment (see this file's header), so reads go
-- through get_child_homework() rather than a raw `subjects` embed.
-- ----------------------------------------------------------------------------
create table if not exists homework (
  id           uuid primary key default gen_random_uuid(),
  institute_id uuid not null references institutes(id) on delete cascade,
  class_id     uuid not null references classes(id) on delete cascade,
  section_id   uuid references sections(id) on delete set null,
  subject_id   uuid references subjects(id) on delete set null,
  teacher_id   uuid references teachers(id) on delete set null,
  title        text not null,
  description  text,
  due_date     date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_homework_class on homework(class_id, section_id, due_date desc);
create index if not exists idx_homework_institute on homework(institute_id, created_at desc);

drop trigger if exists trg_set_institute_id on homework;
create trigger trg_set_institute_id before insert on homework
  for each row execute function set_institute_id();

alter table homework enable row level security;

create policy institute_isolation on homework as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

create policy "staff read homework" on homework for select using (is_active_staff());

-- teacher_owns_class() already resolves true for Super Admin/Principal
-- (can_approve()) too — see its definition, migration 20260924030000.
create policy "teacher manages own class homework" on homework for all
  using (teacher_owns_class(class_id, section_id)) with check (teacher_owns_class(class_id, section_id));

create or replace function get_child_homework(p_student_id uuid, p_limit int default 20)
returns table(id uuid, title text, description text, due_date date, subject_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_class_id uuid;
  v_section_id uuid;
begin
  if not (is_parent_of(p_student_id) or is_active_staff()) then
    raise exception 'NOT_AUTHORIZED: Not authorized to view this student''s homework.';
  end if;

  select class_id, section_id into v_class_id, v_section_id from students where id = p_student_id;
  if v_class_id is null then raise exception 'NOT_FOUND: Student not found.'; end if;

  return query
  select h.id, h.title, h.description, h.due_date, sub.name, h.created_at
  from homework h
  left join subjects sub on sub.id = h.subject_id
  where h.class_id = v_class_id and (h.section_id is null or h.section_id = v_section_id)
  order by h.due_date desc nulls last, h.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$$;

revoke execute on function get_child_homework(uuid, int) from public;
grant execute on function get_child_homework(uuid, int) to authenticated;

-- ----------------------------------------------------------------------------
-- Announcements — a persistent notice-board feed, distinct from
-- `notifications` (per-student system events, e.g. "payment recorded")
-- and from Communication Center's `communication_messages` (individual
-- pushed sends). This is something a parent opens the portal and reads,
-- not something sent to them. Publishing is Super Admin/Principal only —
-- a school-wide or class-wide notice is an administrative act, not an
-- individual teacher's.
-- ----------------------------------------------------------------------------
create table if not exists announcements (
  id           uuid primary key default gen_random_uuid(),
  institute_id uuid not null references institutes(id) on delete cascade,
  title        text not null,
  body         text not null,
  audience     text not null default 'all' check (audience in ('all', 'class')),
  class_id     uuid references classes(id) on delete cascade,
  created_by   uuid references users(id),
  published_at timestamptz not null default now()
);
create index if not exists idx_announcements_institute on announcements(institute_id, published_at desc);

drop trigger if exists trg_set_institute_id on announcements;
create trigger trg_set_institute_id before insert on announcements
  for each row execute function set_institute_id();

alter table announcements enable row level security;

create policy institute_isolation on announcements as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

create policy "admin/principal manage announcements" on announcements for all
  using (can_approve()) with check (can_approve() and (audience <> 'class' or class_id is not null));

create policy "staff read announcements" on announcements for select using (is_active_staff());
create policy "parent reads institute-wide announcements" on announcements for select using (audience = 'all');
create policy "parent reads own child's class announcements" on announcements for select using (audience = 'class' and is_parent_of_class(class_id));

-- ----------------------------------------------------------------------------
-- Support requests — a parent's own words, not a category this app tries
-- to interpret. No automatic routing or AI triage: it lands as 'open',
-- any active staff member can see and respond to it, and the only status
-- changes are the ones a staff member makes explicitly.
-- ----------------------------------------------------------------------------
create table if not exists support_requests (
  id             uuid primary key default gen_random_uuid(),
  institute_id   uuid not null references institutes(id) on delete cascade,
  parent_user_id uuid not null references users(id) on delete cascade,
  student_id     uuid references students(id) on delete set null,
  category       text not null default 'general' check (category in ('general', 'fees', 'academic', 'attendance', 'technical', 'other')),
  subject        text not null,
  message        text not null,
  status         text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  staff_response text,
  responded_by   uuid references users(id),
  responded_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_support_requests_parent on support_requests(parent_user_id, created_at desc);
create index if not exists idx_support_requests_institute on support_requests(institute_id, status, created_at desc);

drop trigger if exists trg_set_institute_id on support_requests;
create trigger trg_set_institute_id before insert on support_requests
  for each row execute function set_institute_id();

alter table support_requests enable row level security;

create policy institute_isolation on support_requests as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

create policy "parent reads own support requests" on support_requests for select
  using (parent_user_id = (select id from users where auth_user_id = auth.uid()));

create policy "staff read all support requests" on support_requests for select using (is_active_staff());

-- No direct insert/update policy for `authenticated` — both go through
-- the two functions below, so "is this really your own child", the
-- category value, and the status state machine are validated in one
-- place each, same reasoning as create_teacher_draft/
-- set_teacher_draft_status (migration 20260924030000).

create or replace function create_support_request(p_student_id uuid, p_category text, p_subject text, p_message text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_parent_user_id uuid;
  v_id uuid;
begin
  select id into v_parent_user_id from users where auth_user_id = auth.uid();
  if v_parent_user_id is null then
    raise exception 'NOT_AUTHORIZED: Not signed in.';
  end if;
  if not exists (select 1 from users u join roles r on r.id = u.role_id where u.id = v_parent_user_id and r.name = 'Parent') then
    raise exception 'NOT_AUTHORIZED: Only a parent can submit a support request.';
  end if;
  if p_student_id is not null and not is_parent_of(p_student_id) then
    raise exception 'NOT_AUTHORIZED: That student is not linked to your account.';
  end if;
  if p_category not in ('general', 'fees', 'academic', 'attendance', 'technical', 'other') then
    raise exception 'INVALID_CATEGORY: % is not recognized.', p_category;
  end if;
  if coalesce(trim(p_subject), '') = '' or coalesce(trim(p_message), '') = '' then
    raise exception 'EMPTY_FIELDS: Please fill in both the subject and the message.';
  end if;

  insert into support_requests (institute_id, parent_user_id, student_id, category, subject, message)
    values (current_institute_id(), v_parent_user_id, p_student_id, p_category, trim(p_subject), trim(p_message))
    returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function create_support_request(uuid, text, text, text) from public;
grant execute on function create_support_request(uuid, text, text, text) to authenticated;

create or replace function respond_to_support_request(p_id uuid, p_response text, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_responder uuid;
begin
  if not is_active_staff() then
    raise exception 'NOT_AUTHORIZED: Only staff can respond to a support request.';
  end if;
  if p_status not in ('open', 'in_progress', 'resolved', 'closed') then
    raise exception 'INVALID_STATUS: % is not recognized.', p_status;
  end if;

  select id into v_responder from users where auth_user_id = auth.uid();

  update support_requests
    set staff_response = coalesce(nullif(trim(p_response), ''), staff_response),
        status = p_status, responded_by = v_responder, responded_at = now(), updated_at = now()
    where id = p_id and institute_id = current_institute_id();

  if not found then raise exception 'NOT_FOUND: Support request not found.'; end if;
end;
$$;

revoke execute on function respond_to_support_request(uuid, text, text) from public;
grant execute on function respond_to_support_request(uuid, text, text) to authenticated;
