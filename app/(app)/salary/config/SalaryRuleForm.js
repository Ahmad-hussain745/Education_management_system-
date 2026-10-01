"use client";

import { useState, useRef } from "react";
import { createSalaryRule } from "./actions";

export default function SalaryRuleForm({ teachers, classes, sections }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [classId, setClassId] = useState("");
  const formRef = useRef(null);

  const sectionsForClass = (sections || []).filter((s) => s.class_id === classId);

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    const res = await createSalaryRule(formData);
    setPending(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    formRef.current?.reset();
    setClassId("");
  };

  return (
    <form ref={formRef} action={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 space-y-3">
      <div className="text-sm font-semibold text-ink">Add / Update a Percentage Rule</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Teacher</label>
          <select name="teacher_id" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">Select…</option>
            {(teachers || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Class</label>
          <select name="class_id" required value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">Select…</option>
            {(classes || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Section (optional)</label>
          <select name="section_id" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">Whole class</option>
            {sectionsForClass.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Percentage (%)</label>
          <input name="percentage" type="number" min="0" max="100" step="0.01" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Effective From</label>
          <input name="effective_from" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Only matters if you're changing an existing rule's percentage — sets when the new rate starts. A month already
        locked for this teacher on or after that date will reject the change; pick a later date instead.
      </p>

      {error && <p className="text-sm text-brick">{error}</p>}

      <button type="submit" disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Saving…" : "Save Rule"}
      </button>
      <p className="text-xs text-slate-400">
        Only the % is entered here. The Rupee amount is calculated at payroll time from that class's actual fee collections that month — never typed in.
      </p>
    </form>
  );
}
