"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeConnectivity } from "@/lib/offline/connectivity";
import { attendanceRepository } from "@/lib/repositories/attendanceRepository";

const STATUSES = [
  { key: "present", label: "Present" },
  { key: "absent", label: "Absent" },
  { key: "late", label: "Late" },
  { key: "leave", label: "Leave" },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function shiftDate(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Everything here is React state, not URL search params — picking a
// different class, section, or date never triggers a page navigation, so
// there's nothing for a service worker to fail to have cached. See
// page.js's comment for why that distinction is the whole point of this
// rewrite.
export default function AttendanceRegisterApp({ instituteId, teacherId, isTeacherOnly, markedByUserId }) {
  const supabase = useMemo(() => createClient(), []);
  const [online, setOnline] = useState(true);
  useEffect(() => subscribeConnectivity(setOnline), []);

  const [date, setDate] = useState(todayStr());
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState("");
  const [sections, setSections] = useState([]);
  const [sectionId, setSectionId] = useState("");

  const [students, setStudents] = useState([]);
  const [draft, setDraft] = useState({});
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingRegister, setLoadingRegister] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  // Classes list — reloads on reconnect too, since a device that opened
  // this page offline with a stale/empty cache should pick up the real
  // list the moment it can.
  useEffect(() => {
    if (!instituteId) return;
    let cancelled = false;
    setLoadingClasses(true);
    attendanceRepository
      .getClasses(supabase, { instituteId, teacherId, isTeacherOnly })
      .then((rows) => { if (!cancelled) setClasses(rows); })
      .catch((err) => { if (!cancelled) setError(err.message || String(err)); })
      .finally(() => { if (!cancelled) setLoadingClasses(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instituteId, teacherId, isTeacherOnly, online]);

  useEffect(() => {
    setSectionId("");
    if (!classId) { setSections([]); return; }
    let cancelled = false;
    attendanceRepository
      .getSections(supabase, { instituteId, classId })
      .then((rows) => { if (!cancelled) setSections(rows); })
      .catch(() => { if (!cancelled) setSections([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, instituteId]);

  const loadRegister = useCallback(() => {
    if (!classId) return;
    setLoadingRegister(true);
    setError("");
    setMessage("");
    attendanceRepository
      .getRegister(supabase, { instituteId, classId, sectionId, date })
      .then(({ students: rows, existingByStudentId }) => {
        setStudents(rows);
        const initial = {};
        for (const s of rows) initial[s.id] = existingByStudentId[s.id]?.status || "";
        setDraft(initial);
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setLoadingRegister(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, sectionId, date, instituteId]);

  useEffect(() => { loadRegister(); }, [loadRegister]);

  const setStatus = (studentId, status) => setDraft((prev) => ({ ...prev, [studentId]: status }));
  const markAllPresent = () => {
    const next = {};
    for (const s of students) next[s.id] = "present";
    setDraft(next);
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    const entries = students.filter((s) => draft[s.id]).map((s) => ({ studentId: s.id, status: draft[s.id] }));
    if (entries.length === 0) {
      setSaving(false);
      setError("Mark at least one student's status before saving.");
      return;
    }
    try {
      const res = await attendanceRepository.save({ instituteId, date, classId, sectionId, markedBy: markedByUserId, entries });
      if (res.mode === "offline") {
        setMessage(`🟠 Saved locally — ${res.count} student${res.count === 1 ? "" : "s"}. Syncs automatically once you're back online.`);
      } else {
        setMessage(`Saved attendance for ${res.count} student${res.count === 1 ? "" : "s"}.`);
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Student Attendance</h1>
          <p className="text-sm text-slate-500 mt-1">Pick a class, mark the register, save.</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setDate(shiftDate(date, -1))} className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">← Prev</button>
          <input
            type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm"
          />
          <button onClick={() => setDate(todayStr())} className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Today</button>
          <button onClick={() => setDate(shiftDate(date, 1))} className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Next →</button>
        </div>
      </div>

      {!online && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm font-medium mb-4">
          🟠 Offline — the class/section list and roster below are from this device's last sync.
          Saving queues each mark locally and syncs automatically once you're back online.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          disabled={loadingClasses}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm disabled:bg-slate-50"
        >
          <option value="">{loadingClasses ? "Loading classes…" : "Select a class…"}</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {classId && (
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All sections</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      {!classId && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm">
          {loadingClasses
            ? "Loading classes…"
            : classes.length === 0
              ? (isTeacherOnly ? "No classes are assigned to you yet." : "No classes found.")
              : "Select a class above to load its register."}
        </div>
      )}

      {classId && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={markAllPresent} className="text-sm px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
              Mark All Present
            </button>
            <button
              type="button" onClick={handleSave} disabled={saving || loadingRegister}
              className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
            >
              {saving ? "Saving…" : online ? "Save Attendance" : "Save Locally (Offline)"}
            </button>
          </div>

          {error && <p className="text-sm text-brick mb-2">{error}</p>}
          {message && <p className="text-sm text-sage mb-2">{message}</p>}

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Student</th>
                  {STATUSES.map((s) => <th key={s.key} className="text-center px-2 py-3">{s.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {loadingRegister && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Loading register…</td></tr>
                )}
                {!loadingRegister && students.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-ink">{s.name}</td>
                    {STATUSES.map((st) => (
                      <td key={st.key} className="text-center px-2 py-3">
                        <input
                          type="radio" name={`radio_${s.id}`} checked={draft[s.id] === st.key}
                          onChange={() => setStatus(s.id, st.key)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
                {!loadingRegister && students.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No students in this class/section.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
