"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendCampaignNow } from "./actions";

const STATUS_BADGE = {
  draft: "bg-slate-100 text-slate-600",
  queued: "bg-gold-tint text-gold",
  sending: "bg-gold-tint text-gold",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-brick-tint text-brick",
};

export default function CampaignRow({ campaign }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const handleSend = async () => {
    if (!window.confirm(`Send "${campaign.name}" now? This queues and immediately attempts delivery to the whole audience.`)) return;
    setPending(true);
    setError("");
    const res = await sendCampaignNow(campaign.id);
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    router.refresh();
  };

  return (
    <div className="px-4 py-2.5 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium text-ink">{campaign.name}</span>
          <span className="text-xs text-slate-400 ml-2">{campaign.channel} · {campaign.audience?.recipient_type}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[campaign.status] || ""}`}>{campaign.status}</span>
          {campaign.status === "draft" && (
            <button onClick={handleSend} disabled={pending} className="text-xs px-2.5 py-1 rounded-lg bg-royal text-white disabled:opacity-60">
              {pending ? "Sending…" : "Send"}
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-xs text-brick mt-1">{error}</p>}
    </div>
  );
}
