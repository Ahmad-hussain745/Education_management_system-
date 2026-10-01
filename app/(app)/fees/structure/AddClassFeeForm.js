"use client";

import { useState, useRef } from "react";
import { createClassFee } from "./actions";

export default function AddClassFeeForm({ classes }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const formRef = useRef(null);

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    const res = await createClassFee(formData);
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    formRef.current?.reset();
  };

  return (
    <form ref={formRef} action={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 space-y-3">
      <div className="text-sm font-semibold text-ink">Schedule a Class Fee</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Class</label>
          <select name="class_id" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">Select…</option>
            {(classes || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Monthly Fee (Rs.)</label>
          <input name="monthly_fee" type="number" min="0" step="0.01" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Effective From</label>
          <input name="effective_from" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {error && <p className="text-sm text-brick">{error}</p>}

      <button type="submit" disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Saving…" : "Schedule Fee"}
      </button>
      <p className="text-xs text-slate-400">
        A future date schedules the change ahead of time without disturbing the current fee — bills for
        earlier months always use whichever fee was in effect at the time.
      </p>
    </form>
  );
}
