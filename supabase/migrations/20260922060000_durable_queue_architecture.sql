-- ============================================================================
-- DURABLE QUEUE ARCHITECTURE (Supabase Queues / pgmq)
--
-- What existed before this migration, and stays exactly as it was:
--   domain_events           (0057) — the permanent "this happened" log,
--                            still written by the same triggers, still
--                            what the daily event-dispatch sweep reads.
--   communication_messages  (20260921120000) — still the queue/status/
--                            history table for the Communication Center.
--   The daily automation sweeps (event-dispatch, communications jobs) —
--            still registered, still run once a day, still the ultimate
--            backstop for anything that somehow never got picked up any
--            other way.
--
-- What's new: a REAL durable queue sitting between "a row was written"
-- and "a worker reacted to it" — Supabase Queues, i.e. the `pgmq`
-- extension. Postgres-native (same database, same backups, same
-- transaction guarantees the rest of this app already relies on — no
-- new service to run or pay for), and it gives this app four things the
-- old "insert a row, poll for it later" shape didn't have:
--
--   Event → Queue → Worker → Provider → Retry → Dead Letter → Audit
--
--   Queue       pgmq holds the message durably — a crash mid-processing
--               doesn't lose it, it just becomes visible again once the
--               reading worker's visibility-timeout lease expires.
--   Worker      lib/queue/worker.js#runQueueWorker — reads a batch,
--               hands each message to a per-queue handler.
--   Retry       automatic and built into the queue itself: a message
--               that isn't explicitly deleted/archived just reappears
--               after its visibility timeout — no separate "retry at"
--               column or cron-within-a-cron to maintain.
--   Dead Letter queue_dead_letters (below) — once a message has been
--               read more times than lib/queue/worker.js's maxAttempts
--               allows, it's archived out of the live queue and
--               recorded here instead of retrying forever.
--   Audit       queue_audit_log (below) — enqueued/succeeded/failed/
--               dead_lettered, independent of whatever the referenced
--               row's own status column says, so "what did the queue
--               actually do with this" is answerable on its own.
--
-- Five queues are provisioned, matching the request exactly:
--   notifications        — WIRED UP. Domain-event reactions (audit,
--                           receipt email) and Communication Center
--                           sends. See lib/queue/handlers/notifications.js.
--   reports               — provisioned, no producer yet.
--   document_generation   — provisioned, no producer yet.
--   billing                — provisioned, no producer yet.
--   analytics             — provisioned, no producer yet.
-- The last four are real, working pgmq queues today — enqueue, read,
-- ack, dead-letter, and audit all function for them exactly like
-- 'notifications' — but nothing in this codebase produces messages onto
-- them, because nothing here currently does heavy/async report
-- generation, document generation, batched billing work, or offline
-- analytics precomputation; every report and chart already queries live
-- (see docs/EVENT_LEDGER_MODEL.md's Analytics note, and
-- lib/events/registry.js's near-identical reasoning for why "Analytics"
-- isn't a domain-event subscriber either). Wiring a queue that nothing
-- ever calls would be exactly the kind of fake step this codebase's own
-- comments elsewhere warn against building. When one of those becomes
-- real async work, the plumbing to carry it durably already exists —
-- see lib/queue/handlers/index.js for the one line that turns it on.
-- ============================================================================

create extension if not exists pgmq;

do $$ begin perform pgmq.create('notifications'); exception when others then null; end $$;
do $$ begin perform pgmq.create('reports'); exception when others then null; end $$;
do $$ begin perform pgmq.create('document_generation'); exception when others then null; end $$;
do $$ begin perform pgmq.create('billing'); exception when others then null; end $$;
do $$ begin perform pgmq.create('analytics'); exception when others then null; end $$;

-- ----------------------------------------------------------------------------
-- Dead letters: a message that failed processing more times than the
-- worker's maxAttempts allows. Its own table (not a status on some
-- other row) because a dead-lettered message might not even correspond
-- to a row that still exists (e.g. the referenced communication_message
-- got deleted between enqueue and processing) — the payload itself is
-- stored here, so nothing is lost even in that case.
-- ----------------------------------------------------------------------------
create table if not exists queue_dead_letters (
  id            uuid primary key default gen_random_uuid(),
  queue_name    text not null,
  institute_id  uuid references institutes(id) on delete cascade,
  msg_id        bigint,
  payload       jsonb not null,
  error         text not null,
  read_ct       int,
  failed_at     timestamptz not null default now(),
  resolved      boolean not null default false,
  resolved_at   timestamptz,
  resolved_by   uuid references users(id)
);
create index if not exists idx_queue_dead_letters_institute on queue_dead_letters(institute_id, failed_at desc);
create index if not exists idx_queue_dead_letters_queue on queue_dead_letters(queue_name, resolved, failed_at desc);

alter table queue_dead_letters enable row level security;

create policy "read own institute dead letters" on queue_dead_letters
  for select using (institute_id = current_institute_id() or institute_id is null);

-- No insert/update policy for authenticated — only queue_dead_letter()
-- (service-role worker path, below) writes these. Marking one resolved
-- goes through resolve_queue_dead_letter() below, not a raw UPDATE, so
-- it's still audited and role-gated instead of being a bare table grant.

-- ----------------------------------------------------------------------------
-- Audit trail: every enqueue/succeed/fail/dead-letter, independent of
-- the referenced row's own status column — same "keep an audit trail
-- that doesn't depend on the thing it's auditing still existing or
-- still agreeing" reasoning as audit_logs (0012) generally.
-- ----------------------------------------------------------------------------
create table if not exists queue_audit_log (
  id            bigint generated always as identity primary key,
  queue_name    text not null,
  msg_id        bigint,
  institute_id  uuid references institutes(id) on delete cascade,
  event         text not null check (event in ('enqueued', 'succeeded', 'failed', 'dead_lettered')),
  detail        jsonb,
  occurred_at   timestamptz not null default now()
);
create index if not exists idx_queue_audit_log_queue on queue_audit_log(queue_name, occurred_at desc);
create index if not exists idx_queue_audit_log_institute on queue_audit_log(institute_id, occurred_at desc);

alter table queue_audit_log enable row level security;

create policy "read own institute queue audit" on queue_audit_log
  for select using (institute_id = current_institute_id() or institute_id is null);

-- No insert/update policy for authenticated/anon — written only by the
-- queue_* functions below (security definer), same shape as
-- domain_events' own "no insert policy, only the definer function"
-- comment (0057).

-- ----------------------------------------------------------------------------
-- queue_enqueue — the ONLY way a message gets onto one of the five
-- queues. Validates the queue name against the provisioned set (a typo
-- here should fail loudly at the call site, not silently create a sixth
-- queue), stamps institute_id onto the message itself (pgmq queues are
-- shared across institutes — one physical queue, every message
-- self-describing which institute it belongs to, same multi-tenancy
-- shape used throughout this schema), and logs the enqueue.
-- ----------------------------------------------------------------------------
create or replace function queue_enqueue(p_queue_name text, p_institute_id uuid, p_payload jsonb, p_delay_seconds integer default 0)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_msg_id bigint;
begin
  if p_queue_name not in ('notifications', 'reports', 'document_generation', 'billing', 'analytics') then
    raise exception 'UNKNOWN_QUEUE: % is not a provisioned queue', p_queue_name;
  end if;

  select pgmq.send(p_queue_name, p_payload || jsonb_build_object('institute_id', p_institute_id), p_delay_seconds)
    into v_msg_id;

  insert into queue_audit_log (queue_name, msg_id, institute_id, event, detail)
    values (p_queue_name, v_msg_id, p_institute_id, 'enqueued', p_payload);

  return v_msg_id;
end;
$$;

revoke execute on function queue_enqueue(text, uuid, jsonb, integer) from public, authenticated;
grant execute on function queue_enqueue(text, uuid, jsonb, integer) to service_role;
-- Also called directly, regardless of this grant, from other SECURITY
-- DEFINER functions that run as their owner — emit_payment_created_event(),
-- queue_one_off_message(), queue_campaign_messages() below — same
-- reasoning as emit_domain_event()'s own grant comment (0057). The
-- explicit service_role grant above is for the worker/job side: reading
-- queue depth, or a future direct enqueue from a cron job.

-- Worker-facing read. p_conditional filters by containment against the
-- message body (pgmq's own `@>` support) — used to scope a read to one
-- institute's messages (`{"institute_id": "..."}`), which is what lets
-- the queue-worker automation job slot into the existing per-institute
-- job engine (lib/automation/engine.js) instead of needing its own
-- separate "run once globally" plumbing.
create or replace function queue_read(p_queue_name text, p_vt integer default 30, p_qty integer default 10, p_conditional jsonb default '{}'::jsonb)
returns table(msg_id bigint, read_ct integer, enqueued_at timestamptz, vt timestamptz, message jsonb)
language sql security definer set search_path = public as $$
  select * from pgmq.read(p_queue_name, p_vt, p_qty, p_conditional);
$$;

revoke execute on function queue_read(text, integer, integer, jsonb) from public, authenticated;
grant execute on function queue_read(text, integer, integer, jsonb) to service_role;

-- Success: archive (not delete) — pgmq keeps archived messages in their
-- own per-queue archive table, so the processed message itself remains
-- inspectable. Combined with the 'succeeded' audit row, that's the
-- Audit step in the diagram covered twice over: what happened (here)
-- and the message that caused it (pgmq's archive).
create or replace function queue_ack(p_queue_name text, p_msg_id bigint, p_institute_id uuid default null, p_detail jsonb default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
begin
  select pgmq.archive(p_queue_name, p_msg_id) into v_ok;
  insert into queue_audit_log (queue_name, msg_id, institute_id, event, detail)
    values (p_queue_name, p_msg_id, p_institute_id, 'succeeded', p_detail);
  return v_ok;
end;
$$;

revoke execute on function queue_ack(text, bigint, uuid, jsonb) from public, authenticated;
grant execute on function queue_ack(text, bigint, uuid, jsonb) to service_role;

-- Transient failure, still under the attempt limit: nothing to do to
-- the message itself — it stays in the live queue and pgmq's own
-- visibility timeout makes it readable again once the current worker's
-- lease on it expires. That expiry-based re-delivery IS the Retry step;
-- this function only records that an attempt failed.
create or replace function queue_fail(p_queue_name text, p_msg_id bigint, p_institute_id uuid, p_error text, p_read_ct integer default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into queue_audit_log (queue_name, msg_id, institute_id, event, detail)
    values (p_queue_name, p_msg_id, p_institute_id, 'failed', jsonb_build_object('error', p_error, 'read_ct', p_read_ct));
end;
$$;

revoke execute on function queue_fail(text, bigint, uuid, text, integer) from public, authenticated;
grant execute on function queue_fail(text, bigint, uuid, text, integer) to service_role;

-- Out of attempts: record the payload and error permanently in
-- queue_dead_letters (so it's inspectable even if the row it referenced
-- is later deleted), log it, then archive it out of the live queue so
-- it stops being redelivered.
create or replace function queue_dead_letter(p_queue_name text, p_msg_id bigint, p_institute_id uuid, p_payload jsonb, p_error text, p_read_ct integer default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into queue_dead_letters (queue_name, msg_id, institute_id, payload, error, read_ct)
    values (p_queue_name, p_msg_id, p_institute_id, p_payload, p_error, p_read_ct);
  insert into queue_audit_log (queue_name, msg_id, institute_id, event, detail)
    values (p_queue_name, p_msg_id, p_institute_id, 'dead_lettered', jsonb_build_object('error', p_error, 'read_ct', p_read_ct));
  perform pgmq.archive(p_queue_name, p_msg_id);
end;
$$;

revoke execute on function queue_dead_letter(text, bigint, uuid, jsonb, text, integer) from public, authenticated;
grant execute on function queue_dead_letter(text, bigint, uuid, jsonb, text, integer) to service_role;

-- A Super Admin/Principal acknowledging a dead-lettered message by hand
-- (e.g. after fixing whatever made it fail, or deciding it's not worth
-- redelivering) — a dedicated function rather than a raw UPDATE grant,
-- same "an action, not a column edit" shape as approveAndLock() etc.
create or replace function resolve_queue_dead_letter(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_by uuid;
begin
  if not (current_role_name() in ('Super Admin', 'Principal')) then
    raise exception 'NOT_AUTHORIZED: Only a Super Admin or Principal can resolve a dead-lettered message.';
  end if;
  select id into v_by from users where auth_user_id = auth.uid();
  update queue_dead_letters set resolved = true, resolved_at = now(), resolved_by = v_by
    where id = p_id and institute_id = current_institute_id();
end;
$$;

revoke execute on function resolve_queue_dead_letter(uuid) from public;
grant execute on function resolve_queue_dead_letter(uuid) to authenticated;

-- Dashboard-facing: depth/age per queue. Deliberately NOT institute-
-- scoped — these are operational figures about the queue itself (one
-- physical queue shared by every institute), the same "global, not
-- per-institute" shape automation_jobs already uses for the job
-- registry. Institute-scoped figures (how many of MY messages are
-- stuck) come from queue_dead_letter_counts() below instead.
create or replace function queue_metrics()
returns table(queue_name text, queue_length bigint, oldest_msg_age_sec integer, total_messages bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_q text;
begin
  for v_q in select unnest(array['notifications', 'reports', 'document_generation', 'billing', 'analytics']) loop
    return query select m.queue_name, m.queue_length, m.oldest_msg_age_sec, m.total_messages from pgmq.metrics(v_q) m;
  end loop;
end;
$$;

revoke execute on function queue_metrics() from public;
grant execute on function queue_metrics() to authenticated;

create or replace function queue_dead_letter_counts()
returns table(queue_name text, unresolved_count bigint)
language sql stable security definer set search_path = public as $$
  select queue_name, count(*) from queue_dead_letters
    where institute_id = current_institute_id() and not resolved
    group by queue_name;
$$;

revoke execute on function queue_dead_letter_counts() from public;
grant execute on function queue_dead_letter_counts() to authenticated;

-- ----------------------------------------------------------------------------
-- Wire the two existing producers up to the 'notifications' queue.
-- Both keep doing exactly what they did before (domain_events insert /
-- communication_messages insert) — this only ADDS the durable-queue
-- side effect, so nothing that already worked changes shape.
-- ----------------------------------------------------------------------------

create or replace function emit_payment_created_event() returns trigger as $$
declare
  v_event_id uuid;
begin
  v_event_id := emit_domain_event(
    'PAYMENT_CREATED',
    new.institute_id,
    jsonb_build_object(
      'payment_id', new.id,
      'fee_record_id', new.fee_record_id,
      'student_id', new.student_id,
      'month', new.month,
      'amount', new.amount,
      'method', new.method,
      'receipt_no', new.receipt_no,
      'is_advance', new.is_advance,
      'received_by', new.received_by,
      'paid_on', new.paid_on
    )
  );

  -- The fast, durable path: a worker can pick this up within seconds
  -- (lib/automation/jobs/queue-worker.js) instead of waiting for the
  -- inline call in recordPayment() to be the only near-real-time path,
  -- or the daily event-dispatch sweep to be the only guarantee. Both of
  -- those stay in place unchanged as additional layers, not replaced.
  perform queue_enqueue(
    'notifications',
    new.institute_id,
    jsonb_build_object('kind', 'domain_event', 'event_id', v_event_id, 'event_type', 'PAYMENT_CREATED')
  );

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function queue_one_off_message(
  p_channel text, p_recipient_type text, p_recipient_id uuid, p_to_address text, p_subject text, p_body text
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_by uuid;
  v_institute uuid := current_institute_id();
begin
  if not (is_finance_staff() or current_role_name() = 'Principal' or current_role_name() = 'Cashier') then
    raise exception 'NOT_AUTHORIZED: Not authorized to send a message.';
  end if;
  if p_to_address is null or p_to_address = '' then
    raise exception 'NO_ADDRESS: No phone/email on file for this recipient.';
  end if;
  select id into v_by from users where auth_user_id = auth.uid();
  insert into communication_messages (institute_id, channel, recipient_type, recipient_id, to_address, subject, body, created_by)
    values (v_institute, p_channel, p_recipient_type, p_recipient_id, p_to_address, p_subject, p_body, v_by)
    returning id into v_id;

  perform queue_enqueue('notifications', v_institute, jsonb_build_object('kind', 'communication_message', 'message_id', v_id));

  return v_id;
end;
$$;
revoke execute on function queue_one_off_message(text, text, uuid, text, text, text) from public;
grant execute on function queue_one_off_message(text, text, uuid, text, text, text) to authenticated;

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
  v_msg_id uuid;
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
        values (v_institute, p_campaign_id, v_campaign.channel, 'student_guardian', v_rec.recipient_id, v_rec.to_address, v_template.subject, v_body, v_by)
        returning id into v_msg_id;
      perform queue_enqueue('notifications', v_institute, jsonb_build_object('kind', 'communication_message', 'message_id', v_msg_id));
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
        values (v_institute, p_campaign_id, v_campaign.channel, 'teacher', v_rec.recipient_id, v_rec.to_address, v_template.subject, v_body, v_by)
        returning id into v_msg_id;
      perform queue_enqueue('notifications', v_institute, jsonb_build_object('kind', 'communication_message', 'message_id', v_msg_id));
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

insert into automation_jobs (key, name, description, schedule) values
  ('queue-worker', 'Durable Queue Worker', 'Drains the notifications queue (audit/receipt emails, WhatsApp/SMS/email/push sends) with retry and dead-lettering — see lib/queue/worker.js. The daily event-dispatch/communications jobs remain as a same-day backstop.', '0 * * * *')
on conflict (key) do nothing;
