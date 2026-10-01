"use client";

import { useEffect, useState, useCallback } from "react";
import { db } from "@/lib/offline/db";
import { subscribeConnectivity } from "@/lib/offline/connectivity";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

const STATUS_LABEL = {
  pending_sync: { text: "Pending Sync", dot: "bg-amber-500", pill: "bg-amber-50 text-amber-700" },
  synced: { text: "Confirmed", dot: "bg-sage", pill: "bg-emerald-50 text-emerald-700" },
  conflict: { text: "Needs Review", dot: "bg-red-500", pill: "bg-red-50 text-red-700" },
  voided: { text: "Voided", dot: "bg-slate-400", pill: "bg-slate-100 text-slate-500" },
};

// Reads provisional_payments directly (not through paymentRepository — this
// is a display list, not a write path) and re-reads on a short poll plus
// whenever connectivity flips, since that's exactly when sync-engine.js
// (driven by OfflineStatus.js elsewhere on the page) is most likely to have
// just moved something from pending_sync to synced or conflict.
export default function OfflineFeeReceipts({ instituteId }) {
  const [rows, setRows] = useState([]);

  const refresh = useCallback(async () => {
    if (!instituteId) return;
    const all = await db.provisional_payments.where({ institute_id: instituteId }).sortBy("created_at");
    setRows(all.reverse());
  }, [instituteId]);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 5000);
    const unsubscribe = subscribeConnectivity(() => refresh());
    return () => {
      clearInterval(poll);
      unsubscribe();
    };
  }, [refresh]);

  // Nothing collected offline on this device yet — stay out of the way
  // rather than showing an empty table under Recent Payments.
  if (rows.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold text-ink mb-2">Offline Receipts (this device)</h2>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Local Receipt</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3">Method</th>
              <th className="text-left px-4 py-3">Collected</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Server Receipt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = STATUS_LABEL[r.status] || STATUS_LABEL.pending_sync;
              return (
                <tr key={r.local_id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-mono text-xs text-ink">{r.local_receipt_no}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(r.amount)}</td>
                  <td className="px-4 py-3 text-slate-600">{r.method}</td>
                  <td className="px-4 py-3 text-slate-600">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${s.pill}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                      {s.text}
                    </span>
                    {r.status === "conflict" && r.conflict_reason && (
                      <p className="text-xs text-red-600 mt-1 max-w-xs">{r.conflict_reason.replace(/^[A-Z_]+:\s*/, "")}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.receipt_no || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.some((r) => r.status === "conflict") && (
        <p className="text-xs text-red-600 mt-2">
          One or more offline receipts need review — an accountant can resolve these from the sync
          conflicts screen.
        </p>
      )}
    </div>
  );
}
