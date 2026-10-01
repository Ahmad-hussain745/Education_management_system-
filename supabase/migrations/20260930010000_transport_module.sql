-- ============================================================================
-- TRANSPORT — the gap the README's own "Planned, not built at all" section
-- named directly.
--
--   Transport
--   ├── Routes              transport_routes (carries the assigned vehicle
--   │                        + driver directly — a route has one of each at
--   │                        a time; re-assign by updating the row, history
--   │                        isn't tracked, same scope call as most of this
--   │                        app's simpler reference tables)
--   ├── Vehicles             transport_vehicles
--   ├── Drivers               transport_drivers (optionally linked to an
--   │                        HR employees row, same optional-link shape as
--   │                        employees.teacher_id)
--   ├── Students               (no new table — see transport_assignments,
--   │                        which IS the student-to-route link)
--   ├── Stops                  transport_stops, ordered per route
--   ├── Assignments            transport_assignments — one active row per
--   │                        student, which route+stop they ride
--   ├── Vehicle maintenance    transport_maintenance
--   ├── Fuel                   transport_fuel_logs
--   └── Transport fees         transport_fee_structures/records/payments —
--                            modeled closely on fee_structures/fee_records/
--                            fee_payments (0001), but DELIBERATELY SEPARATE.
--
-- Then automated, all five grounded in real rows — no LLM, same "signal
-- from a real number, not an opinion" choice this app already made for
-- Student Risk Signals and Assignment Difficulty:
--   maintenance reminders   get_transport_maintenance_due()
--   insurance expiry alerts \_ get_transport_expiry_alerts() (kind-tagged
--   license expiry alerts   /  union, one function, one dashboard panel)
--   fuel analytics           get_vehicle_fuel_analytics()
--   route occupancy          get_route_occupancy()
--
-- WHY TRANSPORT FEES IS ITS OWN BILLING TRAIL, NOT A COLUMN ADDED TO
-- fee_records: fee_records.total_payable is read by more of this app than
-- any other single number — Ask MSA's get_fee_summary, Student Risk's
-- Financial signal, every Fee/Financial report, receipts, Communication
-- Center templates. Redefining what it MEANS (folding transport in) would
-- silently change "outstanding tuition" everywhere that reads it, for
-- modules that were never updated to know transport is now mixed in. A
-- second billing trail, obviously transport's own, costs one more set of
-- tables and gives every one of those existing numbers a guarantee: they
-- still mean exactly what they meant before this migration. Same reasoning
-- HR used to keep Payroll untouched.
-- ============================================================================

create table if not exists transport_vehicles (
  id               uuid primary key default gen_random_uuid(),
  institute_id     uuid not null references institutes(id) on delete cascade,
  registration_no  text not null,
  vehicle_type     text not null default 'bus' check (vehicle_type in ('bus', 'van', 'car', 'other')),
  make             text,
  model            text,
  year             int,
  capacity         int not null check (capacity > 0),
  insurance_expiry date,
  fitness_expiry   date,
  odometer_reading numeric(10, 1),
  status           text not null default 'active' check (status in ('active', 'maintenance', 'inactive')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (institute_id, registration_no)
);

drop trigger if exists trg_set_institute_id on transport_vehicles;
create trigger trg_set_institute_id before insert on transport_vehicles
  for each row execute function set_institute_id();

alter table transport_vehicles enable row level security;
create policy institute_isolation on transport_vehicles as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy "staff read vehicles" on transport_vehicles for select using (is_active_staff());
create policy "HR admin manages vehicles" on transport_vehicles for all using (can_approve()) with check (can_approve());

create table if not exists transport_drivers (
  id             uuid primary key default gen_random_uuid(),
  institute_id   uuid not null references institutes(id) on delete cascade,
  employee_id    uuid unique references employees(id) on delete set null,
  name           text not null,
  phone          text,
  license_no     text,
  license_expiry date,
  address        text,
  status         text not null default 'active' check (status in ('active', 'inactive')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists trg_set_institute_id on transport_drivers;
create trigger trg_set_institute_id before insert on transport_drivers
  for each row execute function set_institute_id();

alter table transport_drivers enable row level security;
create policy institute_isolation on transport_drivers as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy "staff read drivers" on transport_drivers for select using (is_active_staff());
create policy "HR admin manages drivers" on transport_drivers for all using (can_approve()) with check (can_approve());

create table if not exists transport_routes (
  id           uuid primary key default gen_random_uuid(),
  institute_id uuid not null references institutes(id) on delete cascade,
  name         text not null,
  description  text,
  vehicle_id   uuid references transport_vehicles(id) on delete set null,
  driver_id    uuid references transport_drivers(id) on delete set null,
  status       text not null default 'active' check (status in ('active', 'inactive')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (institute_id, name)
);

drop trigger if exists trg_set_institute_id on transport_routes;
create trigger trg_set_institute_id before insert on transport_routes
  for each row execute function set_institute_id();

alter table transport_routes enable row level security;
create policy institute_isolation on transport_routes as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy "staff read routes" on transport_routes for select using (is_active_staff());
create policy "HR admin manages routes" on transport_routes for all using (can_approve()) with check (can_approve());

create table if not exists transport_stops (
  id             uuid primary key default gen_random_uuid(),
  institute_id   uuid not null references institutes(id) on delete cascade,
  route_id       uuid not null references transport_routes(id) on delete cascade,
  name           text not null,
  sequence_order int not null default 0,
  pickup_time    time,
  drop_time      time,
  latitude       numeric(9, 6),
  longitude      numeric(9, 6),
  created_at     timestamptz not null default now(),
  unique (route_id, sequence_order)
);

drop trigger if exists trg_set_institute_id on transport_stops;
create trigger trg_set_institute_id before insert on transport_stops
  for each row execute function set_institute_id();

alter table transport_stops enable row level security;
create policy institute_isolation on transport_stops as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy "staff read stops" on transport_stops for select using (is_active_staff());
create policy "HR admin manages stops" on transport_stops for all using (can_approve()) with check (can_approve());

-- One ACTIVE assignment per student, enforced structurally (a partial
-- unique index), not by application discipline — re-assigning a student
-- means ending the old row (status='ended', effective_to set) and creating
-- a new one, which assign_student_transport() below does as one atomic
-- action rather than trusting two separate client calls to happen in order.
create table if not exists transport_assignments (
  id              uuid primary key default gen_random_uuid(),
  institute_id    uuid not null references institutes(id) on delete cascade,
  student_id      uuid not null references students(id) on delete cascade,
  route_id        uuid not null references transport_routes(id) on delete cascade,
  stop_id         uuid references transport_stops(id) on delete set null,
  effective_from  date not null default current_date,
  effective_to    date,
  status          text not null default 'active' check (status in ('active', 'ended')),
  created_at      timestamptz not null default now()
);
create unique index if not exists uq_transport_assignment_active on transport_assignments(student_id) where status = 'active';
create index if not exists idx_transport_assignments_route on transport_assignments(route_id, status);

drop trigger if exists trg_set_institute_id on transport_assignments;
create trigger trg_set_institute_id before insert on transport_assignments
  for each row execute function set_institute_id();

alter table transport_assignments enable row level security;
create policy institute_isolation on transport_assignments as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy "staff read assignments" on transport_assignments for select using (is_active_staff());
create policy "HR admin manages assignments" on transport_assignments for all using (can_approve()) with check (can_approve());
create policy "parent reads own child's assignment" on transport_assignments for select using (is_parent_of(student_id));

-- Ends any current assignment and starts a new one, in one transaction —
-- the partial unique index above means a naive "insert the new row" would
-- simply fail while an old one is still active, so this is the only
-- correct way to move a student between routes/stops.
create or replace function assign_student_transport(p_student_id uuid, p_route_id uuid, p_stop_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not can_approve() then
    raise exception 'NOT_AUTHORIZED: Only Super Admin/Principal can manage transport assignments.';
  end if;
  if not exists (select 1 from students where id = p_student_id and institute_id = current_institute_id()) then
    raise exception 'NOT_FOUND: Student not found.';
  end if;
  if not exists (select 1 from transport_routes where id = p_route_id and institute_id = current_institute_id()) then
    raise exception 'NOT_FOUND: Route not found.';
  end if;
  if p_stop_id is not null and not exists (select 1 from transport_stops where id = p_stop_id and route_id = p_route_id) then
    raise exception 'INVALID_STOP: That stop does not belong to the chosen route.';
  end if;

  update transport_assignments set status = 'ended', effective_to = current_date
    where student_id = p_student_id and status = 'active';

  insert into transport_assignments (institute_id, student_id, route_id, stop_id)
    values (current_institute_id(), p_student_id, p_route_id, p_stop_id)
    returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function assign_student_transport(uuid, uuid, uuid) from public;
grant execute on function assign_student_transport(uuid, uuid, uuid) to authenticated;

create or replace function end_student_transport(p_student_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_approve() then
    raise exception 'NOT_AUTHORIZED: Only Super Admin/Principal can manage transport assignments.';
  end if;
  update transport_assignments set status = 'ended', effective_to = current_date
    where student_id = p_student_id and status = 'active' and institute_id = current_institute_id();
end;
$$;
revoke execute on function end_student_transport(uuid) from public;
grant execute on function end_student_transport(uuid) to authenticated;

-- Safe, narrow read for a parent: route/stop/vehicle/driver NAME and
-- CONTACT fields only — never the driver's license number or the
-- vehicle's maintenance/insurance detail. Same "RLS is row-level, a
-- table with columns a parent shouldn't see needs a function, not a
-- policy" reasoning as Parent Portal 2.0's get_child_timetable
-- (20260926010000's header explains it at length).
create or replace function get_child_transport(p_student_id uuid)
returns table(route_name text, stop_name text, pickup_time time, drop_time time, vehicle_registration text, vehicle_type text, driver_name text, driver_phone text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_parent_of(p_student_id) or is_active_staff()) then
    raise exception 'NOT_AUTHORIZED: Not authorized to view this student''s transport.';
  end if;
  return query
  select r.name, s.name, s.pickup_time, s.drop_time, v.registration_no, v.vehicle_type, d.name, d.phone
  from transport_assignments ta
  join transport_routes r on r.id = ta.route_id
  left join transport_stops s on s.id = ta.stop_id
  left join transport_vehicles v on v.id = r.vehicle_id
  left join transport_drivers d on d.id = r.driver_id
  where ta.student_id = p_student_id and ta.status = 'active';
end;
$$;
revoke execute on function get_child_transport(uuid) from public;
grant execute on function get_child_transport(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Vehicle maintenance
-- ----------------------------------------------------------------------------
create table if not exists transport_maintenance (
  id                uuid primary key default gen_random_uuid(),
  institute_id      uuid not null references institutes(id) on delete cascade,
  vehicle_id        uuid not null references transport_vehicles(id) on delete cascade,
  maintenance_type  text not null default 'service' check (maintenance_type in ('service', 'repair', 'inspection', 'other')),
  description       text,
  service_date      date not null default current_date,
  next_due_date     date,
  cost              numeric(10, 2),
  odometer_reading  numeric(10, 1),
  vendor            text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_transport_maintenance_vehicle on transport_maintenance(vehicle_id, service_date desc);

drop trigger if exists trg_set_institute_id on transport_maintenance;
create trigger trg_set_institute_id before insert on transport_maintenance
  for each row execute function set_institute_id();

alter table transport_maintenance enable row level security;
create policy institute_isolation on transport_maintenance as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy "staff read maintenance" on transport_maintenance for select using (is_active_staff());
create policy "HR admin manages maintenance" on transport_maintenance for all using (can_approve()) with check (can_approve());

-- A logged odometer reading updates the vehicle's own latest-known
-- reading whenever it's higher than what's on file — maintenance and
-- fuel logs both do this (see the matching trigger below on fuel logs),
-- so "current odometer" always reflects whichever log was entered most
-- recently, from either source, without a person having to update it by
-- hand in two places.
create or replace function _bump_vehicle_odometer() returns trigger as $$
begin
  if new.odometer_reading is not null then
    update transport_vehicles set odometer_reading = new.odometer_reading, updated_at = now()
      where id = new.vehicle_id and (odometer_reading is null or odometer_reading < new.odometer_reading);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_maintenance_bump_odometer after insert on transport_maintenance
  for each row execute function _bump_vehicle_odometer();

-- Maintenance reminders: each vehicle's MOST RECENT maintenance record
-- (by service_date) carries the standing next_due_date — an older
-- record's next_due is superseded, not summed or maxed.
create or replace function get_transport_maintenance_due(p_days int default 30)
returns table(vehicle_id uuid, registration_no text, vehicle_type text, last_service_date date, next_due_date date, days_remaining int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_active_staff() then raise exception 'NOT_AUTHORIZED: Not authorized.'; end if;
  return query
  with latest as (
    select distinct on (m.vehicle_id) m.vehicle_id, m.service_date, m.next_due_date
    from transport_maintenance m
    where m.institute_id = current_institute_id()
    order by m.vehicle_id, m.service_date desc
  )
  select v.id, v.registration_no, v.vehicle_type, l.service_date, l.next_due_date, (l.next_due_date - current_date)::int
  from latest l
  join transport_vehicles v on v.id = l.vehicle_id
  where l.next_due_date is not null and l.next_due_date <= current_date + p_days and v.status <> 'inactive'
  order by l.next_due_date;
end;
$$;
revoke execute on function get_transport_maintenance_due(int) from public;
grant execute on function get_transport_maintenance_due(int) to authenticated;

-- ----------------------------------------------------------------------------
-- Fuel
-- ----------------------------------------------------------------------------
create table if not exists transport_fuel_logs (
  id                uuid primary key default gen_random_uuid(),
  institute_id      uuid not null references institutes(id) on delete cascade,
  vehicle_id        uuid not null references transport_vehicles(id) on delete cascade,
  fuel_date         date not null default current_date,
  liters            numeric(8, 2) not null check (liters > 0),
  cost              numeric(10, 2) not null check (cost >= 0),
  odometer_reading  numeric(10, 1),
  filled_by         uuid references users(id),
  notes             text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_transport_fuel_logs_vehicle on transport_fuel_logs(vehicle_id, fuel_date desc);

drop trigger if exists trg_set_institute_id on transport_fuel_logs;
create trigger trg_set_institute_id before insert on transport_fuel_logs
  for each row execute function set_institute_id();

alter table transport_fuel_logs enable row level security;
create policy institute_isolation on transport_fuel_logs as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy "staff read fuel logs" on transport_fuel_logs for select using (is_active_staff());
create policy "HR admin manages fuel logs" on transport_fuel_logs for all using (can_approve()) with check (can_approve());

create trigger trg_fuel_bump_odometer after insert on transport_fuel_logs
  for each row execute function _bump_vehicle_odometer();

-- Fuel analytics: total spend/volume over the window, and mileage as
-- distance (highest minus lowest ODOMETER READING actually logged in the
-- window, not liters-implied) divided by liters bought in between. That
-- means mileage needs at least two readings in the window to mean
-- anything — with fewer, it's returned null rather than a number that
-- would look precise but isn't (e.g. dividing by a single fill-up's
-- liters with no distance to attribute them to).
create or replace function get_vehicle_fuel_analytics(p_vehicle_id uuid, p_months int default 6)
returns table(total_liters numeric, total_cost numeric, avg_cost_per_liter numeric, distance_km numeric, mileage_km_per_liter numeric, fill_count int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_since date := (date_trunc('month', current_date) - (greatest(1, coalesce(p_months, 6)) - 1) * interval '1 month')::date;
begin
  if not is_active_staff() then raise exception 'NOT_AUTHORIZED: Not authorized.'; end if;
  return query
  with logs as (select * from transport_fuel_logs where vehicle_id = p_vehicle_id and fuel_date >= v_since),
  odo as (select max(odometer_reading) - min(odometer_reading) as span, count(odometer_reading) as n from logs where odometer_reading is not null)
  select
    coalesce(sum(l.liters), 0), coalesce(sum(l.cost), 0),
    case when coalesce(sum(l.liters), 0) > 0 then round(sum(l.cost) / sum(l.liters), 2) else null end,
    case when (select n from odo) >= 2 then (select span from odo) else null end,
    case when (select n from odo) >= 2 and sum(l.liters) > 0 then round((select span from odo) / sum(l.liters), 2) else null end,
    count(*)::int
  from logs l;
end;
$$;
revoke execute on function get_vehicle_fuel_analytics(uuid, int) from public;
grant execute on function get_vehicle_fuel_analytics(uuid, int) to authenticated;

-- ----------------------------------------------------------------------------
-- Expiry alerts — vehicle insurance and driver license, one function.
-- ----------------------------------------------------------------------------
create or replace function get_transport_expiry_alerts(p_days int default 30)
returns table(kind text, subject_id uuid, subject_name text, detail text, expiry_date date, days_remaining int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_active_staff() then raise exception 'NOT_AUTHORIZED: Not authorized.'; end if;
  return query
  select 'insurance', v.id, v.registration_no, v.vehicle_type, v.insurance_expiry, (v.insurance_expiry - current_date)::int
  from transport_vehicles v
  where v.institute_id = current_institute_id() and v.status <> 'inactive'
    and v.insurance_expiry is not null and v.insurance_expiry <= current_date + p_days
  union all
  select 'license', d.id, d.name, coalesce(d.license_no, ''), d.license_expiry, (d.license_expiry - current_date)::int
  from transport_drivers d
  where d.institute_id = current_institute_id() and d.status = 'active'
    and d.license_expiry is not null and d.license_expiry <= current_date + p_days
  order by 5; -- expiry_date by position: a bare name here risks the same
              -- out-parameter collision fixed in get_route_occupancy above
end;
$$;
revoke execute on function get_transport_expiry_alerts(int) from public;
grant execute on function get_transport_expiry_alerts(int) to authenticated;

-- ----------------------------------------------------------------------------
-- Route occupancy
-- ----------------------------------------------------------------------------
create or replace function get_route_occupancy()
returns table(route_id uuid, route_name text, vehicle_registration text, capacity int, assigned_count int, occupancy_pct numeric, over_capacity boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_active_staff() then raise exception 'NOT_AUTHORIZED: Not authorized.'; end if;
  return query
  select r.id, r.name, v.registration_no, v.capacity,
    coalesce(a.n, 0)::int,
    case when v.capacity > 0 then round(100.0 * coalesce(a.n, 0) / v.capacity, 1) else null end,
    coalesce(a.n, 0) > coalesce(v.capacity, 0)
  from transport_routes r
  left join transport_vehicles v on v.id = r.vehicle_id
  -- ta.route_id, aliased to rid: PL/pgSQL resolves a bare "route_id" here
  -- against this function's OWN out-parameter of that name before SQL
  -- ever sees it (ambiguous, fails at call time even though a plain SQL
  -- reader would call it obviously unambiguous) — caught by actually
  -- running this function, not by reading it; see docs/TRANSPORT_MODULE.md.
  left join (select ta.route_id as rid, count(*) as n from transport_assignments ta where ta.status = 'active' group by ta.route_id) a on a.rid = r.id
  where r.institute_id = current_institute_id() and r.status = 'active'
  order by r.name;
end;
$$;
revoke execute on function get_route_occupancy() from public;
grant execute on function get_route_occupancy() to authenticated;

-- ----------------------------------------------------------------------------
-- Transport fees — closely modeled on fee_structures / fee_records /
-- fee_payments (0001) and generate_monthly_fee_records / preview_monthly_
-- fee_generation (0021), but its own tables end to end. See this file's
-- header for why. Only students with an ACTIVE transport_assignments row
-- are billed — ending an assignment stops future months' bills without
-- touching past ones.
-- ----------------------------------------------------------------------------
create table if not exists transport_fee_structures (
  id              uuid primary key default gen_random_uuid(),
  institute_id    uuid not null references institutes(id) on delete cascade,
  route_id        uuid references transport_routes(id) on delete cascade,
  student_id      uuid references students(id) on delete cascade,
  monthly_fee     numeric(12, 2) not null check (monthly_fee >= 0),
  effective_from  date not null default current_date,
  created_at      timestamptz not null default now(),
  check ((route_id is not null and student_id is null) or (route_id is null and student_id is not null))
);
create unique index if not exists uq_transport_fee_structure_route on transport_fee_structures(route_id) where student_id is null;
create unique index if not exists uq_transport_fee_structure_student on transport_fee_structures(student_id) where student_id is not null;

drop trigger if exists trg_set_institute_id on transport_fee_structures;
create trigger trg_set_institute_id before insert on transport_fee_structures
  for each row execute function set_institute_id();

alter table transport_fee_structures enable row level security;
create policy institute_isolation on transport_fee_structures as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy "fee staff read transport fee structures" on transport_fee_structures for select using (can_view_fees());
create policy "HR admin manages transport fee structures" on transport_fee_structures for all using (can_approve()) with check (can_approve());

create table if not exists transport_fee_records (
  id                uuid primary key default gen_random_uuid(),
  institute_id      uuid not null references institutes(id) on delete cascade,
  student_id        uuid not null references students(id) on delete cascade,
  month             date not null,
  monthly_fee       numeric(12, 2) not null,
  previous_balance  numeric(12, 2) not null default 0,
  total_payable     numeric(12, 2) generated always as (monthly_fee + previous_balance) stored,
  paid_total        numeric(12, 2) not null default 0,
  status            fee_status not null default 'unpaid',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (student_id, month)
);
create index if not exists idx_transport_fee_records_month on transport_fee_records(month);

drop trigger if exists trg_set_institute_id on transport_fee_records;
create trigger trg_set_institute_id before insert on transport_fee_records
  for each row execute function set_institute_id();

alter table transport_fee_records enable row level security;
create policy institute_isolation on transport_fee_records as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy "fee staff read transport fee records" on transport_fee_records for select using (can_view_fees());
create policy "parent reads own child's transport fee records" on transport_fee_records for select using (is_parent_of(student_id));
-- No insert/update policy for anyone — only get_or_create_transport_fee_
-- record() (SECURITY DEFINER) writes rows; trg_transport_fee_payments_sync
-- (below) is the only thing that updates paid_total/status.

create table if not exists transport_fee_payments (
  id            uuid primary key default gen_random_uuid(),
  institute_id  uuid not null references institutes(id) on delete cascade,
  fee_record_id uuid not null references transport_fee_records(id) on delete restrict,
  student_id    uuid not null references students(id) on delete restrict,
  month         date not null,
  amount        numeric(12, 2) not null check (amount > 0),
  method        payment_method not null default 'Cash',
  remarks       text,
  paid_on       date not null default current_date,
  received_by   uuid references users(id),
  created_at    timestamptz not null default now()
);
create index if not exists idx_transport_fee_payments_student_month on transport_fee_payments(student_id, month);

drop trigger if exists trg_set_institute_id on transport_fee_payments;
create trigger trg_set_institute_id before insert on transport_fee_payments
  for each row execute function set_institute_id();

alter table transport_fee_payments enable row level security;
create policy institute_isolation on transport_fee_payments as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy "fee staff read transport fee payments" on transport_fee_payments for select using (can_view_fees());
create policy "parent reads own child's transport fee payments" on transport_fee_payments for select using (is_parent_of(student_id));
create policy "finance staff record transport payments" on transport_fee_payments for insert
  with check (current_role_name() in ('Super Admin', 'Accountant', 'Cashier'));

-- Mirrors sync_fee_record_totals() (0001) exactly, for the transport table.
create or replace function _sync_transport_fee_record_totals() returns trigger as $$
declare
  rec_id  uuid := coalesce(new.fee_record_id, old.fee_record_id);
  total   numeric(12, 2);
  payable numeric(12, 2);
begin
  select coalesce(sum(amount), 0) into total from transport_fee_payments where fee_record_id = rec_id;
  select total_payable into payable from transport_fee_records where id = rec_id;
  update transport_fee_records
    set paid_total = total,
        status = (case when total <= 0 then 'unpaid' when total < payable then 'partial' else 'paid' end)::fee_status
    where id = rec_id;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_transport_fee_payments_sync
  after insert or update or delete on transport_fee_payments
  for each row execute function _sync_transport_fee_record_totals();

-- Mirrors get_or_create_fee_record() (0003): idempotent, resolves
-- student-specific fee first then the route-level default, rolls forward
-- the unpaid balance. Only bills a student with an ACTIVE assignment.
create or replace function get_or_create_transport_fee_record(p_student_id uuid, p_month date)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_month         date := date_trunc('month', p_month)::date;
  v_fee_record_id uuid;
  v_route_id      uuid;
  v_monthly_fee   numeric(12, 2);
  v_prev_balance  numeric(12, 2) := 0;
begin
  select id into v_fee_record_id from transport_fee_records where student_id = p_student_id and month = v_month;
  if v_fee_record_id is not null then return v_fee_record_id; end if;

  select route_id into v_route_id from transport_assignments where student_id = p_student_id and status = 'active';
  if v_route_id is null then
    raise exception 'NO_ASSIGNMENT: This student has no active transport assignment.';
  end if;

  select monthly_fee into v_monthly_fee from transport_fee_structures where student_id = p_student_id;
  if v_monthly_fee is null then
    select monthly_fee into v_monthly_fee from transport_fee_structures where route_id = v_route_id;
  end if;
  if v_monthly_fee is null then
    raise exception 'NO_FEE_STRUCTURE: No transport fee is set for this student or their route.';
  end if;

  select greatest(total_payable - paid_total, 0) into v_prev_balance
    from transport_fee_records where student_id = p_student_id and month < v_month order by month desc limit 1;
  v_prev_balance := coalesce(v_prev_balance, 0);

  insert into transport_fee_records (institute_id, student_id, month, monthly_fee, previous_balance)
    values (current_institute_id(), p_student_id, v_month, v_monthly_fee, v_prev_balance)
    returning id into v_fee_record_id;
  return v_fee_record_id;
end;
$$;
revoke execute on function get_or_create_transport_fee_record(uuid, date) from public;
grant execute on function get_or_create_transport_fee_record(uuid, date) to authenticated;

-- Mirrors preview_monthly_fee_generation() (0021): same three finance
-- roles, same shape.
create or replace function preview_transport_fee_generation(p_month date)
returns table(assigned_students int, already_generated int, to_generate int, expected_amount numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  if current_role_name() not in ('Super Admin', 'Accountant', 'Cashier') then
    raise exception 'NOT_AUTHORIZED: Not authorized to preview transport fee generation.';
  end if;
  return query
  with assigned as (
    select ta.student_id, ta.route_id from transport_assignments ta where ta.status = 'active'
  ),
  billable as (
    select a.student_id, coalesce(
      (select monthly_fee from transport_fee_structures where student_id = a.student_id),
      (select monthly_fee from transport_fee_structures where route_id = a.route_id)
    ) as fee
    from assigned a
  )
  select
    (select count(*) from assigned)::int,
    (select count(*) from transport_fee_records fr join assigned a on a.student_id = fr.student_id where fr.month = v_month)::int,
    (select count(*) from billable b where b.fee is not null
       and not exists (select 1 from transport_fee_records fr where fr.student_id = b.student_id and fr.month = v_month))::int,
    coalesce((select sum(b.fee) from billable b where b.fee is not null
       and not exists (select 1 from transport_fee_records fr where fr.student_id = b.student_id and fr.month = v_month)), 0);
end;
$$;
revoke execute on function preview_transport_fee_generation(date) from public;
grant execute on function preview_transport_fee_generation(date) to authenticated;

-- Mirrors generate_monthly_fee_records() (0021): loops, calls the
-- get-or-create above, counts generated vs. skipped. A student with no fee
-- structure resolvable is silently left out of the loop (same as
-- preview's "billable" filter) rather than counted as failed — no
-- structure means no bill yet, not an error to alarm someone over.
create or replace function generate_transport_fee_records(p_month date)
returns table(generated_count int, skipped_count int, total_expected numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_month     date := date_trunc('month', p_month)::date;
  v_row       record;
  v_generated int := 0;
  v_skipped   int := 0;
  v_existed   boolean;
begin
  if current_role_name() not in ('Super Admin', 'Accountant', 'Cashier') then
    raise exception 'NOT_AUTHORIZED: Not authorized to generate transport fee records.';
  end if;

  for v_row in
    select ta.student_id, ta.route_id from transport_assignments ta where ta.status = 'active'
  loop
    if coalesce(
      (select monthly_fee from transport_fee_structures where student_id = v_row.student_id),
      (select monthly_fee from transport_fee_structures where route_id = v_row.route_id)
    ) is null then
      continue;
    end if;

    select exists(select 1 from transport_fee_records where student_id = v_row.student_id and month = v_month) into v_existed;
    perform get_or_create_transport_fee_record(v_row.student_id, v_month);
    if v_existed then v_skipped := v_skipped + 1; else v_generated := v_generated + 1; end if;
  end loop;

  return query select v_generated, v_skipped, coalesce((select sum(total_payable) from transport_fee_records where month = v_month), 0);
end;
$$;
revoke execute on function generate_transport_fee_records(date) from public;
grant execute on function generate_transport_fee_records(date) to authenticated;
