"use client";

import { useState, useRef } from "react";
import { createItem } from "./actions";

export default function AddItemForm({ categories }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const formRef = useRef(null);

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    const res = await createItem(formData);
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    formRef.current?.reset();
  };

  return (
    <form ref={formRef} action={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Item Name</label>
          <input name="name" required placeholder="Printer Paper, Whiteboard Markers…" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
          <select name="category_id" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">— None —</option>
            {(categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Unit</label>
          <input name="unit" defaultValue="pcs" placeholder="packs, boxes, reams…" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Opening Stock</label>
          <input name="opening_stock" type="number" min="0" step="0.01" defaultValue="0" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Reorder Level (optional)</label>
          <input name="reorder_level" type="number" min="0" step="0.01" placeholder="e.g. 20" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>
      <button type="submit" disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Adding…" : "+ Add Item"}
      </button>
      {error && <p className="text-sm text-brick">{error}</p>}
    </form>
  );
}
