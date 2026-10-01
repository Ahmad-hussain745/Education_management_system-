"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleClassFeeActive, deleteClassFee } from "./actions";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

export default function ClassFeeRow({ row, isCurrent }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleToggle = () => {
    setError("");
    startTransition(async () => {
      const res = await toggleClassFeeActive(row.id, !row.active);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  const handleDelete = () => {
    if (!confirm(`Delete this Rs. ${row.monthly_fee} entry effective ${row.effective_from}? This can't be undone.`)) return;
    setError("");
    startTransition(async () => {
      const res = await deleteClassFee(row.id);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="px-4 py-3 text-slate-600">{row.effective_from}</td>
        <td className="px-4 py-3 text-right font-mono font-medium">{fmt(row.monthly_fee)}</td>
        <td className="px-4 py-3">
          {isCurrent && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-royal mr-2">current</span>}
          <span className={`text-xs px-2 py-0.5 rounded-full ${row.active ? "bg-green-50 text-sage" : "bg-slate-100 text-slate-500"}`}>
            {row.active ? "active" : "inactive"}
          </span>
        </td>
        <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
          <button onClick={handleToggle} disabled={pending} className="text-xs text-slate-500">
            {row.active ? "Deactivate" : "Activate"}
          </button>
          <button onClick={handleDelete} disabled={pending} className="text-xs text-brick">Delete</button>
        </td>
      </tr>
      {error && (
        <tr><td colSpan={4} className="px-4 pb-2 pt-0"><p className="text-sm text-brick">{error}</p></td></tr>
      )}
    </>
  );
}
