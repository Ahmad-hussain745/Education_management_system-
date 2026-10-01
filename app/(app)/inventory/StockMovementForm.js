"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { inventoryService } from "@/lib/services/inventoryService";
import { subscribeConnectivity } from "@/lib/offline/connectivity";

// Shared by /inventory/stock-in and /inventory/stock-out — same fields
// either way, just a different movement_type. Now routed through
// inventoryService so it works offline: the movement is queued locally
// and replayed against record_stock_movement() when the connection
// returns, so the server still gets one row per real event rather than a
// recomputed total.
export default function StockMovementForm({ items, movementType, instituteId }) {
  const supabase = createClient();
  const router = useRouter();
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [movementDate, setMovementDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [online, setOnline] = useState(true);
  const [projected, setProjected] = useState(null);

  const isOut = movementType === "stock_out";
  const selectedItem = (items || []).find((i) => i.id === itemId);

  useEffect(() => subscribeConnectivity(setOnline), []);

  // Live projection: server's known stock for this item, plus anything
  // queued on this device that hasn't synced. Display only — this number
  // is never sent anywhere; the queued movements are (see
  // lib/offline/repositories/inventory.js).
  useEffect(() => {
    if (!itemId || !instituteId || selectedItem?.stock == null) { setProjected(null); return; }
    let cancelled = false;
    inventoryService
      .projectStock({ instituteId, itemId, serverStock: selectedItem.stock })
      .then((v) => { if (!cancelled) setProjected(v); })
      .catch(() => { if (!cancelled) setProjected(null); });
    return () => { cancelled = true; };
  }, [itemId, instituteId, selectedItem?.stock, message]);

  const pendingDelta = projected != null && selectedItem?.stock != null ? projected - Number(selectedItem.stock) : 0;
  const afterThis =
    projected != null && quantity
      ? isOut ? projected - Number(quantity) : projected + Number(quantity)
      : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setPending(true);
    try {
      const res = await inventoryService.recordMovement(supabase, {
        instituteId, itemId, movementType, quantity, reason, movementDate,
      });
      if (res.mode === "offline") {
        setMessage(
          `🟠 Saved on this device — ${isOut ? "−" : "+"}${quantity} ${selectedItem?.unit || ""}. It syncs as a movement (not a total), so the server keeps the full history.`
        );
      } else {
        setMessage(`Recorded ${isOut ? "−" : "+"}${quantity} ${selectedItem?.unit || ""} for ${selectedItem?.name || "item"}.`);
        router.refresh();
      }
      setQuantity("");
      setReason("");
    } catch (err) {
      setError((err.message || String(err)).replace(/^[A-Z_]+:\s*/, ""));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 space-y-3">
      {!online && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-sm">
          🟠 Offline — movements are saved here and synced individually when you reconnect.
          {isOut && " A Stock Out is still checked against real stock at that point, so it can be rejected if someone else took the same units first."}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Item</label>
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">— Select —</option>
            {(items || []).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Quantity</label>
          <input type="number" min="0.01" step="0.01" required value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
          <input type="date" value={movementDate} onChange={(e) => setMovementDate(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Reason</label>
          <input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder={isOut ? "Issued to office, Damaged…" : "Donation, Count correction…"} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {selectedItem?.stock != null && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-600">
          <span className="font-medium text-ink">{selectedItem.name}</span>
          {" · "}On server: <span className="font-mono">{Number(selectedItem.stock)}</span> {selectedItem.unit}
          {pendingDelta !== 0 && (
            <> {" · "}Queued here: <span className="font-mono">{pendingDelta > 0 ? "+" : ""}{pendingDelta}</span>{" "}
              → <span className="font-mono font-medium text-ink">{projected}</span></>
          )}
          {afterThis != null && (
            <> {" · "}After this entry: <span className={`font-mono font-medium ${afterThis < 0 ? "text-brick" : "text-ink"}`}>{afterThis}</span></>
          )}
          {afterThis != null && afterThis < 0 && (
            <div className="text-brick text-xs mt-1">This would take the item below zero — the server will reject it.</div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-brick">{error}</p>}
      {message && <p className="text-sm text-sage">{message}</p>}

      <button
        type="submit"
        disabled={pending}
        className={`text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60 ${isOut ? "bg-brick hover:bg-red-700" : "bg-sage hover:bg-green-700"}`}
      >
        {pending ? "Saving…" : online ? (isOut ? "Record Stock Out" : "Record Stock In") : "Save Offline"}
      </button>
    </form>
  );
}
