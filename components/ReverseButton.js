"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useOnline } from "@/lib/offline/useOnline";
import { ONLINE_REQUIRED_MESSAGE } from "@/lib/offline/online-required";
import OnlineRequiredGate from "@/components/OnlineRequiredGate";

// Every posted financial row is immutable — this is the ONLY correction
// path, for all four ledger source tables. It never edits the original row
// (amount/method/date stay exactly as posted); it calls a SECURITY DEFINER
// Postgres function that marks the row reversed and posts a brand-new,
// opposite-direction transaction. See supabase/migrations/0011_immutable_ledger.sql.
const RPC_BY_TABLE = {
  fee_payments: "reverse_fee_payment",
  income: "reverse_income",
  expenses: "reverse_expense",
  salary_payments: "reverse_salary_payment",
};

export default function ReverseButton({ table, id, alreadyReversed }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const supabase = createClient();
  const online = useOnline();

  if (alreadyReversed) {
    return <span className="text-xs text-slate-400 italic">Reversed</span>;
  }

  if (!open) {
    return (
      <OnlineRequiredGate>
        <button onClick={() => setOpen(true)} className="text-xs text-brick hover:underline">
          Reverse
        </button>
      </OnlineRequiredGate>
    );
  }

  const handleConfirm = () => {
    // A "final financial correction" is exactly the kind of thing that
    // must NOT get silently queued for whenever the connection returns —
    // see lib/offline/online-required.js. Belt-and-braces: the trigger
    // above is already gated by OnlineRequiredGate, but connectivity can
    // flip in the seconds between opening this panel and confirming it.
    if (!online) {
      setError(ONLINE_REQUIRED_MESSAGE);
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setError("");
    startTransition(async () => {
      const { error } = await supabase.rpc(RPC_BY_TABLE[table], { p_id: id, p_reason: reason.trim() });
      if (error) {
        setError(error.message);
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
        This posts an opposite transaction to correct the ledger — the original record is never edited.
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
          {pending ? "Reversing…" : "Confirm Reversal"}
        </button>
        <button onClick={() => { setOpen(false); setError(""); }} disabled={pending} className="text-xs text-slate-500 px-2">
          Cancel
        </button>
      </div>
    </div>
  );
}
