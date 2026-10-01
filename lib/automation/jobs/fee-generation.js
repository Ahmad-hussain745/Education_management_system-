// Generates each active student's fee record for the current month.
// Calls run_monthly_fee_generation_for_institute() (0037), the
// service-role variant that takes the institute explicitly — the
// interactive generate_monthly_fee_records() can't be used here because it
// reads current_institute_id() from a signed-in session that cron doesn't have.
//
// Phase 15 adds the last two steps of the requested pipeline:
//   - "Calculate expected collection" — total_expected was already being
//     computed and returned by that same RPC (0037's own
//     generate_monthly_fee_records_for_institute: sum(total_payable) for
//     the whole month, not just the bills generated this run — a
//     previously-existing/skipped bill still counts toward what's
//     expected this month). It was just being discarded here; now it's
//     part of the summary.
//   - "Notify administrator" — an email to this institute's own Super
//     Admin/Principal, via notify.js (the same admin-only, no-human-
//     review-needed reasoning weekly-report's cron already established).
//     Deliberately NOT sent through the parent-facing notifications
//     queue (fee-reminders.js) — this is an internal summary for staff,
//     not a guardian-facing message that needs a person to review before
//     it goes out.
//
// "Create reminder schedule" (the pipeline step between this and
// notifying) needs no new code: fee-reminders.js already finds ANY
// qualifying unpaid bill live on the 10th/20th/25th by querying
// fee_records directly — a bill this job just generated is automatically
// eligible the moment it exists. There's no separate schedule to create
// or persist; the note in the email below just makes that explicit to
// the administrator reading it.
import { notifyInstituteAdmins } from "../notify";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

function monthLabel(monthStr) {
  const [y, m] = monthStr.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

export const feeGenerationJob = {
  key: "fee-generation",
  name: "Monthly Fee Generation",

  async run({ admin, institute, asOf }) {
    const today = asOf ? new Date(asOf) : new Date();

    // Vercel cron fires daily at minimum for some schedules, and a manual
    // trigger can happen any time — the date check keeps this to the 1st
    // regardless of what invoked it. Re-running on the same 1st is
    // harmless anyway (existing records are skipped, not duplicated).
    if (today.getDate() !== 1) {
      return { skipped: true, reason: "Not the 1st of the month" };
    }

    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
    const { data, error } = await admin.rpc("run_monthly_fee_generation_for_institute", {
      p_institute_id: institute.id,
      p_month: month,
    });
    if (error) throw new Error(error.message);

    const r = data?.[0] || {};
    const generated = r.generated_count ?? 0;
    const skipped = r.skipped_count ?? 0;
    const failed = r.failed_count ?? 0;
    // Every active student takes exactly one of these three branches in
    // the RPC's loop (0037), so this sum is the same "Load active
    // students" count the pipeline calls for — no second query needed to
    // get it.
    const students = generated + skipped + failed;
    const expected = Number(r.total_expected ?? 0);

    const notifyResult = await notifyInstituteAdmins(admin, institute.id, {
      subject: `${monthLabel(month)} Fee Generation — ${institute.name}`,
      html: `
        <h2>${monthLabel(month)} Fee Generation</h2>
        <p>${institute.name}</p>
        <ul>
          <li><strong>Students:</strong> ${students}</li>
          <li><strong>Generated:</strong> ${generated}</li>
          <li><strong>Skipped (already existed):</strong> ${skipped}</li>
          <li><strong>Failed:</strong> ${failed}</li>
        </ul>
        <p><strong>Expected collection this month:</strong> ${fmt(expected)}</p>
        <p style="color:#64748b;font-size:13px">
          Reminders will queue automatically on the 10th, 20th and 25th for whichever of these bills are still
          unpaid — nothing further to set up. A staff member still reviews and sends each reminder from
          Notifications; this run only generated the bills themselves.
        </p>
      `,
    });

    return {
      itemsProcessed: students,
      summary: {
        month,
        run_id: r.run_id ?? null,
        students,
        generated,
        skipped,
        failed,
        expected_amount: expected,
        admin_notified: !notifyResult.skipped && !notifyResult.error,
        notify_note: notifyResult.skipped ? notifyResult.reason : notifyResult.error || null,
      },
    };
  },
};
