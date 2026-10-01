import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";

// Runs weekly (see vercel.json). For each active institute, builds a plain
// summary of the last 7 days — fee collection, attendance rate, new
// admissions, outstanding fees — and emails it to that institute's own
// Super Admins and Principals only, via the admin client (each query below
// is explicitly filtered by institute_id since the admin client bypasses
// RLS, same reasoning as the other cron routes added alongside this one).
//
// Unlike the fee-reminder queue, this genuinely sends — but only to the
// institute's own admin staff about their own institute's numbers, not to
// parents/guardians, so there's no "a human should approve this message"
// concern the way there is for guardian-facing reminders.
//
// Requires RESEND_API_KEY to be set in Vercel's environment variables; if
// it isn't yet, sendEmail() returns { skipped: true } and this route still
// completes and reports what it *would* have sent, rather than failing.
export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: institutes, error: instError } = await admin.from("institutes").select("id, name").eq("is_active", true);
  if (instError) return NextResponse.json({ error: instError.message }, { status: 500 });

  const results = [];

  for (const inst of institutes || []) {
    // Priority 4 — was four raw-row pulls per institute (payments,
    // attendance, new-student rows, every unpaid/partial fee_records row)
    // summed/filtered in JS, repeated once per institute in this loop —
    // the worst-scaling instance of this pattern in the app, since
    // institute count multiplies it directly. get_month_financial_summary/
    // get_attendance_summary are called here as service_role (this route
    // already runs under the admin client), which assert_institute_access()
    // (Priority 4 migration) explicitly allows to name any institute,
    // unlike an ordinary authenticated caller who can only ever query
    // their own.
    const [{ data: fin }, { data: att }, { data: newStudents }, { data: outstanding }, { data: recipients }] =
      await Promise.all([
        admin.rpc("get_month_financial_summary", { p_institute_id: inst.id, p_start_date: weekAgo, p_end_date: now.toISOString().slice(0, 10) }).single(),
        admin.rpc("get_attendance_summary", { p_institute_id: inst.id, p_start_date: weekAgo, p_end_date: now.toISOString().slice(0, 10), p_who: "student" }).single(),
        admin.from("students").select("id").eq("institute_id", inst.id).gte("admission_date", weekAgo),
        admin.from("fee_records").select("total_payable, paid_total").eq("institute_id", inst.id).in("status", ["unpaid", "partial"]),
        admin
          .from("users")
          .select("email, name, role:roles!inner(name)")
          .eq("institute_id", inst.id)
          .eq("status", "active")
          .in("role.name", ["Super Admin", "Principal"]),
      ]);

    const collected = Number(fin?.collected || 0);
    const attendanceRate = att?.rate === null || att?.rate === undefined ? null : Math.round(Number(att.rate));
    const admissions = newStudents?.length || 0;
    // This one stays a direct sum over fee_records rather than a new RPC —
    // outstanding-fees-by-status isn't a date-range aggregate the way
    // everything else here is (it's "every currently unpaid/partial bill,
    // whenever it's from"), so it doesn't fit get_month_financial_summary's
    // shape, and Reports > Pending Fees already has its own dedicated,
    // paginated RPC (fee_arrears_accounts) for the general case — adding a
    // third variant just for this one weekly total isn't worth it for a
    // single number in an email.
    const totalOutstanding = (outstanding || []).reduce((sum, r) => sum + (Number(r.total_payable || 0) - Number(r.paid_total || 0)), 0);

    const recipientEmails = (recipients || []).map((r) => r.email).filter(Boolean);

    const html = `
      <h2>${inst.name} — Weekly Summary</h2>
      <p>${weekAgo} to ${now.toISOString().slice(0, 10)}</p>
      <ul>
        <li><strong>Fees collected:</strong> Rs. ${collected.toLocaleString()}</li>
        <li><strong>Attendance rate:</strong> ${attendanceRate !== null ? attendanceRate + "%" : "No attendance recorded this week"}</li>
        <li><strong>New admissions:</strong> ${admissions}</li>
        <li><strong>Total outstanding fees:</strong> Rs. ${totalOutstanding.toLocaleString()}</li>
      </ul>
    `;

    let sendResult = { skipped: true, reason: "No admin recipients found" };
    if (recipientEmails.length > 0) {
      sendResult = await sendEmail({ to: recipientEmails, subject: `${inst.name} — Weekly Summary`, html });
    }

    results.push({ institute: inst.name, collected, attendanceRate, admissions, totalOutstanding, recipients: recipientEmails.length, sendResult });
  }

  return NextResponse.json({ ran_at: now.toISOString(), results });
}
