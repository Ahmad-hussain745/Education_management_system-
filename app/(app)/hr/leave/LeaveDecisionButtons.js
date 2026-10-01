"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { decideLeave } from "../actions";

export default function LeaveDecisionButtons({ id }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function decide(status) {
    setPending(true);
    setError(null);
    try {
      const res = await decideLeave(id, status, null);
      if (res.error) setError(res.error);
      else router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-2">
      <div className="flex gap-2">
        <button onClick={() => decide("approved")} disabled={pending} className="text-xs bg-sage text-white px-3 py-1.5 rounded-lg disabled:opacity-60">Approve</button>
        <button onClick={() => decide("rejected")} disabled={pending} className="text-xs border border-slate-300 px-3 py-1.5 rounded-lg disabled:opacity-60">Reject</button>
      </div>
      {error && <div className="text-xs text-red-700 mt-1">{error}</div>}
    </div>
  );
}
