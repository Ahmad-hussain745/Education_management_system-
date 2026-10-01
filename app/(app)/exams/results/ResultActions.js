"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// The two-step "Calculate Total → Percentage → Grade" then "Publish
// Result" from the workflow — compute_exam_results() is safe to click
// repeatedly (e.g. after correcting a mark), publish_exam_results()/
// unpublish_exam_results() are the explicit, separate approval step
// (0030_exams_and_results.sql).
export default function ResultActions({ examId, canApprove }) {
  const supabase = createClient();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const run = (fnName, label, confirmMsg) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setError("");
    setMessage("");
    startTransition(async () => {
      const { data, error } = await supabase.rpc(fnName, { p_exam_id: examId });
      if (error) {
        setError(error.message.replace(/^[A-Z_]+:\s*/, ""));
        return;
      }
      setMessage(`${label}: ${data} student${data === 1 ? "" : "s"}.`);
      router.refresh();
    });
  };

  if (!canApprove) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <button
        onClick={() => run("compute_exam_results", "Calculated")}
        disabled={pending}
        className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {pending ? "Working…" : "Calculate Results"}
      </button>
      <button
        onClick={() => run("publish_exam_results", "Published", "Publish results for this exam? Every student's marks lock immediately after — you'd need to Unpublish before correcting any of them.")}
        disabled={pending}
        className="text-sm px-4 py-2 rounded-lg bg-royal hover:bg-royal-dark text-white disabled:opacity-50"
      >
        Publish Results
      </button>
      <button
        onClick={() => run("unpublish_exam_results", "Unpublished")}
        disabled={pending}
        className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        Unpublish
      </button>
      {message && <span className="text-sm text-sage">{message}</span>}
      {error && <span className="text-sm text-brick">{error}</span>}
    </div>
  );
}
