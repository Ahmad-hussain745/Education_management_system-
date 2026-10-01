"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import { getRoleContext } from "@/lib/auth/roles";
import { runJobNowForInstitute, JOBS } from "@/lib/automation/scheduler";

// Every action here re-checks its own role itself (requireRole), even
// though the page that renders the buttons already gates on it — the same
// "don't trust a hidden button" reasoning applied everywhere else server
// actions touch something sensitive in this codebase.
//
// Phase 25 widened who can reach this file at all — Principal (Approvals/
// Alerts/Reports) and Accountant (Finance/Reconciliation/Payroll) now get
// their own views of /automation — but NOT an equally wider set of
// permissions here. Two controls stay Super-Admin-only on purpose:
//   - setJobEnabled (Pause/Resume) — a scheduling POLICY decision that
//     affects every future run of a job, not a one-off action; same bar
//     as Settings.
//   - runJobNow for anything outside Accountant's own three finance jobs
//     (fee-generation, reconciliation, payroll, anomaly-detection) — an
//     Accountant triggering Backup Verification or Inventory Alerts isn't
//     "Finance, Reconciliation, Payroll," it's everything, which is what
//     Super Admin is for.
const ACCOUNTANT_RUNNABLE_JOBS = ["fee-generation", "reconciliation", "payroll", "anomaly-detection"];

export async function runJobNow(jobKey) {
  const role = await requireRole(["Super Admin", "Accountant"]);
  if (!JOBS[jobKey]) return { error: `Unknown job: ${jobKey}` };
  if (role === "Accountant" && !ACCOUNTANT_RUNNABLE_JOBS.includes(jobKey)) {
    return { error: "That job is outside what an Accountant can run — ask a Super Admin." };
  }

  const roleContext = await getRoleContext();
  if (!roleContext?.instituteId) return { error: "Not assigned to an institute." };

  const admin = createAdminClient();
  try {
    const result = await runJobNowForInstitute(admin, jobKey, roleContext.instituteId);
    revalidatePath("/automation");
    return { result };
  } catch (err) {
    return { error: err.message };
  }
}

// set_automation_job_enabled() (0046) does the real authorization and
// institute-scoping — this is the thinnest possible wrapper so a paused/
// resumed job shows up immediately without a full page reload.
export async function setJobEnabled(jobKey, enabled) {
  await requireRole(["Super Admin"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_automation_job_enabled", { p_job_key: jobKey, p_enabled: enabled });
  if (error) {
    if (error.message?.includes("NOT_AUTHORIZED")) return { error: "You're not authorized to change automation settings." };
    return { error: error.message };
  }
  revalidatePath("/automation");
  return { ok: true };
}

// Recent runs + errors for one job, this institute only — backs the
// "View Logs" expand on each row. Kept small (last 15 runs) since this is
// a quick-glance panel, not the full history; automation_runs itself has
// no row limit for anyone who needs to query further. Read-only, so it's
// open to everyone who has SOME /automation view worth reading logs
// from — Cashier/Teacher's views don't render a job table at all, so
// this never actually gets called from theirs, but the gate here matches
// what's reachable rather than assuming that.
export async function getJobLogs(jobKey) {
  await requireRole(["Super Admin", "Principal", "Accountant"]);
  const roleContext = await getRoleContext();
  if (!roleContext?.instituteId) return { error: "Not assigned to an institute." };

  const supabase = await createClient();
  const [{ data: runs, error: runsError }, { data: errors }] = await Promise.all([
    supabase
      .from("automation_runs")
      .select("id, started_at, finished_at, status, items_processed, summary, duration_ms")
      .eq("job_key", jobKey)
      .eq("institute_id", roleContext.instituteId)
      .order("started_at", { ascending: false })
      .limit(15),
    supabase
      .from("automation_errors")
      .select("id, message, occurred_at")
      .eq("job_key", jobKey)
      .eq("institute_id", roleContext.instituteId)
      .order("occurred_at", { ascending: false })
      .limit(15),
  ]);
  if (runsError) return { error: runsError.message };

  return { runs: runs || [], errors: errors || [] };
}

// Open (not dismissed) anomaly-type staff_notifications for this
// institute — backs AnomaliesPanel.js. Uses the regular (non-admin)
// client deliberately: RLS's own "read own institute staff notifications"
// policy (0050) is sufficient here, same as any other read-only listing
// on this page — no need for the admin client just to read something RLS
// already allows. Principal/Accountant added for Phase 25 ("Alerts" /
// "Finance") — dismiss_staff_notification() (0050) itself has no role
// check beyond institute membership, so this was already safe to widen
// without a migration.
export async function getOpenAnomalies() {
  await requireRole(["Super Admin", "Principal", "Accountant"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_notifications")
    .select("id, severity, title, message, related_table, created_at, updated_at")
    .eq("type", "anomaly")
    .is("dismissed_at", null)
    .order("updated_at", { ascending: false });
  if (error) return { error: error.message };
  return { anomalies: data || [] };
}

export async function dismissAnomaly(id) {
  await requireRole(["Super Admin", "Principal", "Accountant"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("dismiss_staff_notification", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/automation");
  return { ok: true };
}
