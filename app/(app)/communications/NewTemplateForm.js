"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createTemplate } from "./actions";

export default function NewTemplateForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const formRef = useRef(null);

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    const res = await createTemplate(formData);
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    formRef.current?.reset();
    setOpen(false);
    router.refresh();
  };

  if (!open) return <button onClick={() => setOpen(true)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">+ New Template</button>;

  return (
    <form ref={formRef} action={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
      <div className="flex gap-2">
        <input name="name" placeholder="Template name" required className="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        <select name="channel" required className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="whatsapp">WhatsApp</option>
          <option value="sms">SMS</option>
          <option value="email">Email</option>
          <option value="push">Push</option>
        </select>
      </div>
      <input name="subject" placeholder="Subject (email/push only)" className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
      <textarea name="body" rows={2} required placeholder="Message body — use {{student_name}}, {{teacher_name}}" className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
      {error && <p className="text-xs text-brick">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600">Cancel</button>
        <button type="submit" disabled={pending} className="text-xs px-3 py-1.5 rounded-lg bg-royal text-white">{pending ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}
