-- ============================================================================
-- ROLE BOUNDARY TEST — run in the Supabase SQL Editor against your actual
-- project, connected as the postgres/service role (NOT impersonating
-- anyone yourself — the script does its own impersonating internally).
--
-- Unlike reversal_and_tenant_isolation_test.sql (which only exercises
-- SECURITY DEFINER functions' own internal checks — those run their logic
-- regardless of who's connected, so testing them as a superuser is fine),
-- two of the checks below are pure RLS / pure GRANT checks with no
-- function-level guard behind them at all. RLS does not apply to a table
-- owner or a superuser by default (Postgres exempts them unless FORCE ROW
-- LEVEL SECURITY is set), and GRANT/REVOKE-based permission denial is
-- bypassed by superusers entirely — so running those two checks as
-- postgres would silently "pass" even if the underlying policy were
-- completely broken. Found exactly this while writing this file: an
-- earlier draft ran everything as postgres and check #3 below passed when
-- it shouldn't have, for exactly this reason.
--
-- Fixed by actually switching to the `authenticated` role (`SET ROLE`,
-- not just setting request.jwt.claim.sub) for every check, real RLS/GRANT
-- enforcement and all — genuinely the same authorization path a real
-- PostgREST request goes through, not an approximation of it. Fixture IDs
-- are carried across the role switches via a temp table, since each `SET
-- ROLE`/`RESET ROLE` needs to happen as a top-level statement (not from
-- inside a still-running PL/pgSQL block), which means the setup and each
-- check are necessarily separate `do $$ ... $$` blocks, and plain
-- PL/pgSQL local variables don't survive between them.
-- ============================================================================

begin;

create temporary table test_fixture (key text primary key, value text) on commit drop;
grant select on test_fixture to authenticated;

-- ----------------------------------------------------------------------------
-- SETUP — as postgres (needs to insert into auth.users, assign roles,
-- etc.), no assertions here.
-- ----------------------------------------------------------------------------
do $$
declare
  v_institute       uuid;
  v_class           uuid;
  v_section         uuid;
  v_role_teacher    uuid;
  v_role_cashier    uuid;
  v_role_parent     uuid;
  v_role_accountant uuid;
  v_teacher_a_auth  uuid; v_teacher_a_user uuid; v_teacher_a_id uuid;
  v_teacher_b_auth  uuid; v_teacher_b_id uuid;
  v_cashier_auth    uuid;
  v_parent_a_auth   uuid; v_parent_a_user uuid;
  v_parent_b_auth   uuid;
  v_accountant_auth uuid;
  v_student_a       uuid;
  v_student_b       uuid;
  v_salary_record   uuid;
begin
  select id into v_role_teacher    from roles where name = 'Teacher';
  select id into v_role_cashier    from roles where name = 'Cashier';
  select id into v_role_parent     from roles where name = 'Parent';
  select id into v_role_accountant from roles where name = 'Accountant';

  insert into institutes (name) values ('TEST Role Boundary Institute') returning id into v_institute;
  insert into classes (name, sort_order, institute_id) values ('TEST Class', 1, v_institute) returning id into v_class;
  insert into sections (class_id, name, institute_id) values (v_class, 'A', v_institute) returning id into v_section;

  insert into auth.users (email) values ('test-teacher-a@example.com') returning id into v_teacher_a_auth;
  insert into teachers (name, institute_id) values ('TEST Teacher A', v_institute) returning id into v_teacher_a_id;
  insert into users (auth_user_id, name, role_id, institute_id, status)
    values (v_teacher_a_auth, 'TEST Teacher A', v_role_teacher, v_institute, 'active') returning id into v_teacher_a_user;
  update teachers set user_id = v_teacher_a_user where id = v_teacher_a_id;

  insert into auth.users (email) values ('test-teacher-b@example.com') returning id into v_teacher_b_auth;
  insert into teachers (name, institute_id) values ('TEST Teacher B', v_institute) returning id into v_teacher_b_id;
  insert into users (auth_user_id, name, role_id, institute_id, status)
    values (v_teacher_b_auth, 'TEST Teacher B', v_role_teacher, v_institute, 'active');
  update teachers set user_id = (select id from users where auth_user_id = v_teacher_b_auth) where id = v_teacher_b_id;

  insert into auth.users (email) values ('test-cashier@example.com') returning id into v_cashier_auth;
  insert into users (auth_user_id, name, role_id, institute_id, status)
    values (v_cashier_auth, 'TEST Cashier', v_role_cashier, v_institute, 'active');

  insert into auth.users (email) values ('test-accountant@example.com') returning id into v_accountant_auth;
  insert into users (auth_user_id, name, role_id, institute_id, status)
    values (v_accountant_auth, 'TEST Accountant', v_role_accountant, v_institute, 'active');

  insert into students (name, class_id, section_id, status, institute_id)
    values ('TEST Student A', v_class, v_section, 'active', v_institute) returning id into v_student_a;
  insert into students (name, class_id, section_id, status, institute_id)
    values ('TEST Student B', v_class, v_section, 'active', v_institute) returning id into v_student_b;

  insert into auth.users (email) values ('test-parent-a@example.com') returning id into v_parent_a_auth;
  insert into users (auth_user_id, name, role_id, institute_id, status)
    values (v_parent_a_auth, 'TEST Parent A', v_role_parent, v_institute, 'active') returning id into v_parent_a_user;
  insert into parent_students (parent_user_id, student_id) values (v_parent_a_user, v_student_a);

  insert into auth.users (email) values ('test-parent-b@example.com') returning id into v_parent_b_auth;
  insert into users (auth_user_id, name, role_id, institute_id, status)
    values (v_parent_b_auth, 'TEST Parent B', v_role_parent, v_institute, 'active');

  insert into salary_records (teacher_id, month, base_salary, institute_id)
    values (v_teacher_a_id, '2026-08-01', 50000, v_institute) returning id into v_salary_record;

  insert into test_fixture (key, value) values
    ('institute', v_institute::text),
    ('teacher_a_auth', v_teacher_a_auth::text),
    ('teacher_b_auth', v_teacher_b_auth::text),
    ('teacher_b_id', v_teacher_b_id::text),
    ('cashier_auth', v_cashier_auth::text),
    ('accountant_auth', v_accountant_auth::text),
    ('parent_a_auth', v_parent_a_auth::text),
    ('parent_b_auth', v_parent_b_auth::text),
    ('student_a', v_student_a::text),
    ('student_b', v_student_b::text),
    ('salary_record', v_salary_record::text);
end $$;

-- ----------------------------------------------------------------------------
-- CHECK 1 — TEACHER CANNOT ACCESS ANOTHER TEACHER'S RECORDS
-- ----------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', (select value from test_fixture where key = 'teacher_a_auth'), false);

do $$
declare
  v_teacher_b_id uuid := (select value::uuid from test_fixture where key = 'teacher_b_id');
  v_caught text;
begin
  begin
    perform * from teacher_dashboard_summary(v_teacher_b_id);
  exception when others then v_caught := SQLERRM;
  end;
  if v_caught is null then
    raise exception 'FAIL — Teacher A read Teacher B''s dashboard summary with no error';
  end if;
  raise notice 'PASS — Teacher A cannot read Teacher B''s dashboard summary (%)', v_caught;
end $$;
reset role;

-- ----------------------------------------------------------------------------
-- CHECK 2 — CASHIER CANNOT APPROVE RESTRICTED ACTIONS (payroll lock)
-- approveAndLock() in the app is a plain UPDATE relying on RLS, not a
-- SECURITY DEFINER function. Confirmed empirically while writing this
-- (not assumed): as a genuinely RLS-restricted `authenticated` Cashier,
-- the row is invisible to the UPDATE's own WHERE-clause matching in the
-- first place (no permissive UPDATE policy covers Cashier on
-- salary_records — "finance staff manage payroll" and "principal can
-- approve payroll" don't include it), so it affects zero rows silently —
-- enforce_approve_only() (0002_rls.sql)'s trigger never even gets a
-- chance to fire, because no row reached it. That trigger firing and
-- raising is what you see if you run this same UPDATE as postgres/
-- service_role instead (RLS bypassed, the row IS matched, the trigger
-- catches it there) — a real difference worth knowing about, not a
-- contradiction: both paths correctly stop the Cashier, they just stop it
-- at different layers depending on who's actually running the query.
-- ----------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', (select value from test_fixture where key = 'cashier_auth'), false);

do $$
declare
  v_salary_record uuid := (select value::uuid from test_fixture where key = 'salary_record');
  v_row_count int;
begin
  update salary_records set locked = true, locked_at = now() where id = v_salary_record;
  get diagnostics v_row_count = row_count;
  if v_row_count <> 0 then
    raise exception 'FAIL — Cashier''s UPDATE against salary_records.locked affected % row(s)', v_row_count;
  end if;
  raise notice 'PASS — Cashier''s attempt to lock payroll affected zero rows (RLS: the row isn''t even visible to the UPDATE)';
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', (select value from test_fixture where key = 'accountant_auth'), false);
do $$
declare
  v_salary_record uuid := (select value::uuid from test_fixture where key = 'salary_record');
begin
  if (select locked from salary_records where id = v_salary_record) is distinct from false then
    raise exception 'FAIL — salary_records.locked is not false after the blocked Cashier update — something else changed it';
  end if;
  raise notice 'PASS — payroll record confirmed still unlocked after the blocked Cashier attempt';
end $$;
reset role;

-- ----------------------------------------------------------------------------
-- CHECK 3 — PARENT CANNOT ACCESS ANOTHER STUDENT'S RECORDS
-- Pure RLS, no function/trigger involved — this is the one that actually
-- needs SET ROLE to mean anything (see this file's header).
-- ----------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', (select value from test_fixture where key = 'parent_a_auth'), false);

do $$
declare
  v_student_a uuid := (select value::uuid from test_fixture where key = 'student_a');
  v_student_b uuid := (select value::uuid from test_fixture where key = 'student_b');
  v_row_count int;
begin
  select count(*) into v_row_count from students where id = v_student_b;
  if v_row_count <> 0 then
    raise exception 'FAIL — Parent A can see Student B''s row via students';
  end if;
  raise notice 'PASS — Parent A cannot see Student B''s row in students';

  select count(*) into v_row_count from students where id = v_student_a;
  if v_row_count <> 1 then
    raise exception 'FAIL — Parent A cannot see their OWN child (Student A) — the policy is over-restrictive, not just safe, and this check isn''t vacuous';
  end if;
  raise notice 'PASS — Parent A can still see their own child (Student A)';
end $$;
reset role;

-- ----------------------------------------------------------------------------
-- CHECK 4 — SERVICE-SIDE FUNCTIONS VALIDATE CALLER IDENTITY
-- A non-service_role authenticated user must not be able to invoke the
-- cron-only, cross-institute "_for_institute" functions directly — this is
-- a GRANT check (no EXECUTE for `authenticated` at all), which a superuser
-- would also bypass, so this needs SET ROLE for the same reason check 3 does.
-- ----------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', (select value from test_fixture where key = 'cashier_auth'), false);

do $$
declare
  v_institute uuid := (select value::uuid from test_fixture where key = 'institute');
  v_caught text;
begin
  begin
    perform run_fee_reminder_schedule_for_institute(v_institute, current_date);
  exception when others then v_caught := SQLERRM;
  end;
  if v_caught is null then
    raise exception 'FAIL — an authenticated Cashier was able to call run_fee_reminder_schedule_for_institute() directly';
  end if;
  raise notice 'PASS — an authenticated (non-service-role) user cannot call the cron-only _for_institute function (%)', v_caught;
  raise notice '=== ALL ROLE BOUNDARY TESTS PASSED ===';
end $$;
reset role;

rollback;
