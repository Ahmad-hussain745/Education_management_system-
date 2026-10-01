import { sendEmail } from "@/lib/email";

// Thin wrapper so the queue processor (processor.js) can treat every
// channel identically — call send(message), get back {delivered, provider,
// providerMessageId, error} — without needing to know that email already
// had its own working implementation (lib/email.js, since before this
// module existed) while the others are new.
export async function send(message) {
  const res = await sendEmail({ to: message.to_address, subject: message.subject || "", html: message.body });
  if (res.skipped) {
    return { delivered: false, provider: "resend", error: res.reason || res.error || "Email not sent" };
  }
  if (res.error) {
    return { delivered: false, provider: "resend", error: res.error };
  }
  return { delivered: true, provider: "resend", providerMessageId: res.id };
}
