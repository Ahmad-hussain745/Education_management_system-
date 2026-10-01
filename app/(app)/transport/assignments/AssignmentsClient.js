"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { assignStudent, unassignStudent } from "../actions";

const inputCls = "mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm";
const labelCls = "text-xs text-slate-600";

export default function AssignmentsClient({ routes, assignments, students, assignedIds }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [studentId, setStudentId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [stopId, setStopId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return students.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 15);
  }, [search, students]);

  const selectedStudent = students.find((s) => s.id === studentId);
  const selectedRoute = routes.find((r) => r.id === routeId);
  const alreadyAssigned = studentId && assignedIds.includes(studentId);

  async function submit() {
    if (!studentId || !routeId) { setError("Choose a student and a route."); return; }
    setPending(true); setError(null); setDone(false);
    try {
      const res = await assignStudent(studentId, routeId, stopId || null);
      if (res.error) setError(res.error);
      else { setDone(true); setStudentId(""); setSearch(""); setRouteId(""); setStopId(""); router.refresh(); }
    } finally { setPending(false); }
  }

  async function unassign(sid) {
    await unassignStudent(sid);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-ink mb-3">Assign a Student</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className={`${labelCls} relative`}>
            Student
            <input value={selectedStudent ? selectedStudent.name : search} onChange={(e) => { setSearch(e.target.value); setStudentId(""); }} placeholder="Type a name…" className={inputCls} />
            {search && !studentId && filtered.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-sm max-h-48 overflow-y-auto">
                {filtered.map((s) => (
                  <button key={s.id} onClick={() => { setStudentId(s.id); setSearch(""); }} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50">
                    {s.name} <span className="text-xs text-slate-400">{s.class?.name}</span>{assignedIds.includes(s.id) ? <span className="text-xs text-amber-700"> · already assigned</span> : ""}
                  </button>
                ))}
              </div>
            )}
          </label>
          <label className={labelCls}>Route
            <select value={routeId} onChange={(e) => { setRouteId(e.target.value); setStopId(""); }} className={inputCls}>
              <option value="">Choose…</option>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          {selectedRoute?.stops?.length > 0 && (
            <label className={labelCls}>Stop (optional)
              <select value={stopId} onChange={(e) => setStopId(e.target.value)} className={inputCls}>
                <option value="">—</option>
                {[...selectedRoute.stops].sort((a, b) => a.sequence_order - b.sequence_order).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}
        </div>
        {alreadyAssigned && <p className="text-xs text-amber-700 mt-2">This student already has an active assignment — submitting will move them to this route/stop.</p>}
        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">{error}</div>}
        {done && <div className="text-sm text-sage bg-sage/10 border border-sage/30 rounded-lg px-3 py-2 mt-2">Assigned.</div>}
        <button onClick={submit} disabled={pending || !studentId || !routeId} className="mt-3 bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
          {pending ? "Saving…" : alreadyAssigned ? "Reassign" : "Assign"}
        </button>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink mb-2">Active Assignments ({assignments.length})</h2>
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {assignments.length === 0 ? (
            <p className="text-sm text-slate-400 p-4">No students assigned yet.</p>
          ) : (
            assignments.map((a) => (
              <div key={a.id} className="p-3 flex items-center justify-between text-sm">
                <span className="text-ink">{a.student?.name} <span className="text-xs text-slate-400">{a.student?.class?.name} · {a.route?.name}</span></span>
                <button onClick={() => unassign(a.student_id)} className="text-xs text-slate-400 hover:text-brick">Unassign</button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
