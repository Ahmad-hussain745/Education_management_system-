import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { runDailyJobs, runScheduledJob, JOBS } from "@/lib/automation/scheduler";

// Single entry point for the automation subsystem. Runs daily; each job
// decides for itself whether today is a day it applies (see scheduler.js).
//
// ?job=<key> runs one job on demand — useful for testing a job without
// waiting for its schedule, and for re-running one that failed. Still
// requires CRON_SECRET, so it isn't publicly triggerable.
//
// The pre-existing per-job routes (/api/cron/fee-reminders,
// /api/cron/monthly-fee-generation) still work and are left in place —
// removing them while a deployment might still have them scheduled would
// break automation mid-migration. Once vercel.json points only here, they
// can be deleted.
export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { searchParams } = new URL(request.url);
  const jobKey = searchParams.get("job");
  const asOf = searchParams.get("as_of") || undefined;

  try {
    if (jobKey) {
      if (!JOBS[jobKey]) {
        return NextResponse.json({ error: `Unknown job: ${jobKey}`, available: Object.keys(JOBS) }, { status: 400 });
      }
      const result = await runScheduledJob(admin, jobKey, { asOf });
      return NextResponse.json({ ran_at: new Date().toISOString(), ...result });
    }

    const results = await runDailyJobs(admin, { asOf });
    return NextResponse.json({ ran_at: new Date().toISOString(), jobs: results });
  } catch (err) {
    // Only reached if something outside any individual job fails (e.g.
    // the institutes lookup) — per-job and per-institute failures are
    // caught and logged further in.
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
