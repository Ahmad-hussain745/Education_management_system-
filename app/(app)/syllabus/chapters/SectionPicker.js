"use client";

import { useRouter } from "next/navigation";

export default function SectionPicker({ classId, subjectId, sections, sectionId }) {
  const router = useRouter();

  return (
    <div className="mb-4">
      <label className="block text-xs font-medium text-slate-600 mb-1">Tracking progress for</label>
      <select
        defaultValue={sectionId}
        onChange={(e) => {
          const params = new URLSearchParams({ class_id: classId, subject_id: subjectId });
          if (e.target.value) params.set("section_id", e.target.value);
          router.push(`?${params.toString()}`);
        }}
        className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
      >
        <option value="">Whole class</option>
        {(sections || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </div>
  );
}
