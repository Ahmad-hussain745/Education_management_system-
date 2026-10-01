import { feeGenerationJob } from "./jobs/fee-generation";
import { feeRemindersJob } from "./jobs/fee-reminders";
import { reconciliationJob } from "./jobs/reconciliation";
import { inventoryAlertsJob } from "./jobs/inventory-alerts";
import { payrollJob } from "./jobs/payroll";
import { backupsJob } from "./jobs/backups";
import { anomalyDetectionJob } from "./jobs/anomaly-detection";
import { eventDispatchJob } from "./jobs/event-dispatch";
import { communicationsJob } from "./jobs/communications";
import { queueWorkerJob } from "./jobs/queue-worker";
import { runJob, getActiveInstitutes } from "./engine";

export const JOBS = {
  [feeGenerationJob.key]: feeGenerationJob,
  [feeRemindersJob.key]: feeRemindersJob,
  [reconciliationJob.key]: reconciliationJob,
  [inventoryAlertsJob.key]: inventoryAlertsJob,
  [payrollJob.key]: payrollJob,
  [backupsJob.key]: backupsJob,
  [anomalyDetectionJob.key]: anomalyDetectionJob,
  [eventDispatchJob.key]: eventDispatchJob,
  [communicationsJob.key]: communicationsJob,
  [queueWorkerJob.key]: queueWorkerJob,
};

// Which jobs a given day's tick should attempt. Vercel's cron scheduling
// stays in vercel.json (it's what actually invokes us), but "is today a
// day this job cares about" lives in the jobs themselves — fee-generation
// and payroll check for the 1st, fee-reminders checks for the 10th/20th/
// 25th, and each returns { skipped } rather than running. That keeps the
// decision next to the logic it guards instead of split across two files
// that can drift apart.
export function listJobs() {
  return Object.values(JOBS).map((j) => ({ key: j.key, name: j.name }));
}

export async function runScheduledJob(admin, jobKey, { asOf, instituteIds, force = false } = {}) {
  const job = JOBS[jobKey];
  if (!job) throw new Error(`Unknown job: ${jobKey}`);

  let institutes = await getActiveInstitutes(admin);
  if (instituteIds) institutes = institutes.filter((i) => instituteIds.includes(i.id));

  // No top-level enabled gate here anymore — pausing is per-institute now
  // (0046_automation_job_overrides.sql) and checked per-institute INSIDE
  // runJob, so institute A being paused can never affect institute B's run
  // in the same daily cron tick.
  const results = await runJob(admin, job, { institutes, context: { asOf }, force });

  return {
    job: jobKey,
    status: results.some((r) => r.status === "failed") ? "partial_failure" : "ok",
    institutes: institutes.length,
    results,
  };
}

// The Automation Center's "Run Now" — one institute, triggered by that
// institute's own Super Admin clicking a button, not a cron tick. force:
// true is deliberate: a paused job should still run when explicitly asked
// to, the same way a disabled CI workflow still allows a manual dispatch.
export async function runJobNowForInstitute(admin, jobKey, instituteId, { asOf } = {}) {
  if (!JOBS[jobKey]) throw new Error(`Unknown job: ${jobKey}`);
  return runScheduledJob(admin, jobKey, { asOf, instituteIds: [instituteId], force: true });
}

export async function runDailyJobs(admin, { asOf } = {}) {
  // event-dispatch/communications here are now the SAME-DAY BACKSTOP,
  // not the primary path. The near-real-time paths are: the inline call
  // in recordPayment() (app/(app)/fees/payments/actions.js), for the
  // same request; and queue-worker, its own more-frequent cron (see
  // vercel.json), which drains the durable 'notifications' pgmq queue
  // every message actually gets enqueued onto now (see
  // emit_payment_created_event()/queue_one_off_message()/
  // queue_campaign_messages() in migration 20260922060000). This daily
  // sweep only matters for whatever somehow slipped past both of those —
  // a message that failed to enqueue, or a queue-worker run that never
  // happened — which is why it's still here rather than removed.
  const daily = ["fee-generation", "fee-reminders", "reconciliation", "payroll", "backups", "anomaly-detection", "event-dispatch", "communications"];
  const out = [];
  for (const key of daily) {
    // One job failing must not stop the rest — same reasoning as the
    // per-institute isolation in engine.js, one level up.
    try {
      out.push(await runScheduledJob(admin, key, { asOf }));
    } catch (err) {
      out.push({ job: key, status: "failed", error: err.message });
    }
  }
  return out;
}
