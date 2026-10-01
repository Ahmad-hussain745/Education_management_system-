"use client";

import { useState } from "react";
import { closeMonth } from "./actions";
import { useOnline } from "@/lib/offline/useOnline";
import { ONLINE_REQUIRED_MESSAGE } from "@/lib/offline/online-required";
import OnlineRequiredGate from "@/components/OnlineRequiredGate";

export default function CloseMonthForm({ defaultMonth, alreadyClosedMonths }) {
  const [month, setMonth] = useState(defaultMonth.slice(0, 7));
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const online = useOnline();

  const monthValue = month + "-01";
  const isAlreadyClosed = alreadyClosedMonths.includes(monthValue);

  const handleConfirm = async () => {
    // Freezing a month's totals permanently is not something to let queue
    // offline and fire later without anyone watching — see
    // lib/offline/online-required.js.
    if (!online) {
      setError(ONLINE_REQUIRED_MESSAGE);
      return;
    }
    setPending(true);
    setError("");
    const formData = new FormData();
    formData.set("month", monthValue);
    formData.set("notes", notes);
    const res = await closeMonth(formData);
    setPending(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    setConfirming(false);
    setNotes("");
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Month to Close</label>
          <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setConfirming(false); }} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-600 mb-1">Notes (optional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. reviewed and reconciled" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        {isAlreadyClosed ? (
          <span className="text-sm text-slate-400 px-4 py-2">Already closed</span>
        ) : !confirming ? (
          <OnlineRequiredGate>
            <button onClick={() => setConfirming(true)} className="text-sm px-4 py-2 rounded-lg bg-royal text-white">
              Close This Month
            </button>
          </OnlineRequiredGate>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => setConfirming(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-600">Cancel</button>
            <button onClick={handleConfirm} disabled={pending} className="text-sm px-4 py-2 rounded-lg bg-brick text-white disabled:opacity-60">
              {pending ? "Closing…" : "Confirm — this is permanent"}
            </button>
          </div>
        )}
      </div>
      {confirming && !isAlreadyClosed && (
        <p className="text-xs text-brick mt-2">
          This freezes {month}'s income/expense/salary totals permanently. It doesn't lock any individual record — you can still record a
          reversal later — but this specific snapshot won't be regenerated once saved.
        </p>
      )}
      {error && <p className="text-sm text-brick mt-2">{error}</p>}
    </div>
  );
}
