"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { decideExpenseRequest } from "./actions";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

// canApprove is can_approve() (Super Admin/Principal) — but the actual
// separation-of-duties check (can't approve your own request) is enforced
// in decide_expense_request() itself, not here. This component doesn't
// even know who requested a given row well enough to pre-hide the buttons
// reliably — the RPC's rejection is the real, trustworthy answer, so a
// same-person attempt just gets a clear error back instead.
export default function PendingExpenseApprovals({ requests, canApprove }) {
  if (!requests || requests.length === 0) return null;

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-ink mb-2">Pending Approval — Large Expenses</h2>
      <div className="space-y-2">
        {requests.map((r) => (
          <RequestRow key={r.id} request={r} canApprove={canApprove} />
        ))}
      </div>
    </div>
  );
}

function RequestRow({ request, canApprove }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const decide = async (approve) => {
    if (!approve && !note.trim()) {
      setError("A reason is required to reject.");
      return;
    }
    setPending(true);
    setError("");
    const res = await decideExpenseRequest(request.id, approve, note.trim() || null);
    setPending(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    router.refresh();
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm">
          <span className="font-medium text-ink">{request.category}</span>
          <span className="text-slate-500"> — {request.description || "no description"}</span>
          <span className="font-mono font-medium ml-2">{fmt(request.amount)}</span>
          <span className="text-xs text-slate-400 ml-2">
            requested by {request.requester?.name || "—"} · {new Date(request.created_at).toLocaleDateString()}
          </span>
        </div>
        {canApprove && !open && (
          <button onClick={() => setOpen(true)} className="text-xs px-3 py-1.5 rounded-lg bg-royal text-white">
            Review
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (required to reject, optional to approve)"
            className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
          />
          {error && <p className="text-xs text-brick">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => decide(true)} disabled={pending} className="text-xs bg-sage text-white px-3 py-1.5 rounded-lg disabled:opacity-60">
              {pending ? "…" : "Approve — post to ledger"}
            </button>
            <button onClick={() => decide(false)} disabled={pending} className="text-xs bg-brick text-white px-3 py-1.5 rounded-lg disabled:opacity-60">
              {pending ? "…" : "Reject"}
            </button>
            <button onClick={() => { setOpen(false); setError(""); }} disabled={pending} className="text-xs text-slate-500 px-2">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
