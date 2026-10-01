import { createClient } from "@/lib/supabase/server";
import { nextRunLabel } from "@/lib/automation/schedule-labels";
import JobRow from "./JobRow";
import AnomaliesPanel from "./AnomaliesPanel";

// Accountant — "Finance, Reconciliation, Payroll" (Phase 25). Scoped to
// exactly those jobs, matching ACCOUNTANT_RUNNABLE_JOBS in actions.js —
// Run Now is real here (canRun=true), Pause/Resume isn't (canPause=false
// always): triggering today's reconciliation is finance work, but
// deciding reconciliation should stop running automatically every night
// is a scheduling POLICY call, same bar as Settings, Super-Admin-only
// regardless of which view renders the row.
const ACCOUNTANT_JOB_KEYS = ["fee-generation", "reconciliation", "payroll", "anomaly-detection"];

export default async function AccountantView({ roleContext }) {
  const instituteId = roleContext.instituteId;
  const supabase = await createClient();

  const [{ data: jobs }, { data: overrides }, { data: recentRuns }] = await Promise.all([
    supabase
      .from("automation_jobs")
      .select("key, name, description, schedule, enabled")
      .in("key", ACCOUNTANT_JOB_KEYS)
      .order("key"),
    supabase.from("automation_job_overrides").select("job_key, enabled").eq("institute_id", instituteId),
    supabase
      .from("automation_runs")
      .select("job_key, started_at, status, items_processed, summary")
      .eq("institute_id", instituteId)
      .in("job_key", ACCOUNTANT_JOB_KEYS)
      .order("started_at", { ascending: false })
      .limit(40),
  ]);

  const overrideByKey = new Map((overrides || []).map((o) => [o.job_key, o.enabled]));
  const lastRunByKey = new Map();
  for (const run of recentRuns || []) {
    if (!lastRunByKey.has(run.job_key)) lastRunByKey.set(run.job_key, run);
  }
  const now = new Date();
  const rows = (jobs || []).map((job) => {
    const enabled = overrideByKey.has(job.key) ? overrideByKey.get(job.key) : job.enabled;
    return { ...job, enabled, nextRun: enabled ? nextRunLabel(job.key, now) : null, lastRun: lastRunByKey.get(job.key) || null };
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Automation</h1>
      <p className="text-sm text-slate-500 mt-1">
        Fee generation, reconciliation, and payroll drafting — the jobs that touch what you're responsible for.
        Run Now works here; pausing a job's schedule is a Super Admin setting.
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
              <JobRow key={job.key} job={job} canRun={true} canPause={false} />
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="text-sm font-semibold text-ink mt-8 mb-2">Anomalies</h2>
      <p className="text-sm text-slate-500 mb-3">
        Cash collection, cashier reversals, expense categories, arrears, and salary cost — compared against
        their own recent history, flagged only when the difference is large enough to be worth a look.
      </p>
      <AnomaliesPanel />
    </div>
  );
}
