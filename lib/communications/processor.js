import * as emailProvider from "./providers/email";
import * as smsProvider from "./providers/sms";
import * as whatsappProvider from "./providers/whatsapp";
import * as pushProvider from "./providers/push";

const PROVIDERS = { email: emailProvider, sms: smsProvider, whatsapp: whatsappProvider, push: pushProvider };
const MAX_ATTEMPTS = 5;

// One message's worth of send-and-record — extracted so it's callable
// per-item both from the batch sweep below AND from the durable-queue
// path (lib/queue/handlers/notifications.js), which pulls one message at
// a time off the 'notifications' queue rather than polling
// communication_messages itself. Throws on any non-delivery (unknown
// channel included) so the queue worker's retry/dead-letter logic has a
// clear signal to act on — the batch sweep below just catches it per
// item, same as it always counted both cases as "failed" before this
// was extracted.
export async function processOneMessage(admin, message) {
  const provider = PROVIDERS[message.channel];
  if (!provider) {
    await admin.rpc("record_message_delivery", {
      p_message_id: message.id, p_status: "failed", p_provider: null, p_provider_message_id: null,
      p_error: `Unknown channel: ${message.channel}`,
    });
    throw new Error(`Unknown channel: ${message.channel}`);
  }

  const result = await provider.send(message);
  await admin.rpc("record_message_delivery", {
    p_message_id: message.id,
    p_status: result.delivered ? "delivered" : "failed",
    p_provider: result.provider,
    p_provider_message_id: result.providerMessageId || null,
    p_error: result.error || null,
  });
  if (!result.delivered) throw new Error(result.error || `${message.channel} send failed`);
  return result;
}

// Called by the communications automation job (per institute, service-role
// admin client) and, for a fast one-off send, directly from the send
// action too — same function either way, so "what actually happens when a
// message is sent" only has one implementation to reason about. Now the
// same-day backstop behind the durable-queue worker (see
// lib/automation/jobs/queue-worker.js and queue_one_off_message()/
// queue_campaign_messages() in migration 20260922060000, which enqueue
// every message durably for near-real-time delivery); this still exists
// to catch anything that somehow never got enqueued, or that the queue
// worker itself never ran for.
export async function processQueue(admin, instituteId, { limit = 50 } = {}) {
  const { data: messages } = await admin
    .from("communication_messages")
    .select("*")
    .eq("institute_id", instituteId)
    .in("status", ["queued"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(limit);

  let delivered = 0;
  let failed = 0;

  for (const message of messages || []) {
    try {
      await processOneMessage(admin, message);
      delivered++;
    } catch {
      failed++;
    }
  }

  return { processed: (messages || []).length, delivered, failed };
}
