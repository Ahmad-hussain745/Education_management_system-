import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Meant to be hit once a day by a scheduler — Vercel Cron (see vercel.json's
// "crons" entry).
//
// UPDATED (0038_fix_fee_reminder_cron.sql): this used to call the
// single-institute run_fee_reminder_schedule(), which called
// queue_fee_notification() — a function that requires a signed-in user's
// role. A cron request has no signed-in user, so every call here was
// silently failing with "Not authorized" before this fix; nothing was ever
// actually queued. It also predated multi-tenancy and had no institute
// scoping. Both are fixed by looping run_fee_reminder_schedule_for_institute()
// once per active institute instead.
//
// Still only ever QUEUES reminders (status='queued', no channel) —
// nothing gets marked 'sent', and no message is actually dispatched, until
// a staff member opens the Notifications page and clicks Send themselves
// (which, even then, only reaches 'ready' for WhatsApp/SMS — see
// 0047_notification_status_lifecycle.sql). A cron job should never be the
// thing that puts a real message in a parent's inbox with zero human
// involved.
//
// Protected by a shared secret — anyone who knows this URL but not
// CRON_SECRET gets a 401.
export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const asOf = new Date().toISOString().slice(0, 10);

  const { data: institutes, error: instError } = await admin.from("institutes").select("id, name").eq("is_active", true);
  if (instError) return NextResponse.json({ error: instError.message }, { status: 500 });

  const results = [];
  let templateKey = null;
  for (const inst of institutes || []) {
    const { data, error } = await admin.rpc("run_fee_reminder_schedule_for_institute", {
      p_institute_id: inst.id,
      p_as_of: asOf,
    });
    if (error) {
      results.push({ institute: inst.name, error: error.message });
      continue;
    }
    const r = data?.[0] || { template_key: null, queued_count: 0 };
    templateKey = templateKey || r.template_key;
    results.push({ institute: inst.name, template: r.template_key, queued: r.queued_count });
  }

  return NextResponse.json({
    ran_at: new Date().toISOString(),
    results,
    note: templateKey
      ? `Queued reminders per institute above. Nothing was sent — each institute's staff still needs to send from their own Notifications page.`
      : "Not a scheduled reminder day (10th/20th/25th) — nothing to do.",
  });
}
