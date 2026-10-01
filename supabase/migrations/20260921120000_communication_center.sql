-- ============================================================================
-- COMMUNICATION CENTER
--
-- The existing `notifications` table (0027) stays exactly as it is — it's
-- a fee-reminder-specific queue (student_id, fee_record_id required) and
-- rewiring it into a general-purpose system would mean loosening columns
-- that are correctly NOT NULL for its actual job. What's new here is
-- general-purpose: any channel, any recipient (student, teacher, staff,
-- or an arbitrary campaign audience), with real provider delivery instead
-- of a wa.me/sms:/mailto: handoff. The two systems will end up sharing
-- the same PROVIDER code (lib/communications/providers/) — this
-- migration is only the new data model.
--
-- One table, not three, for Notification Queue / Delivery status /
-- Communication history: communication_messages IS the queue while
-- status = 'queued', IS the delivery-status view via its own status
-- column, and IS the history simply by existing after being sent — same
-- reasoning event_deliveries (0057) and sync_outbox already use
-- elsewhere in this app for exactly this "queue and audit trail are the
-- same row" shape.
-- ============================================================================

create table communication_templates (
  id            uuid primary key default gen_random_uuid(),
  institute_id  uuid references institutes(id) on delete cascade,
  channel       text not null check (channel in ('whatsapp', 'sms', 'email', 'push')),
  name          text not null,
  subject       text,                      -- email/push only
  body          text not null,             -- {{student_name}}, {{amount}}, {{month}}, {{institute_name}} placeholders, rendered client-side before queueing
  active        boolean not null default true,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now()
);

create table communication_campaigns (
  id            uuid primary key default gen_random_uuid(),
  institute_id  uuid references institutes(id) on delete cascade,
  name          text not null,
  channel       text not null check (channel in ('whatsapp', 'sms', 'email', 'push')),
  template_id   uuid references communication_templates(id) on delete set null,
  -- Audience is a small declarative filter, not a stored list of ids —
  -- {"recipient_type": "student_guardian", "class_id": "...", "section_id": "..."}
  -- or {"recipient_type": "teacher"} or {"recipient_type": "all_staff"}.
  -- queue_campaign_messages() below is what actually expands this into
  -- real recipient rows, once, at queue time — never re-evaluated later,
  -- so a class roster changing after a campaign was queued doesn't alter
  -- who it was actually sent to.
  audience      jsonb not null default '{}'::jsonb,
  status        text not null default 'draft' check (status in ('draft', 'queued', 'sending', 'completed', 'failed')),
  scheduled_at  timestamptz,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now()
);

create table communication_messages (
  id                  uuid primary key default gen_random_uuid(),
  institute_id        uuid references institutes(id) on delete cascade,
  campaign_id         uuid references communication_campaigns(id) on delete set null,   -- null = one-off send
  channel             text not null check (channel in ('whatsapp', 'sms', 'email', 'push')),
  recipient_type      text not null,        -- 'student_guardian', 'teacher', 'user'
  recipient_id        uuid,                 -- student_id, teacher_id, or user_id depending on recipient_type — not a hard FK, since which table varies
  to_address           text,                 -- phone/email/push endpoint actually used, frozen at send time
  subject              text,
  body                 text not null,        -- fully rendered, frozen at send time — never re-derived from a since-edited template
  status               text not null default 'queued' check (status in ('queued', 'sending', 'delivered', 'failed', 'bounced')),
  provider             text,                 -- 'resend', 'twilio', 'whatsapp_cloud', 'web_push'
  provider_message_id  text,
  error                text,
  attempts             int not null default 0,
  created_by           uuid references users(id),
  created_at           timestamptz not null default now(),
  sent_at              timestamptz,
  delivered_at         timestamptz
);
create index idx_communication_messages_institute_status on communication_messages(institute_id, status);
create index idx_communication_messages_campaign on communication_messages(campaign_id);
create index idx_communication_messages_created on communication_messages(institute_id, created_at desc);

create table push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  institute_id  uuid references institutes(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  endpoint      text not null,
  p256dh        text not null,
  auth          text not null,
  created_at    timestamptz not null default now(),
  unique (user_id, endpoint)
);

create trigger trg_set_institute_id before insert on communication_templates for each row execute function set_institute_id();
create trigger trg_set_institute_id before insert on communication_campaigns for each row execute function set_institute_id();
create trigger trg_set_institute_id before insert on communication_messages for each row execute function set_institute_id();
create trigger trg_set_institute_id before insert on push_subscriptions for each row execute function set_institute_id();

alter table communication_templates enable row level security;
alter table communication_campaigns enable row level security;
alter table communication_messages enable row level security;
alter table push_subscriptions enable row level security;

create policy institute_isolation on communication_templates as restrictive for all using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy institute_isolation on communication_campaigns as restrictive for all using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy institute_isolation on communication_messages as restrictive for all using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());
create policy institute_isolation on push_subscriptions as restrictive for all using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

-- Same tier as Admissions/Timetable management — no dedicated
-- "Communications Officer" role exists yet.
create policy "finance staff and principal manage templates" on communication_templates for all
  using (is_finance_staff() or current_role_name() = 'Principal') with check (is_finance_staff() or current_role_name() = 'Principal');
create policy "finance staff and principal manage campaigns" on communication_campaigns for all
  using (is_finance_staff() or current_role_name() = 'Principal') with check (is_finance_staff() or current_role_name() = 'Principal');
create policy "finance staff and principal manage messages" on communication_messages for all
  using (is_finance_staff() or current_role_name() = 'Principal') with check (is_finance_staff() or current_role_name() = 'Principal');

-- Push subscriptions: every signed-in user manages their own (this is
-- "does my browser get push notifications", not an institute-wide
-- setting) — no finance-staff gate needed, just "is this your own row".
create policy "user manages own push subscription" on push_subscriptions for all
  using (user_id = (select id from users where auth_user_id = auth.uid()))
  with check (user_id = (select id from users where auth_user_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- Expands a campaign's audience filter into real, queued message rows —
-- the ONE place that ever reads a class roster / teacher list to build a
-- send list, so "who did this campaign actually reach" is always
-- answerable later from communication_messages alone, without needing to
-- re-run the audience query against data that may have since changed.
-- ----------------------------------------------------------------------------
create or replace function queue_campaign_messages(p_campaign_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_campaign communication_campaigns%rowtype;
  v_template communication_templates%rowtype;
  v_institute uuid := current_institute_id();
  v_by uuid;
  v_count int := 0;
  v_rec record;
  v_body text;
begin
  if not (is_finance_staff() or current_role_name() = 'Principal') then
    raise exception 'NOT_AUTHORIZED: Not authorized to send a campaign.';
  end if;

  select * into v_campaign from communication_campaigns where id = p_campaign_id;
  if v_campaign.id is null then raise exception 'Campaign not found.'; end if;
  if v_campaign.institute_id is distinct from v_institute then
    raise exception 'NOT_AUTHORIZED: That campaign does not belong to your institute.';
  end if;
  if v_campaign.status <> 'draft' then raise exception 'ALREADY_QUEUED: This campaign has already been queued.'; end if;

  if v_campaign.template_id is not null then
    select * into v_template from communication_templates where id = v_campaign.template_id;
  end if;

  select id into v_by from users where auth_user_id = auth.uid();

  if v_campaign.audience->>'recipient_type' = 'student_guardian' then
    for v_rec in
      select s.id as recipient_id,
        case when v_campaign.channel = 'email' then s.guardian_email else s.guardian_phone end as to_address,
        s.name as student_name
      from students s
      where s.institute_id = v_institute and s.status = 'active'
        and (v_campaign.audience->>'class_id' is null or s.class_id = (v_campaign.audience->>'class_id')::uuid)
        and (v_campaign.audience->>'section_id' is null or s.section_id = (v_campaign.audience->>'section_id')::uuid)
    loop
      if v_rec.to_address is null or v_rec.to_address = '' then continue; end if;
      v_body := replace(coalesce(v_template.body, ''), '{{student_name}}', v_rec.student_name);
      insert into communication_messages (institute_id, campaign_id, channel, recipient_type, recipient_id, to_address, subject, body, created_by)
        values (v_institute, p_campaign_id, v_campaign.channel, 'student_guardian', v_rec.recipient_id, v_rec.to_address, v_template.subject, v_body, v_by);
      v_count := v_count + 1;
    end loop;

  elsif v_campaign.audience->>'recipient_type' = 'teacher' then
    for v_rec in
      select t.id as recipient_id, u.email, u.phone, t.name as teacher_name
      from teachers t
      join users u on u.id = t.user_id
      where t.institute_id = v_institute and t.status = 'active'
    loop
      v_rec.to_address := case when v_campaign.channel = 'email' then v_rec.email else v_rec.phone end;
      if v_rec.to_address is null or v_rec.to_address = '' then continue; end if;
      v_body := replace(coalesce(v_template.body, ''), '{{teacher_name}}', v_rec.teacher_name);
      insert into communication_messages (institute_id, campaign_id, channel, recipient_type, recipient_id, to_address, subject, body, created_by)
        values (v_institute, p_campaign_id, v_campaign.channel, 'teacher', v_rec.recipient_id, v_rec.to_address, v_template.subject, v_body, v_by);
      v_count := v_count + 1;
    end loop;
  else
    raise exception 'INVALID_AUDIENCE: audience.recipient_type must be student_guardian or teacher.';
  end if;

  update communication_campaigns set status = 'queued' where id = p_campaign_id;
  return v_count;
end;
$$;
revoke execute on function queue_campaign_messages(uuid) from public;
grant execute on function queue_campaign_messages(uuid) to authenticated;

-- A one-off send (not part of a campaign) — the direct replacement for
-- the old wa.me/sms:/mailto: SendButtons flow.
create or replace function queue_one_off_message(
  p_channel text, p_recipient_type text, p_recipient_id uuid, p_to_address text, p_subject text, p_body text
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_by uuid;
begin
  if not (is_finance_staff() or current_role_name() = 'Principal' or current_role_name() = 'Cashier') then
    raise exception 'NOT_AUTHORIZED: Not authorized to send a message.';
  end if;
  if p_to_address is null or p_to_address = '' then
    raise exception 'NO_ADDRESS: No phone/email on file for this recipient.';
  end if;
  select id into v_by from users where auth_user_id = auth.uid();
  insert into communication_messages (institute_id, channel, recipient_type, recipient_id, to_address, subject, body, created_by)
    values (current_institute_id(), p_channel, p_recipient_type, p_recipient_id, p_to_address, p_subject, p_body, v_by)
    returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function queue_one_off_message(text, text, uuid, text, text, text) from public;
grant execute on function queue_one_off_message(text, text, uuid, text, text, text) to authenticated;

-- Delivery outcome — written by the processor (service-role) after
-- actually calling a provider.
create or replace function record_message_delivery(p_message_id uuid, p_status text, p_provider text, p_provider_message_id text default null, p_error text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('delivered', 'failed', 'bounced') then
    raise exception 'INVALID_STATUS: status must be delivered, failed, or bounced.';
  end if;
  update communication_messages set
    status = p_status, provider = p_provider, provider_message_id = p_provider_message_id, error = p_error,
    attempts = attempts + 1, sent_at = coalesce(sent_at, now()),
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end
    where id = p_message_id;
end;
$$;
revoke execute on function record_message_delivery(uuid, text, text, text, text) from public, authenticated;
grant execute on function record_message_delivery(uuid, text, text, text, text) to service_role;

-- Dashboard-style counts for the Communication Center — same "aggregate
-- in the database" fix Priority 5 applied elsewhere.
create or replace function communication_dashboard_counts()
returns table(queued int, delivered int, failed int, total_last_30_days int)
language sql stable security definer set search_path = public as $$
  select
    count(*) filter (where status = 'queued'),
    count(*) filter (where status = 'delivered'),
    count(*) filter (where status in ('failed', 'bounced')),
    count(*) filter (where created_at >= now() - interval '30 days')
  from communication_messages
  where institute_id = current_institute_id();
$$;
revoke execute on function communication_dashboard_counts() from public;
grant execute on function communication_dashboard_counts() to authenticated;

insert into automation_jobs (key, name, description, schedule) values
  ('communications', 'Communication Queue', 'Dispatches queued WhatsApp/SMS/email/push messages to their real provider and records delivery status — see lib/communications/processor.js.', '0 * * * *')
on conflict (key) do nothing;
