"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitAssignment } from "./actions";

export default function SubmitForm({ assignmentId, studentId, existing }) {
  const router = useRouter();
  const [text, setText] = useState(existing?.content_text || "");
  const [url, setUrl] = useState(existing?.content_url || "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    if (!text.trim() && !url.trim()) { setError("Add some text or a link first."); return; }
    setPending(true);
    setError(null);
    try {
      const res = await submitAssignment(assignmentId, studentId, text.trim(), url.trim());
      if (res.error) setError(res.error);
      else router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Write the answer here…"
        className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Or paste a link (Google Doc, photo, etc.) — optional"
        className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
      {error && <div className="text-xs text-red-700">{error}</div>}
      <button onClick={submit} disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-60">
        {pending ? "Submitting…" : existing ? "Update Submission" : "Submit"}
      </button>
    </div>
  );
}
