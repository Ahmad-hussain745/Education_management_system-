// Meta's WhatsApp Cloud API — plain REST (Bearer token + JSON POST), no
// SDK. Same fail-soft shape as the other providers.
//
// IMPORTANT, documented plainly rather than silently assumed: the Cloud
// API can only send a free-form text message (what this sends) within a
// 24-hour customer-service window after the recipient last messaged the
// school's WhatsApp number. Outside that window, Meta requires a
// pre-approved message TEMPLATE (a different API call, with the
// template's own approved name/variables) or the send is rejected. This
// adapter sends free-form text; a template-based send for "first contact"
// campaigns is a real, separate feature this module doesn't build yet —
// noted here rather than pretending this always works.
export async function send(message) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    return { delivered: false, provider: "whatsapp_cloud", error: "WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID not set" };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: message.to_address.replace(/\D/g, ""), // Cloud API wants digits only, with country code
        type: "text",
        text: { body: message.body },
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { delivered: false, provider: "whatsapp_cloud", error: data?.error?.message || `WhatsApp API error ${res.status}` };
    }
    return { delivered: true, provider: "whatsapp_cloud", providerMessageId: data.messages?.[0]?.id };
  } catch (err) {
    return { delivered: false, provider: "whatsapp_cloud", error: err.message };
  }
}
