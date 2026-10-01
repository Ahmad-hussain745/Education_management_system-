-- ============================================================================
-- ADMISSIONS / ENROLLMENT MODULE
--
-- Enquiry -> Applicant -> Application -> Interview/Test -> Document
-- verification -> Decision -> Enrollment -> Student conversion, exactly
-- the flow requested. Built on top of the same conventions every other
-- module in this schema already uses, including the ones the Priority 3
-- security audit had to add back onto older functions retroactively —
-- applied here from the start instead:
--   - every table gets institute_id via the same set_institute_id()
--     trigger + institute_isolation RESTRICTIVE policy as everything else
--   - every SECURITY DEFINER function sets search_path = public
--   - every function taking a foreign-key-shaped uuid parameter validates
--     that row's institute_id against current_institute_id() before using
--     it, not just relying on the caller's own current_institute_id() to
--     be correct
--   - enum-typed parameters where the value maps to an enum column
--     (see the Priority 3 finding about record_fee_payment's p_method
--     being wrongly typed text — not repeating that here)
--   - one enrollment RPC, not a raw multi-table INSERT from the client,
--     so "convert this applicant into a student" is one auditable,
--     transactional, authorization-checked action, the same reasoning
--     behind record_fee_payment/record_stock_movement being RPCs instead
--     of direct table writes
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------
do $$ begin
  create type enquiry_status as enum ('open', 'contacted', 'converted', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type enquiry_source as enum ('walk_in', 'phone', 'website', 'referral', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type application_status as enum (
    'submitted', 'under_review', 'interview_scheduled', 'test_scheduled',
    'documents_pending', 'decision_pending', 'approved', 'rejected',
    'waitlisted', 'enrolled', 'withdrawn'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type admission_event_status as enum ('scheduled', 'completed', 'cancelled', 'no_show');
exception when duplicate_object then null; end $$;

do $$ begin
  create type admission_document_status as enum ('pending', 'submitted', 'verified', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type admission_decision_type as enum ('approved', 'rejected', 'waitlisted');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. Registrar role — front-office/admissions staff who aren't the
--    Principal or Super Admin. Scoped, deliberately: is_admissions_staff()
--    below is the only place this role gets any special access. It does
--    NOT appear in is_finance_staff()/can_view_finance()/can_approve(), so
--    a Registrar gets no fees/salary/payroll access just by existing —
--    same least-privilege reasoning as every other role in this schema.
--    It DOES fall under is_active_staff() (0030_parent_portal.sql's "not
--    a Parent" check), same as Teacher/Cashier/Accountant already do, so
--    a Registrar can browse students/classes the same ordinary way any
--    staff member can — genuinely necessary for admissions work (checking
--    for space in a class, avoiding duplicate names), not an oversight.
-- ----------------------------------------------------------------------------
insert into roles (name, permissions) values
  ('Registrar', '["admissions.view","admissions.write","admissions.decide"]')
on conflict (name) do nothing;

create or replace function is_admissions_staff() returns boolean as $$
  select current_role_name() in ('Super Admin', 'Principal', 'Registrar');
$$ language sql stable security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- 3. ENQUIRY — the very first contact, often before there's even a named
--    applicant yet ("someone called asking about Class 3 for next year").
-- ----------------------------------------------------------------------------
create table admission_enquiries (
  id                 uuid primary key default gen_random_uuid(),
  institute_id       uuid,
  parent_name        text not null,
  parent_phone       text not null,
  parent_email       text,
  student_name       text,                 -- prospective student, often known even this early
  interested_class_id uuid references classes(id) on delete set null,
  source             enquiry_source not null default 'walk_in',
  status             enquiry_status not null default 'open',
  notes              text,
  created_by         uuid references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index idx_admission_enquiries_institute on admission_enquiries(institute_id);
create index idx_admission_enquiries_status    on admission_enquiries(institute_id, status);

create trigger trg_admission_enquiries_institute before insert on admission_enquiries
  for each row execute function set_institute_id();
create trigger trg_admission_enquiries_updated_at before update on admission_enquiries
  for each row execute function set_updated_at();

alter table admission_enquiries enable row level security;
create policy institute_isolation on admission_enquiries as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy "admissions staff manage enquiries" on admission_enquiries for all
  using (is_admissions_staff()) with check (is_admissions_staff());

-- ----------------------------------------------------------------------------
-- 4. APPLICANT — created from an enquiry (or directly), holds the actual
--    candidate's details. One applicant can have more than one
--    application over time (reapplying a later year), which is why this
--    is a separate table from admission_applications rather than folded
--    into it.
-- ----------------------------------------------------------------------------
create table admission_applicants (
  id               uuid primary key default gen_random_uuid(),
  institute_id     uuid,
  enquiry_id       uuid references admission_enquiries(id) on delete set null,
  name             text not null,
  dob              date,
  gender           text,
  guardian_name    text not null,
  guardian_phone   text not null,
  guardian_email   text,
  guardian_cnic    text,
  address          text,
  previous_school  text,
  created_by       uuid references users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_admission_applicants_institute on admission_applicants(institute_id);

create trigger trg_admission_applicants_institute before insert on admission_applicants
  for each row execute function set_institute_id();
create trigger trg_admission_applicants_updated_at before update on admission_applicants
  for each row execute function set_updated_at();

alter table admission_applicants enable row level security;
create policy institute_isolation on admission_applicants as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy "admissions staff manage applicants" on admission_applicants for all
  using (is_admissions_staff()) with check (is_admissions_staff());

-- ----------------------------------------------------------------------------
-- 5. APPLICATION — the formal application for a specific class/cycle.
--    application_number is generated once, on insert, per-institute
--    per-year — human-facing ("ADM-2026-0007"), not the primary key.
-- ----------------------------------------------------------------------------
create table admission_applications (
  id                 uuid primary key default gen_random_uuid(),
  institute_id       uuid,
  applicant_id       uuid not null references admission_applicants(id) on delete cascade,
  application_number text unique,
  academic_year      int not null,
  applied_class_id   uuid not null references classes(id) on delete restrict,
  status             application_status not null default 'submitted',
  submitted_at       timestamptz not null default now(),
  student_id         uuid references students(id) on delete set null,  -- set only at enrollment
  enrolled_at        timestamptz,
  created_by         uuid references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index idx_admission_applications_institute on admission_applications(institute_id);
create index idx_admission_applications_status    on admission_applications(institute_id, status);
create index idx_admission_applications_applicant on admission_applications(applicant_id);

create trigger trg_admission_applications_institute before insert on admission_applications
  for each row execute function set_institute_id();
create trigger trg_admission_applications_updated_at before update on admission_applications
  for each row execute function set_updated_at();

create or replace function set_application_number() returns trigger as $$
declare
  v_seq int;
begin
  if new.application_number is not null then
    return new;
  end if;
  select count(*) + 1 into v_seq
    from admission_applications
    where institute_id = new.institute_id and academic_year = new.academic_year;
  new.application_number := 'ADM-' || new.academic_year || '-' || lpad(v_seq::text, 4, '0');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Runs AFTER set_institute_id() (both BEFORE INSERT — Postgres fires
-- same-timing triggers in name order, "trg_a..." before "trg_s...", and
-- this trigger needs new.institute_id already populated).
create trigger trg_admission_applications_number before insert on admission_applications
  for each row execute function set_application_number();

alter table admission_applications enable row level security;
create policy institute_isolation on admission_applications as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy "admissions staff manage applications" on admission_applications for all
  using (is_admissions_staff()) with check (is_admissions_staff());

-- ----------------------------------------------------------------------------
-- 6. INTERVIEW — an application can have more than one (a follow-up
--    interview isn't unusual).
-- ----------------------------------------------------------------------------
create table admission_interviews (
  id             uuid primary key default gen_random_uuid(),
  institute_id   uuid,
  application_id uuid not null references admission_applications(id) on delete cascade,
  scheduled_at   timestamptz not null,
  interviewer_id uuid references users(id),
  mode           text not null default 'in_person',
  status         admission_event_status not null default 'scheduled',
  score          numeric(5,2),
  remarks        text,
  created_by     uuid references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_admission_interviews_institute   on admission_interviews(institute_id);
create index idx_admission_interviews_application on admission_interviews(application_id);

create trigger trg_admission_interviews_institute before insert on admission_interviews
  for each row execute function set_institute_id();
create trigger trg_admission_interviews_updated_at before update on admission_interviews
  for each row execute function set_updated_at();

alter table admission_interviews enable row level security;
create policy institute_isolation on admission_interviews as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy "admissions staff manage interviews" on admission_interviews for all
  using (is_admissions_staff()) with check (is_admissions_staff());

-- ----------------------------------------------------------------------------
-- 7. TEST — entrance test / assessment.
-- ----------------------------------------------------------------------------
create table admission_tests (
  id              uuid primary key default gen_random_uuid(),
  institute_id    uuid,
  application_id  uuid not null references admission_applications(id) on delete cascade,
  test_name       text not null default 'Entrance Test',
  scheduled_at    timestamptz not null,
  max_marks       numeric(6,2) not null default 100,
  obtained_marks  numeric(6,2),
  status          admission_event_status not null default 'scheduled',
  remarks         text,
  created_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_admission_tests_institute   on admission_tests(institute_id);
create index idx_admission_tests_application on admission_tests(application_id);

create trigger trg_admission_tests_institute before insert on admission_tests
  for each row execute function set_institute_id();
create trigger trg_admission_tests_updated_at before update on admission_tests
  for each row execute function set_updated_at();

alter table admission_tests enable row level security;
create policy institute_isolation on admission_tests as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy "admissions staff manage tests" on admission_tests for all
  using (is_admissions_staff()) with check (is_admissions_staff());

-- ----------------------------------------------------------------------------
-- 8. DOCUMENT VERIFICATION — file_path points into the
--    'admission-documents' storage bucket (private, added below), path
--    convention `<institute_id>/<application_id>/<filename>` so the
--    storage RLS policies can check institute ownership from the path
--    alone, the same way 0035_multi_tenancy.sql's institute-logos bucket
--    keys off bucket_id rather than path (that one's public; this one
--    can't be).
-- ----------------------------------------------------------------------------
create table admission_documents (
  id             uuid primary key default gen_random_uuid(),
  institute_id   uuid,
  application_id uuid not null references admission_applications(id) on delete cascade,
  document_type  text not null,          -- 'birth_certificate','previous_report_card','photo','cnic_copy',...
  file_path      text,
  status         admission_document_status not null default 'pending',
  verified_by    uuid references users(id),
  verified_at    timestamptz,
  notes          text,
  created_by     uuid references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_admission_documents_institute   on admission_documents(institute_id);
create index idx_admission_documents_application on admission_documents(application_id);

create trigger trg_admission_documents_institute before insert on admission_documents
  for each row execute function set_institute_id();
create trigger trg_admission_documents_updated_at before update on admission_documents
  for each row execute function set_updated_at();

alter table admission_documents enable row level security;
create policy institute_isolation on admission_documents as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy "admissions staff manage documents" on admission_documents for all
  using (is_admissions_staff()) with check (is_admissions_staff());

insert into storage.buckets (id, name, public) values ('admission-documents', 'admission-documents', false)
on conflict (id) do nothing;

drop policy if exists "admissions staff access admission documents" on storage.objects;
create policy "admissions staff access admission documents" on storage.objects
  for all using (
    bucket_id = 'admission-documents'
    and is_admissions_staff()
    and (storage.foldername(name))[1]::uuid = current_institute_id()
  ) with check (
    bucket_id = 'admission-documents'
    and is_admissions_staff()
    and (storage.foldername(name))[1]::uuid = current_institute_id()
  );

-- ----------------------------------------------------------------------------
-- 9. DECISION — one row per decision event (a re-decision after appeal
--    stays in history rather than overwriting — same immutable-event
--    reasoning as fee_payments/income/expenses, see 0011_immutable_ledger.sql,
--    scaled down: this table doesn't block UPDATE the way that migration's
--    trigger does, since a decision correction here has no financial
--    weight, but it's still additive by convention — decide_admission()
--    below always inserts a new row rather than updating an old one).
-- ----------------------------------------------------------------------------
create table admission_decisions (
  id                   uuid primary key default gen_random_uuid(),
  institute_id         uuid,
  application_id       uuid not null references admission_applications(id) on delete cascade,
  decision             admission_decision_type not null,
  offered_class_id     uuid references classes(id) on delete set null,
  offered_section_id   uuid references sections(id) on delete set null,
  offered_fee_override numeric(12,2),
  reason               text,
  decided_by           uuid references users(id),
  decided_at           timestamptz not null default now()
);
create index idx_admission_decisions_institute   on admission_decisions(institute_id);
create index idx_admission_decisions_application on admission_decisions(application_id);

create trigger trg_admission_decisions_institute before insert on admission_decisions
  for each row execute function set_institute_id();

alter table admission_decisions enable row level security;
create policy institute_isolation on admission_decisions as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy "admissions staff manage decisions" on admission_decisions for all
  using (is_admissions_staff()) with check (is_admissions_staff());

-- ============================================================================
-- 10. RPCs
-- ============================================================================

-- ----------------------------------------------------------------------------
-- submit_public_enquiry() — the literal "Parent inquiry" step, reachable
-- before anyone has an account at all (a public form on the institute's
-- own site/QR code). Deliberately narrow: it can only ever INSERT one
-- enquiry row, nothing else, and every field is validated before the
-- insert — an anon-reachable function is exactly the surface the Priority
-- 3 audit found real damage in (pending_fee_reminders), so this one is
-- built to the standard that audit set, not the standard the one it found
-- broken was at. No read access for anon anywhere in this module — this
-- is the only anon-reachable admissions function that exists.
-- ----------------------------------------------------------------------------
create or replace function submit_public_enquiry(
  p_institute_id uuid,
  p_parent_name text,
  p_parent_phone text,
  p_parent_email text default null,
  p_student_name text default null,
  p_interested_class_id uuid default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_institute_id is null or not exists (select 1 from institutes where id = p_institute_id) then
    raise exception 'INVALID_INSTITUTE: Unknown institute.';
  end if;
  if p_parent_name is null or length(trim(p_parent_name)) = 0 then
    raise exception 'INVALID_INPUT: Parent name is required.';
  end if;
  if p_parent_phone is null or length(trim(p_parent_phone)) < 7 then
    raise exception 'INVALID_INPUT: A valid parent phone number is required.';
  end if;
  -- A class hinted at must genuinely belong to the institute being
  -- enquired about — otherwise this becomes a way to probe which class
  -- uuids exist at ANOTHER institute (a value keeps or discards, not a
  -- read primitive on its own, but there's no reason to allow it either).
  if p_interested_class_id is not null and not exists (
    select 1 from classes where id = p_interested_class_id and institute_id = p_institute_id
  ) then
    raise exception 'INVALID_INPUT: That class does not belong to this institute.';
  end if;

  insert into admission_enquiries (institute_id, parent_name, parent_phone, parent_email, student_name, interested_class_id, source, notes)
    values (p_institute_id, trim(p_parent_name), trim(p_parent_phone), p_parent_email, p_student_name, p_interested_class_id, 'website', p_notes)
    returning id into v_id;

  return v_id;
end;
$$;

revoke all on function submit_public_enquiry(uuid, text, text, text, text, uuid, text) from public;
grant execute on function submit_public_enquiry(uuid, text, text, text, text, uuid, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- convert_enquiry_to_applicant() — Enquiry -> Applicant, without retyping
-- the parent's name/phone/email a second time (this is the "eliminates
-- manual duplicate data entry" the request calls out, applied at the
-- first hand-off, not just the last one at enrollment).
-- ----------------------------------------------------------------------------
create or replace function convert_enquiry_to_applicant(
  p_enquiry_id uuid,
  p_name text,
  p_dob date default null,
  p_gender text default null,
  p_guardian_cnic text default null,
  p_address text default null,
  p_previous_school text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_enquiry admission_enquiries;
  v_applicant_id uuid;
begin
  if not is_admissions_staff() then
    raise exception 'NOT_AUTHORIZED: Not authorized to manage admissions.';
  end if;

  select * into v_enquiry from admission_enquiries where id = p_enquiry_id;
  if v_enquiry.id is null or v_enquiry.institute_id != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That enquiry does not belong to your institute.';
  end if;

  insert into admission_applicants (
    enquiry_id, name, dob, gender, guardian_name, guardian_phone, guardian_email,
    guardian_cnic, address, previous_school, created_by
  ) values (
    p_enquiry_id, p_name, p_dob, p_gender, v_enquiry.parent_name, v_enquiry.parent_phone, v_enquiry.parent_email,
    p_guardian_cnic, p_address, p_previous_school, current_users_id()
  ) returning id into v_applicant_id;

  update admission_enquiries set status = 'converted' where id = p_enquiry_id;

  return v_applicant_id;
end;
$$;

revoke all on function convert_enquiry_to_applicant(uuid, text, date, text, text, text, text) from public;
grant execute on function convert_enquiry_to_applicant(uuid, text, date, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- submit_application() — Applicant -> Application.
-- ----------------------------------------------------------------------------
create or replace function submit_application(
  p_applicant_id uuid,
  p_applied_class_id uuid,
  p_academic_year int
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_applicant_institute uuid;
  v_class_institute uuid;
  v_application_id uuid;
begin
  if not is_admissions_staff() then
    raise exception 'NOT_AUTHORIZED: Not authorized to manage admissions.';
  end if;

  select institute_id into v_applicant_institute from admission_applicants where id = p_applicant_id;
  if v_applicant_institute is null or v_applicant_institute != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That applicant does not belong to your institute.';
  end if;

  select institute_id into v_class_institute from classes where id = p_applied_class_id;
  if v_class_institute is null or v_class_institute != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That class does not belong to your institute.';
  end if;

  insert into admission_applications (applicant_id, applied_class_id, academic_year, created_by)
    values (p_applicant_id, p_applied_class_id, p_academic_year, current_users_id())
    returning id into v_application_id;

  return v_application_id;
end;
$$;

revoke all on function submit_application(uuid, uuid, int) from public;
grant execute on function submit_application(uuid, uuid, int) to authenticated;

-- ----------------------------------------------------------------------------
-- decide_admission() — Interview/Test -> Approved (or Rejected/Waitlisted).
-- Records the decision AND advances application.status together, so the
-- two can't drift apart (a decision row with no matching status change,
-- or vice versa).
-- ----------------------------------------------------------------------------
create or replace function decide_admission(
  p_application_id uuid,
  p_decision admission_decision_type,
  p_offered_class_id uuid default null,
  p_offered_section_id uuid default null,
  p_offered_fee_override numeric default null,
  p_reason text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_app admission_applications;
  v_decision_id uuid;
  v_new_status application_status;
begin
  -- Deciding is deliberately narrower than general admissions staff
  -- access — matches can_approve() (Super Admin/Principal) elsewhere in
  -- this schema, not is_admissions_staff() (which also includes
  -- Registrar). A Registrar runs the process; a Principal decides it —
  -- same split as Cashier-collects/Principal-approves-payroll.
  if not can_approve() then
    raise exception 'NOT_AUTHORIZED: Only a Principal or Super Admin can decide an admission.';
  end if;

  select * into v_app from admission_applications where id = p_application_id;
  if v_app.id is null or v_app.institute_id != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That application does not belong to your institute.';
  end if;
  if v_app.status in ('enrolled', 'withdrawn') then
    raise exception 'INVALID_STATE: This application is already %, and can''t be decided again.', v_app.status;
  end if;

  if p_offered_class_id is not null and not exists (
    select 1 from classes where id = p_offered_class_id and institute_id = current_institute_id()
  ) then
    raise exception 'NOT_AUTHORIZED: The offered class does not belong to your institute.';
  end if;
  if p_offered_section_id is not null and not exists (
    select 1 from sections where id = p_offered_section_id and institute_id = current_institute_id()
  ) then
    raise exception 'NOT_AUTHORIZED: The offered section does not belong to your institute.';
  end if;

  insert into admission_decisions (application_id, decision, offered_class_id, offered_section_id, offered_fee_override, reason, decided_by)
    values (p_application_id, p_decision, p_offered_class_id, p_offered_section_id, p_offered_fee_override, p_reason, current_users_id())
    returning id into v_decision_id;

  v_new_status := case p_decision
    when 'approved' then 'approved'
    when 'rejected' then 'rejected'
    when 'waitlisted' then 'waitlisted'
  end;
  update admission_applications set status = v_new_status where id = p_application_id;

  return v_decision_id;
end;
$$;

revoke all on function decide_admission(uuid, admission_decision_type, uuid, uuid, numeric, text) from public;
grant execute on function decide_admission(uuid, admission_decision_type, uuid, uuid, numeric, text) to authenticated;

-- ----------------------------------------------------------------------------
-- enroll_admission_application() — Approved -> Enrollment -> Student
-- conversion -> Fee structure -> Class/Section, the last four boxes of
-- the flow, as one transactional, idempotent action. This is THE "no
-- duplicate data entry" step: the applicant's name/guardian details were
-- typed once, at admission_applicants; this reads them back rather than
-- asking anyone to retype them into the Students module.
-- ----------------------------------------------------------------------------
create or replace function enroll_admission_application(p_application_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_app admission_applications;
  v_applicant admission_applicants;
  v_decision admission_decisions;
  v_class_id uuid;
  v_section_id uuid;
  v_student_id uuid;
  v_student_code text;
begin
  if not can_approve() then
    raise exception 'NOT_AUTHORIZED: Only a Principal or Super Admin can enroll an approved applicant.';
  end if;

  select * into v_app from admission_applications where id = p_application_id;
  if v_app.id is null or v_app.institute_id != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That application does not belong to your institute.';
  end if;

  -- Idempotent: calling this twice on an already-enrolled application
  -- returns the existing student rather than creating a second one or
  -- erroring — the same "duplicate attempt is a no-op, not a new side
  -- effect" shape as record_fee_payment's idempotency_key, just keyed by
  -- the application instead of an explicit key, since one application can
  -- only ever produce one student.
  if v_app.status = 'enrolled' then
    return v_app.student_id;
  end if;
  if v_app.status != 'approved' then
    raise exception 'INVALID_STATE: This application is %, not approved — it must be approved before enrollment.', v_app.status;
  end if;

  select * into v_applicant from admission_applicants where id = v_app.applicant_id;

  select * into v_decision from admission_decisions
    where application_id = p_application_id and decision = 'approved'
    order by decided_at desc limit 1;

  v_class_id := coalesce(v_decision.offered_class_id, v_app.applied_class_id);
  v_section_id := v_decision.offered_section_id;

  v_student_code := 'ADM-' || v_app.academic_year || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into students (student_code, name, guardian_name, guardian_phone, class_id, section_id, admission_date, status)
    values (v_student_code, v_applicant.name, v_applicant.guardian_name, v_applicant.guardian_phone, v_class_id, v_section_id, current_date, 'active')
    returning id into v_student_id;

  if v_decision.offered_fee_override is not null then
    insert into fee_structures (student_id, monthly_fee, effective_from)
      values (v_student_id, v_decision.offered_fee_override, current_date);
  end if;

  update admission_applications
    set status = 'enrolled', student_id = v_student_id, enrolled_at = now()
    where id = p_application_id;

  return v_student_id;
end;
$$;

revoke all on function enroll_admission_application(uuid) from public;
grant execute on function enroll_admission_application(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- admission_dashboard_summary() — the tiles asked for: New Enquiries,
-- Applications, Interviews, Approved, Rejected, Enrolled, Pending
-- Documents. "New" = last 30 days for enquiries (an open-ended count of
-- every enquiry ever would just grow forever and stop meaning anything);
-- the rest are current-state counts, which is what a status column is for.
-- ----------------------------------------------------------------------------
create or replace function admission_dashboard_summary()
returns table (
  new_enquiries    bigint,
  applications     bigint,
  interviews       bigint,
  approved         bigint,
  rejected         bigint,
  enrolled         bigint,
  pending_documents bigint
)
language sql stable security definer set search_path = public
as $$
  select
    (select count(*) from admission_enquiries where institute_id = current_institute_id() and created_at >= now() - interval '30 days'),
    (select count(*) from admission_applications where institute_id = current_institute_id()),
    (select count(*) from admission_interviews where institute_id = current_institute_id() and status = 'scheduled'),
    (select count(*) from admission_applications where institute_id = current_institute_id() and status = 'approved'),
    (select count(*) from admission_applications where institute_id = current_institute_id() and status = 'rejected'),
    (select count(*) from admission_applications where institute_id = current_institute_id() and status = 'enrolled'),
    (select count(*) from admission_documents where institute_id = current_institute_id() and status = 'pending')
  where is_admissions_staff();
$$;

grant execute on function admission_dashboard_summary() to authenticated;
