import { runQueueWorker } from "@/lib/queue/worker";
import { QUEUE_HANDLERS } from "@/lib/queue/handlers";
import { QUEUE_NAMES } from "@/lib/queue/queues";

// The durable-queue counterpart to event-dispatch.js/communications.js —
// this is the FAST path for both now (seconds, on whatever schedule this
// job's own cron uses — see vercel.json), not just "next sweep". Those
// two jobs stay registered unchanged as the same-day backstop for
// anything that somehow never got enqueued, or that this worker never
// ran for — see their own updated comments for why removing them isn't
// warranted just because a faster path now exists.
//
// pgmq queues aren't partitioned per institute — a single 'notifications'
// queue carries every institute's messages, each self-tagged with its
// own institute_id (see queue_enqueue() in the migration). Rather than
// give this job its own "run once globally" plumbing outside the
// existing per-institute engine (lib/automation/engine.js), each
// institute's run just reads with a conditional filter scoped to its own
// messages (`{institute_id: ...}`, using pgmq's own containment-based
// conditional read) — so it slots into runJob()'s existing per-institute
// loop exactly like every other job here.
export const queueWorkerJob = {
  key: "queue-worker",
  name: "Durable Queue Worker",

  async run({ admin, institute }) {
    const summary = {};
    let itemsProcessed = 0;

    for (const queueName of QUEUE_NAMES) {
      const handler = QUEUE_HANDLERS[queueName];
      if (!handler) continue; // no producer/consumer wired up yet — see lib/queue/handlers/index.js

      const result = await runQueueWorker(admin, queueName, handler, {
        conditional: { institute_id: institute.id },
      });
      summary[queueName] = result;
      itemsProcessed += result.read;
    }

    return { itemsProcessed, summary };
  },
};
