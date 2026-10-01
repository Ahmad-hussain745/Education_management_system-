"use client";

import { useState, useRef } from "react";
import { createTeacher } from "./actions";

export default function AddTeacherForm({ subjects }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [salaryMode, setSalaryMode] = useState("fixed");
  const formRef = useRef(null);

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    const res = await createTeacher(formData);
    setPending(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    formRef.current?.reset();
    setSalaryMode("fixed");
    setOpen(false);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg">
        + Add Teacher
      </button>
    );
  }

  return (
    <form ref={formRef} action={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
          <input name="name" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
          <input name="phone" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Subject</label>
          <select name="subject_id" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">—</option>
            {(subjects || []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Salary Mode</label>
          <select name="salary_mode" value={salaryMode} onChange={(e) => setSalaryMode(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="fixed">Fixed</option>
            <option value="percentage">Percentage of collection</option>
            <option value="hybrid">Hybrid (fixed + percentage)</option>
          </select>
        </div>
        {salaryMode !== "percentage" && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {salaryMode === "hybrid" ? "Base Salary (Rs.)" : "Fixed Salary (Rs.)"}
            </label>
            <input name="fixed_salary" type="number" min="0" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
          <select name="status" defaultValue="active" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {salaryMode !== "fixed" && (
        <p className="text-xs text-slate-400">
          Percentage-based pay is set per class in Salary Configuration, once this teacher is saved.
        </p>
      )}

      {error && <p className="text-sm text-brick">{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-600">
          Cancel
        </button>
        <button type="submit" disabled={pending} className="text-sm px-4 py-2 rounded-lg bg-royal text-white disabled:opacity-60">
          {pending ? "Saving…" : "Save Teacher"}
        </button>
      </div>
    </form>
  );
}
