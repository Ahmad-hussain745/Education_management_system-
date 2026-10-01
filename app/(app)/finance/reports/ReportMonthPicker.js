"use client";

import { useRouter } from "next/navigation";

export default function ReportMonthPicker({ month }) {
  const router = useRouter();
  return (
    <input
      type="month"
      defaultValue={month.slice(0, 7)}
      onChange={(e) => router.push(`?month=${e.target.value}-01`)}
      className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
    />
  );
}
