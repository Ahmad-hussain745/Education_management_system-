import { Resend } from "resend";

// Centralizes email sending so every caller (weekly reports today, other
// automated emails later) doesn't repeat the "is this even configured yet"
// check. Deliberately fails soft: if RESEND_API_KEY isn't set, callers get
// { skipped: true } back instead of a thrown error, so a scheduled cron
// job doesn't crash just because email hasn't been set up yet — it can
// still do everything else and report what it would have sent.
export async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    return { skipped: true, reason: "RESEND_API_KEY not set" };
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.REPORT_EMAIL_FROM || "MSA Academy <onboarding@resend.dev>";

  try {
    const { data, error } = await resend.emails.send({ from, to, subject, html });
    if (error) return { skipped: false, error: error.message };
    return { skipped: false, id: data?.id };
  } catch (err) {
    return { skipped: false, error: err.message };
  }
}
