import { createClient } from "@/lib/supabase/server";
import MonthClassPicker from "./MonthClassPicker";

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function nextMonthStr(month) {
  const d = new Date(month + "T00:00:00");
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}
function pct(present, total) {
  return total > 0 ? ((present / total) * 100).toFixed(1) : "0.0";
}

const STATUS_KEYS = ["present", "absent", "late", "leave"];

export default async function AttendanceReportsPage(props) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const month = searchParams?.month || currentMonthStr();
  const monthEnd = nextMonthStr(month);
  const classId = searchParams?.class_id || "";

  const [{ data: classes }, { data: studentRows }, { data: teacherRows }] = await Promise.all([
    supabase.from("classes").select("id, name").order("sort_order"),
    // subject_id is null because Student Attendance's register always marks
    // whole-day, whole-class attendance (see attendance/students/actions.js)
    // — filtering it keeps this report matching exactly what the register
    // actually produces, not a hypothetical per-subject scheme.
    (() => {
      let q = supabase
        .from("student_attendance")
        .select("student_id, status, student:students(name, class:classes(name), class_id)")
        .gte("date", month).lt("date", monthEnd).is("subject_id", null);
      if (classId) q = q.eq("class_id", classId);
      return q;
    })(),
    supabase
      .from("teacher_attendance")
      .select("teacher_id, status, teacher:teachers(name)")
      .gte("date", month).lt("date", monthEnd),
  ]);

  const summarize = (rows, idKey) => {
    const byId = new Map();
    (rows || []).forEach((r) => {
      const id = r[idKey];
      if (!byId.has(id)) byId.set(id, { present: 0, absent: 0, late: 0, leave: 0, ref: r });
      const entry = byId.get(id);
      if (STATUS_KEYS.includes(r.status)) entry[r.status] += 1;
    });
    return byId;
  };

  const studentSummary = summarize(studentRows, "student_id");
  const teacherSummary = summarize(teacherRows, "teacher_id");

  const studentReport = [...studentSummary.entries()].map(([id, s]) => {
    const total = s.present + s.absent + s.late + s.leave;
    return { id, name: s.ref.student?.name, className: s.ref.student?.class?.name, ...s, total, attendancePct: pct(s.present, total) };
  }).sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const teacherReport = [...teacherSummary.entries()].map(([id, s]) => {
    const workingDays = s.present + s.absent + s.late + s.leave;
    return { id, name: s.ref.teacher?.name, ...s, workingDays, attendancePct: pct(s.present, workingDays) };
  }).sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Attendance Reports</h1>
      <p className="text-sm text-slate-500 mt-1">
        Summed straight from the registers already marked in Student Attendance and Teacher Attendance —
        nothing here is entered separately.
      </p>

      <MonthClassPicker month={month} classId={classId} classes={classes} kind="student" />

      <div className="text-sm font-semibold text-ink mb-2">Student Attendance — {month.slice(0, 7)}</div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Student</th>
              <th className="text-left px-4 py-3">Class</th>
              <th className="text-left px-4 py-3">Month</th>
              <th className="text-right px-4 py-3">Present</th>
              <th className="text-right px-4 py-3">Absent</th>
              <th className="text-right px-4 py-3">Late</th>
              <th className="text-right px-4 py-3">Leave</th>
              <th className="text-right px-4 py-3">Attendance %</th>
            </tr>
          </thead>
          <tbody>
            {studentReport.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-ink">{r.name}</td>
                <td className="px-4 py-3 text-slate-600">{r.className || "—"}</td>
                <td className="px-4 py-3 text-slate-600">{month.slice(0, 7)}</td>
                <td className="px-4 py-3 text-right font-mono">{r.present}</td>
                <td className="px-4 py-3 text-right font-mono">{r.absent}</td>
                <td className="px-4 py-3 text-right font-mono">{r.late}</td>
                <td className="px-4 py-3 text-right font-mono">{r.leave}</td>
                <td className="px-4 py-3 text-right font-mono font-medium">{r.attendancePct}%</td>
              </tr>
            ))}
            {studentReport.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No student attendance marked for this month{classId ? " in this class" : ""} yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-sm font-semibold text-ink mb-2">Teacher Attendance — {month.slice(0, 7)}</div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Teacher</th>
              <th className="text-right px-4 py-3">Working Days</th>
              <th className="text-right px-4 py-3">Present</th>
              <th className="text-right px-4 py-3">Absent</th>
              <th className="text-right px-4 py-3">Late</th>
              <th className="text-right px-4 py-3">Leave</th>
              <th className="text-right px-4 py-3">Attendance %</th>
            </tr>
          </thead>
          <tbody>
            {teacherReport.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-ink">{r.name}</td>
                <td className="px-4 py-3 text-right font-mono">{r.workingDays}</td>
                <td className="px-4 py-3 text-right font-mono">{r.present}</td>
                <td className="px-4 py-3 text-right font-mono">{r.absent}</td>
                <td className="px-4 py-3 text-right font-mono">{r.late}</td>
                <td className="px-4 py-3 text-right font-mono">{r.leave}</td>
                <td className="px-4 py-3 text-right font-mono font-medium">{r.attendancePct}%</td>
              </tr>
            ))}
            {teacherReport.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No teacher attendance marked for this month yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
