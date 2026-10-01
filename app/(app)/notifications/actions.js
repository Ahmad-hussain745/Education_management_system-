"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import * as smsProvider from "@/lib/communications/providers/sms";
import * as whatsappProvider from "@/lib/communications/providers/whatsapp";

// One call does both the "render + freeze the message" step and marks the
// row 'ready' — never 'sent' outright anymore (see
// 0047_notification_status_lifecycle.sql). type='manual' so a WhatsApp
// send followed by an SMS send for the same bill are two distinct rows,
// not one overwritten (see the partial unique index in
// 0027_notifications.sql).
// Manual sends always render using the fee_reminder_1 template's wording —
// there's no "which stage is this" concept on an ad hoc send triggered
// straight from a fee card, so one consistent, reasonable default message
// is used rather than asking a cashier to pick a template mid-click. The
// scheduled reminder_1/reminder_2/overdue types (see
// run_fee_reminder_schedule_for_institute()) are what actually vary the
// wording by stage.
//
// All three channels now go through a real provider and can genuinely
// earn 'sent'/'failed' — Email via Resend (lib/email.js), WhatsApp via
// Meta's Cloud API, SMS via Twilio (both lib/communications/providers/,
// built for the Communication Center). None of them are a wa.me:/sms:
// browser handoff anymore; if a provider isn't configured (missing env
// vars), that's reported back as a real failure reason, not silently left
// at 'ready' pretending a click accomplished something.
export async function sendFeeNotification(studentId, feeRecordId, channel, recipient) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("queue_fee_notification", {
    p_student_id: studentId,
    p_fee_record_id: feeRecordId,
    p_type: "manual",
    p_template_key: "fee_reminder_1",
    p_channel: channel,
    p_recipient: recipient,
  });
  if (error) return { error: error.message };

  const { data: notification } = await supabase
    .from("notifications").select("rendered_message").eq("id", data).maybeSingle();
  const message = notification?.rendered_message || "";
  // mark_notification_delivery_status() is service_role-only (0047) — the
  // admin client here is the trusted-server-context boundary that
  // restriction expects, not a bypass of it: this whole function only
  // reaches this point after queue_fee_notification's own role check
  // above already authorized the request.
  const admin = createAdminClient();

  if (channel === "email") {
    const result = await sendEmail({ to: recipient, subject: "Fee Reminder", html: `<p>${message.replace(/\n/g, "<br/>")}</p>` });
    if (result.skipped) {
      revalidatePath("/notifications");
      return { success: true, message, delivered: false, reason: result.reason };
    }
    if (result.error) {
      await admin.rpc("mark_notification_delivery_status", { p_notification_id: data, p_status: "failed", p_detail: result.error });
      revalidatePath("/notifications");
      return { error: `Email could not be sent: ${result.error}` };
    }
    await admin.rpc("mark_notification_delivery_status", { p_notification_id: data, p_status: "sent", p_detail: "Accepted by Resend" });
    revalidatePath("/notifications");
    return { success: true, message, delivered: true };
  }

  const provider = channel === "whatsapp" ? whatsappProvider : smsProvider;
  const result = await provider.send({ to_address: recipient, body: message });
  if (!result.delivered) {
    // Not configured / provider rejected it — a real, reportable failure
    // now, not a silent "stays ready forever".
    await admin.rpc("mark_notification_delivery_status", { p_notification_id: data, p_status: "failed", p_detail: result.error });
    revalidatePath("/notifications");
    return { success: true, message, delivered: false, reason: result.error };
  }
  await admin.rpc("mark_notification_delivery_status", { p_notification_id: data, p_status: "sent", p_detail: `Accepted by ${result.provider}` });
  revalidatePath("/notifications");
  return { success: true, message, delivered: true };
}
