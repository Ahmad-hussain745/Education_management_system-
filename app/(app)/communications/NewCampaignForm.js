"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createCampaign } from "./actions";

export default function NewCampaignForm({ templates, classes }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [recipientType, setRecipientType] = useState("student_guardian");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const formRef = useRef(null);

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    const res = await createCampaign(formData);
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    formRef.current?.reset();
    setOpen(false);
    router.refresh();
  };

  if (!open) return <button onClick={() => setOpen(true)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">+ New Campaign</button>;

  return (
    <form ref={formRef} action={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
      <div className="flex gap-2">
        <input name="name" placeholder="Campaign name" required className="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        <select name="channel" required className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="whatsapp">WhatsApp</option>
          <option value="sms">SMS</option>
          <option value="email">Email</option>
        </select>
      </div>
      <select name="template_id" className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
        <option value="">— No template (use custom body per message later) —</option>
        {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.channel})</option>)}
      </select>
      <div className="flex gap-2">
        <select name="recipient_type" value={recipientType} onChange={(e) => setRecipientType(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="student_guardian">Student Guardians</option>
          <option value="teacher">Teachers</option>
        </select>
        {recipientType === "student_guardian" && (
          <select name="class_id" className="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="">All Classes</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>
      {error && <p className="text-xs text-brick">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600">Cancel</button>
        <button type="submit" disabled={pending} className="text-xs px-3 py-1.5 rounded-lg bg-royal text-white">{pending ? "Saving…" : "Save Draft"}</button>
      </div>
    </form>
  );
}
