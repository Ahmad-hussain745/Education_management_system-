"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleDiscountActive, deleteDiscount } from "./actions";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

export default function DiscountRow({ row }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleToggle = () => {
    setError("");
    startTransition(async () => {
      const res = await toggleDiscountActive(row.id, !row.active);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  const handleDelete = () => {
    if (!confirm(`Delete this ${fmt(row.amount)} discount for ${row.student?.name}?`)) return;
    setError("");
    startTransition(async () => {
      const res = await deleteDiscount(row.id);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="px-4 py-3 font-medium text-ink">{row.student?.name}</td>
        <td className="px-4 py-3 text-slate-600">{row.student?.class?.name || "—"}</td>
        <td className="px-4 py-3 text-right font-mono">{fmt(row.amount)}</td>
        <td className="px-4 py-3 text-slate-600">{row.reason || "—"}</td>
        <td className="px-4 py-3">
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
        <tr><td colSpan={6} className="px-4 pb-2 pt-0"><p className="text-sm text-brick">{error}</p></td></tr>
      )}
    </>
  );
}
