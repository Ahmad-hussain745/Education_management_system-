-- ============================================================================
-- 38. FEE REMINDER CRON — TWO BUGS FIXED
--
-- Bug 1 (pre-existing, unrelated to multi-tenancy): queue_fee_notification()
-- requires current_role_name() to resolve to an authorized role, which
-- needs a real signed-in user (auth.uid() from a session JWT).
-- run_fee_reminder_schedule() — the function the daily cron calls — runs
-- with no signed-in user at all (called via the admin/service-role client
-- from app/api/cron/fee-reminders/route.js). That means every call this
-- cron has ever made to queue_fee_notification() raises "Not authorized",
-- so the scheduled 10th/20th/25th reminder queuing in 0027_notifications.sql
-- has never actually been able to queue anything.
--
-- Bug 2 (same class as 0037's fix): pending_fee_reminders() has no
-- institute_id filter, so once bug 1 is fixed, a single cron run would mix
-- every institute's overdue students into one pass, and the notification
-- rows it inserts would get institute_id = NULL (current_institute_id()
-- resolves to null with no session) — invisible to every institute's own
-- staff under RLS, and visible only via a raw database connection.
--
-- Fix follows the same split used in 0037: an interactive, role-checked
-- entry point (unchanged name, so app/(app)/notifications/actions.js needs
-- no changes) plus an internal worker used only by the cron path, which
-- skips the human-role check and takes an explicit institute id instead of
-- relying on a session that doesn't exist.
-- ============================================================================

create or replace function pending_fee_reminders(p_month date, p_institute_id uuid default null)
returns table(
  student_id uuid, student_name text, guardian_phone text, guardian_email text,
  fee_record_id uuid, month date, total_payable numeric, paid_total numeric, outstanding numeric
)
language sql stable security definer set search_path = public
as $$
  select s.id, s.name, s.guardian_phone, s.guardian_email,
    fr.id, fr.month, fr.total_payable, fr.paid_total, fr.total_payable - fr.paid_total
  from fee_records fr
  join students s on s.id = fr.student_id
  where fr.month = date_trunc('month', p_month)::date
    and fr.status in ('unpaid', 'partial')
    and s.status = 'active'
    and s.institute_id = coalesce(p_institute_id, current_institute_id());
$$;

-- Shared insert logic, no role check — only reachable from
-- queue_fee_notification() (human path, checks role first) or
-- run_fee_reminder_schedule_for_institute() (cron path, service_role only).
create or replace function queue_fee_notification_internal(
  p_student_id uuid, p_fee_record_id uuid, p_type text, p_template_key text,
  p_institute_id uuid, p_channel text default null, p_recipient text default null,
  p_created_by uuid default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_template_id uuid;
  v_subject text;
  v_body text;
  v_notification_id uuid;
begin
  select id into v_template_id from notification_templates where key = p_template_key and active;

  select rendered_subject, rendered_body into v_subject, v_body
    from render_notification_template(p_template_key, p_student_id, p_fee_record_id);

  insert into notifications (student_id, fee_record_id, template_id, type, channel, recipient, rendered_message, status, scheduled_for, sent_at, created_by, institute_id)
    values (
      p_student_id, p_fee_record_id, v_template_id, p_type, p_channel, p_recipient, v_body,
      case when p_channel is not null then 'sent' else 'pending' end,
      date_trunc('month', (select month from fee_records where id = p_fee_record_id))::date,
      case when p_channel is not null then now() else null end,
      p_created_by,
      p_institute_id
    )
    on conflict (student_id, fee_record_id, type) where type <> 'manual' do update set
      channel = coalesce(excluded.channel, notifications.channel),
      recipient = coalesce(excluded.recipient, notifications.recipient),
      status = case when excluded.channel is not null then 'sent' else notifications.status end,
      sent_at = case when excluded.channel is not null then now() else notifications.sent_at end
    returning id into v_notification_id;

  insert into notification_logs (notification_id, event, detail)
    values (v_notification_id, case when p_channel is not null then 'sent' else 'queued' end,
      case when p_channel is not null then 'Sent via ' || p_channel else 'Queued by schedule' end);

  return v_notification_id;
end;
$$;

revoke execute on function queue_fee_notification_internal(uuid, uuid, text, text, uuid, text, text, uuid) from public, authenticated;
grant execute on function queue_fee_notification_internal(uuid, uuid, text, text, uuid, text, text, uuid) to service_role;

-- Interactive entry point — same name/signature the app already calls,
-- role check restored, now just forwards to the internal worker with the
-- caller's own institute.
create or replace function queue_fee_notification(
  p_student_id uuid, p_fee_record_id uuid, p_type text, p_template_key text,
  p_channel text default null, p_recipient text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
  v_by uuid;
begin
  select current_role_name() into v_role;
  if v_role is null or v_role not in ('Super Admin', 'Principal', 'Accountant', 'Cashier') then
    raise exception 'Not authorized to send fee notifications.';
  end if;

  select id into v_by from users where auth_user_id = auth.uid();

  return queue_fee_notification_internal(
    p_student_id, p_fee_record_id, p_type, p_template_key,
    current_institute_id(), p_channel, p_recipient, v_by
  );
end;
$$;

-- Cron-only worker for one explicit institute.
create or replace function run_fee_reminder_schedule_for_institute(p_institute_id uuid, p_as_of date default current_date)
returns table(template_key text, queued_count int)
language plpgsql security definer set search_path = public
as $$
declare
  v_day int := extract(day from p_as_of);
  v_key text;
  v_month date := date_trunc('month', p_as_of)::date;
  v_row record;
  v_count int := 0;
begin
  v_key := case v_day
    when 10 then 'fee_reminder_1'
    when 20 then 'fee_reminder_2'
    when 25 then 'fee_overdue'
    else null
  end;

  if v_key is null then
    return query select null::text, 0;
    return;
  end if;

  for v_row in select * from pending_fee_reminders(v_month, p_institute_id) loop
    perform queue_fee_notification_internal(
      v_row.student_id, v_row.fee_record_id,
      case v_key when 'fee_reminder_1' then 'reminder_1' when 'fee_reminder_2' then 'reminder_2' else 'overdue' end,
      v_key, p_institute_id
    );
    v_count := v_count + 1;
  end loop;

  return query select v_key, v_count;
end;
$$;

revoke execute on function run_fee_reminder_schedule_for_institute(uuid, date) from public, authenticated;
grant execute on function run_fee_reminder_schedule_for_institute(uuid, date) to service_role;

-- The old single-institute run_fee_reminder_schedule(date) is superseded
-- by the cron route now looping run_fee_reminder_schedule_for_institute()
-- once per institute (see the updated fee-reminders route). Left in place,
-- unchanged, rather than dropped — dropping a function a running
-- deployment might still reference mid-deploy is riskier than an unused
-- leftover.
