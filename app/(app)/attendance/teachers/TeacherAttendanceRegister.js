"use client";

import { useState, useRef } from "react";
import { saveTeacherAttendance } from "./actions";

const STATUSES = [
  { key: "present", label: "Present" },
  { key: "absent", label: "Absent" },
  { key: "late", label: "Late" },
  { key: "leave", label: "Leave" },
];

export default function TeacherAttendanceRegister({ teachers, existingByTeacherId, date }) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState(() => {
    const initial = {};
    for (const t of teachers) {
      const existing = existingByTeacherId[t.id];
      initial[t.id] = {
        status: existing?.status || "",
        check_in: existing?.check_in?.slice(0, 5) || "",
        check_out: existing?.check_out?.slice(0, 5) || "",
      };
    }
    return initial;
  });
  const formRef = useRef(null);

  const setStatus = (teacherId, status) =>
    setDraft((prev) => ({ ...prev, [teacherId]: { ...prev[teacherId], status } }));
  const setTime = (teacherId, field, value) =>
    setDraft((prev) => ({ ...prev, [teacherId]: { ...prev[teacherId], [field]: value } }));
  const markAllPresent = () =>
    setDraft((prev) => {
      const next = { ...prev };
      for (const t of teachers) next[t.id] = { ...next[t.id], status: "present" };
      return next;
    });

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    setMessage("");
    const res = await saveTeacherAttendance(formData);
    setPending(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    setMessage(`Saved attendance for ${res.count} teacher${res.count === 1 ? "" : "s"}.`);
  };

  if (teachers.length === 0) {
    return <p className="text-sm text-slate-400 py-10 text-center">No active teachers on record yet.</p>;
  }

  return (
    <form ref={formRef} action={handleSubmit}>
      <input type="hidden" name="date" value={date} />

      <div className="flex justify-end mb-3">
        <button
          type="button"
          onClick={markAllPresent}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
        >
          Mark All Present
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Teacher</th>
              {STATUSES.map((s) => (
                <th key={s.key} className="text-center px-3 py-3">{s.label}</th>
              ))}
              <th className="text-center px-3 py-3">Check In</th>
              <th className="text-center px-3 py-3">Check Out</th>
            </tr>
          </thead>
          <tbody>
            {teachers.map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-ink">
                  {t.name}
                  {t.subject?.name && <div className="text-xs text-slate-400 font-normal">{t.subject.name}</div>}
                </td>
                {STATUSES.map((s) => (
                  <td key={s.key} className="text-center px-3 py-3">
                    <input
                      type="radio"
                      name={`status_${t.id}`}
                      value={s.key}
                      checked={draft[t.id]?.status === s.key}
                      onChange={() => setStatus(t.id, s.key)}
                    />
                  </td>
                ))}
                <td className="text-center px-2 py-3">
                  <input
                    type="time"
                    name={`checkin_${t.id}`}
                    value={draft[t.id]?.check_in || ""}
                    onChange={(e) => setTime(t.id, "check_in", e.target.value)}
                    className="border border-slate-300 rounded-lg px-2 py-1 text-xs"
                  />
                </td>
                <td className="text-center px-2 py-3">
                  <input
                    type="time"
                    name={`checkout_${t.id}`}
                    value={draft[t.id]?.check_out || ""}
                    onChange={(e) => setTime(t.id, "check_out", e.target.value)}
                    className="border border-slate-300 rounded-lg px-2 py-1 text-xs"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <p className="text-sm text-brick mt-3">{error}</p>}
      {message && <p className="text-sm text-sage mt-3">{message}</p>}

      <div className="mt-4">
        <button type="submit" disabled={pending} className="text-sm px-4 py-2 rounded-lg bg-royal text-white disabled:opacity-60">
          {pending ? "Saving…" : "Save Attendance"}
        </button>
      </div>
    </form>
  );
}
