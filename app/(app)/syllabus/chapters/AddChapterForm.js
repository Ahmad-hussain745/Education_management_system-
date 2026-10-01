"use client";

import { useState, useRef } from "react";
import { createChapter } from "./actions";

export default function AddChapterForm({ classId, subjectId }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const formRef = useRef(null);

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    const res = await createChapter(formData);
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    formRef.current?.reset();
  };

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-wrap items-end gap-2 mb-4">
      <input type="hidden" name="class_id" value={classId} />
      <input type="hidden" name="subject_id" value={subjectId} />
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">New Chapter</label>
        <input name="title" required placeholder="e.g. Fractions" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <button type="submit" disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Saving…" : "Add Chapter"}
      </button>
      {error && <p className="text-sm text-brick self-center">{error}</p>}
    </form>
  );
}
