"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getSyncStatus } from "@/lib/offline/sync/sync-status";
import { runSync } from "@/lib/offline/sync/sync-engine";
import { subscribeConnectivity } from "@/lib/offline/connectivity";

// Deliberately per-DEVICE, not per-institute in the way the jobs table
// above is — this reads THIS browser's own IndexedDB outbox (see
// lib/offline/db.js), so a Cashier's laptop and a different Cashier's
// phone each show their own numbers here, not a shared institute-wide
// total. That's not a limitation to fix; the outbox itself is inherently
// per-device (see OfflineStatus.js for the same distinction in the header
// pill this page's numbers are a fuller view of).
export default function SyncHealthPanel({ instituteId }) {
  const [status, setStatus] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState(null);

  const refresh = useCallback(async () => {
    const s = await getSyncStatus(instituteId);
    setStatus(s);
  }, [instituteId]);

  useEffect(() => {
    refresh();
    const unsubscribe = subscribeConnectivity(() => refresh());
    const poll = setInterval(refresh, 10000);
    return () => {
      unsubscribe();
      clearInterval(poll);
    };
  }, [refresh]);

  const handleRetryFailed = async () => {
    setRetrying(true);
    setRetryMessage(null);
    const supabase = createClient();
    const result = await runSync(supabase);
    setRetrying(false);
    if (result.status === "offline") {
      setRetryMessage("Still offline — nothing can sync until this device reconnects.");
    } else if (result.status === "already_running") {
      setRetryMessage("A sync is already in progress.");
    } else {
      const synced = (result.results || []).filter((r) => r.status === "synced").length;
      const stillFailing = (result.results || []).filter((r) => r.status === "retry_later").length;
      const conflicts = (result.results || []).filter((r) => r.status === "conflict").length;
      setRetryMessage(
        `${synced} synced` + (stillFailing ? `, ${stillFailing} still failing` : "") + (conflicts ? `, ${conflicts} need review` : "") + "."
      );
    }
    await refresh();
  };

  if (!status) {
    return <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-400">Loading…</div>;
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Stat label="Connection" value={status.online ? "🟢 Online" : "🟠 Offline"} />
        <Stat label="Last Sync" value={status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Never"} />
        <Stat label="Pending Sync" value={status.pendingCount} highlight={status.pendingCount > 0} />
        <Stat label="Failed Jobs" value={status.failedCount} highlight={status.failedCount > 0} bad={status.failedCount > 0} />
      </div>

      {status.conflictCount > 0 && (
        <p className="text-xs text-brick mt-3">
          ⚠️ {status.conflictCount} change{status.conflictCount === 1 ? "" : "s"} need review — a business rule rejected them at sync
          (e.g. a bill that was already paid by someone else). See the conflicts list to resolve them; retrying won't fix these on its own.
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={handleRetryFailed}
          disabled={retrying || !status.online || (status.pendingCount === 0 && status.failedCount === 0)}
          className="text-xs px-3 py-1.5 rounded-lg bg-royal hover:bg-royal-dark text-white disabled:opacity-50"
        >
          {retrying ? "Syncing…" : "Retry Failed"}
        </button>
        {retryMessage && <span className="text-xs text-slate-500">{retryMessage}</span>}
      </div>
    </div>
  );
}

function Stat({ label, value, highlight, bad }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-lg font-semibold mt-0.5 ${highlight ? (bad ? "text-brick" : "text-amber-600") : "text-ink"}`}>{value}</div>
    </div>
  );
}
