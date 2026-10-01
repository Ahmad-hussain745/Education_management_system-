import * as queue from "./client";

const DEFAULT_VISIBILITY_TIMEOUT = 30; // seconds a message stays invisible while a worker holds it
const DEFAULT_MAX_ATTEMPTS = 5; // matches lib/communications/processor.js's own MAX_ATTEMPTS

// Generic durable-queue drain: read a batch, hand each message to the
// queue's handler, and resolve it one of three ways —
//   succeeded      → queue.ack (archives the message — the archive row
//                     IS the audit trail, same "the queue row is the
//                     history" reasoning communication_messages already
//                     uses for itself).
//   failed, retry  → queue.fail (just logs; the message is left alone
//                     and pgmq's own visibility timeout makes it
//                     re-readable once that expires — that's the retry,
//                     no separate scheduling needed).
//   failed, out of
//   attempts       → queue.deadLetter (recorded permanently in
//                     queue_dead_letters, archived out of the live
//                     queue so it stops being redelivered).
//
// One message failing must never stop the rest of the batch — same
// per-item isolation reasoning as lib/automation/engine.js's per-
// institute loop and lib/events/dispatcher.js's per-handler loop.
export async function runQueueWorker(admin, queueName, handler, {
  visibilityTimeout = DEFAULT_VISIBILITY_TIMEOUT,
  batchSize = 10,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  conditional = {},
} = {}) {
  const messages = await queue.readBatch(admin, queueName, { visibilityTimeout, batchSize, conditional });

  let succeeded = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const msg of messages) {
    const instituteId = msg.message?.institute_id ?? null;
    try {
      await handler(admin, msg.message);
      await queue.ack(admin, queueName, msg.msg_id, instituteId);
      succeeded++;
    } catch (err) {
      const errorMessage = err?.message || String(err);
      if (msg.read_ct >= maxAttempts) {
        await queue.deadLetter(admin, queueName, msg.msg_id, instituteId, msg.message, errorMessage, msg.read_ct);
        deadLettered++;
      } else {
        await queue.fail(admin, queueName, msg.msg_id, instituteId, errorMessage, msg.read_ct);
        failed++;
      }
    }
  }

  return { read: messages.length, succeeded, failed, deadLettered };
}
