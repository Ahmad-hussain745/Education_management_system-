"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitSupportRequest } from "./actions";

const CATEGORIES = [
  { value: "general", label: "General" },
  { value: "fees", label: "Fees" },
  { value: "academic", label: "Academic" },
  { value: "attendance", label: "Attendance" },
  { value: "technical", label: "Technical / Portal" },
  { value: "other", label: "Other" },
];

export default function SupportForm({ children_ }) {
  const router = useRouter();
  const [studentId, setStudentId] = useState(children_?.[0]?.id || "");
  const [category, setCategory] = useState("general");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState(null);

  async function submit() {
    if (!subject.trim() || !message.trim()) return;
    setPending(true);
    setStatus(null);
    try {
      const res = await submitSupportRequest(studentId || null, category, subject.trim(), message.trim());
      if (res.error) setStatus({ error: res.error });
      else {
        setStatus({ ok: true });
        setSubject(""); setMessage("");
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-ink mb-3">Submit a Request</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        {children_ && children_.length > 1 && (
          <label className="text-xs text-slate-600">
            About
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm">
              {children_.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <label className="text-xs text-slate-600">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm">
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600 sm:col-span-2">
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
        </label>
        <label className="text-xs text-slate-600 sm:col-span-2">
          Message
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
        </label>
      </div>

      {status?.error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">{status.error}</div>}
      {status?.ok && <div className="text-sm text-sage bg-sage/10 border border-sage/30 rounded-lg px-3 py-2 mt-3">Sent — the school will respond here.</div>}

      <button onClick={submit} disabled={pending || !subject.trim() || !message.trim()}
        className="mt-3 bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Sending…" : "Submit"}
      </button>
    </div>
  );
}
