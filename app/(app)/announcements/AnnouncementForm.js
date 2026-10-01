"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAnnouncement } from "./actions";

export default function AnnouncementForm({ classes }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("all");
  const [classId, setClassId] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState(null);

  async function submit() {
    setPending(true);
    setStatus(null);
    try {
      const res = await createAnnouncement(title, body, audience, classId || null);
      if (res.error) setStatus({ error: res.error });
      else {
        setStatus({ ok: true });
        setTitle(""); setBody("");
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-ink mb-3">Publish an Announcement</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-xs text-slate-600 sm:col-span-2">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
        </label>
        <label className="text-xs text-slate-600">
          Audience
          <select value={audience} onChange={(e) => setAudience(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm">
            <option value="all">Whole institute</option>
            <option value="class">One class</option>
          </select>
        </label>
        {audience === "class" && (
          <label className="text-xs text-slate-600">
            Class
            <select value={classId} onChange={(e) => setClassId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm">
              <option value="">Choose a class…</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <label className="text-xs text-slate-600 sm:col-span-2">
          Message
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
        </label>
      </div>

      {status?.error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">{status.error}</div>}
      {status?.ok && <div className="text-sm text-sage bg-sage/10 border border-sage/30 rounded-lg px-3 py-2 mt-3">Published.</div>}

      <button onClick={submit} disabled={pending || !title.trim() || !body.trim() || (audience === "class" && !classId)}
        className="mt-3 bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Publishing…" : "Publish"}
      </button>
    </div>
  );
}
