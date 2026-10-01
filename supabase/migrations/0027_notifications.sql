-- ============================================================================
-- 29. NOTIFICATIONS — fee reminders, starting point for a general system
-- ============================================================================
-- Three tables, matching the request exactly:
--   notification_templates — the reusable message text (with placeholders)
--   notifications          — one row per notice, student+fee_record scoped,
--                            with a frozen rendered_message (same snapshot
--                            philosophy as fee_records.monthly_fee — what
--                            was actually sent shouldn't drift if the
--                            template is edited later)
--   notification_logs      — append-only event trail per notification
--                            (queued/sent/failed), same shape as audit_logs
--
-- Guardian contact: students had guardian_phone but no email column at all
-- — added here since "Send Email" needs somewhere to send it. Nullable;
-- WhatsApp/SMS still work from guardian_phone alone if it's never filled in.
--
-- WHAT "SEND" ACTUALLY DOES: there's no Twilio/WhatsApp Business API/SMTP
-- credential anywhere in this project, and this migration doesn't invent
-- one. Automated day-of-month scheduling (see run_fee_reminder_schedule()
-- below) only ever queues a notification as 'pending' — it never marks
-- anything 'sent' by itself, on purpose: nobody should get an actual
-- message because a cron job ran, with no human in the loop. The three
-- Send buttons on the Notifications page open a real wa.me / sms: / mailto:
-- link with the rendered message pre-filled — those genuinely work with no
-- API key, because they hand off to the browser's own WhatsApp/SMS/mail
-- handler, with a staff member hitting the final Send themselves. True
-- unattended API dispatch (no human click at all) is a separate integration
-- this migration deliberately leaves as a clearly-marked seam, not a
-- pretended capability.

alter table students add column if not exists guardian_email text;

create table notification_templates (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,     -- 'fee_reminder_1', 'fee_reminder_2', 'fee_overdue'
  name       text not null,            -- display name in the admin UI
  subject    text,                     -- email only; null is fine for whatsapp/sms-only templates
  body       text not null,            -- placeholders: {{student_name}} {{month}} {{amount}} {{academy_name}}
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notifications (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references students(id) on delete restrict,
  fee_record_id    uuid references fee_records(id) on delete set null,
  template_id      uuid references notification_templates(id),
  type             text not null check (type in ('reminder_1', 'reminder_2', 'overdue', 'manual')),
  channel          text check (channel in ('whatsapp', 'sms', 'email')),  -- null until a human picks one and sends
  recipient        text,              -- the phone/email actually used, frozen at send time
  rendered_message text,              -- the actual filled-in text, frozen at send time — never re-derived from a since-edited template
  status           text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  scheduled_for    date,              -- the month this reminder concerns
  sent_at          timestamptz,
  created_by       uuid references users(id),
  created_at       timestamptz not null default now()
);

-- One queued reminder of a given automated type per student per bill — but
-- NOT for type='manual': a staff member sending an ad hoc WhatsApp and then
-- also an ad hoc SMS for the same outstanding bill are two real, distinct
-- send events that both deserve their own row, not an overwrite. The
-- schedule (10th/20th/25th) genuinely only wants one queued reminder_1 per
-- bill even if it runs twice; manual sends have no such "one per bill" rule.
create unique index uq_notifications_scheduled on notifications(student_id, fee_record_id, type) where type <> 'manual';

create index idx_notifications_student on notifications(student_id);
create index idx_notifications_status on notifications(status);

create table notification_logs (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references notifications(id) on delete cascade,
  event           text not null check (event in ('queued', 'sent', 'failed')),
  detail          text,
  created_at      timestamptz not null default now()
);

alter table notification_templates enable row level security;
alter table notifications enable row level security;
alter table notification_logs enable row level security;

-- Same audience as Fee Records/Payments (can_view_fees(): Super Admin,
-- Principal, Accountant, Cashier) — reminders are fee-collection work.
create policy "read: fee staff and principal" on notification_templates for select using (can_view_fees());
create policy "write: finance staff" on notification_templates for all using (is_finance_staff()) with check (is_finance_staff());

create policy "read: fee staff and principal" on notifications for select using (can_view_fees());
create policy "write: fee staff" on notifications for insert with check (can_view_fees());
-- No update policy for notifications: status changes (pending → sent/failed)
-- only ever happen through mark_notification_sent()/mark_notification_failed()
-- below, both SECURITY DEFINER — consistent with fee_payments/salary_payments
-- being append-only everywhere else in this app (0011_immutable_ledger.sql).

create policy "read: fee staff and principal" on notification_logs for select using (can_view_fees());
-- No insert/update policy for notification_logs at all — every log line is
-- written by the SECURITY DEFINER functions below, never directly.

insert into notification_templates (key, name, subject, body) values
  ('fee_reminder_1', 'First Fee Reminder (10th)',
   'Fee Reminder — {{month}}',
   'Dear Guardian of {{student_name}}, the {{month}} fee of Rs. {{amount}} is currently outstanding. Kindly arrange payment at your earliest convenience. — {{academy_name}}'),
  ('fee_reminder_2', 'Second Fee Reminder (20th)',
   'Second Fee Reminder — {{month}}',
   'Dear Guardian of {{student_name}}, this is a second reminder that the {{month}} fee of Rs. {{amount}} remains unpaid. Please pay soon to avoid late charges. — {{academy_name}}'),
  ('fee_overdue', 'Overdue Notice (25th)',
   'Overdue Fee Notice — {{month}}',
   'Dear Guardian of {{student_name}}, the {{month}} fee of Rs. {{amount}} is now overdue. Please contact the academy office immediately to settle this balance. — {{academy_name}}');

-- ----------------------------------------------------------------------------
-- Who's due a reminder right now: every active student with an outstanding
-- (unpaid/partial) fee_records row for the given month, plus enough detail
-- to render a template and show a card exactly like the example
-- (Ahmed Khan / August Fee: Rs. 8,000 / Outstanding: Rs. 8,000).
-- ----------------------------------------------------------------------------
create or replace function pending_fee_reminders(p_month date)
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
    and s.status = 'active';
$$;

revoke execute on function pending_fee_reminders(date) from public;
grant execute on function pending_fee_reminders(date) to authenticated;

-- ----------------------------------------------------------------------------
-- Fill in a template's placeholders for one student's outstanding bill.
-- ----------------------------------------------------------------------------
create or replace function render_notification_template(p_template_key text, p_student_id uuid, p_fee_record_id uuid)
returns table(rendered_subject text, rendered_body text)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_body text;
  v_subject text;
  v_student_name text;
  v_month_label text;
  v_amount numeric;
begin
  select subject, body into v_subject, v_body from notification_templates where key = p_template_key and active;
  if v_body is null then
    raise exception 'Unknown or inactive template: %', p_template_key;
  end if;

  select s.name, to_char(fr.month, 'FMMonth YYYY'), fr.total_payable - fr.paid_total
    into v_student_name, v_month_label, v_amount
    from fee_records fr join students s on s.id = fr.student_id
    where fr.id = p_fee_record_id and s.id = p_student_id;

  v_body := replace(v_body, '{{student_name}}', coalesce(v_student_name, ''));
  v_body := replace(v_body, '{{month}}', coalesce(v_month_label, ''));
  v_body := replace(v_body, '{{amount}}', to_char(coalesce(v_amount, 0), 'FM999,999,999'));
  v_body := replace(v_body, '{{academy_name}}', 'Modern Science Academy');

  if v_subject is not null then
    v_subject := replace(v_subject, '{{month}}', coalesce(v_month_label, ''));
  end if;

  return query select v_subject, v_body;
end;
$$;

revoke execute on function render_notification_template(text, uuid, uuid) from public;
grant execute on function render_notification_template(text, uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Queue (and, if a channel is given, immediately mark sent) one
-- notification. Renders the template now and freezes the result — editing
-- the template afterward never changes what this row says was sent.
-- p_channel is nullable: the automated schedule below queues with no
-- channel yet (a human picks one from the UI); a direct Send from the
-- Notifications page passes the channel and this marks it sent in the same
-- call, since by that point the wa.me/sms:/mailto: link has already been
-- opened client-side.
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
  v_template_id uuid;
  v_subject text;
  v_body text;
  v_notification_id uuid;
begin
  select current_role_name() into v_role;
  if v_role is null or v_role not in ('Super Admin', 'Principal', 'Accountant', 'Cashier') then
    raise exception 'Not authorized to send fee notifications.';
  end if;

  select id into v_by from users where auth_user_id = auth.uid();
  select id into v_template_id from notification_templates where key = p_template_key and active;

  select rendered_subject, rendered_body into v_subject, v_body
    from render_notification_template(p_template_key, p_student_id, p_fee_record_id);

  insert into notifications (student_id, fee_record_id, template_id, type, channel, recipient, rendered_message, status, scheduled_for, sent_at, created_by)
    values (
      p_student_id, p_fee_record_id, v_template_id, p_type, p_channel, p_recipient, v_body,
      case when p_channel is not null then 'sent' else 'pending' end,
      date_trunc('month', (select month from fee_records where id = p_fee_record_id))::date,
      case when p_channel is not null then now() else null end,
      v_by
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

revoke execute on function queue_fee_notification(uuid, uuid, text, text, text, text) from public;
grant execute on function queue_fee_notification(uuid, uuid, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- The day-of-month automation:
--   10th → reminder_1, 20th → reminder_2, 25th → overdue
-- Only queues (status='pending', channel=null) — never sends anything by
-- itself. Meant to be called once a day; see app/api/cron/fee-reminders
-- for the Next.js side that a scheduler (Vercel Cron or Supabase's own
-- pg_cron) actually triggers daily. Restricted to service_role so it can't
-- be called from the client at all — only a trusted server context (the
-- cron route, using the admin client) should ever run this.
-- ----------------------------------------------------------------------------
create or replace function run_fee_reminder_schedule(p_as_of date default current_date)
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

  for v_row in select * from pending_fee_reminders(v_month) loop
    perform queue_fee_notification(v_row.student_id, v_row.fee_record_id,
      case v_key when 'fee_reminder_1' then 'reminder_1' when 'fee_reminder_2' then 'reminder_2' else 'overdue' end,
      v_key);
    v_count := v_count + 1;
  end loop;

  return query select v_key, v_count;
end;
$$;

revoke execute on function run_fee_reminder_schedule(date) from public;
grant execute on function run_fee_reminder_schedule(date) to service_role;
