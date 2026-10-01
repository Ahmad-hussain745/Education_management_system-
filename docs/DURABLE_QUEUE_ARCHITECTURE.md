# Durable Queue Architecture (Supabase Queues / pgmq)

## The request's diagram, mapped onto what's actually here

```
Event → Queue → Worker → Provider → Retry → Dead Letter → Audit
```

| Step | Implementation |
|---|---|
| **Event** | `domain_events` (0057) for system events, and the direct `communication_messages` insert (Communication Center) for outbound sends — unchanged by this migration. |
| **Queue** | `pgmq` (Postgres-native, the extension behind Supabase Queues) — five queues, provisioned in `20260922060000_durable_queue_architecture.sql`: `notifications`, `reports`, `document_generation`, `billing`, `analytics`. |
| **Worker** | `lib/queue/worker.js#runQueueWorker`, run by the `queue-worker` automation job (`lib/automation/jobs/queue-worker.js`), hourly (`vercel.json`). |
| **Provider** | The same providers that already existed — `lib/communications/providers/*` for sends, `lib/events/handlers/*` for audit/notification reactions. Nothing about *what* runs changed, only *how it gets triggered*. |
| **Retry** | Built into pgmq itself: a message that isn't deleted/archived becomes visible again once its visibility timeout expires. No separate "retry at" column, no retry-scheduling cron. |
| **Dead Letter** | `queue_dead_letters` — once a message's `read_ct` exceeds the worker's `maxAttempts` (5, matching `communication_messages`' own `MAX_ATTEMPTS`), it's recorded there and archived out of the live queue instead of retrying forever. |
| **Audit** | `queue_audit_log` (every enqueue/succeed/fail/dead-letter) plus pgmq's own per-queue archive table for successfully processed messages. |

## Why pgmq, specifically

Postgres-native — same database this app already runs on, same backups,
same transaction guarantees, no new service to run or pay for. That
matters here specifically because `lib/automation/scheduler.js`'s own
comment used to say a "genuinely real-time async queue isn't available in
a serverless-functions-only deployment without adding external
infrastructure" — that was true before this migration. pgmq removes that
constraint without adding infrastructure: it's an extension on the same
Supabase Postgres instance, durable messages and archival included.

## What changed vs. what stayed the same

**Stayed exactly the same:**
- `domain_events` — still the permanent "this happened" log, still written by the same trigger.
- `communication_messages` — still the queue/status/history table for the Communication Center; its own lifecycle (`queued` → `delivered`/`failed`/`bounced`) is untouched.
- The daily automation sweeps, `event-dispatch` and `communications` — still registered, still run once a day. They're now the **same-day backstop** behind the queue worker rather than the only delivery path, but nothing about how they work changed.
- Every provider (`lib/communications/providers/*`) and every domain-event handler (`lib/events/handlers/*`) — unchanged.

**New:**
- `emit_payment_created_event()` now also calls `queue_enqueue('notifications', ...)` right after writing to `domain_events`, so a worker can react within the hour instead of only "same request" (inline dispatch) or "same day" (the sweep).
- `queue_one_off_message()` / `queue_campaign_messages()` (Communication Center) now also enqueue each `communication_messages` row onto `notifications`.
- `lib/queue/handlers/notifications.js` — the one worker wired up today. It branches on `message.kind` (`'domain_event'` or `'communication_message'`) and calls the exact same per-item functions the sweeps use (`processOneEvent`, `processOneMessage` — extracted from `dispatcher.js`/`processor.js` specifically so both paths share one implementation).

## The other four queues: provisioned, not wired up

`reports`, `document_generation`, `billing`, and `analytics` are real,
working pgmq queues today — `queue_enqueue`/`queue_read`/`queue_ack`/
`queue_dead_letter`/`queue_audit_log` all function for them exactly like
`notifications` does. What's missing is a **producer**: nothing in this
codebase currently does heavy/async report generation, document
generation, batched billing work, or offline analytics precomputation.
Every report and chart already queries live (see `EVENT_LEDGER_MODEL.md`'s
Analytics note, and `lib/events/registry.js`'s near-identical reasoning
for why "Analytics" isn't a domain-event subscriber either). Wiring a
queue that nothing ever calls would be exactly the kind of step this
codebase's own comments elsewhere warn against — a fake integration that
looks complete but does nothing real.

Turning one on, when the need is real, is two steps:
1. Write a handler — same shape as `lib/queue/handlers/notifications.js`: `async (admin, message) => { ...; throws on failure ... }`.
2. Register it in `lib/queue/handlers/index.js`. `lib/automation/jobs/queue-worker.js` already loops every provisioned queue name and skips any without a registered handler — no scheduler change needed.

Then call `enqueue(admin, "reports", instituteId, { ... })` (`lib/queue/client.js`) from wherever that work currently happens synchronously.

## Operational notes

- **Cron frequency**: `vercel.json` schedules `queue-worker` hourly (`0 * * * *`). Vercel's Hobby plan only runs cron jobs once a day regardless of the schedule string — sub-daily cron (this one, and genuinely getting `communications`/`event-dispatch` to their documented-but-currently-unmet hourly/daily cadences) needs a Pro plan or an external scheduler (e.g. cron-job.org hitting `/api/cron/automation?job=queue-worker` with the `CRON_SECRET` bearer token). Worth knowing plainly: on Hobby, this still works, just at the same once-a-day cadence as everything else behind `/api/cron/automation`.
- **Multi-tenancy**: pgmq queues are not partitioned per institute — one physical `notifications` queue carries every institute's messages, each self-tagged with `institute_id` in its payload. `queue-worker`'s per-institute run reads with a `conditional` filter (`{institute_id: ...}`, pgmq's own JSONB-containment-based conditional read) so it slots into the existing per-institute job engine (`lib/automation/engine.js`) instead of needing separate "run once globally" plumbing.
- **Visibility timeout**: 30 seconds by default (`lib/queue/worker.js`). A worker that crashes mid-message doesn't lose it — it just becomes redeliverable once that timeout passes.
- **Dashboard**: Automation Center → "Durable Queues" (Super Admin view) shows live depth, oldest-message age, and unresolved dead-letter counts per queue (`QueueHealthPanel.js`, backed by `queue_metrics()`/`queue_dead_letter_counts()`).
