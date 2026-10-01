"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

export default function GenerateFeesButton({ month, toGenerate }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const supabase = createClient();

  const handleGenerate = () => {
    setError("");
    setResult(null);
    startTransition(async () => {
      const { data, error } = await supabase.rpc("generate_monthly_fee_records", { p_month: month });
      if (error) {
        setError(error.message);
        return;
      }
      setResult(data?.[0] || null);
      router.refresh();
    });
  };

  if (result) {
    const hasFailures = result.failed_count > 0;
    return (
      <div className={`text-sm border rounded-lg px-4 py-3 ${hasFailures ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-green-50 border-green-200 text-green-800"}`}>
        <div>
          Generated {result.generated_count} new bill{result.generated_count === 1 ? "" : "s"}
          {result.skipped_count > 0 && ` · ${result.skipped_count} already existed`}
          {hasFailures && ` · ${result.failed_count} failed`}.
        </div>
        <div className="mt-1">Total billed for this month: {fmt(result.total_expected)}.</div>
        {hasFailures && (
          <div className="mt-1 text-xs">
            Some students couldn't be billed — check their fee structure/class assignment and re-run;
            already-generated bills from this run are untouched.
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={handleGenerate}
        disabled={pending || toGenerate === 0}
        className="w-full bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2.5 rounded-lg disabled:opacity-50"
      >
        {pending ? "Generating…" : toGenerate === 0 ? "Nothing to Generate" : "Generate Fees"}
      </button>
      {error && <p className="text-sm text-brick mt-2">{error}</p>}
    </div>
  );
}
