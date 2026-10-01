"use client";

import { useState, useRef } from "react";
import { createAccount } from "./actions";

export default function AddAccountForm() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const formRef = useRef(null);

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    const res = await createAccount(formData);
    setPending(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    formRef.current?.reset();
    setOpen(false);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg">
        + Add Account
      </button>
    );
  }

  return (
    <form ref={formRef} action={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Account Name</label>
          <input name="name" required placeholder="e.g. HBL Current Account" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Kind</label>
          <select name="kind" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="cash">Cash</option>
            <option value="bank">Bank</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Opening Balance (Rs.)</label>
          <input name="opening_balance" type="number" min="0" defaultValue="0" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>
      {error && <p className="text-sm text-brick">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-600">Cancel</button>
        <button type="submit" disabled={pending} className="text-sm px-4 py-2 rounded-lg bg-royal text-white disabled:opacity-60">
          {pending ? "Saving…" : "Save Account"}
        </button>
      </div>
    </form>
  );
}
