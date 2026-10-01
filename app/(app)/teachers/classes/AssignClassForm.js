"use client";

import { useState, useRef } from "react";
import { assignTeacherClass } from "./actions";

export default function AssignClassForm({ teachers, classes, sections, subjects }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [classId, setClassId] = useState("");
  const formRef = useRef(null);

  const sectionsForClass = (sections || []).filter((s) => s.class_id === classId);

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    const res = await assignTeacherClass(formData);
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    formRef.current?.reset();
    setClassId("");
  };

  return (
    <form ref={formRef} action={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 space-y-3">
      <div className="text-sm font-semibold text-ink">Assign a Teacher to a Class</div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
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
          <label className="block text-xs font-medium text-slate-600 mb-1">Subject (optional)</label>
          <select name="subject_id" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">—</option>
            {(subjects || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Earns % (optional)</label>
          <input name="percentage" type="number" min="0" max="100" step="0.01" placeholder="e.g. 60" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {error && <p className="text-sm text-brick">{error}</p>}

      <button type="submit" disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Saving…" : "Assign"}
      </button>
      <p className="text-xs text-slate-400">
        Filling in "Earns %" also creates the matching Salary Configuration rule — no need to visit that screen separately.
      </p>
    </form>
  );
}
