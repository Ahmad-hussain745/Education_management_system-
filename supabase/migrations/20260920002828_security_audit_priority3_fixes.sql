-- ============================================================================
-- Priority 3 security audit — four confirmed findings, fixed.
--
-- Found by pulling the definitive list of every SECURITY DEFINER function
-- directly from a real, freshly-migrated Postgres instance (pg_proc, not
-- by reading migration source and guessing what the final state is after
-- 61 files' worth of CREATE OR REPLACE), then checking each against:
-- search_path -> caller identity -> institute_id -> role authorization ->
-- input validation -> RLS interaction.
--
-- Three of the four are the exact same root cause repeated: a function
-- that references another entity by ID (a student, a fee record) never
-- checks that entity actually belongs to the caller's own institute
-- before using it. This codebase has fixed this exact bug shape before —
-- 0051 added the check to record_stock_movement/record_inventory_purchase/
-- reverse_fee_payment/repair_fee_record — but three more instances of it
-- were never caught: record_fee_payment (the ORIGINAL payment-recording
-- function, predates 0051), and queue_fee_notification/
-- queue_fee_notification_internal (0038, also predates 0051). The lesson
-- for future functions: any SECURITY DEFINER function taking a foreign-key
-- style uuid parameter needs this checked, every time, not just the ones
-- that happened to get audited.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- FINDING 1 — three functions with no search_path set at all, unlike every
-- other SECURITY DEFINER function in this schema. current_institute_id()
-- especially: it's called from nearly every RLS policy in the system, and
-- from inside dozens of other SECURITY DEFINER functions, all with an
-- unqualified `institute_id`/`users` reference relying on search_path
-- resolution — exactly the shape a search_path hijack targets.
-- ----------------------------------------------------------------------------
create or replace function current_institute_id() returns uuid as $$
  select institute_id from users where auth_user_id = auth.uid() limit 1;
$$ language sql stable security definer set search_path = public;

create or replace function current_users_id() returns uuid as $$
  select id from users where auth_user_id = auth.uid() limit 1;
$$ language sql stable security definer set search_path = public;

create or replace function set_institute_id() returns trigger as $$
begin
  if new.institute_id is null then
    new.institute_id := current_institute_id();
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- FINDING 2 — pending_fee_reminders(date, uuid): no institute or role
-- check, and (Postgres grants EXECUTE to PUBLIC by default on function
-- creation; nothing ever revoked it for this specific overload — 0027 did
-- for the single-arg version, 0038 forgot to for this one when it added
-- p_institute_id) callable by anon. An unauthenticated request supplying
-- any real institute UUID gets every student's name, guardian phone, and
-- guardian email for that institute.
--
-- Fixed the same way finance_month_comparison/finance_monthly_trend
-- already do it: validate p_institute_id against current_institute_id()
-- and require can_view_fees(), both written so a NULL current_institute_id()
-- (the service_role/cron caller, which has no auth.uid() at all) passes
-- through untouched — that's not an oversight, current_role_name() already
-- returns NULL for service_role for the same reason, and NULL propagates
-- to "don't raise" in an `if not x then raise` check. That's what lets
-- run_fee_reminder_schedule_for_institute() keep calling this across every
-- institute in its loop while a same-institute Teacher (authenticated, but
-- not can_view_fees()) or a cross-institute call from anyone now gets
-- rejected outright.
-- ----------------------------------------------------------------------------
create or replace function pending_fee_reminders(p_month date, p_institute_id uuid default null)
returns table(
  student_id uuid, student_name text, guardian_phone text, guardian_email text,
  fee_record_id uuid, month date, total_payable numeric, paid_total numeric, outstanding numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if p_institute_id is not null and p_institute_id != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That institute does not match your session.';
  end if;
  if not can_view_fees() then
    raise exception 'NOT_AUTHORIZED: Not authorized to view fee reminders.';
  end if;

  return query
  select s.id, s.name, s.guardian_phone, s.guardian_email,
    fr.id, fr.month, fr.total_payable, fr.paid_total, fr.total_payable - fr.paid_total
  from fee_records fr
  join students s on s.id = fr.student_id
  where fr.month = date_trunc('month', p_month)::date
    and fr.status in ('unpaid', 'partial')
    and s.status = 'active'
    and s.institute_id = coalesce(p_institute_id, current_institute_id());
end;
$$;

revoke all on function pending_fee_reminders(date, uuid) from public, anon;
grant execute on function pending_fee_reminders(date, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- FINDING 3 — record_fee_payment(): never checked p_student_id or
-- p_fee_record_id belong to the caller's own institute. institute_id on
-- the new fee_payments row is auto-filled correctly (set_institute_id()
-- trigger, always the CALLER's own institute, ignoring these parameters
-- entirely) — the real damage is that sync_fee_record_totals() then
-- recomputes ANOTHER institute's real fee_records row using this payment,
-- since that trigger joins purely by fee_record_id with no institute
-- filter (correctly so — its job is just "keep this fee record's total in
-- sync with its own payments", not re-litigate authorization). The
-- authorization has to happen here, before the insert, which is exactly
-- the pattern record_stock_movement()/record_inventory_purchase() already
-- use for the equivalent check on p_item_id.
--
-- Also fixed in passing, found while actually running this end-to-end
-- while writing the Priority 3 test suite (not something the audit was
-- looking for): p_method was typed `text` in the original 0042 definition
-- — every sibling function that takes a payment method
-- (post_transaction/default_account_id/0028's purchase functions) types it
-- `payment_method` (the actual enum), which is what lets Postgres/PostgREST
-- coerce the caller's plain string into the right type at the boundary. A
-- `text` parameter doesn't get that same implicit coercion when it's
-- later assigned to an enum column inside the function body — Postgres
-- has no implicit or assignment cast from text to a user-defined enum,
-- only from an untyped string literal, which a declared `text` parameter
-- no longer is by the time it reaches the INSERT. Concretely:
-- record_fee_payment(..., 'Cash', ...) has been failing with "column
-- 'method' is of type payment_method but expression is of type text" on
-- every single call since 0042 was written — this is not a narrow edge
-- case, it's the function the entire app's payment-recording path (online
-- and offline) goes through. Retyped to payment_method below, matching
-- every other function that takes this parameter.
-- ----------------------------------------------------------------------------
-- record_fee_payment() with `p_method payment_method` is a DIFFERENT
-- signature to Postgres than the original `p_method text` — CREATE OR
-- REPLACE with a changed parameter type creates a new overload, it does
-- not replace the old one (the exact same pitfall Finding 2 already
-- explains for pending_fee_reminders). Drop the old, permanently-broken
-- signature outright rather than leaving it to linger as dead, confusing,
-- still-callable weight.
drop function if exists record_fee_payment(uuid, uuid, date, numeric, text, text, boolean, uuid);

create or replace function record_fee_payment(
  p_fee_record_id uuid,
  p_student_id uuid,
  p_month date,
  p_amount numeric,
  p_method payment_method,
  p_remarks text default null,
  p_is_advance boolean default false,
  p_idempotency_key uuid default null
)
returns fee_payments
language plpgsql security definer set search_path = public as $$
declare
  v_row fee_payments;
  v_student_institute uuid;
  v_fee_record_institute uuid;
begin
  if p_idempotency_key is not null then
    select * into v_row from fee_payments where idempotency_key = p_idempotency_key;
    if found then
      return v_row;
    end if;
  end if;

  if not (is_finance_staff() or current_role_name() = 'Cashier') then
    raise exception 'NOT_AUTHORIZED: Not authorized to record a payment.';
  end if;

  select institute_id into v_student_institute from students where id = p_student_id;
  if v_student_institute is null or v_student_institute != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That student does not belong to your institute.';
  end if;

  select institute_id into v_fee_record_institute from fee_records where id = p_fee_record_id;
  if v_fee_record_institute is null or v_fee_record_institute != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That fee record does not belong to your institute.';
  end if;

  insert into fee_payments (
    fee_record_id, student_id, month, amount, method, remarks, is_advance, idempotency_key
  ) values (
    p_fee_record_id, p_student_id, p_month, p_amount, p_method, p_remarks, p_is_advance, p_idempotency_key
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function record_fee_payment(uuid, uuid, date, numeric, payment_method, text, boolean, uuid) from public;
grant execute on function record_fee_payment(uuid, uuid, date, numeric, payment_method, text, boolean, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- FINDING 4 — queue_fee_notification()/queue_fee_notification_internal():
-- same shape as Finding 3. render_notification_template() would happily
-- render another institute's real student's name/guardian phone/amount
-- into rendered_message, and because the notification row itself gets
-- correctly tagged with the CALLER's own institute_id, they can read that
-- rendered text back afterward through their own, correctly-scoped
-- notifications row — a real cross-institute PII leak riding on a
-- perfectly correct read-side policy.
--
-- Checked at the human entrypoint (queue_fee_notification), not the
-- _internal one — queue_fee_notification_internal is also called from
-- run_fee_reminder_schedule_for_institute() (service_role, legitimately
-- cross-institute by design, one institute per loop iteration), so adding
-- an institute check inside _internal itself would break the cron path.
-- The human path is the one that needs gating, the same split already
-- used for pending_fee_reminders vs. its _for_institute counterpart.
-- ----------------------------------------------------------------------------
create or replace function queue_fee_notification(
  p_student_id uuid, p_fee_record_id uuid, p_type text, p_template_key text,
  p_channel text default null, p_recipient text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
  v_by uuid;
  v_student_institute uuid;
  v_fee_record_institute uuid;
begin
  select current_role_name() into v_role;
  if v_role is null or v_role not in ('Super Admin', 'Principal', 'Accountant', 'Cashier') then
    raise exception 'Not authorized to send fee notifications.';
  end if;

  select institute_id into v_student_institute from students where id = p_student_id;
  if v_student_institute is null or v_student_institute != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That student does not belong to your institute.';
  end if;

  select institute_id into v_fee_record_institute from fee_records where id = p_fee_record_id;
  if v_fee_record_institute is null or v_fee_record_institute != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That fee record does not belong to your institute.';
  end if;

  select id into v_by from users where auth_user_id = auth.uid();

  return queue_fee_notification_internal(
    p_student_id, p_fee_record_id, p_type, p_template_key,
    current_institute_id(), p_channel, p_recipient, v_by
  );
end;
$$;
