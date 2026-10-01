"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { processQueueNow } from "./actions";

export default function ProcessQueueButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState("");

  const handleClick = async () => {
    setPending(true);
    setMsg("");
    const res = await processQueueNow();
    setPending(false);
    if (res?.error) { setMsg(res.error); return; }
    setMsg(`Processed ${res.processed} — ${res.delivered} delivered, ${res.failed} failed.`);
    router.refresh();
  };

  return (
    <div className="text-right">
      <button onClick={handleClick} disabled={pending} className="text-sm px-3 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
        {pending ? "Processing…" : "Process Queue Now"}
      </button>
      {msg && <p className="text-xs text-slate-500 mt-1">{msg}</p>}
    </div>
  );
}
