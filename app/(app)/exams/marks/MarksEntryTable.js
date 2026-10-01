"use client";

import { useState } from "react";
import { saveExamMarks } from "./actions";

// Same "draft state in one form, single Save for the whole grid" shape as
// app/(app)/attendance/students/StudentAttendanceRegister.js — enter marks
// for the whole class, save once.
export default function MarksEntryTable({ students, existingByStudentId, examSubjectId, maxMarks }) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState(() => {
    const initial = {};
    for (const s of students) {
      const existing = existingByStudentId[s.id];
      initial[s.id] = { marks: existing?.marks_obtained ?? "", absent: existing?.is_absent || false };
    }
    return initial;
  });

  const setMarks = (studentId, marks) => setDraft((prev) => ({ ...prev, [studentId]: { ...prev[studentId], marks, absent: false } }));
  const setAbsent = (studentId, absent) => setDraft((prev) => ({ ...prev, [studentId]: { ...prev[studentId], absent, marks: absent ? "" : prev[studentId]?.marks } }));

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    const formData = new FormData();
    formData.set("exam_subject_id", examSubjectId);
    for (const s of students) {
      const d = draft[s.id];
      if (d.absent) formData.set(`absent_${s.id}`, "on");
      else if (d.marks !== "") formData.set(`marks_${s.id}`, d.marks);
    }
    setPending(true);
    saveExamMarks(formData).then((res) => {
      setPending(false);
      if (res?.error) { setError(res.error); return; }
      setMessage(`Saved marks for ${res.count} student${res.count === 1 ? "" : "s"}.`);
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-slate-500">Out of {maxMarks} marks. Tick Absent instead of entering a number for a student who didn't sit this subject.</p>
        <button type="submit" disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
          {pending ? "Saving…" : "Save Marks"}
        </button>
      </div>

      {error && <p className="text-sm text-brick mb-2">{error}</p>}
      {message && <p className="text-sm text-sage mb-2">{message}</p>}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Student</th>
              <th className="text-right px-4 py-3">Marks Obtained</th>
              <th className="text-center px-4 py-3">Absent</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const d = draft[s.id];
              return (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-ink">{s.name}</td>
                  <td className="px-4 py-3 text-right">
                    <input
                      type="number" min="0" max={maxMarks} step="0.5"
                      value={d.marks}
                      disabled={d.absent}
                      onChange={(e) => setMarks(s.id, e.target.value)}
                      className="w-24 text-right border border-slate-300 rounded-lg px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-300"
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input type="checkbox" checked={d.absent} onChange={(e) => setAbsent(s.id, e.target.checked)} />
                  </td>
                </tr>
              );
            })}
            {students.length === 0 && <tr><td colSpan={3} className="px-4 py-10 text-center text-slate-400">No active students in this class.</td></tr>}
          </tbody>
        </table>
      </div>
    </form>
  );
}
