import { createClient } from "@/lib/supabase/server";
import { nextRunLabel } from "@/lib/automation/schedule-labels";
import JobRow from "./JobRow";
import AnomaliesPanel from "./AnomaliesPanel";

// Principal — "Approvals, Alerts, Reports" (Phase 25). No Run Now/Pause
// controls anywhere on this view (JobRow's canRun/canPause=false below) —
// a Principal's real authority here is approving payroll/exam results
// (already genuinely theirs via can_approve() — canApprove.isPrincipal),
// not operating the automation schedule, which stays Super-Admin-only
// (see actions.js).
export default async function PrincipalView({ roleContext }) {
  const instituteId = roleContext.instituteId;
  const supabase = await createClient();
  const monthStart = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;

  const [
    { count: pendingPayroll },
    { data: draftResults },
    { count: pendingExpenses },
    { count: pendingReversals },
    { data: jobs },
    { data: overrides },
    { data: recentRuns },
  ] = await Promise.all([
    supabase
      .from("salary_records")
      .select("id", { count: "exact", head: true })
      .eq("institute_id", instituteId)
      .eq("month", monthStart)
      .eq("locked", false),
    supabase
      .from("exam_results")
      .select("exam_id")
      .eq("institute_id", instituteId)
      .eq("status", "draft"),
    // Phase 26 — request_expense() (0056) files these instead of posting
    // straight to the ledger once an amount reaches the institute's
    // large-expense threshold.
    supabase
      .from("expense_requests")
      .select("id", { count: "exact", head: true })
      .eq("institute_id", instituteId)
      .eq("status", "pending"),
    supabase
      .from("fee_reversal_requests")
      .select("id", { count: "exact", head: true })
      .eq("institute_id", instituteId)
      .eq("status", "pending"),
    supabase.from("automation_jobs").select("key, name, description, schedule, enabled").order("key"),
    supabase.from("automation_job_overrides").select("job_key, enabled").eq("institute_id", instituteId),
    supabase
      .from("automation_runs")
      .select("job_key, started_at, status, items_processed, summary")
      .eq("institute_id", instituteId)
      .order("started_at", { ascending: false })
      .limit(60),
  ]);

  const draftExamCount = new Set((draftResults || []).map((r) => r.exam_id)).size;

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
      <p className="text-sm text-slate-500 mt-1">Approvals, alerts, and how the automated jobs have been running.</p>

      <h2 className="text-sm font-semibold text-ink mt-6 mb-2">Approvals</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ApprovalCard
          label="Payroll drafts awaiting Approve & Lock"
          count={pendingPayroll || 0}
          href="/salary/payroll"
        />
        <ApprovalCard
          label="Exams with results still in draft"
          count={draftExamCount}
          href="/exams/results"
        />
        <ApprovalCard
          label="Large expenses awaiting approval"
          count={pendingExpenses || 0}
          href="/finance/expenses"
        />
        <ApprovalCard
          label="Fee reversals awaiting authorization"
          count={pendingReversals || 0}
          href="/fees/payments"
        />
      </div>

      <h2 className="text-sm font-semibold text-ink mt-8 mb-2">Alerts</h2>
      <p className="text-sm text-slate-500 mb-3">
        Flagged automatically by comparing today's numbers against their own recent history.
      </p>
      <AnomaliesPanel />

      <h2 className="text-sm font-semibold text-ink mt-8 mb-2">Reports</h2>
      <p className="text-sm text-slate-500 mb-3">
        A read-only view of when each automated job last ran — for the numbers themselves, see{" "}
        <a href="/finance/reports" className="text-royal hover:underline">Financial Reports</a> or{" "}
        <a href="/salary/reports" className="text-royal hover:underline">Salary Reports</a>.
      </p>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
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
              <JobRow key={job.key} job={job} canRun={false} canPause={false} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ApprovalCard({ label, count, href }) {
  return (
    <a href={href} className="bg-white rounded-xl border border-slate-200 p-4 block hover:border-royal transition-colors">
      <div className={`text-2xl font-semibold ${count > 0 ? "text-amber-600" : "text-emerald-700"}`}>{count}</div>
      <div className="text-sm text-slate-600 mt-1">{label}</div>
      {count > 0 && <div className="text-xs text-royal mt-2">Review →</div>}
    </a>
  );
}
