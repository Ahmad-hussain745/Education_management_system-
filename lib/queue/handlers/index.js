import { handleNotificationMessage } from "./notifications";

// Which of the five provisioned queues (lib/queue/queues.js) actually
// have a worker today. reports/document_generation/billing/analytics are
// real, working pgmq queues — enqueue, read, dead-letter and audit all
// function for them exactly like 'notifications' — but nothing in this
// codebase produces messages onto them yet, so there's deliberately no
// handler registered for them here. Same "don't wire a step that does
// nothing real" reasoning as lib/events/registry.js's own omissions
// (Receipt/Analytics/Teacher Payroll not subscribing to domain events).
//
// Turning one on later is two steps: write its handler (same shape as
// notifications.js — `async (admin, message) => { ... throws on
// failure ... }`) and add it here. lib/automation/jobs/queue-worker.js
// already loops every queue name and skips any without an entry.
export const QUEUE_HANDLERS = {
  notifications: handleNotificationMessage,
};
