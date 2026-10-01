import { startRun, finishRun, logError } from "./logger";

// Runs one job across every active institute, logging each institute's
// execution separately.
//
// Two deliberate properties:
//
// 1. One institute's failure never stops the others. Before this, a cron
//    route looping institutes inline would abort the whole run on the
//    first error — so institute #1 failing meant institutes #2..#N never
//    got their fees generated, with nothing recorded to say why.
//
// 2. Jobs return a summary object rather than writing their own log rows.
//    Keeping the logging here means every job is observable the same way
//    without each one remembering to do it.

export async function runJob(admin, job, { institutes, context = {}, force = false }) {
  const results = [];

  for (const institute of institutes) {
    // Checked per-institute, inside the loop — NOT once before it, and
    // not force-skipped even when this whole run started from a single-
    // institute call. That's what makes "institute A paused this" have
    // zero effect on institute B, the same isolation property (1) above
    // already gives failures. `force` (Run Now, from the Automation
    // Center) is the one deliberate bypass — a manual, explicit run
    // shouldn't be blocked by a schedule the same admin who's clicking
    // the button already knows they've paused.
    if (!force && !(await isJobEnabled(admin, job.key, institute.id))) {
      results.push({ institute: institute.name, status: "skipped", reason: "Paused for this institute" });
      continue;
    }

    const run = await startRun(admin, { jobKey: job.key, instituteId: institute.id });
    try {
      const outcome = await job.run({ admin, institute, ...context });

      if (outcome?.skipped) {
        await finishRun(admin, run, { status: "skipped", summary: outcome.summary ?? { reason: outcome.reason } });
        results.push({ institute: institute.name, status: "skipped", reason: outcome.reason });
        continue;
      }

      await finishRun(admin, run, {
        status: "success",
        itemsProcessed: outcome?.itemsProcessed ?? 0,
        summary: outcome?.summary ?? null,
      });
      results.push({ institute: institute.name, status: "success", ...outcome?.summary });
    } catch (err) {
      const message = err?.message || String(err);
      await logError(admin, { run, jobKey: job.key, instituteId: institute.id, message });
      await finishRun(admin, run, { status: "failed", summary: { error: message } });
      results.push({ institute: institute.name, status: "failed", error: message });
      // Deliberately no rethrow — see property (1) above.
    }
  }

  return results;
}

export async function getActiveInstitutes(admin) {
  const { data, error } = await admin.from("institutes").select("id, name").eq("is_active", true);
  if (error) throw new Error(`Could not load institutes: ${error.message}`);
  return data || [];
}

// A job is skipped (not failed) when it's disabled — checked per
// institute now (automation_job_overrides, 0046), falling back to the
// global automation_jobs.enabled default when an institute has never
// touched it. That fallback is what makes this migration additive: an
// institute that's never clicked Pause behaves exactly as it did before
// 0046 existed.
export async function isJobEnabled(admin, jobKey, instituteId = null) {
  if (instituteId) {
    const { data: override } = await admin
      .from("automation_job_overrides")
      .select("enabled")
      .eq("job_key", jobKey)
      .eq("institute_id", instituteId)
      .maybeSingle();
    if (override) return override.enabled;
  }
  const { data } = await admin.from("automation_jobs").select("enabled").eq("key", jobKey).maybeSingle();
  return data?.enabled !== false;
}
