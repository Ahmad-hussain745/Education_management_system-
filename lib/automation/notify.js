import { sendEmail } from "@/lib/email";

// Shared "tell this institute's OWN admin staff something" step.
// lib/email.js's own comment already anticipated this ("other automated
// emails later") — weekly-report's cron route was the first caller,
// fee-generation.js is the second. Extracted here rather than copied a
// second time so a third automated admin email doesn't have to re-derive
// the recipient query again.
//
// Deliberately institute-scoped and admin-only, same as weekly-report:
// this only ever emails an institute's own Super Admins/Principals about
// their own institute's numbers, never a parent/guardian. That's what
// makes it safe to send with no human review step, unlike the
// parent-facing fee-reminder queue (lib/automation/jobs/fee-reminders.js),
// which deliberately stops at "queued" for exactly that reason.
export async function getInstituteAdminEmails(admin, instituteId) {
  const { data } = await admin
    .from("users")
    .select("email, role:roles!inner(name)")
    .eq("institute_id", instituteId)
    .eq("status", "active")
    .in("role.name", ["Super Admin", "Principal"]);
  return (data || []).map((r) => r.email).filter(Boolean);
}

// Fails soft, same as sendEmail itself: no recipients, or no
// RESEND_API_KEY configured yet, are both reported back rather than
// thrown — a notification failing to send should never be the reason an
// automation job as a whole is marked "failed."
export async function notifyInstituteAdmins(admin, instituteId, { subject, html }) {
  const recipients = await getInstituteAdminEmails(admin, instituteId);
  if (recipients.length === 0) {
    return { skipped: true, reason: "No admin recipients found" };
  }
  return sendEmail({ to: recipients, subject, html });
}
