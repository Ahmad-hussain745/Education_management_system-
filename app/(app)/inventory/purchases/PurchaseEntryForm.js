"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { inventoryService } from "@/lib/services/inventoryService";
import { subscribeConnectivity } from "@/lib/offline/connectivity";

const METHODS = ["Cash", "Bank Transfer", "Cheque", "Easypaisa", "JazzCash", "Card"];

// record_inventory_purchase() (0028_inventory.sql) does the real work in one
// transaction — inserts the expense (which the existing trg_expenses_ledger
// trigger turns into a transactions row and moves the account balance),
// the purchase row, and the stock-in movement. This form is just the input
// screen; it recomputes nothing and trusts the RPC's numbers, not its own.
export default function PurchaseEntryForm({ items, suppliers, instituteId }) {
  const supabase = createClient();
  const router = useRouter();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [online, setOnline] = useState(true);
  const formRef = useRef(null);

  useEffect(() => subscribeConnectivity(setOnline), []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    const formData = new FormData(formRef.current);
    const itemId = formData.get("item_id")?.toString();
    const supplierId = formData.get("supplier_id")?.toString() || null;
    const quantity = Number(formData.get("quantity"));
    const unitPrice = Number(formData.get("unit_price"));
    const purchaseDate = formData.get("purchase_date")?.toString() || new Date().toISOString().slice(0, 10);
    const method = formData.get("method")?.toString() || "Cash";

    setPending(true);
    try {
      // Routed through inventoryService so a purchase can be recorded
      // offline too. record_inventory_purchase() does the expense, the
      // purchase row, and the stock movement in ONE transaction (made
      // idempotent in 0044), so a queued purchase either fully applies at
      // sync time or not at all — the money and the stock can't diverge.
      const res = await inventoryService.recordPurchase(supabase, {
        instituteId, itemId, supplierId, quantity, unitPrice, purchaseDate, method,
      });
      if (res.mode === "offline") {
        setMessage("🟠 Saved on this device. The expense, ledger entry, and stock movement are all created together when it syncs — not before.");
      } else {
        router.refresh();
      }
      formRef.current?.reset();
    } catch (err) {
      setError((err.message || String(err)).replace(/^[A-Z_]+:\s*/, ""));
    } finally {
      setPending(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Item</label>
          <select name="item_id" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">— Select —</option>
            {(items || []).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Supplier (optional)</label>
          <select name="supplier_id" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">— None —</option>
            {(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Quantity</label>
          <input name="quantity" type="number" min="0.01" step="0.01" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Unit Price (Rs.)</label>
          <input name="unit_price" type="number" min="0" step="0.01" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Method</label>
          <select name="method" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
          <input name="purchase_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {!online && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-sm">
          🟠 Offline — this purchase is saved here and applied in full when you reconnect. Note the
          money hasn&apos;t hit the ledger yet, so it won&apos;t show in Expenses or the Dashboard until then.
        </div>
      )}

      {error && <p className="text-sm text-brick">{error}</p>}
      {message && <p className="text-sm text-sage">{message}</p>}

      <button type="submit" disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Recording…" : online ? "Record Purchase" : "Save Offline"}
      </button>
    </form>
  );
}
