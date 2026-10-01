import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Runs once a month (see vercel.json's "crons" entry) and generates that
// month's fee records for every active institute, calling
// run_monthly_fee_generation_for_institute() once per institute —
// see 0037_fix_fee_generation_isolation.sql for why a per-institute loop
// is required rather than one call across all students.
//
// This is safe to run unattended, unlike the fee-reminders cron: it only
// creates internal fee_records rows (idempotent — re-running for a month
// that's already generated just skips existing records, same as clicking
// "Generate" twice manually does today). Nothing gets sent to anyone and
// no money moves; a staff member still reviews and collects fees the same
// way as before. That's the same line 0027_notifications.sql draws
// between "queue" and "send" — this sits on the queue side of it.
//
// Protected by the same CRON_SECRET as fee-reminders.
export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = new Date();
  // Only actually generate on the 1st — Vercel cron granularity is daily
  // at minimum for this schedule, so the date check keeps this idempotent
  // even if the schedule or a manual trigger fires more than once.
  if (today.getDate() !== 1) {
    return NextResponse.json({ ran_at: today.toISOString(), note: "Not the 1st of the month — nothing to do." });
  }

  const monthDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;

  const { data: institutes, error: instError } = await admin.from("institutes").select("id, name").eq("is_active", true);
  if (instError) return NextResponse.json({ error: instError.message }, { status: 500 });

  const results = [];
  for (const inst of institutes || []) {
    const { data, error } = await admin.rpc("run_monthly_fee_generation_for_institute", {
      p_institute_id: inst.id,
      p_month: monthDate,
    });
    if (error) {
      results.push({ institute: inst.name, error: error.message });
      continue;
    }
    const r = data?.[0] || {};
    results.push({
      institute: inst.name,
      generated: r.generated_count ?? 0,
      skipped: r.skipped_count ?? 0,
      failed: r.failed_count ?? 0,
    });
  }

  return NextResponse.json({ ran_at: today.toISOString(), month: monthDate, results });
}
