"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestFeeReversal } from "./actions";

// Every posted fee payment is still immutable — nothing here edits the
// original row. What changed in Phase 26 is that this button no longer
// reverses anything itself: it only files a request. The actual reversal
// (reverse_fee_payment(), unchanged since 0011) now only ever runs from
// inside decide_fee_reversal(), called by a DIFFERENT person from
// PendingFeeReversals.js below — direct execute on reverse_fee_payment()
// is revoked (0056), so there's no other path to it, including a raw RPC
// call from the browser console.
export default function RequestReversalButton({ paymentId, alreadyReversed, pendingStatus }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (alreadyReversed) {
    return <span className="text-xs text-slate-400 italic">Reversed</span>;
  }
  if (pendingStatus === "pending") {
    return <span className="text-xs text-amber-600 italic">Awaiting authorization</span>;
  }
  if (pendingStatus === "rejected") {
    return <span className="text-xs text-slate-400 italic">Reversal denied</span>;
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-brick hover:underline">
        Request Reversal
      </button>
    );
  }

  const handleConfirm = () => {
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setError("");
    startTransition(async () => {
      const res = await requestFeeReversal(paymentId, reason.trim());
      if (res?.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setReason("");
      router.refresh();
    });
  };

  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2 min-w-[240px]">
      <p className="text-xs text-slate-600">
        Files a request only — the reversal itself needs a different Super Admin or the Principal to
        authorize it below.
      </p>
      <input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for reversal (required)"
        className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
      />
      {error && <p className="text-xs text-brick">{error}</p>}
      <div className="flex gap-2">
        <button onClick={handleConfirm} disabled={pending} className="text-xs bg-brick text-white px-3 py-1.5 rounded-lg disabled:opacity-60">
          {pending ? "Requesting…" : "Request Reversal"}
        </button>
        <button onClick={() => { setOpen(false); setError(""); }} disabled={pending} className="text-xs text-slate-500 px-2">
          Cancel
        </button>
      </div>
    </div>
  );
}
