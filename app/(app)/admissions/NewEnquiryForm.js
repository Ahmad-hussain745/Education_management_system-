"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createEnquiry } from "./actions";

export default function NewEnquiryForm({ classes, instituteId }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const formRef = useRef(null);
  const router = useRouter();

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    setDone(false);
    const res = await createEnquiry(formData);
    setPending(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    formRef.current?.reset();
    setDone(true);
    router.refresh();
    setTimeout(() => setDone(false), 3000);
  };

  return (
    <form ref={formRef} action={handleSubmit} className="space-y-3">
      <input type="hidden" name="institute_id" value={instituteId || ""} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Parent Name</label>
          <input name="parent_name" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Parent Phone</label>
          <input name="parent_phone" required type="tel" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Prospective Student</label>
          <input name="student_name" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Interested Class</label>
          <select name="interested_class_id" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">— Not sure yet —</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
        <textarea name="notes" rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      {error && <p className="text-sm text-brick">{error}</p>}
      {done && <p className="text-sm text-sage">Enquiry logged.</p>}
      <button type="submit" disabled={pending} className="text-sm px-4 py-2 rounded-lg bg-royal text-white disabled:opacity-60">
        {pending ? "Saving…" : "Log Enquiry"}
      </button>
    </form>
  );
}
