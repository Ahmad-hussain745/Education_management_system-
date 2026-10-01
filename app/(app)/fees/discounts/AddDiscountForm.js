"use client";

import { useState, useRef } from "react";
import { createDiscount } from "./actions";

export default function AddDiscountForm({ students }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const formRef = useRef(null);

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    const res = await createDiscount(formData);
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    formRef.current?.reset();
  };

  return (
    <form ref={formRef} action={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 space-y-3">
      <div className="text-sm font-semibold text-ink">Add a Discount</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Student</label>
          <select name="student_id" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">Select…</option>
            {(students || []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.class?.name ? ` — ${s.class.name}` : ""}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Amount (Rs.)</label>
          <input name="amount" type="number" min="0" step="0.01" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Reason (optional)</label>
          <input name="reason" placeholder="Sibling, scholarship…" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {error && <p className="text-sm text-brick">{error}</p>}

      <button type="submit" disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Saving…" : "Add Discount"}
      </button>
      <p className="text-xs text-slate-400">
        Applies to every future month's bill for this student until deactivated — subtracted straight
        from Total Payable, same as Payment Entry already shows.
      </p>
    </form>
  );
}
