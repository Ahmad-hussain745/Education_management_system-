-- ============================================================================
-- 47. NOTIFICATION STATUS LIFECYCLE — queued / ready / sent / failed
--
-- The bug: queue_fee_notification_internal() (0038) marked a notification
-- 'sent' the moment ANY channel was passed in — which happens the instant
-- a staff member clicks "Send WhatsApp"/"Send SMS", before the browser has
-- even opened wa.me/sms:, let alone before anyone on the other end has
-- actually received anything. A wa.me/sms: link is a handoff to a
-- different app entirely; this codebase has no way to know what happens
-- after that handoff. 'sent' was a claim this system had no way to back up.
--
-- The fix widens the vocabulary from two real states (sent/failed, plus
-- 'pending' for not-yet-touched) to four, and — this is the actual fix,
-- not just a rename — makes 'sent' and 'failed' reachable ONLY through
-- mark_notification_delivery_status() below, which exists specifically to
-- be called by something that actually knows the outcome: a synchronous
-- provider response (Email/Resend, wired below) today, and a real
-- WhatsApp Business API / SMS gateway delivery webhook whenever one gets
-- integrated. Clicking Send now earns 'ready' — "handed off, outcome
-- unknown" — which is what actually happened, no more and no less.
-- ============================================================================

update notifications set status = 'queued' where status = 'pending';

alter table notifications drop constraint notifications_status_check;
alter table notifications add constraint notifications_status_check
  check (status in ('queued', 'ready', 'sent', 'failed'));
alter table notifications alter column status set default 'queued';

alter table notification_logs drop constraint notification_logs_event_check;
alter table notification_logs add constraint notification_logs_event_check
  check (event in ('queued', 'ready', 'sent', 'failed'));

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
  v_status text;
  v_event text;
  v_detail text;
begin
  select id into v_template_id from notification_templates where key = p_template_key and active;

  select rendered_subject, rendered_body into v_subject, v_body
    from render_notification_template(p_template_key, p_student_id, p_fee_record_id);

  if p_channel is null then
    -- The automated schedule's own path (run_fee_reminder_schedule_for_institute)
    -- — nothing has happened yet beyond "this bill needs a reminder."
    v_status := 'queued';
    v_event := 'queued';
    v_detail := 'Queued by schedule';
  else
    -- A human just clicked Send. That's real and worth recording — just
    -- not as 'sent'. mark_notification_delivery_status() below is what
    -- moves this to 'sent' or 'failed', once something actually reports
    -- back what happened.
    v_status := 'ready';
    v_event := 'ready';
    v_detail := 'Handed off via ' || p_channel || ' — awaiting real delivery confirmation';
  end if;

  insert into notifications (student_id, fee_record_id, template_id, type, channel, recipient, rendered_message, status, scheduled_for, sent_at, created_by, institute_id)
    values (
      p_student_id, p_fee_record_id, v_template_id, p_type, p_channel, p_recipient, v_body,
      v_status,
      date_trunc('month', (select month from fee_records where id = p_fee_record_id))::date,
      null, -- sent_at is set only by mark_notification_delivery_status() when it's genuinely earned
      p_created_by,
      p_institute_id
    )
    on conflict (student_id, fee_record_id, type) where type <> 'manual' do update set
      channel = coalesce(excluded.channel, notifications.channel),
      recipient = coalesce(excluded.recipient, notifications.recipient),
      status = case when excluded.channel is not null then 'ready' else notifications.status end
    returning id into v_notification_id;

  insert into notification_logs (notification_id, event, detail) values (v_notification_id, v_event, v_detail);

  return v_notification_id;
end;
$$;

-- The seam this migration's header refers to: the ONE path allowed to
-- move a notification to 'sent' or 'failed'. Today's only caller is
-- app/(app)/notifications/actions.js, right after the synchronous Resend
-- response for email. When a real WhatsApp Business API or SMS gateway
-- gets integrated, its delivery webhook becomes the second caller — same
-- function, same rule: only something that actually knows the outcome
-- gets to report one.
--
-- service_role-only, not authenticated: even though today's one caller is
-- triggered by a signed-in staff member clicking Send, the call itself
-- goes through a Server Action using the admin client — never a raw
-- client-side update a browser could forge. A future delivery webhook
-- would be the same shape: a trusted server route, no end-user session.
create or replace function mark_notification_delivery_status(p_notification_id uuid, p_status text, p_detail text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'INVALID_STATUS: mark_notification_delivery_status only accepts sent or failed, got %', p_status;
  end if;

  update notifications set
    status = p_status,
    sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = p_notification_id;

  insert into notification_logs (notification_id, event, detail) values (p_notification_id, p_status, p_detail);
end;
$$;

revoke execute on function mark_notification_delivery_status(uuid, text, text) from public, authenticated;
grant execute on function mark_notification_delivery_status(uuid, text, text) to service_role;
