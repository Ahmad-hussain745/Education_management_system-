import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/server";

// Web Push needs no third-party account at all — VAPID keys are
// self-generated (`npx web-push generate-vapid-keys`) and the browser's
// own Push API + Google/Mozilla's push service handles delivery. The one
// real dependency is the recipient having subscribed from their browser
// first (push_subscriptions, this module's migration) — this send fails
// soft with a clear reason if they haven't.
export async function send(message) {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!publicKey || !privateKey) {
    return { delivered: false, provider: "web_push", error: "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set" };
  }
  if (!message.recipient_id) {
    return { delivered: false, provider: "web_push", error: "No recipient user to look up a push subscription for" };
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const admin = createAdminClient();
  const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", message.recipient_id);
  if (!subs || subs.length === 0) {
    return { delivered: false, provider: "web_push", error: "Recipient has no push subscription (never opted in from a browser)" };
  }

  const payload = JSON.stringify({ title: message.subject || "MSA Academy", body: message.body });
  let anyDelivered = false;
  let lastError = null;
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      anyDelivered = true;
    } catch (err) {
      lastError = err.message;
      // A 410/404 means the browser subscription is dead (uninstalled,
      // expired) — clean it up so future sends don't keep retrying it.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await admin.from("push_subscriptions").delete().eq("id", sub.id);
      }
    }
  }

  return anyDelivered
    ? { delivered: true, provider: "web_push" }
    : { delivered: false, provider: "web_push", error: lastError || "All push subscriptions failed" };
}
