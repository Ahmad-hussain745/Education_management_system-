import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";
import { nextRunLabel } from "@/lib/automation/schedule-labels";
import JobRow from "./JobRow";
import SyncHealthPanel from "./SyncHealthPanel";
import AnomaliesPanel from "./AnomaliesPanel";
import QueueHealthPanel from "./QueueHealthPanel";

// Super Admin's view — "Everything" (Phase 25). Full control over every
// registered job, all open anomalies, backup freshness, this device's
// sync health. The other four role views (PrincipalView.js,
// AccountantView.js, CashierView.js, TeacherView.js) each show a scoped
// slice of this same underlying data — nothing here is Super-Admin-only
// DATA, just the full unscoped view of it plus the scheduling controls
// (Pause/Resume) that stay Super-Admin-only regardless of view (see
// actions.js's own comment on why).
export default async function SuperAdminView() {
  const roleContext = await getRoleContext();
  const instituteId = roleContext.instituteId;
  const supabase = await createClient();

  const [{ data: jobs }, { data: overrides }, { data: recentRuns }, { data: backupRuns }] = await Promise.all([
    supabase.from("automation_jobs").select("key, name, description, schedule, enabled").order("key"),
    supabase.from("automation_job_overrides").select("job_key, enabled").eq("institute_id", instituteId),
    // Last 60 runs across all jobs for this institute is comfortably
    // enough to find each job's single most-recent row (6 jobs, at most
    // one real run a day each) without a separate query per job.
    supabase
      .from("automation_runs")
      .select("job_key, started_at, finished_at, status, items_processed, summary")
      .eq("institute_id", instituteId)
      .order("started_at", { ascending: false })
      .limit(60),
    // The 60-row shared query above only reaches back ~10 days across 6
    // jobs — nowhere near enough to reliably find a once-a-month
    // backups run. This one is scoped to just that job, 40 rows back,
    // comfortably covering a month even with the odd missed day.
    supabase
      .from("automation_runs")
      .select("started_at, status, summary")
      .eq("institute_id", instituteId)
      .eq("job_key", "backups")
      .order("started_at", { ascending: false })
      .limit(40),
  ]);

  const overrideByKey = new Map((overrides || []).map((o) => [o.job_key, o.enabled]));
  const lastRunByKey = new Map();
  for (const run of recentRuns || []) {
    if (!lastRunByKey.has(run.job_key)) lastRunByKey.set(run.job_key, run);
  }

  // Backup freshness, derived from the backups job's own run history — no
  // separate table for this, same reasoning as the cadence tags added to
  // backups.js: the run history already has everything needed to answer
  // "when did daily/weekly/monthly last succeed."
  const successfulBackupRuns = (backupRuns || []).filter((r) => r.status === "success");
  const lastDaily = successfulBackupRuns[0] || null;
  const lastWeekly = successfulBackupRuns.find((r) => r.summary?.cadence?.weekly) || null;
  const lastMonthly = successfulBackupRuns.find((r) => r.summary?.cadence?.monthly) || null;

  const now = new Date();
  const rows = (jobs || []).map((job) => {
    const enabled = overrideByKey.has(job.key) ? overrideByKey.get(job.key) : job.enabled;
    return {
      ...job,
      enabled,
      nextRun: enabled ? nextRunLabel(job.key, now) : null,
      lastRun: lastRunByKey.get(job.key) || null,
    };
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Automation Center</h1>
      <p className="text-sm text-slate-500 mt-1">
        Every scheduled job below runs once a day per institute automatically — the button on each row is for
        checking on it or stepping in, not for normal operation. Fee reminders and payroll drafts are queued,
        never sent or paid, without a person opening that screen and confirming.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-6">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Job</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Next Run</th>
              <th className="text-left px-4 py-3">Last Run</th>
              <th className="text-left px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((job) => (
              <JobRow key={job.key} job={job} />
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="text-sm font-semibold text-ink mt-8 mb-2">Durable Queues</h2>
      <p className="text-sm text-slate-500 mb-3">
        Event → Queue → Worker → Provider → Retry → Dead Letter → Audit. The Durable Queue Worker row above
        drains these; a message that keeps failing ends up in Dead Letters instead of retrying forever.
        See <code>docs/DURABLE_QUEUE_ARCHITECTURE.md</code>.
      </p>
      <QueueHealthPanel />

      <h2 className="text-sm font-semibold text-ink mt-8 mb-2">Anomalies</h2>
      <p className="text-sm text-slate-500 mb-3">
        Flagged automatically by comparing today's numbers against their own recent history — a real
        average vs. a real current figure, not a prediction. See the Anomaly Detection row above for
        when this last ran.
      </p>
      <AnomaliesPanel />

      <h2 className="text-sm font-semibold text-ink mt-8 mb-2">Backups</h2>
      <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm">
        <div className="grid grid-cols-3 gap-4 mb-3">
          <CadenceStatus label="Daily verification" run={lastDaily} />
          <CadenceStatus label="This week" run={lastWeekly} />
          <CadenceStatus label="This month" run={lastMonthly} />
        </div>
        <p className="text-xs text-slate-500 mb-3">
          These confirm the database is alive and row counts haven&apos;t dropped unexpectedly —
          they are NOT the backups themselves. Real backups are Supabase&apos;s automatic daily
          backups (Dashboard → Database → Backups) and the migration files in your repo.
          See <code>docs/BACKUP_AND_RECOVERY.md</code>.
        </p>
        <a href="/automation/backup-export" className="text-royal text-sm font-medium hover:underline">
          Download an encrypted local copy →
        </a>
      </div>

      <h2 className="text-sm font-semibold text-ink mt-8 mb-2">Device Sync</h2>
      <p className="text-sm text-slate-500 mb-3">
        This is separate from the jobs above — it's this browser's own offline queue (attendance, payments, expenses,
        inventory saved while offline), not something that runs on a schedule.
      </p>
      <SyncHealthPanel instituteId={instituteId} />
    </div>
  );
}

function CadenceStatus({ label, run }) {
  if (!run) {
    return (
      <div>
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-brick text-sm font-medium">No successful run yet</div>
      </div>
    );
  }
  const when = new Date(run.started_at);
  const staleMs = Date.now() - when.getTime();
  const stale = staleMs > 1000 * 60 * 60 * 24 * 2; // no success in 2+ days is worth flagging
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-sm font-medium ${stale ? "text-brick" : "text-sage"}`}>
        {stale ? "⚠ " : "✅ "}{when.toLocaleDateString()}
      </div>
    </div>
  );
}
