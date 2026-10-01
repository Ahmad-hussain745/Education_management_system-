-- ============================================================================
-- 43. OFFLINE STUDENT REGISTRATION
--
-- Phase 9. createStudent() (app/(app)/students/actions.js) currently does a
-- raw client insert with student_code assigned by nextStudentCode() —
-- scan every existing "MSA-{year}-*" row in JS, take the max, add one. That
-- function's own comment already admits the risk: "if two cashiers save at
-- the same instant they could collide... a collision doesn't fail the
-- insert (student_code has no unique constraint)". Fine, barely, for one
-- browser tab colliding with another over a live connection. Not fine for
-- offline: N devices each computing "next code" from their own
-- last-synced cache, with no way to see each other's in-flight inserts
-- until sync, would produce the exact same code for different children far
-- more often than the online case ever did.
--
-- The fix has two parts:
--   1. The official student_code is never computed in the browser, online
--      or offline — create_student() below does it, inside the same
--      transaction as the insert, via student_code_counters (an atomic
--      upsert, not a scan-and-guess).
--   2. A LOCAL record (local_id, an offline-generated uuid) is what an
--      offline device actually has until it syncs — never presented as if
--      it were the official record. See lib/offline/repositories/
--      students.js for the client-side half of this: that local_id
--      doubles as this function's idempotency key, so a device's retry of
--      its own sync (or two sync attempts after a dropped response) can
--      never produce two students for one registration, the same
--      protection 0042_payment_idempotency.sql gives a payment.
-- ============================================================================

alter table students add column if not exists idempotency_key uuid unique;

-- One row per institute per year. next_seq starts at 1 and is claimed
-- atomically by the upsert in create_student() below — no SELECT-then-
-- INSERT race window, because the claim and the increment are the same
-- statement.
create table if not exists student_code_counters (
  institute_id uuid not null references institutes(id) on delete cascade,
  year         int  not null,
  next_seq     int  not null default 1,
  primary key (institute_id, year)
);

create or replace function create_student(
  p_name text,
  p_guardian_name text default null,
  p_guardian_phone text default null,
  p_class_id uuid default null,
  p_section_id uuid default null,
  p_admission_date date default current_date,
  p_status text default 'active',
  p_student_code text default null,     -- manual override (online form only); left null → auto-assigned below
  p_monthly_fee numeric default null,
  p_discount numeric default null,
  p_discount_reason text default null,
  p_idempotency_key uuid default null
)
returns students
language plpgsql security definer set search_path = public as $$
declare
  v_row students;
  v_institute_id uuid;
  v_year int;
  v_seq int;
  v_code text;
begin
  -- Same ordering as record_fee_payment() (0042) and record_inventory_
  -- purchase() (0028): the idempotency check runs before anything else,
  -- including authorization, so a retry of an already-successful
  -- registration is never rejected by state that registration itself
  -- changed — and, specifically here, never burns a second student_code
  -- for the same child.
  if p_idempotency_key is not null then
    select * into v_row from students where idempotency_key = p_idempotency_key;
    if found then
      return v_row;
    end if;
  end if;

  if not is_finance_staff() then
    raise exception 'NOT_AUTHORIZED: Not authorized to add a student.';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'INVALID_NAME: Student name is required.';
  end if;

  v_institute_id := current_institute_id();

  if p_student_code is not null and btrim(p_student_code) <> '' then
    v_code := btrim(p_student_code);
  else
    v_year := extract(year from coalesce(p_admission_date, current_date))::int;
    -- The atomic claim: insert year 1 the first time, or bump an existing
    -- year's counter — either way in one statement, so two callers hitting
    -- this at the same instant (two cashiers online, or a sync engine
    -- processing two offline registrations back to back) get two different
    -- numbers, never the same one.
    insert into student_code_counters (institute_id, year, next_seq)
    values (v_institute_id, v_year, 2)
    on conflict (institute_id, year)
    do update set next_seq = student_code_counters.next_seq + 1
    returning next_seq - 1 into v_seq;
    v_code := 'MSA-' || v_year || '-' || lpad(v_seq::text, 5, '0');
  end if;

  -- institute_id deliberately omitted — set_institute_id() (0035) fills it
  -- from the caller's own session, same as every other tenant-table insert
  -- in this app.
  insert into students (
    student_code, name, guardian_name, guardian_phone, class_id, section_id,
    admission_date, status, idempotency_key
  ) values (
    v_code, btrim(p_name), nullif(btrim(coalesce(p_guardian_name, '')), ''), nullif(btrim(coalesce(p_guardian_phone, '')), ''),
    p_class_id, p_section_id, coalesce(p_admission_date, current_date),
    coalesce(p_status, 'active')::person_status, p_idempotency_key
  )
  returning * into v_row;

  -- Fee override + discount in the SAME transaction as the student insert
  -- — unlike the old client-side flow (three separate requests, "Student
  -- saved, but the fee override failed" as a possible half-done outcome),
  -- a failure here rolls the whole registration back rather than leaving
  -- a student with no override half-saved.
  if p_monthly_fee is not null and p_monthly_fee > 0 then
    insert into fee_structures (student_id, monthly_fee) values (v_row.id, p_monthly_fee);
  end if;
  if p_discount is not null and p_discount > 0 then
    insert into fee_discounts (student_id, amount, reason) values (v_row.id, p_discount, p_discount_reason);
  end if;

  return v_row;
end;
$$;

revoke execute on function create_student(text, text, text, uuid, uuid, date, text, text, numeric, numeric, text, uuid) from public;
grant execute on function create_student(text, text, text, uuid, uuid, date, text, text, numeric, numeric, text, uuid) to authenticated;
