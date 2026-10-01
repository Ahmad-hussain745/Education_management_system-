"use client";

import { useEffect, useState } from "react";
import { expenseService } from "@/lib/services/expenseService";

// The server-rendered table below this only shows expenses that actually
// reached Postgres. Without this, an expense recorded offline vanishes
// from the cashier's view until it syncs — the exact "did that save?"
// uncertainty the offline work is supposed to eliminate.
function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

export default function PendingExpenses({ instituteId }) {
  const [pending, setPending] = useState([]);

  useEffect(() => {
    if (!instituteId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await expenseService.getRecent({ instituteId, limit: 50 });
        if (!cancelled) setPending((rows || []).filter((r) => !r.synced));
      } catch {
        // IndexedDB unavailable (private browsing, storage disabled) —
        // nothing to show, and it isn't worth an error banner here since
        // the synced table below still renders normally.
      }
    };
    load();
    const poll = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(poll); };
  }, [instituteId]);

  if (pending.length === 0) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
      <div className="text-sm font-medium text-amber-900 mb-2">
        🟠 {pending.length} expense{pending.length === 1 ? "" : "s"} saved on this device, not yet synced
      </div>
      <p className="text-xs text-amber-800 mb-3">
        These post to the Cash/Bank ledger and the audit log when they sync — they aren&apos;t in the
        figures below or on the Dashboard yet.
      </p>
      <ul className="space-y-1.5">
        {pending.map((r) => (
          <li key={r.local_id} className="text-sm text-amber-900 flex justify-between gap-3">
            <span>{r.category}{r.description ? ` — ${r.description}` : ""}</span>
            <span className="font-mono whitespace-nowrap">{fmt(r.amount)} · {r.expense_date}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
