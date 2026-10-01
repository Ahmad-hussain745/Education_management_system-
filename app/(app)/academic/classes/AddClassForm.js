"use client";

import { useState, useRef } from "react";
import { createClass } from "./actions";

export default function AddClassForm() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const formRef = useRef(null);

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    const res = await createClass(formData);
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    formRef.current?.reset();
  };

  return (
    <form ref={formRef} action={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 flex flex-wrap items-end gap-3">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Class Name</label>
        <input name="name" required placeholder="e.g. Class 10" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Sort Order</label>
        <input name="sort_order" type="number" defaultValue={0} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-24" />
      </div>
      <button type="submit" disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Saving…" : "Add Class"}
      </button>
      {error && <p className="text-sm text-brick self-center">{error}</p>}
    </form>
  );
}
