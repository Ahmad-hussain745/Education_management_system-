-- ============================================================================
-- 57. EVENT-DRIVEN ARCHITECTURE (Phase 27) + a carried-over fix
--
-- CARRIED OVER FROM THE PAYROLL APPROVAL AUDIT (previous session): the
-- enforce_approve_only() trigger (0002_rls.sql) let is_finance_staff()
-- short-circuit BEFORE the can_approve() check ever ran, meaning an
-- Accountant could set locked=true on their own draft by calling
-- approveAndLock() directly — the UI hides that button from anyone but
-- a Principal, but nothing in the database actually stopped it. The
-- "Principal Approval" step was a button-hiding convention, not an
-- enforced boundary. Fixed below: flipping locked false→true now always
-- requires can_approve(), regardless of role.
--
-- EVENT SYSTEM: PAYMENT_CREATED is the flagship example (matching the
-- request exactly), emitted by a trigger on fee_payments — a trigger,
-- not application code, so it fires no matter which code path inserts a
-- row (the interactive form, a future API, anything), the same
-- reliability reasoning behind every other trigger in this codebase.
--
-- Two deliberately different reaction speeds, because a real message
-- queue doesn't exist here (serverless functions, no persistent broker):
--   - SYNCHRONOUS subscribers are the ones that already exist as direct
--     Postgres triggers — Ledger (trg_fee_payments_ledger, wherever it's
--     defined) posts in the SAME transaction as the payment. That's
--     correct and deliberately NOT rerouted through this event table —
--     ledger posting has to be atomic with the payment, not "eventually
--     consistent." Routing it through an async queue would be a
--     regression, not an improvement.
--   - ASYNCHRONOUS subscribers (Notification, Audit here) read from
--     domain_events, dispatched either inline right after the payment
--     (lib/events/dispatcher.js, called from recordPayment()) for near-
--     instant reaction, or by a daily automation job as the reliability
--     sweep for anything the inline call missed or failed.
--
-- Receipt, Analytics, and Teacher Payroll are in the request's diagram
-- but are NOT built as subscribers here, and that's a design decision,
-- not an oversight — see lib/events/registry.js for why each one already
-- gets what it needs without subscribing to anything.
-- ============================================================================

create or replace function enforce_approve_only() returns trigger as $$
begin
  -- Locking (false→true) always requires can_approve() now, even for
  -- finance staff. This is the actual Principal-approval gate; being
  -- finance staff no longer bypasses it.
  if new.locked and not old.locked then
    if not can_approve() then
      raise exception 'NOT_AUTHORIZED: Only a Principal or Super Admin can approve and lock payroll.';
    end if;
    return new;
  end if;

  if is_finance_staff() then
    return new;
  end if;
  if not can_approve() then
    raise exception 'not authorized to modify this row';
  end if;
  if to_jsonb(new) - 'locked' - 'locked_at' - 'locked_by' - 'updated_at'
     is distinct from to_jsonb(old) - 'locked' - 'locked_at' - 'locked_by' - 'updated_at' then
    raise exception 'Principal may only approve/lock this record, not edit its figures';
  end if;
  return new;
end;
$$ language plpgsql;

create table if not exists domain_events (
  id            uuid primary key default gen_random_uuid(),
  institute_id  uuid not null references institutes(id) on delete cascade,
  event_type    text not null,
  payload       jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  processed_at  timestamptz,
  handler_errors jsonb
);
create index if not exists idx_domain_events_pending on domain_events(institute_id, processed_at, created_at);
create index if not exists idx_domain_events_type on domain_events(event_type, created_at desc);

alter table domain_events enable row level security;

create policy "read own institute events" on domain_events
  for select using (institute_id = current_institute_id());

-- No insert/update policy for authenticated/anon — events are only ever
-- written by the emit trigger (security definer, below) or the
-- service-role dispatcher marking them processed.

create or replace function emit_domain_event(p_event_type text, p_institute_id uuid, p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into domain_events (institute_id, event_type, payload)
    values (p_institute_id, p_event_type, p_payload)
    returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function emit_domain_event(text, uuid, jsonb) from public, authenticated;
grant execute on function emit_domain_event(text, uuid, jsonb) to service_role;
-- Also callable from the trigger below regardless of grants, since
-- security definer functions run as their owner — the explicit grant
-- above is for the dispatcher's own direct use (marking synthetic
-- events, tests, etc.), not required for the trigger path itself.

create or replace function emit_payment_created_event() returns trigger as $$
begin
  perform emit_domain_event(
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
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_fee_payments_emit_created on fee_payments;
create trigger trg_fee_payments_emit_created
  after insert on fee_payments for each row execute function emit_payment_created_event();

-- Dispatcher-facing read/update: the async job needs to see pending
-- events and mark them processed, using the service-role client (no
-- signed-in session, so current_institute_id() isn't available — this
-- function takes the institute explicitly, same pattern as every
-- cron-safe function since 0037).
create or replace function get_pending_events(p_institute_id uuid, p_limit int default 50)
returns setof domain_events
language sql security definer set search_path = public as $$
  select * from domain_events
    where institute_id = p_institute_id and processed_at is null
    order by created_at asc
    limit p_limit;
$$;

revoke execute on function get_pending_events(uuid, int) from public, authenticated;
grant execute on function get_pending_events(uuid, int) to service_role;

create or replace function mark_event_processed(p_event_id uuid, p_handler_errors jsonb default null)
returns void
language sql security definer set search_path = public as $$
  update domain_events set processed_at = now(), handler_errors = p_handler_errors where id = p_event_id;
$$;

revoke execute on function mark_event_processed(uuid, jsonb) from public, authenticated;
grant execute on function mark_event_processed(uuid, jsonb) to service_role;

insert into automation_jobs (key, name, description, schedule) values
  ('event-dispatch', 'Domain Event Dispatch', 'Safety-net sweep for domain events (PAYMENT_CREATED, etc.) not already processed inline — see lib/events/dispatcher.js.', '0 4 * * *')
on conflict (key) do nothing;
