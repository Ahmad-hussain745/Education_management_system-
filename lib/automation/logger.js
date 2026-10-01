// Every automated run writes here. The point is that a job failing at 4am
// leaves a trace someone can find later — before this, a silently failed
// fee generation was invisible until a parent asked why they had no bill.
//
// All writes go through the service-role admin client (automation has no
// signed-in user), which bypasses RLS. The read policies in
// 0045_automation_engine.sql are what let staff see their own institute's
// history from the app.

export async function startRun(admin, { jobKey, instituteId }) {
  const { data, error } = await admin
    .from("automation_runs")
    .insert({ job_key: jobKey, institute_id: instituteId, status: "running" })
    .select("id, started_at")
    .single();
  if (error) {
    // Logging must never be the reason a job doesn't run. Return null and
    // let the caller proceed unlogged rather than aborting real work
    // because the bookkeeping table was unreachable.
    console.error(`[automation] could not open run for ${jobKey}:`, error.message);
    return null;
  }
  return data;
}

export async function finishRun(admin, run, { status, itemsProcessed = 0, summary = null }) {
  if (!run) return;
  const durationMs = Date.now() - new Date(run.started_at).getTime();
  const { error } = await admin
    .from("automation_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      items_processed: itemsProcessed,
      summary,
      duration_ms: durationMs,
    })
    .eq("id", run.id);
  if (error) console.error("[automation] could not close run:", error.message);
}

export async function logError(admin, { run, jobKey, instituteId, message, detail = null }) {
  const { error } = await admin.from("automation_errors").insert({
    run_id: run?.id ?? null,
    job_key: jobKey,
    institute_id: instituteId,
    message: String(message).slice(0, 2000),
    detail,
  });
  if (error) console.error("[automation] could not log error:", error.message);
}
