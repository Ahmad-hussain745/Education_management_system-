import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import ReportFilterBar from "@/components/reports/ReportFilterBar";
import ReportToolbar from "@/components/reports/ReportToolbar";

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

export default async function AttendanceReportPage(props) {
  const searchParams = await props.searchParams;
  await requireRole(["Super Admin", "Principal", "Accountant"]);
  const supabase = await createClient();

  const month = searchParams?.month || currentMonthStr();
  const monthEnd = nextMonthStr(month);
  const classId = searchParams?.class_id || "";
  const sectionId = searchParams?.section_id || "";
  const teacherId = searchParams?.teacher_id || "";

  const [{ data: classes }, { data: sections }, { data: teachers }] = await Promise.all([
    supabase.from("classes").select("id, name").order("sort_order"),
    supabase.from("sections").select("id, name, class_id").order("name"),
    supabase.from("teachers").select("id, name").order("name"),
  ]);

  let studentQuery = supabase
    .from("student_attendance")
    .select("student_id, status, student:students(name, class_id, section_id, class:classes(name), section:sections(name))")
    .gte("date", month).lt("date", monthEnd).is("subject_id", null);
  if (classId) studentQuery = studentQuery.eq("class_id", classId);
  if (sectionId) studentQuery = studentQuery.eq("section_id", sectionId);

  let teacherQuery = supabase
    .from("teacher_attendance")
    .select("teacher_id, status, teacher:teachers(name)")
    .gte("date", month).lt("date", monthEnd);
  if (teacherId) teacherQuery = teacherQuery.eq("teacher_id", teacherId);

  const [{ data: studentRows }, { data: teacherRows }] = await Promise.all([studentQuery, teacherQuery]);

  const byStudent = new Map();
  (studentRows || []).forEach((r) => {
    const key = r.student_id;
    if (!byStudent.has(key)) byStudent.set(key, { name: r.student?.name, class: r.student?.class?.name, section: r.student?.section?.name, present: 0, absent: 0, late: 0, leave: 0 });
    if (STATUS_KEYS.includes(r.status)) byStudent.get(key)[r.status] += 1;
  });
  const studentSummary = [...byStudent.values()].map((s) => ({ ...s, total: s.present + s.absent + s.late + s.leave, attendancePct: pct(s.present, s.present + s.absent + s.late + s.leave) }));

  const byTeacher = new Map();
  (teacherRows || []).forEach((r) => {
    const key = r.teacher_id;
    if (!byTeacher.has(key)) byTeacher.set(key, { name: r.teacher?.name, present: 0, absent: 0, late: 0, leave: 0 });
    if (STATUS_KEYS.includes(r.status)) byTeacher.get(key)[r.status] += 1;
  });
  const teacherSummary = [...byTeacher.values()].map((t) => ({ ...t, workingDays: t.present + t.absent + t.late + t.leave, attendancePct: pct(t.present, t.present + t.absent + t.late + t.leave) }));

  const csvRows = [
    ...studentSummary.map((s) => ({ type: "Student", name: s.name, class: s.class, section: s.section || "", present: s.present, absent: s.absent, late: s.late, leave: s.leave, pct: s.attendancePct })),
    ...teacherSummary.map((t) => ({ type: "Teacher", name: t.name, class: "", section: "", present: t.present, absent: t.absent, late: t.late, leave: t.leave, pct: t.attendancePct })),
  ];
  const csvColumns = [
    { key: "type", label: "Type" }, { key: "name", label: "Name" }, { key: "class", label: "Class" }, { key: "section", label: "Section" },
    { key: "present", label: "Present" }, { key: "absent", label: "Absent" }, { key: "late", label: "Late" }, { key: "leave", label: "Leave" }, { key: "pct", label: "Attendance %" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Attendance Report</h1>
          <p className="text-sm text-slate-500 mt-1">Present / Absent / Late / Leave, summed from the registers for the selected month.</p>
        </div>
        <ReportToolbar rows={csvRows} columns={csvColumns} filename={`attendance-${month.slice(0, 7)}`} />
      </div>

      <ReportFilterBar
        fields={["month", "class", "section", "teacher"]}
        values={{ month, class_id: classId, section_id: sectionId, teacher_id: teacherId }}
        classes={classes} sections={sections} teachers={teachers}
      />

      <div className="text-sm font-semibold text-ink mb-2">Students</div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Student</th>
              <th className="text-left px-4 py-3">Class</th>
              <th className="text-right px-4 py-3">Present</th>
              <th className="text-right px-4 py-3">Absent</th>
              <th className="text-right px-4 py-3">Late</th>
              <th className="text-right px-4 py-3">Leave</th>
              <th className="text-right px-4 py-3">Attendance %</th>
            </tr>
          </thead>
          <tbody>
            {studentSummary.map((s, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-ink">{s.name}</td>
                <td className="px-4 py-3 text-slate-600">{s.class}{s.section ? ` — ${s.section}` : ""}</td>
                <td className="px-4 py-3 text-right font-mono">{s.present}</td>
                <td className="px-4 py-3 text-right font-mono">{s.absent}</td>
                <td className="px-4 py-3 text-right font-mono">{s.late}</td>
                <td className="px-4 py-3 text-right font-mono">{s.leave}</td>
                <td className="px-4 py-3 text-right font-mono font-medium">{s.attendancePct}%</td>
              </tr>
            ))}
            {studentSummary.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No student attendance marked for this filter.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="text-sm font-semibold text-ink mb-2">Teachers</div>
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
            {teacherSummary.map((t, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-ink">{t.name}</td>
                <td className="px-4 py-3 text-right font-mono">{t.workingDays}</td>
                <td className="px-4 py-3 text-right font-mono">{t.present}</td>
                <td className="px-4 py-3 text-right font-mono">{t.absent}</td>
                <td className="px-4 py-3 text-right font-mono">{t.late}</td>
                <td className="px-4 py-3 text-right font-mono">{t.leave}</td>
                <td className="px-4 py-3 text-right font-mono font-medium">{t.attendancePct}%</td>
              </tr>
            ))}
            {teacherSummary.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No teacher attendance marked for this filter.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
