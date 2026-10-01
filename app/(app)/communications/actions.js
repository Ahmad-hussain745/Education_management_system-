"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { processQueue } from "@/lib/communications/processor";

export async function createTemplate(formData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("users").select("id").eq("auth_user_id", user?.id).maybeSingle();

  const name = formData.get("name")?.toString().trim();
  const channel = formData.get("channel")?.toString();
  const body = formData.get("body")?.toString().trim();
  if (!name || !channel || !body) return { error: "Name, channel, and message body are all required." };

  const { error } = await supabase.from("communication_templates").insert({
    name, channel, body, subject: formData.get("subject")?.toString() || null, created_by: me?.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/communications");
  return { success: true };
}

export async function createCampaign(formData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("users").select("id").eq("auth_user_id", user?.id).maybeSingle();

  const name = formData.get("name")?.toString().trim();
  const channel = formData.get("channel")?.toString();
  const templateId = formData.get("template_id")?.toString() || null;
  const recipientType = formData.get("recipient_type")?.toString();
  if (!name || !channel || !recipientType) return { error: "Name, channel, and audience are all required." };

  const audience = { recipient_type: recipientType };
  if (formData.get("class_id")) audience.class_id = formData.get("class_id").toString();
  if (formData.get("section_id")) audience.section_id = formData.get("section_id").toString();

  const { error } = await supabase.from("communication_campaigns").insert({
    name, channel, template_id: templateId, audience, created_by: me?.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/communications");
  return { success: true };
}

// Queues the audience, then immediately drains the queue once (best
// effort — the communications automation job is the guaranteed backstop
// within the hour either way, same "instant when possible, same-day
// guaranteed" shape as the rest of this app's near-real-time paths).
export async function sendCampaignNow(campaignId) {
  const supabase = await createClient();
  const { data: queuedCount, error } = await supabase.rpc("queue_campaign_messages", { p_campaign_id: campaignId });
  if (error) {
    if (error.message?.includes("NOT_AUTHORIZED")) return { error: "You're not authorized to send this campaign." };
    if (error.message?.includes("ALREADY_QUEUED")) return { error: "This campaign has already been sent." };
    return { error: error.message };
  }

  const { data: campaign } = await supabase.from("communication_campaigns").select("institute_id").eq("id", campaignId).maybeSingle();
  const admin = createAdminClient();
  const result = await processQueue(admin, campaign.institute_id, { limit: 500 });
  await supabase.from("communication_campaigns").update({ status: result.failed === 0 ? "completed" : "failed" }).eq("id", campaignId);

  revalidatePath("/communications");
  return { success: true, queuedCount, ...result };
}

// One-off send — the direct replacement for the old wa.me/sms:/mailto:
// SendButtons flow. Queues AND immediately attempts delivery, so the
// person clicking "Send" gets a real answer (delivered/failed), not just
// a browser tab that may or may not have actually sent anything.
export async function sendOneOffMessage({ channel, recipientType, recipientId, toAddress, subject, body }) {
  const supabase = await createClient();
  const { data: messageId, error } = await supabase.rpc("queue_one_off_message", {
    p_channel: channel, p_recipient_type: recipientType, p_recipient_id: recipientId || null,
    p_to_address: toAddress, p_subject: subject || null, p_body: body,
  });
  if (error) {
    if (error.message?.includes("NO_ADDRESS")) return { error: "No phone/email on file for this recipient." };
    if (error.message?.includes("NOT_AUTHORIZED")) return { error: "You're not authorized to send a message." };
    return { error: error.message };
  }

  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("users").select("institute_id").eq("auth_user_id", user?.id).maybeSingle();
  const admin = createAdminClient();
  const result = await processQueue(admin, me.institute_id, { limit: 1 });

  revalidatePath("/communications");
  return { success: true, messageId, delivered: result.delivered > 0 };
}

export async function savePushSubscription(subscription) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("users").select("id").eq("auth_user_id", user?.id).maybeSingle();
  if (!me) return { error: "Not signed in." };

  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id: me.id, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
    { onConflict: "user_id,endpoint" }
  );
  if (error) return { error: error.message };
  return { success: true };
}

export async function processQueueNow() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("users").select("institute_id, role:roles(name)").eq("auth_user_id", user?.id).maybeSingle();
  if (!["Super Admin", "Accountant", "Principal"].includes(me?.role?.name)) return { error: "Not authorized." };

  const admin = createAdminClient();
  const result = await processQueue(admin, me.institute_id, { limit: 200 });
  revalidatePath("/communications");
  return { success: true, ...result };
}
