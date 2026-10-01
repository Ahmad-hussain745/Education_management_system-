-- ============================================================================
-- TIMETABLE & SCHEDULING MODULE
--
-- Classes, Teachers, and Subjects already exist (classes, teachers,
-- subjects, teacher_classes — the last of these is reused directly as
-- "who teaches what to whom" instead of inventing a parallel assignment
-- table). New here: Rooms, Periods, Academic Days, Subject frequency (how
-- many periods/week a subject needs — the input the generator plans
-- against), timetable_entries (the grid itself), and Substitutions.
--
-- The generator (generate_timetable_suggestions) is a greedy constraint
-- scheduler, not an optimal solver — it fills slots in a fixed order,
-- respecting teacher availability, room availability, one-subject-per-day
-- per class (unless frequency demands more), and a weekly teacher-load
-- cap, but it does not backtrack or search for a globally optimal
-- arrangement. That's a deliberate scope decision: a real optimal
-- timetabling solver is a research-grade constraint-satisfaction problem;
-- a greedy pass that respects the real constraints and produces a
-- reviewable, editable draft is what actually helps an administrator
-- here, and it's exactly why the result is a DRAFT, not a published
-- timetable — the human doing the final Approve step is expected to
-- adjust slots the algorithm placed imperfectly, not just rubber-stamp it.
--
-- The approval gate itself: generate_timetable_suggestions() only ever
-- INSERTs status = 'draft' rows, tagged with a shared batch_id. Nothing
-- in this migration ever transitions a row to 'published' except
-- publish_timetable_batch(), which is role-gated to Super Admin/
-- Principal — the same tier every other "review, then a human decides"
-- flow in this app already uses (payroll's Approve & Lock, admissions'
-- decide_admission()). A published timetable is what the rest of the app
-- (and, if built later, a public-facing view) would ever read; a draft
-- is only ever visible on the Timetable admin screen itself.
-- ============================================================================

create table rooms (
  id            uuid primary key default gen_random_uuid(),
  institute_id  uuid references institutes(id) on delete cascade,
  name          text not null,
  capacity      int,
  room_type     text,                     -- "Classroom", "Lab", "Hall"...
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table periods (
  id            uuid primary key default gen_random_uuid(),
  institute_id  uuid references institutes(id) on delete cascade,
  name          text not null,             -- "Period 1", "Lunch Break"...
  start_time    time not null,
  end_time      time not null,
  sort_order    int not null default 0,
  is_break      boolean not null default false,
  created_at    timestamptz not null default now()
);

-- day_of_week: 0 = Sunday .. 6 = Saturday (matches extract(dow from date)),
-- so date-based lookups (substitutions, a future "today's timetable" view)
-- never need a separate mapping table.
create table academic_days (
  id            uuid primary key default gen_random_uuid(),
  institute_id  uuid references institutes(id) on delete cascade,
  day_of_week   int not null check (day_of_week between 0 and 6),
  active        boolean not null default true,
  unique (institute_id, day_of_week)
);

create table subject_frequency (
  id                uuid primary key default gen_random_uuid(),
  institute_id      uuid references institutes(id) on delete cascade,
  class_id          uuid not null references classes(id) on delete cascade,
  subject_id        uuid not null references subjects(id) on delete cascade,
  periods_per_week  int not null check (periods_per_week > 0),
  max_per_day       int not null default 1 check (max_per_day > 0),
  unique (institute_id, class_id, subject_id)
);

create table timetable_entries (
  id            uuid primary key default gen_random_uuid(),
  institute_id  uuid references institutes(id) on delete cascade,
  class_id      uuid not null references classes(id) on delete cascade,
  section_id    uuid references sections(id) on delete cascade,
  day_of_week   int not null check (day_of_week between 0 and 6),
  period_id     uuid not null references periods(id) on delete cascade,
  subject_id    uuid references subjects(id) on delete set null,
  teacher_id    uuid references teachers(id) on delete set null,
  room_id       uuid references rooms(id) on delete set null,
  status        text not null default 'draft' check (status in ('draft', 'published')),
  batch_id      uuid,                      -- groups one generation run for bulk approve/discard
  generated     boolean not null default false,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now(),
  -- A draft and a published row CAN occupy the same slot at once (the
  -- draft is a proposed replacement under review) — only two rows of the
  -- SAME status may not collide.
  unique (institute_id, class_id, section_id, day_of_week, period_id, status)
);
create index idx_timetable_entries_institute_status on timetable_entries(institute_id, status);
create index idx_timetable_entries_teacher on timetable_entries(teacher_id, day_of_week, period_id);
create index idx_timetable_entries_batch on timetable_entries(batch_id);

create table timetable_substitutions (
  id                     uuid primary key default gen_random_uuid(),
  institute_id           uuid references institutes(id) on delete cascade,
  timetable_entry_id     uuid not null references timetable_entries(id) on delete cascade,
  date                   date not null,
  original_teacher_id    uuid references teachers(id),
  substitute_teacher_id  uuid not null references teachers(id),
  reason                 text,
  created_by             uuid references users(id),
  created_at             timestamptz not null default now(),
  unique (timetable_entry_id, date)
);

-- institute_id auto-fill + tenant isolation, same boilerplate every table
-- created after 0035 needs.
create trigger trg_set_institute_id before insert on rooms for each row execute function set_institute_id();
create trigger trg_set_institute_id before insert on periods for each row execute function set_institute_id();
create trigger trg_set_institute_id before insert on academic_days for each row execute function set_institute_id();
create trigger trg_set_institute_id before insert on subject_frequency for each row execute function set_institute_id();
create trigger trg_set_institute_id before insert on timetable_entries for each row execute function set_institute_id();
create trigger trg_set_institute_id before insert on timetable_substitutions for each row execute function set_institute_id();

alter table rooms enable row level security;
alter table periods enable row level security;
alter table academic_days enable row level security;
alter table subject_frequency enable row level security;
alter table timetable_entries enable row level security;
alter table timetable_substitutions enable row level security;

create policy institute_isolation on rooms as restrictive for all using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy institute_isolation on periods as restrictive for all using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy institute_isolation on academic_days as restrictive for all using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy institute_isolation on subject_frequency as restrictive for all using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy institute_isolation on timetable_entries as restrictive for all using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy institute_isolation on timetable_substitutions as restrictive for all using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

-- Setup (rooms/periods/academic days/subject frequency): Super Admin or
-- Principal, same tier as Academic Setup elsewhere in this app.
create policy "admin manages rooms" on rooms for all using (is_admin() or current_role_name() = 'Principal') with check (is_admin() or current_role_name() = 'Principal');
create policy "admin manages periods" on periods for all using (is_admin() or current_role_name() = 'Principal') with check (is_admin() or current_role_name() = 'Principal');
create policy "admin manages academic days" on academic_days for all using (is_admin() or current_role_name() = 'Principal') with check (is_admin() or current_role_name() = 'Principal');
create policy "admin manages subject frequency" on subject_frequency for all using (is_admin() or current_role_name() = 'Principal') with check (is_admin() or current_role_name() = 'Principal');

-- Everyone signed in can VIEW rooms/periods/academic days (harmless
-- reference data, and a Teacher needs to see period times same as anyone).
create policy "read rooms" on rooms for select using (is_active_staff());
create policy "read periods" on periods for select using (is_active_staff());
create policy "read academic days" on academic_days for select using (is_active_staff());

-- timetable_entries: admin/Principal write everything; a Teacher may only
-- ever see PUBLISHED entries (never someone else's draft-in-review), and
-- only their own row within those — matching the "own records only"
-- boundary this app already enforces everywhere else for Teacher. Parents
-- are out of scope for this module for now (no student-facing timetable
-- view exists yet) — a real follow-up, not something to improvise here.
create policy "admin manages timetable" on timetable_entries for all
  using (is_admin() or current_role_name() = 'Principal')
  with check (is_admin() or current_role_name() = 'Principal');
create policy "teacher views own published schedule" on timetable_entries for select
  using (status = 'published' and teacher_id = current_teacher_id());
create policy "principal and admin view all timetable" on timetable_entries for select
  using (can_view_finance());

create policy "admin manages substitutions" on timetable_substitutions for all
  using (is_admin() or current_role_name() = 'Principal')
  with check (is_admin() or current_role_name() = 'Principal');
create policy "teacher views own substitutions" on timetable_substitutions for select
  using (original_teacher_id = current_teacher_id() or substitute_teacher_id = current_teacher_id());

-- ----------------------------------------------------------------------------
-- The generator. One batch_id per run, everything it writes is a draft.
-- ----------------------------------------------------------------------------
create or replace function generate_timetable_suggestions(p_class_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_institute      uuid := current_institute_id();
  v_batch_id       uuid := gen_random_uuid();
  v_freq           record;
  v_day            record;
  v_period         record;
  v_teacher        uuid;
  v_room           uuid;
  v_placed_today   int;
  v_placed_week    int;
  v_teacher_weekly_count int;
  v_slot_taken     boolean;
begin
  if not (is_admin() or current_role_name() = 'Principal') then
    raise exception 'NOT_AUTHORIZED: Only Super Admin or Principal can generate timetable suggestions.';
  end if;

  -- One class/subject/day/period placement at a time, in a fixed,
  -- deterministic order — class, then subject (most-frequent-first, so
  -- the tightest constraints get first pick of open slots), then day,
  -- then period.
  for v_freq in
    select sf.class_id, sf.subject_id, sf.periods_per_week, sf.max_per_day
    from subject_frequency sf
    where sf.institute_id = v_institute and (p_class_id is null or sf.class_id = p_class_id)
    order by sf.periods_per_week desc
  loop
    -- Pick the teacher assigned to this class+subject via teacher_classes
    -- (existing table) — the same source of truth Class Assignment
    -- already uses. If more than one teacher is assigned, the first by
    -- id is used; a real multi-teacher-per-subject split is a manual
    -- edit on the draft, not something this pass tries to guess.
    select tc.teacher_id into v_teacher
      from teacher_classes tc
      where tc.class_id = v_freq.class_id and tc.subject_id = v_freq.subject_id
      order by tc.teacher_id limit 1;
    if v_teacher is null then
      continue; -- no teacher assigned to this class/subject — nothing to schedule yet
    end if;

    v_placed_week := 0;
    <<days_loop>>
    for v_day in select day_of_week from academic_days where institute_id = v_institute and active order by day_of_week loop
      exit days_loop when v_placed_week >= v_freq.periods_per_week;
      v_placed_today := 0;

      for v_period in select id from periods where institute_id = v_institute and not is_break order by sort_order loop
        exit when v_placed_today >= v_freq.max_per_day or v_placed_week >= v_freq.periods_per_week;

        -- Teacher availability: not already placed (draft, this batch) at
        -- this day/period for ANY class.
        select exists(
          select 1 from timetable_entries
          where institute_id = v_institute and batch_id = v_batch_id
            and teacher_id = v_teacher and day_of_week = v_day.day_of_week and period_id = v_period.id
        ) into v_slot_taken;
        if v_slot_taken then continue; end if;

        -- Teacher weekly workload cap — 30 periods/week is a reasonable
        -- generic ceiling; a real per-teacher cap is a future refinement,
        -- not something this pass has data to derive yet.
        select count(*) into v_teacher_weekly_count from timetable_entries
          where institute_id = v_institute and batch_id = v_batch_id and teacher_id = v_teacher;
        if v_teacher_weekly_count >= 30 then continue; end if;

        -- This class/section slot must itself be free this run.
        select exists(
          select 1 from timetable_entries
          where institute_id = v_institute and batch_id = v_batch_id
            and class_id = v_freq.class_id and day_of_week = v_day.day_of_week and period_id = v_period.id
        ) into v_slot_taken;
        if v_slot_taken then continue; end if;

        -- Room availability: first active room not already booked this
        -- day/period in this batch.
        select r.id into v_room from rooms r
          where r.institute_id = v_institute and r.active
            and not exists (
              select 1 from timetable_entries te
              where te.institute_id = v_institute and te.batch_id = v_batch_id
                and te.room_id = r.id and te.day_of_week = v_day.day_of_week and te.period_id = v_period.id
            )
          order by r.name limit 1;

        insert into timetable_entries (institute_id, class_id, section_id, day_of_week, period_id, subject_id, teacher_id, room_id, status, batch_id, generated)
          values (v_institute, v_freq.class_id, null, v_day.day_of_week, v_period.id, v_freq.subject_id, v_teacher, v_room, 'draft', v_batch_id, true);

        v_placed_today := v_placed_today + 1;
        v_placed_week := v_placed_week + 1;
      end loop;
    end loop;
  end loop;

  return v_batch_id;
end;
$$;
revoke execute on function generate_timetable_suggestions(uuid) from public;
grant execute on function generate_timetable_suggestions(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- The approval gate. Nothing above this line ever writes status =
-- 'published' — this is the only function that does.
-- ----------------------------------------------------------------------------
create or replace function publish_timetable_batch(p_batch_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_institute uuid := current_institute_id();
  v_count int := 0;
  v_row record;
begin
  if not (is_admin() or current_role_name() = 'Principal') then
    raise exception 'NOT_AUTHORIZED: Only Super Admin or Principal can publish a timetable.';
  end if;

  for v_row in select * from timetable_entries where institute_id = v_institute and batch_id = p_batch_id and status = 'draft' loop
    -- Replace whatever was previously published for this exact slot —
    -- approving a new draft for a slot supersedes the old published
    -- entry, it doesn't sit alongside it.
    delete from timetable_entries
      where institute_id = v_institute and status = 'published'
        and class_id = v_row.class_id and section_id is not distinct from v_row.section_id
        and day_of_week = v_row.day_of_week and period_id = v_row.period_id;

    update timetable_entries set status = 'published' where id = v_row.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
revoke execute on function publish_timetable_batch(uuid) from public;
grant execute on function publish_timetable_batch(uuid) to authenticated;

create or replace function discard_timetable_batch(p_batch_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_institute uuid := current_institute_id();
  v_count int;
begin
  if not (is_admin() or current_role_name() = 'Principal') then
    raise exception 'NOT_AUTHORIZED: Only Super Admin or Principal can discard a timetable draft.';
  end if;
  delete from timetable_entries where institute_id = v_institute and batch_id = p_batch_id and status = 'draft';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function discard_timetable_batch(uuid) from public;
grant execute on function discard_timetable_batch(uuid) to authenticated;
