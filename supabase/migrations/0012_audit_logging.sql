-- ============================================================================
-- 20. AUDIT LOGGING — the audit_logs table has existed since 0001_init.sql
-- (with an "admin reads audit log" RLS policy) but nothing has ever written
-- to it. Logging as database triggers on the specific transitions that
-- matter — rather than scattering log_audit() calls through app code — means
-- it can't be forgotten in some new code path, and it can't be skipped by
-- calling a function directly instead of going through the UI.
--
-- Scope: the transitions that most need a "who, when, what changed" trail —
-- a reversal (the correction mechanism from 0011), a payroll lock/approval,
-- and account creation (a new login, or a teacher being linked to one).
-- This is deliberately not "log every UPDATE on every table" — that's noise,
-- not an audit trail.
-- ============================================================================

create or replace function log_audit(p_action text, p_table text, p_record_id uuid, p_old jsonb, p_new jsonb)
returns void as $$
declare
  v_user_id uuid;
begin
  select id into v_user_id from users where auth_user_id = auth.uid();
  insert into audit_logs (user_id, action, table_name, record_id, old_value, new_value)
    values (v_user_id, p_action, p_table, p_record_id, p_old, p_new);
end;
$$ language plpgsql security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- Reversals — fires once per reverse_*() call, since that's the only way
-- reversed_at can go from null to not-null (enforced by the immutability
-- trigger in 0011, which allows no other path to change these rows at all).
-- ----------------------------------------------------------------------------
create or replace function audit_log_reversal() returns trigger as $$
begin
  if old.reversed_at is null and new.reversed_at is not null then
    perform log_audit(tg_table_name || '.reverse', tg_table_name, new.id,
      jsonb_build_object('amount', to_jsonb(old)->'amount', 'reversed', false),
      jsonb_build_object('amount', to_jsonb(new)->'amount', 'reversed', true, 'reason', new.reversal_reason));
  end if;
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['fee_payments', 'income', 'expenses', 'salary_payments'] loop
    execute format('drop trigger if exists trg_%1$s_audit_reversal on %1$s', t);
    execute format('create trigger trg_%1$s_audit_reversal after update on %1$s for each row execute function audit_log_reversal()', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Payroll lock — fires when `locked` flips false → true, regardless of
-- whether that came from finance staff or a Principal's approval (both
-- paths already funnel through the same UPDATE, per enforce_approve_only()
-- in 0002_rls.sql).
-- ----------------------------------------------------------------------------
create or replace function audit_log_payroll_lock() returns trigger as $$
begin
  if (old.locked is distinct from true) and new.locked = true then
    perform log_audit('salary_record.lock', 'salary_records', new.id,
      jsonb_build_object('locked', false),
      jsonb_build_object('locked', true, 'gross_salary', new.gross_salary, 'locked_by', new.locked_by));
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_salary_records_audit_lock on salary_records;
create trigger trg_salary_records_audit_lock
  after update on salary_records for each row execute function audit_log_payroll_lock();

-- ----------------------------------------------------------------------------
-- Account creation — a new login existing at all is worth a trail, and so
-- is a teacher being linked to one (that link is what turns on their "own
-- attendance/classes/syllabus/salary" RLS access, per 0002_rls.sql).
-- ----------------------------------------------------------------------------
create or replace function audit_log_user_created() returns trigger as $$
begin
  perform log_audit('user.create', 'users', new.id, null,
    jsonb_build_object('name', new.name, 'email', new.email, 'role_id', new.role_id));
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_users_audit_create on users;
create trigger trg_users_audit_create
  after insert on users for each row execute function audit_log_user_created();

create or replace function audit_log_teacher_linked() returns trigger as $$
begin
  if old.user_id is null and new.user_id is not null then
    perform log_audit('teacher.link_account', 'teachers', new.id,
      jsonb_build_object('user_id', null),
      jsonb_build_object('user_id', new.user_id));
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_teachers_audit_link on teachers;
create trigger trg_teachers_audit_link
  after update on teachers for each row execute function audit_log_teacher_linked();
