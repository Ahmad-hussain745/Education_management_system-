"use client";

import { useState, useRef } from "react";
import { createCategory } from "./actions";

export default function AddCategoryForm() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const formRef = useRef(null);

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    const res = await createCategory(formData);
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    formRef.current?.reset();
  };

  return (
    <form ref={formRef} action={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 flex flex-wrap items-end gap-3">
      <div className="flex-1">
        <label className="block text-xs font-medium text-slate-600 mb-1">Category Name</label>
        <input name="name" required placeholder="Stationery, Cleaning Supplies, Lab Equipment…" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <button type="submit" disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Adding…" : "+ Add Category"}
      </button>
      {error && <p className="text-sm text-brick">{error}</p>}
    </form>
  );
}
