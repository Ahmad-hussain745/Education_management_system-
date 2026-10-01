"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

// Phase 32 — this button is the actual point of deriving the balance at
// all rather than trusting a stored running total: a one-click re-check
// of every account's cached current_balance against a fresh sum of the
// immutable transactions ledger (verify_account_balances(),
// 0060_derived_account_balances.sql). Under the old incremental-UPDATE
// design there was no equivalent of this button to build — a drift, had
// one ever occurred, would have had nothing to compare itself against.
export default function VerifyBalancesButton() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const handleCheck = async () => {
    setChecking(true);
    setError("");
    setResult(null);
    const supabase = createClient();
    const { data, error: err } = await supabase.rpc("verify_account_balances");
    setChecking(false);
    if (err) {
      setError(err.message);
      return;
    }
    setResult(data || []);
  };

  const mismatches = (result || []).filter((r) => !r.matches);

  return (
    <div className="mt-4">
      <button
        onClick={handleCheck}
        disabled={checking}
        className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-600 disabled:opacity-60"
      >
        {checking ? "Checking…" : "Verify Balances"}
      </button>

      {error && <p className="mt-2 text-sm text-brick">{error}</p>}

      {result && (
        <div className="mt-3">
          {mismatches.length === 0 ? (
            <p className="text-sm text-sage bg-sage-tint border border-sage/30 rounded-lg px-3 py-2 inline-block">
              ✓ Every account's balance matches the ledger — nothing derived differently from what's stored.
            </p>
          ) : (
            <div className="space-y-2">
              {mismatches.map((m) => (
                <p key={m.account_id} className="text-sm text-brick bg-brick-tint border border-brick/30 rounded-lg px-3 py-2">
                  {m.account_name}: stored {fmt(m.stored_balance)}, ledger says {fmt(m.derived_balance)}.
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
