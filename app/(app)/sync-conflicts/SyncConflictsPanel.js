"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  listOpenConflicts,
  discardConflict,
  retryConflictWithAdjustment,
} from "@/lib/offline/sync/conflict-resolver";
import { runSync } from "@/lib/offline/sync/sync-engine";
import { getConnectivity } from "@/lib/offline/connectivity";

// Phase 31 — the UI half of a machinery that already existed
// (lib/offline/sync/conflict-resolver.js, since Phase 8/9) but had never
// actually been wired to a screen: sync_conflicts could accumulate
// forever and the only visible trace was OfflineStatus.js's "⚠️ N changes
// need review" pill, which linked nowhere. This is where it links now.
//
// High-risk entities land here specifically because they're NOT
// last-write-wins — see conflict-resolver.js's own header. Low-risk
// fields (guardian_name/guardian_phone/address, see
// lib/offline/repositories/students.js's queueContactUpdate) never
// produce a sync_conflicts row at all, by design, so they never appear
// on this page.

const ENTITY_LABEL = {
  payments: "Payment",
  students: "Student registration",
  inventory: "Inventory movement",
  inventory_purchase: "Inventory purchase",
  expenses: "Expense",
};

// Raw reasons are either a Postgres error message (INSUFFICIENT_STOCK: ...,
// PAYMENT_EXCEEDS_REMAINING: ..., MONTH_CLOSED, INVALID_NAME,
// NOT_AUTHORIZED) or handleFailure()'s own "Failed to sync after N
// attempts: ...". This turns the ones that matter into the plain-language
// headline a non-technical reviewer needs, without inventing certainty the
// raw message doesn't support — anything unrecognized falls through to its
// own raw text rather than a made-up-sounding generic label.
function conflictHeadline(conflict) {
  const r = conflict.reason || "";
  if (r.includes("PAYMENT_EXCEEDS_REMAINING")) return "Payment already exists on server.";
  if (r.includes("MONTH_CLOSED")) return "This month was closed before this could sync.";
  if (r.includes("INSUFFICIENT_STOCK")) return "Stock changed before this could sync.";
  if (r.includes("INVALID_NAME")) return "This registration is missing a valid name.";
  if (r.includes("NOT_AUTHORIZED")) return "This account is no longer authorized for this action.";
  if (r.startsWith("Failed to sync after")) return "This didn't sync after several attempts.";
  return "This entry needs a decision before it can sync.";
}

function fmtAmount(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

export default function SyncConflictsPanel() {
  const [conflicts, setConflicts] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [resolving, setResolving] = useState({});
  const [adjustedAmount, setAdjustedAmount] = useState({});
  const [banner, setBanner] = useState("");

  const load = async () => {
    const rows = await listOpenConflicts();
    // Newest first — the ones a person is most likely here to deal with.
    rows.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    setConflicts(rows);
  };

  useEffect(() => {
    load();
  }, []);

  const toggleView = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const handleDiscard = async (conflict) => {
    if (!confirm(`Discard this ${ENTITY_LABEL[conflict.entity] || conflict.entity}? This doesn't refund or undo anything that already happened offline — it just stops this entry from trying to sync.`)) return;
    setResolving((r) => ({ ...r, [conflict.id]: true }));
    try {
      await discardConflict(conflict.id);
      await load();
    } finally {
      setResolving((r) => ({ ...r, [conflict.id]: false }));
    }
  };

  const handleRetry = async (conflict) => {
    setResolving((r) => ({ ...r, [conflict.id]: true }));
    try {
      const adj = adjustedAmount[conflict.id];
      const adjustedPayload =
        conflict.entity === "payments" && adj ? { p_amount: Number(adj) } : {};
      await retryConflictWithAdjustment(conflict.id, adjustedPayload);
      // If we're online right now, push it immediately rather than making
      // the accountant wait for OfflineStatus.js's next poll — they're
      // already looking at a page that needed a connection to load.
      if (getConnectivity()) {
        await runSync(createClient());
      }
      await load();
      setBanner("Re-queued. It'll show as synced once the next sync pass confirms it.");
      setTimeout(() => setBanner(""), 5000);
    } finally {
      setResolving((r) => ({ ...r, [conflict.id]: false }));
    }
  };

  if (conflicts === null) {
    return <div className="max-w-3xl p-6 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-ink">Sync Conflicts</h1>
      <p className="text-sm text-slate-500 mt-1">
        Offline entries the server rejected or couldn't confirm — specific to this device.
        Low-risk edits (guardian name/phone/address) never appear here; they sync automatically.
      </p>

      {banner && (
        <p className="mt-4 text-sm text-sage bg-sage-tint border border-sage/30 rounded-lg px-3 py-2">{banner}</p>
      )}

      {conflicts.length === 0 ? (
        <div className="mt-6 bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          No open conflicts on this device. 🎉
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {conflicts.map((c) => {
            const isFinancial = c.entity === "payments" || c.entity === "expenses" || c.entity === "inventory_purchase";
            return (
              <div
                key={c.id}
                className={`bg-white border rounded-xl p-4 ${isFinancial ? "border-brick/40" : "border-amber-300"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className={`text-xs font-bold tracking-wide uppercase ${isFinancial ? "text-brick" : "text-amber-700"}`}>
                      ⚠ Conflict Detected
                    </div>
                    <p className="text-sm text-ink mt-1">{conflictHeadline(c)}</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {ENTITY_LABEL[c.entity] || c.entity} · {new Date(c.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => toggleView(c.id)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600"
                    >
                      {expanded[c.id] ? "Hide" : "View"}
                    </button>
                  </div>
                </div>

                {expanded[c.id] && (
                  <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600 space-y-1">
                    {c.entity === "payments" && (
                      <>
                        <div>Amount: {fmtAmount(c.payload?.p_amount)}</div>
                        <div>Month: {c.payload?.p_month}</div>
                        <div>Method: {c.payload?.p_method}</div>
                      </>
                    )}
                    {c.entity === "students" && <div>Name: {c.payload?.p_name}</div>}
                    {c.entity === "inventory" && (
                      <>
                        <div>Type: {c.payload?.p_movement_type}</div>
                        <div>Quantity: {c.payload?.p_quantity}</div>
                      </>
                    )}
                    <div className="text-slate-400">Raw reason: {c.reason}</div>
                  </div>
                )}

                <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
                  {c.entity === "payments" && (
                    <input
                      type="number"
                      min="0"
                      placeholder="Corrected amount (optional)"
                      value={adjustedAmount[c.id] || ""}
                      onChange={(e) => setAdjustedAmount((a) => ({ ...a, [c.id]: e.target.value }))}
                      className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs w-48"
                    />
                  )}
                  <button
                    onClick={() => handleRetry(c)}
                    disabled={resolving[c.id]}
                    className="text-xs px-3 py-1.5 rounded-lg bg-royal text-white disabled:opacity-60"
                  >
                    {resolving[c.id] ? "Working…" : "Resolve — Retry"}
                  </button>
                  <button
                    onClick={() => handleDiscard(c)}
                    disabled={resolving[c.id]}
                    className="text-xs px-3 py-1.5 rounded-lg border border-brick text-brick disabled:opacity-60"
                  >
                    Discard
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
