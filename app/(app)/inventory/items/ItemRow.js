"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateItem, toggleItemStatus, deleteItem } from "./actions";

export default function ItemRow({ item, categories, stock }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [categoryId, setCategoryId] = useState(item.category_id || "");
  const [unit, setUnit] = useState(item.unit);
  const [openingStock, setOpeningStock] = useState(item.opening_stock);
  const [reorderLevel, setReorderLevel] = useState(item.reorder_level ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const belowReorder = item.reorder_level != null && stock <= Number(item.reorder_level);

  const handleSave = (e) => {
    e.preventDefault();
    setError("");
    const formData = new FormData();
    formData.set("id", item.id);
    formData.set("name", name);
    formData.set("category_id", categoryId);
    formData.set("unit", unit);
    formData.set("opening_stock", openingStock);
    formData.set("reorder_level", reorderLevel);
    startTransition(async () => {
      const res = await updateItem(formData);
      if (res?.error) { setError(res.error); return; }
      setEditing(false);
      router.refresh();
    });
  };

  const handleToggle = () => {
    setError("");
    startTransition(async () => {
      const res = await toggleItemStatus(item.id, item.active !== true);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  const handleDelete = () => {
    if (!confirm(`Delete "${item.name}"? This can't be undone.`)) return;
    setError("");
    startTransition(async () => {
      const res = await deleteItem(item.id);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  if (editing) {
    return (
      <tr className="border-t border-slate-100">
        <td className="px-4 py-2" colSpan={6}>
          <form onSubmit={handleSave} className="flex items-center gap-2 flex-wrap">
            <input value={name} onChange={(e) => setName(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm flex-1 min-w-[9rem]" placeholder="Name" />
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm">
              <option value="">— None —</option>
              {(categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm w-24" placeholder="Unit" />
            <input type="number" min="0" step="0.01" value={openingStock} onChange={(e) => setOpeningStock(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm w-24" placeholder="Opening" />
            <input type="number" min="0" step="0.01" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm w-24" placeholder="Reorder" />
            <button type="submit" disabled={pending} className="text-sm px-3 py-1 rounded-lg bg-royal text-white disabled:opacity-60">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="text-sm px-2 py-1 text-slate-500">Cancel</button>
          </form>
          {error && <p className="text-sm text-brick mt-1">{error}</p>}
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="px-4 py-3 font-medium text-ink">{item.name}</td>
        <td className="px-4 py-3 text-slate-600">{item.category?.name || "—"}</td>
        <td className="px-4 py-3 text-slate-600">{item.unit}</td>
        <td className={`px-4 py-3 text-right font-mono ${belowReorder ? "text-brick font-semibold" : ""}`}>
          {stock} {belowReorder && <span className="text-xs font-normal">(low)</span>}
        </td>
        <td className="px-4 py-3">
          <span className={`text-xs px-2 py-0.5 rounded-full ${item.active ? "bg-green-50 text-sage" : "bg-slate-100 text-slate-500"}`}>
            {item.active ? "active" : "inactive"}
          </span>
        </td>
        <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
          <button onClick={() => setEditing(true)} className="text-xs text-royal">Edit</button>
          <button onClick={handleToggle} disabled={pending} className="text-xs text-slate-500">
            {item.active ? "Deactivate" : "Activate"}
          </button>
          <button onClick={handleDelete} disabled={pending} className="text-xs text-brick">Delete</button>
        </td>
      </tr>
      {error && (
        <tr><td colSpan={6} className="px-4 pb-2 pt-0"><p className="text-sm text-brick">{error}</p></td></tr>
      )}
    </>
  );
}
