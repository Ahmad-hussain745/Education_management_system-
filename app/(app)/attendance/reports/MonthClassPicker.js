"use client";

import { useRouter } from "next/navigation";

export default function MonthClassPicker({ month, classId, classes, kind }) {
  const router = useRouter();

  const push = (overrides) => {
    const params = new URLSearchParams({ month, class_id: classId, ...overrides });
    for (const [k, v] of [...params.entries()]) if (!v) params.delete(k);
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-end gap-3 mb-6">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Month</label>
        <input
          type="month" defaultValue={month.slice(0, 7)}
          onChange={(e) => push({ month: `${e.target.value}-01` })}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>
      {kind === "student" && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Class (optional)</label>
          <select defaultValue={classId} onChange={(e) => push({ class_id: e.target.value })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All classes</option>
            {(classes || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}
