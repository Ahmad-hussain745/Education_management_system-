"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { recordSubstitution } from "../actions";

export default function SubstitutionForm({ entries, teachers, dayNames }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const formRef = useRef(null);

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    const entryId = formData.get("timetable_entry_id")?.toString();
    const original = entries.find((e) => e.id === entryId)?.teacher?.id;
    if (original) formData.set("original_teacher_id", original);
    const res = await recordSubstitution(formData);
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    formRef.current?.reset();
    router.refresh();
  };

  return (
    <form ref={formRef} action={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Class Period</label>
        <select name="timetable_entry_id" required className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">— Select —</option>
          {entries.map((e) => (
            <option key={e.id} value={e.id}>{dayNames[e.day_of_week]} {e.period?.name} — {e.class?.name} {e.subject?.name} ({e.teacher?.name || "unassigned"})</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
        <input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Substitute Teacher</label>
        <select name="substitute_teacher_id" required className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">— Select —</option>
          {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Reason</label>
        <input name="reason" placeholder="Sick leave, training…" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <button type="submit" disabled={pending} className="text-sm px-4 py-2 rounded-lg bg-royal text-white disabled:opacity-60">
        {pending ? "Saving…" : "Record"}
      </button>
      {error && <p className="text-sm text-brick w-full">{error}</p>}
    </form>
  );
}
