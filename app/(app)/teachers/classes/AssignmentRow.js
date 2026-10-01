"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateAssignment, removeAssignment } from "./actions";

export default function AssignmentRow({ assignment, sections, subjects, canWrite }) {
  const [editing, setEditing] = useState(false);
  const [sectionId, setSectionId] = useState(assignment.section_id || "");
  const [subjectId, setSubjectId] = useState(assignment.subject_id || "");
  const [percentage, setPercentage] = useState(assignment.percentage ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const sectionsForClass = sections.filter((s) => s.class_id === assignment.class_id);

  const handleSave = () => {
    setError("");
    startTransition(async () => {
      const res = await updateAssignment({
        id: assignment.id,
        teacherId: assignment.teacher_id,
        classId: assignment.class_id,
        sectionId,
        subjectId,
        percentage,
      });
      if (res?.error) { setError(res.error); return; }
      setEditing(false);
      router.refresh();
    });
  };

  const handleRemove = () => {
    if (!confirm(`Remove ${assignment.teacher_name} from ${assignment.class_name}${assignment.section_name ? "-" + assignment.section_name : ""}? Their salary rule for this assignment will be deactivated too.`)) return;
    setError("");
    startTransition(async () => {
      const res = await removeAssignment({ id: assignment.id, teacherId: assignment.teacher_id, classId: assignment.class_id, sectionId: assignment.section_id });
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  if (editing) {
    return (
      <>
        <tr className="border-t border-slate-100 bg-soft-blue/30">
          <td className="px-4 py-3 font-medium text-ink">{assignment.teacher_name}</td>
          <td className="px-4 py-3 text-slate-600">{assignment.class_name}</td>
          <td className="px-4 py-3">
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm">
              <option value="">Whole class</option>
              {sectionsForClass.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </td>
          <td className="px-4 py-3">
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm">
              <option value="">—</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </td>
          <td className="px-4 py-3">
            <input type="number" min="0" max="100" step="0.01" value={percentage} onChange={(e) => setPercentage(e.target.value)}
              placeholder="e.g. 60" className="border border-slate-300 rounded-lg px-2 py-1 text-sm w-20" />
          </td>
          <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
            <button onClick={handleSave} disabled={pending} className="text-xs text-royal font-medium">{pending ? "Saving…" : "Save"}</button>
            <button onClick={() => setEditing(false)} disabled={pending} className="text-xs text-slate-500">Cancel</button>
          </td>
        </tr>
        {error && <tr><td colSpan={6} className="px-4 pb-2 pt-0"><p className="text-sm text-brick">{error}</p></td></tr>}
      </>
    );
  }

  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="px-4 py-3 font-medium text-ink">{assignment.teacher_name}</td>
        <td className="px-4 py-3 text-slate-600">{assignment.class_name}</td>
        <td className="px-4 py-3 text-slate-600">{assignment.section_name || "Whole class"}</td>
        <td className="px-4 py-3 text-slate-600">{assignment.subject_name || "—"}</td>
        <td className="px-4 py-3 font-mono text-slate-600">
          {assignment.percentage != null ? `${assignment.percentage}%` : "—"}
        </td>
        <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
          {canWrite ? (
            <>
              <button onClick={() => setEditing(true)} disabled={pending} className="text-xs text-royal">Edit</button>
              <button onClick={handleRemove} disabled={pending} className="text-xs text-brick">{pending ? "…" : "Remove"}</button>
            </>
          ) : (
            <span className="text-xs text-slate-300">—</span>
          )}
        </td>
      </tr>
      {error && <tr><td colSpan={6} className="px-4 pb-2 pt-0"><p className="text-sm text-brick">{error}</p></td></tr>}
    </>
  );
}
