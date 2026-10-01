"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createExam } from "./actions";

export default function CreateExamForm({ examTypes }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const formRef = useRef(null);
  const router = useRouter();

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    const res = await createExam(formData);
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    formRef.current?.reset();
    router.refresh();
  };

  return (
    <form ref={formRef} action={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Exam Name</label>
          <input name="name" required placeholder="Mid Term 2026" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Exam Type</label>
          <select name="exam_type_id" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">— None —</option>
            {(examTypes || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600 mb-1">Start</label>
            <input name="start_date" type="date" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600 mb-1">End</label>
            <input name="end_date" type="date" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
      </div>
      {error && <p className="text-sm text-brick">{error}</p>}
      <button type="submit" disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Creating…" : "+ Create Exam"}
      </button>
    </form>
  );
}
