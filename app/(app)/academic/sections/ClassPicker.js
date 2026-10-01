"use client";

import { useRouter } from "next/navigation";

export default function ClassPicker({ classes, classId }) {
  const router = useRouter();
  return (
    <select
      defaultValue={classId}
      onChange={(e) => router.push(e.target.value ? `?class_id=${e.target.value}` : "?")}
      className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
    >
      <option value="">Select a class…</option>
      {(classes || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}
