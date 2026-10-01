import { createClient } from "@/lib/supabase/server";

function fmtRs(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

// Teacher — "Attendance, Syllabus, Marks, Own salary" (Phase 25). Like
// CashierView, no job table — a Teacher doesn't administer automation,
// they want to know: did I mark attendance today, how far along is my
// syllabus, do I have marks to enter, and what does my own slip say.
// teacher_dashboard_summary() (0055) answers the first three in one round
// trip; salary is its own query since it needs the actual record, not
// just a count.
export default async function TeacherView({ roleContext }) {
  const teacherId = roleContext.teacherId;
  const supabase = await createClient();

  if (!teacherId) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-ink">Automation</h1>
        <p className="text-sm text-slate-500 mt-1">
          Your account isn't linked to a teacher profile yet — ask a Super Admin to link it from Settings → Users.
        </p>
      </div>
    );
  }

  const [{ data: summary, error: summaryError }, { data: latestSlip }] = await Promise.all([
    supabase.rpc("teacher_dashboard_summary", { p_teacher_id: teacherId }).maybeSingle(),
    supabase
      .from("salary_records")
      .select("id, month, gross_salary, status, locked")
      .eq("teacher_id", teacherId)
      .order("month", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const s = summary || {};
  const attendanceDone = s.classes_assigned > 0 && s.classes_attendance_marked_today >= s.classes_assigned;
  const syllabusPct = s.syllabus_topics_total > 0 ? Math.round((s.syllabus_topics_completed / s.syllabus_topics_total) * 100) : null;

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">My Teaching</h1>
      <p className="text-sm text-slate-500 mt-1">Attendance, syllabus progress, marks, and your own salary — just yours.</p>
      {summaryError && <p className="text-sm text-brick mt-3">{summaryError.message}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
        <a href="/attendance/students" className="bg-white rounded-xl border border-slate-200 p-4 block hover:border-royal transition-colors">
          <div className="text-xs text-slate-400">Attendance — today</div>
          {s.classes_assigned > 0 ? (
            <div className={`text-lg font-semibold mt-1 ${attendanceDone ? "text-emerald-700" : "text-amber-600"}`}>
              {attendanceDone ? "✅ Marked" : `${s.classes_attendance_marked_today || 0} of ${s.classes_assigned} classes marked`}
            </div>
          ) : (
            <div className="text-sm text-slate-500 mt-1">No classes assigned</div>
          )}
          <div className="text-xs text-royal mt-2">Open register →</div>
        </a>

        <a href="/syllabus/progress" className="bg-white rounded-xl border border-slate-200 p-4 block hover:border-royal transition-colors">
          <div className="text-xs text-slate-400">Syllabus progress</div>
          <div className="text-lg font-semibold text-ink mt-1">
            {syllabusPct === null ? "No topics yet" : `${syllabusPct}% (${s.syllabus_topics_completed}/${s.syllabus_topics_total})`}
          </div>
          <div className="text-xs text-royal mt-2">Update progress →</div>
        </a>

        <a href="/exams/marks" className="bg-white rounded-xl border border-slate-200 p-4 block hover:border-royal transition-colors">
          <div className="text-xs text-slate-400">Marks entry</div>
          <div className="text-lg font-semibold text-ink mt-1">
            {s.exam_subjects_assigned > 0
              ? `${s.exam_subjects_assigned} exam subject${s.exam_subjects_assigned === 1 ? "" : "s"} assigned`
              : "Nothing assigned"}
          </div>
          <div className="text-xs text-royal mt-2">Enter marks →</div>
        </a>

        {latestSlip ? (
          <a href={`/salary/payroll/${latestSlip.id}`} className="bg-white rounded-xl border border-slate-200 p-4 block hover:border-royal transition-colors">
            <div className="text-xs text-slate-400">
              Salary — {new Date(latestSlip.month).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </div>
            <div className="text-lg font-semibold text-ink mt-1">{fmtRs(latestSlip.gross_salary)}</div>
            <div className="text-xs mt-1">
              {latestSlip.locked ? (
                <span className="text-emerald-700">Approved & locked</span>
              ) : (
                <span className="text-amber-600">⚠ Draft — awaiting approval, not yet final</span>
              )}
            </div>
          </a>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="text-xs text-slate-400">Salary</div>
            <div className="text-sm text-slate-500 mt-1">No salary record yet</div>
          </div>
        )}
      </div>
    </div>
  );
}
