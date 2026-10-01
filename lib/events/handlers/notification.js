import { sendEmail } from "@/lib/email";

// Genuinely new capability, not something that existed before this event
// system — previously a receipt only existed as what's shown/printed on
// screen right after payment (Receipt.js), nothing was ever emailed
// automatically. Skips silently (not an error) when there's no guardian
// email on file or RESEND_API_KEY isn't configured — same "fails soft"
// convention as every other use of lib/email.js in this codebase.
export async function onPaymentCreated({ admin, institute, event }) {
  const p = event.payload;

  const { data: student, error: studentError } = await admin
    .from("students")
    .select("name, guardian_name, guardian_email")
    .eq("id", p.student_id)
    .maybeSingle();
  if (studentError) throw new Error(`notification: ${studentError.message}`);
  if (!student?.guardian_email) return; // nothing to send to — not an error

  const amount = "Rs. " + Number(p.amount).toLocaleString("en-US");
  const html = `
    <p>Dear ${student.guardian_name || "Guardian"},</p>
    <p>We've received a payment of <strong>${amount}</strong> for ${student.name}.</p>
    <ul>
      <li>Receipt: ${p.receipt_no || "—"}</li>
      <li>Method: ${p.method}</li>
      <li>Date: ${p.paid_on}</li>
      ${p.is_advance ? "<li>This includes an advance amount, which will reduce next month's bill.</li>" : ""}
    </ul>
    <p>— ${institute.name}</p>
  `;

  const result = await sendEmail({ to: student.guardian_email, subject: `Payment Received — ${student.name}`, html });
  if (result.error) throw new Error(`notification: ${result.error}`);
}
