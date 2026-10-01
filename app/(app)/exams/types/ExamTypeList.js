"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createExamType, deleteExamType } from "./actions";

export default function ExamTypeList({ types }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const formRef = useRef(null);
  const router = useRouter();

  const handleAdd = async (formData) => {
    setError("");
    const res = await createExamType(formData);
    if (res?.error) { setError(res.error); return; }
    formRef.current?.reset();
    router.refresh();
  };

  const handleDelete = (id, name) => {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    setError("");
    startTransition(async () => {
      const res = await deleteExamType(id);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  return (
    <div className="mt-6">
      <form ref={formRef} action={handleAdd} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-600 mb-1">Exam Type Name</label>
          <input name="name" required placeholder="Mid Term, Final Term, Class Test…" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <button type="submit" className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg">+ Add</button>
      </form>
      {error && <p className="text-sm text-brick mb-3">{error}</p>}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr><th className="text-left px-4 py-3">Name</th><th className="text-right px-4 py-3">Actions</th></tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-ink">{t.name}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => handleDelete(t.id, t.name)} disabled={pending} className="text-xs text-brick">Delete</button>
                </td>
              </tr>
            ))}
            {types.length === 0 && <tr><td colSpan={2} className="px-4 py-10 text-center text-slate-400">No exam types yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
