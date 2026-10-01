"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { respondToRequest } from "./actions";

const STATUS_STYLE = {
  open: "bg-amber-50 text-amber-700 border-amber-200",
  in_progress: "bg-soft-blue text-royal border-royal/20",
  resolved: "bg-sage-tint text-sage border-sage/30",
  closed: "bg-slate-100 text-slate-500 border-slate-200",
};

export default function RequestCard({ request, fmtDate }) {
  const router = useRouter();
  const [response, setResponse] = useState(request.staff_response || "");
  const [status, setStatus] = useState(request.status);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await respondToRequest(request.id, response, status);
      if (res.error) setError(res.error);
      else router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-ink">{request.subject}</span>
          <span className="text-xs text-slate-400 ml-2">
            {request.parent_name ? `from ${request.parent_name}` : ""}{request.student?.name ? ` re. ${request.student.name}` : ""} · {request.category} · {fmtDate(request.created_at)}
          </span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${STATUS_STYLE[request.status]}`}>{request.status.replace("_", " ")}</span>
      </div>
      <p className="text-sm text-slate-600 mt-1.5 whitespace-pre-wrap">{request.message}</p>

      <div className="mt-3 grid sm:grid-cols-[1fr_160px] gap-2">
        <textarea value={response} onChange={(e) => setResponse(e.target.value)} rows={2} placeholder="Write a response…"
          className="border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-slate-300 rounded-lg px-2.5 py-2 text-sm h-fit">
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
      </div>
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">{error}</div>}
      <button onClick={submit} disabled={pending} className="mt-2 border border-slate-300 text-ink hover:bg-slate-50 text-sm font-medium px-4 py-1.5 rounded-lg disabled:opacity-60">
        {pending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
