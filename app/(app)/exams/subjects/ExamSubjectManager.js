"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addExamSubject, removeExamSubject } from "./actions";

export default function ExamSubjectManager({ exams, subjects, examClassesByExam, examSubjectsByExam }) {
  const router = useRouter();
  const [examId, setExamId] = useState("");
  const [classId, setClassId] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const classesForExam = examId ? (examClassesByExam[examId] || []) : [];
  const rows = examId ? (examSubjectsByExam[examId] || []) : [];

  const handleAdd = (e) => {
    e.preventDefault();
    setError("");
    const formData = new FormData(e.target);
    formData.set("exam_id", examId);
    startTransition(async () => {
      const res = await addExamSubject(formData);
      if (res?.error) { setError(res.error); return; }
      e.target.reset();
      router.refresh();
    });
  };

  const handleRemove = (id, hasMarks) => {
    if (hasMarks && !confirm("Marks have already been entered for this subject — removing it deletes those marks too. Continue?")) return;
    setError("");
    startTransition(async () => {
      const res = await removeExamSubject(id);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  return (
    <div className="mt-6">
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
        <label className="block text-xs font-medium text-slate-600 mb-1">Exam</label>
        <select value={examId} onChange={(e) => { setExamId(e.target.value); setClassId(""); }} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full md:w-80">
          <option value="">— Select an exam —</option>
          {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>

      {examId && classesForExam.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-8 text-center text-slate-400 text-sm mb-6">
          No classes assigned to this exam yet — assign classes on the Exams page first.
        </div>
      )}

      {examId && classesForExam.length > 0 && (
        <form onSubmit={handleAdd} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Class</label>
            <select name="class_id" required onChange={(e) => setClassId(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="">— Select —</option>
              {classesForExam.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Subject</label>
            <select name="subject_id" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="">— Select —</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Max Marks</label>
            <input name="max_marks" type="number" min="1" step="0.5" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Passing Marks</label>
            <input name="passing_marks" type="number" min="0" step="0.5" defaultValue="0" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Exam Date</label>
            <input name="exam_date" type="date" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button type="submit" disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">+ Add</button>
        </form>
      )}
      {error && <p className="text-sm text-brick mb-3">{error}</p>}

      {examId && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Class</th>
                <th className="text-left px-4 py-3">Subject</th>
                <th className="text-right px-4 py-3">Max Marks</th>
                <th className="text-right px-4 py-3">Passing Marks</th>
                <th className="text-left px-4 py-3">Exam Date</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-ink">{r.class?.name}</td>
                  <td className="px-4 py-3 text-ink">{r.subject?.name}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.max_marks}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.passing_marks}</td>
                  <td className="px-4 py-3 text-slate-600">{r.exam_date || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleRemove(r.id, (r.mark_count || 0) > 0)} disabled={pending} className="text-xs text-brick">Remove</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No subjects added for this exam yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
