"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { generateSuggestions, publishBatch, discardBatch } from "./actions";

export default function TimetableControls({ classId, batchToReview, reviewOnly }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  if (reviewOnly && batchToReview) {
    const handlePublish = async () => {
      setPending(true);
      setError("");
      const res = await publishBatch(batchToReview.batchId);
      setPending(false);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    };
    const handleDiscard = async () => {
      if (!window.confirm("Discard this draft timetable? This can't be undone.")) return;
      setPending(true);
      setError("");
      const res = await discardBatch(batchToReview.batchId);
      setPending(false);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    };
    return (
      <div className="flex items-center justify-between py-1.5 text-sm">
        <span className="text-amber-800">
          {batchToReview.className || "Multiple classes"} — {batchToReview.count} slot{batchToReview.count === 1 ? "" : "s"} suggested
        </span>
        <div className="flex gap-2">
          <button onClick={handleDiscard} disabled={pending} className="px-3 py-1 rounded-lg border border-slate-300 text-slate-600 text-xs">Discard</button>
          <button onClick={handlePublish} disabled={pending} className="px-3 py-1 rounded-lg bg-royal text-white text-xs">Review &amp; Publish</button>
        </div>
        {error && <p className="text-xs text-brick">{error}</p>}
      </div>
    );
  }

  const handleGenerate = async () => {
    setPending(true);
    setError("");
    const res = await generateSuggestions(classId);
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    router.refresh();
  };

  return (
    <div>
      <button onClick={handleGenerate} disabled={pending} className="text-sm px-4 py-2 rounded-lg bg-royal text-white disabled:opacity-60">
        {pending ? "Generating…" : "Generate Suggestions for This Class"}
      </button>
      {error && <p className="text-xs text-brick mt-1">{error}</p>}
    </div>
  );
}
