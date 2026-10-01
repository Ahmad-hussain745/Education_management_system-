"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createGradeRule, deleteGradeRule } from "./actions";

export default function GradeRuleList({ rules }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const formRef = useRef(null);
  const router = useRouter();

  const handleAdd = async (formData) => {
    setError("");
    const res = await createGradeRule(formData);
    if (res?.error) { setError(res.error); return; }
    formRef.current?.reset();
    router.refresh();
  };

  const handleDelete = (id, grade) => {
    if (!confirm(`Delete grade "${grade}"? This can't be undone.`)) return;
    setError("");
    startTransition(async () => {
      const res = await deleteGradeRule(id);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  return (
    <div className="mt-6">
      <form ref={formRef} action={handleAdd} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Grade</label>
          <input name="grade" required placeholder="A+" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Min %</label>
          <input name="min_percentage" type="number" min="0" max="100" step="0.01" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Max %</label>
          <input name="max_percentage" type="number" min="0" max="100" step="0.01" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Grade Point</label>
          <input name="grade_point" type="number" min="0" max="4" step="0.01" placeholder="optional" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="col-span-1">
          <label className="block text-xs font-medium text-slate-600 mb-1">Remarks</label>
          <input name="remarks" placeholder="Excellent" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <button type="submit" className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg">+ Add</button>
      </form>
      {error && <p className="text-sm text-brick mb-3">{error}</p>}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Grade</th>
              <th className="text-right px-4 py-3">Range</th>
              <th className="text-right px-4 py-3">Grade Point</th>
              <th className="text-left px-4 py-3">Remarks</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-ink">{r.grade}</td>
                <td className="px-4 py-3 text-right font-mono">{r.min_percentage}–{r.max_percentage}%</td>
                <td className="px-4 py-3 text-right font-mono">{r.grade_point ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{r.remarks || "—"}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => handleDelete(r.id, r.grade)} disabled={pending} className="text-xs text-brick">Delete</button>
                </td>
              </tr>
            ))}
            {rules.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No grade rules yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
