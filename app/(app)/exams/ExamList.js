"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addExamClass, removeExamClass, deleteExam } from "./actions";

// "Assign Classes" — the second workflow step — lives inline under each
// exam via <details>, rather than a separate page, so creating an exam and
// assigning its classes stay visually and mechanically close together.
export default function ExamList({ exams, classes, sections }) {
  return (
    <div className="space-y-3">
      {exams.map((e) => <ExamCard key={e.id} exam={e} classes={classes} sections={sections} />)}
      {exams.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-10 text-center text-slate-400 text-sm">
          No exams yet — create the first one above.
        </div>
      )}
    </div>
  );
}

function ExamCard({ exam, classes, sections }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const sectionsForClass = (sections || []).filter((s) => !classId || s.class_id === classId);

  const handleAddClass = (e) => {
    e.preventDefault();
    setError("");
    const formData = new FormData();
    formData.set("exam_id", exam.id);
    formData.set("class_id", classId);
    if (sectionId) formData.set("section_id", sectionId);
    startTransition(async () => {
      const res = await addExamClass(formData);
      if (res?.error) { setError(res.error); return; }
      setClassId("");
      setSectionId("");
      router.refresh();
    });
  };

  const handleRemoveClass = (id) => {
    setError("");
    startTransition(async () => {
      const res = await removeExamClass(id);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  const handleDeleteExam = () => {
    if (!confirm(`Delete "${exam.name}"? This also deletes its class assignments, subjects, marks, and results.`)) return;
    setError("");
    startTransition(async () => {
      const res = await deleteExam(exam.id);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  return (
    <details className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none list-none flex-wrap">
        <div>
          <span className="font-medium text-ink">{exam.name}</span>
          {exam.exam_type?.name && <span className="text-xs text-slate-400 ml-2">{exam.exam_type.name}</span>}
          {(exam.start_date || exam.end_date) && (
            <span className="text-xs text-slate-400 ml-2">{exam.start_date || "?"} – {exam.end_date || "?"}</span>
          )}
        </div>
        <span className="text-xs text-slate-400">{(exam.exam_classes || []).length} class{(exam.exam_classes || []).length === 1 ? "" : "es"} assigned</span>
      </summary>
      <div className="border-t border-slate-100 p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {(exam.exam_classes || []).map((ec) => (
            <span key={ec.id} className="text-xs bg-soft-blue text-royal px-2 py-1 rounded-full flex items-center gap-1">
              {ec.class?.name}{ec.section?.name ? `-${ec.section.name}` : " (all sections)"}
              <button onClick={() => handleRemoveClass(ec.id)} disabled={pending} className="ml-1 text-royal/60 hover:text-royal">×</button>
            </span>
          ))}
          {(exam.exam_classes || []).length === 0 && <span className="text-xs text-slate-400">No classes assigned yet.</span>}
        </div>

        <form onSubmit={handleAddClass} className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Class</label>
            <select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(""); }} required className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="">— Select —</option>
              {(classes || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Section</label>
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="">All sections</option>
              {sectionsForClass.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button type="submit" disabled={pending || !classId} className="text-sm px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            + Assign
          </button>
          <button type="button" onClick={handleDeleteExam} disabled={pending} className="text-xs text-brick ml-auto">
            Delete Exam
          </button>
        </form>
        {error && <p className="text-sm text-brick">{error}</p>}
      </div>
    </details>
  );
}
