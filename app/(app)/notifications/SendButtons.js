"use client";

import { useState, useTransition } from "react";
import { sendFeeNotification } from "./actions";

export default function SendButtons({ studentId, feeRecordId, guardianPhone, guardianEmail }) {
  const [result, setResult] = useState(null); // { channel, delivered, reason }
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const handleSend = (channel) => {
    if (channel !== "email" && !guardianPhone) {
      setError("No guardian phone number on file for this student.");
      return;
    }
    if (channel === "email" && !guardianEmail) {
      setError("No guardian email on file for this student.");
      return;
    }
    setError("");
    setResult(null);
    const recipient = channel === "email" ? guardianEmail : guardianPhone;

    startTransition(async () => {
      const res = await sendFeeNotification(studentId, feeRecordId, channel, recipient);
      if (res?.error) { setError(res.error); return; }
      setResult({ channel, delivered: res.delivered, reason: res.reason });
    });
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => handleSend("whatsapp")} disabled={pending}
          className="text-xs px-3 py-1.5 rounded-lg bg-sage text-white disabled:opacity-60">
          Send WhatsApp
        </button>
        <button onClick={() => handleSend("sms")} disabled={pending}
          className="text-xs px-3 py-1.5 rounded-lg bg-royal text-white disabled:opacity-60">
          Send SMS
        </button>
        <button onClick={() => handleSend("email")} disabled={pending}
          className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 disabled:opacity-60">
          Send Email
        </button>
      </div>
      {error && <p className="text-xs text-brick mt-2">{error}</p>}
      {result?.delivered === true && <p className="text-xs text-sage mt-2">✓ Sent — confirmed by the provider.</p>}
      {result?.delivered === false && <p className="text-xs text-amber-600 mt-2">Not sent — {result.reason || "the provider rejected it"}.</p>}
    </div>
  );
}
