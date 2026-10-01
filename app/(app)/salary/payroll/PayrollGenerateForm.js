"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generatePayroll } from "./actions";

export default function PayrollGenerateForm({ month }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleMonthChange = (value) => {
    router.push(`/salary/payroll?month=${value}-01`);
  };

  const handleGenerate = () => {
    setError("");
    startTransition(async () => {
      const res = await generatePayroll(month);
      if (res?.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6 flex flex-wrap items-end gap-3">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Month</label>
        <input
          type="month"
          defaultValue={month.slice(0, 7)}
          onChange={(e) => handleMonthChange(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>
      <button onClick={handleGenerate} disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Generating…" : "Generate / Refresh Payroll"}
      </button>
      {error && <p className="text-sm text-brick">{error}</p>}
    </div>
  );
}
