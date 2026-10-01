"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCategory, toggleCategoryStatus, deleteCategory } from "./actions";

export default function CategoryRow({ category }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleSave = (e) => {
    e.preventDefault();
    setError("");
    const formData = new FormData();
    formData.set("id", category.id);
    formData.set("name", name);
    startTransition(async () => {
      const res = await updateCategory(formData);
      if (res?.error) { setError(res.error); return; }
      setEditing(false);
      router.refresh();
    });
  };

  const handleToggle = () => {
    setError("");
    startTransition(async () => {
      const res = await toggleCategoryStatus(category.id, category.active !== true);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  const handleDelete = () => {
    if (!confirm(`Delete "${category.name}"? This can't be undone.`)) return;
    setError("");
    startTransition(async () => {
      const res = await deleteCategory(category.id);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  if (editing) {
    return (
      <tr className="border-t border-slate-100">
        <td className="px-4 py-2" colSpan={3}>
          <form onSubmit={handleSave} className="flex items-center gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm flex-1" />
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
        <td className="px-4 py-3 font-medium text-ink">{category.name}</td>
        <td className="px-4 py-3">
          <span className={`text-xs px-2 py-0.5 rounded-full ${category.active ? "bg-green-50 text-sage" : "bg-slate-100 text-slate-500"}`}>
            {category.active ? "active" : "inactive"}
          </span>
        </td>
        <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
          <button onClick={() => setEditing(true)} className="text-xs text-royal">Edit</button>
          <button onClick={handleToggle} disabled={pending} className="text-xs text-slate-500">
            {category.active ? "Deactivate" : "Activate"}
          </button>
          <button onClick={handleDelete} disabled={pending} className="text-xs text-brick">Delete</button>
        </td>
      </tr>
      {error && (
        <tr><td colSpan={3} className="px-4 pb-2 pt-0"><p className="text-sm text-brick">{error}</p></td></tr>
      )}
    </>
  );
}
