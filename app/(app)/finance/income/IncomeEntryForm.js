"use client";

import { useState, useRef } from "react";
import { recordIncome } from "./actions";

export default function IncomeEntryForm() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const formRef = useRef(null);

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    const res = await recordIncome(formData);
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    formRef.current?.reset();
  };

  return (
    <form ref={formRef} action={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
          <input name="category" required placeholder="Admission Fee, Donation…" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Amount (Rs.)</label>
          <input name="amount" type="number" min="0" step="0.01" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Method</label>
          <select name="method" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            {["Cash", "Bank Transfer", "Cheque", "Easypaisa", "JazzCash", "Card"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
          <input name="income_date" type="date" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="col-span-2 md:col-span-4">
          <label className="block text-xs font-medium text-slate-600 mb-1">Description (optional)</label>
          <input name="description" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {error && <p className="text-sm text-brick">{error}</p>}

      <button type="submit" disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Saving…" : "Record Income"}
      </button>
    </form>
  );
}
