import { processOneEvent } from "@/lib/events/dispatcher";
import { processOneMessage } from "@/lib/communications/processor";

// The 'notifications' queue carries two kinds of message — see each
// producer for exactly where these get enqueued:
//   'domain_event'          — emit_payment_created_event() (migration
//                              20260922060000), right after inserting
//                              into domain_events.
//   'communication_message' — queue_one_off_message() /
//                              queue_campaign_messages() (Communication
//                              Center), right after inserting into
//                              communication_messages.
//
// Both branches reuse the exact same per-item logic the daily sweep jobs
// (event-dispatch, communications) already used before this queue
// existed — processOneEvent/processOneMessage — so "what actually
// happens when an event fires or a message is sent" still has one
// implementation, whether it's reached via the queue (fast path) or the
// daily sweep (backstop).
export async function handleNotificationMessage(admin, message) {
  const institute = message.institute_id ? await loadInstitute(admin, message.institute_id) : null;

  if (message.kind === "domain_event") {
    const { data: event, error } = await admin.from("domain_events").select("*").eq("id", message.event_id).maybeSingle();
    if (error) throw new Error(`notifications queue: could not load event ${message.event_id}: ${error.message}`);
    if (!event) return; // domain_events rows are never deleted — shouldn't happen, but nothing to do if it did
    if (event.processed_at) return; // the daily sweep (or an earlier delivery of this same message) already handled it

    const result = await processOneEvent(admin, institute, event);
    if (result.errors) {
      const detail = Object.entries(result.errors).map(([name, err]) => `${name}: ${err}`).join("; ");
      throw new Error(`domain event ${event.id} (${event.event_type}): ${detail}`);
    }
    return;
  }

  if (message.kind === "communication_message") {
    const { data: row, error } = await admin.from("communication_messages").select("*").eq("id", message.message_id).maybeSingle();
    if (error) throw new Error(`notifications queue: could not load message ${message.message_id}: ${error.message}`);
    if (!row || row.status !== "queued") return; // already sent (e.g. the hourly sweep beat this worker to it) — nothing to do

    await processOneMessage(admin, row);
    return;
  }

  throw new Error(`notifications queue: unknown message kind "${message.kind}"`);
}

async function loadInstitute(admin, instituteId) {
  const { data } = await admin.from("institutes").select("id, name").eq("id", instituteId).maybeSingle();
  return data;
}
