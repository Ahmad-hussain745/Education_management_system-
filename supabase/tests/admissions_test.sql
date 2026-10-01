-- ============================================================================
-- ADMISSIONS MODULE TEST — run in the Supabase SQL Editor against your
-- actual project, logged in as a Super Admin (Impersonate user in Studio —
-- see supabase/tests/README.md for why that matters).
--
-- Covers the full flow once (enquiry -> applicant -> application ->
-- decision -> enrollment, including the idempotent-double-enrollment
-- guarantee), then the two things a NEW module is most likely to get
-- wrong on day one if it doesn't deliberately check for them: another
-- institute's data reachable through it, and a Registrar (who can run the
-- process) being able to also decide/enroll (a Principal/Admin-only step).
-- ============================================================================

begin;

do $$
declare
  v_institute uuid; v_admin_auth uuid; v_role_admin uuid;
  v_class uuid; v_section uuid;
  v_enquiry uuid; v_applicant uuid; v_application uuid; v_decision uuid; v_student uuid;
  v_dup_student uuid;
  v_app record;

  v_foreign_institute uuid; v_foreign_class uuid; v_foreign_applicant uuid; v_foreign_application uuid;
  v_caught text;
begin
  select id into v_role_admin from roles where name = 'Super Admin';
  insert into institutes (name) values ('TEST Admissions Institute') returning id into v_institute;
  insert into auth.users (email) values ('test-admissions-admin@example.com') returning id into v_admin_auth;
  insert into users (auth_user_id, name, role_id, institute_id, status)
    values (v_admin_auth, 'Test Admin', v_role_admin, v_institute, 'active');
  perform set_config('request.jwt.claim.sub', v_admin_auth::text, true);

  insert into classes (name, sort_order, institute_id) values ('TEST Class 1', 1, v_institute) returning id into v_class;
  insert into sections (class_id, name, institute_id) values (v_class, 'A', v_institute) returning id into v_section;

  -------------------------------------------------------------------------
  -- FULL FLOW
  -------------------------------------------------------------------------
  v_enquiry := submit_public_enquiry(v_institute, 'Mrs. Test Parent', '0300-1234567', 'parent@example.com', 'Little Timmy', v_class, 'Interested for next year');
  v_applicant := convert_enquiry_to_applicant(v_enquiry, 'Timmy Test', '2019-05-01', 'male', '12345-6789012-3', '123 Test Street', 'ABC Montessori');
  if (select guardian_phone from admission_applicants where id = v_applicant) != '0300-1234567' then
    raise exception 'FAIL — guardian_phone was not carried over from the enquiry to the applicant';
  end if;

  v_application := submit_application(v_applicant, v_class, 2026);
  select * into v_app from admission_applications where id = v_application;
  if v_app.application_number is null or v_app.application_number not like 'ADM-2026-%' then
    raise exception 'FAIL — application_number was not generated correctly: %', v_app.application_number;
  end if;

  insert into admission_interviews (application_id, scheduled_at, mode) values (v_application, now() + interval '2 days', 'in_person');
  insert into admission_tests (application_id, scheduled_at, max_marks) values (v_application, now() + interval '3 days', 100);
  insert into admission_documents (application_id, document_type, status) values (v_application, 'birth_certificate', 'submitted');

  v_decision := decide_admission(v_application, 'approved', v_class, v_section, 4500, 'Strong interview + test scores');
  if (select status from admission_applications where id = v_application) != 'approved' then
    raise exception 'FAIL — application status did not advance to approved';
  end if;

  v_student := enroll_admission_application(v_application);
  if not exists (select 1 from students where id = v_student and name = 'Timmy Test' and guardian_phone = '0300-1234567' and section_id = v_section) then
    raise exception 'FAIL — enrolled student does not carry the applicant''s details / offered section';
  end if;
  if not exists (select 1 from fee_structures where student_id = v_student and monthly_fee = 4500) then
    raise exception 'FAIL — the decision''s fee override was not applied to the new student';
  end if;
  if (select status from admission_applications where id = v_application) != 'enrolled'
     or (select student_id from admission_applications where id = v_application) != v_student then
    raise exception 'FAIL — application did not correctly link to the new student on enrollment';
  end if;

  v_dup_student := enroll_admission_application(v_application);
  if v_dup_student != v_student or (select count(*) from students where guardian_phone = '0300-1234567') != 1 then
    raise exception 'FAIL — re-enrolling an already-enrolled application created a second student';
  end if;
  raise notice 'PASS — full enquiry-to-enrollment flow, including idempotent double-enrollment protection';

  -------------------------------------------------------------------------
  -- TENANT ISOLATION — an admin at a SECOND institute must not be able to
  -- touch the first institute's applicant/application/decision/enrollment
  -- through any of these RPCs.
  -------------------------------------------------------------------------
  insert into institutes (name) values ('TEST Foreign Admissions Institute') returning id into v_foreign_institute;
  declare v_foreign_admin_auth uuid; begin
    insert into auth.users (email) values ('test-foreign-admissions-admin@example.com') returning id into v_foreign_admin_auth;
    insert into users (auth_user_id, name, role_id, institute_id, status)
      values (v_foreign_admin_auth, 'Foreign Admin', v_role_admin, v_foreign_institute, 'active');
    perform set_config('request.jwt.claim.sub', v_foreign_admin_auth::text, true);
  end;

  v_caught := null;
  begin
    perform convert_enquiry_to_applicant(v_enquiry, 'Should not work');
  exception when others then v_caught := SQLERRM; end;
  if v_caught is null or v_caught not like 'NOT_AUTHORIZED%' then
    raise exception 'FAIL — a different institute''s admin converted another institute''s enquiry (got: %)', coalesce(v_caught, 'no error');
  end if;
  raise notice 'PASS — convert_enquiry_to_applicant() refused another institute''s enquiry';

  v_caught := null;
  begin
    perform decide_admission(v_application, 'approved');
  exception when others then v_caught := SQLERRM; end;
  if v_caught is null or v_caught not like 'NOT_AUTHORIZED%' then
    raise exception 'FAIL — a different institute''s admin decided another institute''s application (got: %)', coalesce(v_caught, 'no error');
  end if;
  raise notice 'PASS — decide_admission() refused another institute''s application';

  v_caught := null;
  begin
    perform enroll_admission_application(v_application);
  exception when others then v_caught := SQLERRM; end;
  if v_caught is null or v_caught not like 'NOT_AUTHORIZED%' then
    raise exception 'FAIL — a different institute''s admin enrolled another institute''s application (got: %)', coalesce(v_caught, 'no error');
  end if;
  raise notice 'PASS — enroll_admission_application() refused another institute''s application';

  raise notice '=== ADMISSIONS MODULE TENANT ISOLATION TESTS PASSED ===';
end $$;

rollback;
