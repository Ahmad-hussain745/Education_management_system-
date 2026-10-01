// The five durable queues provisioned by the "DURABLE QUEUE ARCHITECTURE"
// migration (20260922060000). Being listed here means the pgmq queue
// itself exists and enqueue/read/ack/dead-letter/audit all work for it —
// it does NOT mean anything runs on it. See lib/queue/handlers/index.js
// for which ones have a registered worker today, and why the rest
// deliberately don't yet.
export const QUEUES = {
  notifications: {
    name: "notifications",
    description: "Domain-event reactions (audit log, receipt email) and Communication Center sends (WhatsApp/SMS/email/push).",
  },
  reports: {
    name: "reports",
    description: "Reserved for moving heavy report generation off the request/response cycle, if a report ever gets too slow to run synchronously.",
  },
  document_generation: {
    name: "document_generation",
    description: "Reserved for async PDF/document generation — every PDF this app makes today (receipts, exports) is still synchronous.",
  },
  billing: {
    name: "billing",
    description: "Reserved for billing-side async work distinct from fee-generation.js's own monthly cron job.",
  },
  analytics: {
    name: "analytics",
    description: "Reserved for precomputing/refreshing analytics — every report/chart today queries live (see docs/EVENT_LEDGER_MODEL.md).",
  },
};

export const QUEUE_NAMES = Object.keys(QUEUES);
