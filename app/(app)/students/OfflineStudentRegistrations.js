"use client";

import { useEffect, useState, useCallback } from "react";
import { db } from "@/lib/offline/db";
import { subscribeConnectivity } from "@/lib/offline/connectivity";

const STATUS_LABEL = {
  pending_sync: { text: "Pending Sync", dot: "bg-amber-500", pill: "bg-amber-50 text-amber-700" },
  synced: { text: "Confirmed", dot: "bg-sage", pill: "bg-emerald-50 text-emerald-700" },
  conflict: { text: "Needs Review", dot: "bg-red-500", pill: "bg-red-50 text-red-700" },
  voided: { text: "Voided", dot: "bg-slate-400", pill: "bg-slate-100 text-slate-500" },
};

// Same pattern as OfflineFeeReceipts.js (fees/payments) — reads
// local_students directly and polls, since that's exactly when
// sync-engine.js is most likely to have just turned a local reference into
// a real, officially-numbered student.
export default function OfflineStudentRegistrations({ instituteId }) {
  const [rows, setRows] = useState([]);

  const refresh = useCallback(async () => {
    if (!instituteId) return;
    const all = await db.local_students.where({ institute_id: instituteId }).sortBy("created_at");
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

  if (rows.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold text-ink mb-2">Offline Registrations (this device)</h2>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Local Reference</th>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Registered</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Official Student ID</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = STATUS_LABEL[r.sync_status] || STATUS_LABEL.pending_sync;
              return (
                <tr key={r.local_id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-mono text-xs text-ink">{r.local_ref}</td>
                  <td className="px-4 py-3 text-slate-700">{r.name}</td>
                  <td className="px-4 py-3 text-slate-600">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${s.pill}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                      {s.text}
                    </span>
                    {r.sync_status === "conflict" && r.conflict_reason && (
                      <p className="text-xs text-red-600 mt-1 max-w-xs">{r.conflict_reason.replace(/^[A-Z_]+:\s*/, "")}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.official_student_code || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.some((r) => r.sync_status === "conflict") && (
        <p className="text-xs text-red-600 mt-2">
          One or more offline registrations need review — resolve them from the sync conflicts screen.
        </p>
      )}
    </div>
  );
}
