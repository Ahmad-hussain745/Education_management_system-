import { EVENT_HANDLERS } from "./registry";

// One event's worth of subscriber dispatch — extracted so it's callable
// per-item both from the batch sweep below AND from the durable-queue
// path (lib/queue/handlers/notifications.js), which pulls one event at a
// time off the 'notifications' queue rather than polling
// get_pending_events() itself.
//
// Handler failures are isolated per-handler, same reasoning as
// lib/automation/engine.js: audit failing must never stop notification
// from running, and vice versa. Failures are recorded on the event row
// (handler_errors) rather than thrown, so this always completes and
// always leaves a trace of what didn't work — the queue-worker caller
// is the one that decides whether a returned `errors` object should
// count as a retryable failure, not this function.
export async function processOneEvent(admin, institute, event) {
  const subscribers = EVENT_HANDLERS[event.event_type] || [];
  const handlerErrors = {};

  for (const { name, handler } of subscribers) {
    try {
      await handler({ admin, institute, event });
    } catch (err) {
      handlerErrors[name] = err.message || String(err);
    }
  }

  const hasErrors = Object.keys(handlerErrors).length > 0;
  await admin.rpc("mark_event_processed", { p_event_id: event.id, p_handler_errors: hasErrors ? handlerErrors : null });
  return { event_id: event.id, event_type: event.event_type, handlers: subscribers.map((s) => s.name), errors: hasErrors ? handlerErrors : null };
}

// Called two ways, same function either way:
//   1. Inline, right after a payment is recorded (app/(app)/fees/payments/
//      actions.js) — for near-instant reaction, using the same request's
//      already-authenticated context. Best-effort: a handler failing here
//      must never fail the payment itself, which already succeeded.
//   2. From the daily automation job (lib/automation/jobs/event-dispatch.js)
//      as the reliability sweep — catches anything the inline call AND the
//      durable-queue worker (lib/automation/jobs/queue-worker.js) both
//      missed, using the service-role client, no session required. Now the
//      backstop of two layers instead of one — see
//      emit_payment_created_event() (migration 20260922060000) for the
//      queue side, which is the fast path this sweep used to be alone.
export async function dispatchPendingEvents(admin, { instituteId, limit = 50 } = {}) {
  const { data: events, error } = await admin.rpc("get_pending_events", { p_institute_id: instituteId, p_limit: limit });
  if (error) throw new Error(`dispatch: could not read pending events: ${error.message}`);

  const { data: institute } = await admin.from("institutes").select("id, name").eq("id", instituteId).maybeSingle();

  const results = [];
  for (const event of events || []) {
    results.push(await processOneEvent(admin, institute, event));
  }

  return results;
}
