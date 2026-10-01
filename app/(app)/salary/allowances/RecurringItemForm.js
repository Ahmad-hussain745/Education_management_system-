"use client";

import { useState, useRef } from "react";
import { createRecurringItem } from "./actions";

export default function RecurringItemForm({ teachers }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const formRef = useRef(null);

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    const res = await createRecurringItem(formData);
    setPending(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    formRef.current?.reset();
  };

  return (
    <form ref={formRef} action={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 space-y-3">
      <div className="text-sm font-semibold text-ink">Add an Allowance or Deduction</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Teacher</label>
          <select name="teacher_id" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">Select…</option>
            {(teachers || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
          <select name="item_type" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="allowance">Allowance (adds to pay)</option>
            <option value="deduction">Deduction (subtracts from pay)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Label</label>
          <input name="label" required placeholder="Transport Allowance, Advance Recovery…" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Amount (Rs. / month)</label>
          <input name="amount" type="number" min="0" step="0.01" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {error && <p className="text-sm text-brick">{error}</p>}

      <button type="submit" disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Saving…" : "Add"}
      </button>
      <p className="text-xs text-slate-400">
        Applied automatically to every future payroll draft for this teacher until turned off below — nothing
        needs re-entering each month. An already-locked month is never touched.
      </p>
    </form>
  );
}
