// Twilio's Messages API is plain REST (Basic Auth + form-encoded POST) —
// no SDK needed, which keeps this a zero-new-dependency integration. Same
// fail-soft shape as lib/email.js: missing credentials is a normal,
// expected state (not every school has Twilio set up on day one), not a
// crash — a queued message just stays queued/failed with a clear reason
// instead of the whole processor run blowing up.
export async function send(message) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    return { delivered: false, provider: "twilio", error: "TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER not set" };
  }

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: message.to_address, From: from, Body: message.body }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { delivered: false, provider: "twilio", error: data?.message || `Twilio error ${res.status}` };
    }
    // Twilio's initial response is "queued"/"accepted", not final delivery
    // — real delivery confirmation arrives later via their status-callback
    // webhook, which this app doesn't have a public endpoint wired up to
    // receive yet (see the module's README note). Treated as delivered
    // here in the sense that matters for a school office: the provider
    // accepted it and will attempt real delivery, same trust level Resend
    // already gets for email above.
    return { delivered: true, provider: "twilio", providerMessageId: data.sid };
  } catch (err) {
    return { delivered: false, provider: "twilio", error: err.message };
  }
}
