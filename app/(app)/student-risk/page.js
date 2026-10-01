import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { DIMENSION_LABELS, describeDimension, dedupeActions } from "@/lib/student-risk/format";

// Super Admin/Principal only — this is the one place Financial
// (fee arrears) gets combined with Attendance/Academic/Engagement, so it
// sits at the same role tier as Fee Reports, not Teacher Copilot's own
// (class-scoped, no financial data) risk_signals tool.
export default async function StudentRiskPage() {
  await requireRole(["Super Admin", "Principal"]);
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_student_risk_signals", { p_class_id: null });
  const rows = data || [];

  const counts = { academic: 0, attendance: 0, financial: 0, engagement: 0 };
  for (const r of rows) {
    if (r.academic_signal) counts.academic++;
    if (r.attendance_signal) counts.attendance++;
    if (r.financial_signal) counts.financial++;
    if (r.engagement_signal) counts.engagement++;
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Student Risk &amp; Early Warning</h1>

      <div className="mt-3 bg-royal/5 border border-royal/20 rounded-xl px-4 py-3 text-sm text-ink">
        <strong>These are signals from the data, not conclusions about a student.</strong> Each one is a
        plain, checkable number — attendance, exam results, fee records, syllabus pace, or a teacher's own
        note — not a judgment this app has made. Please review the underlying record before deciding on any
        next step; nothing here is sent or acted on automatically.
      </div>

      {error && <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error.message}</div>}

      {!error && (
        <>
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(DIMENSION_LABELS).map(([key, label]) => (
              <div key={key} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="text-2xl font-semibold text-ink mt-1">{counts[key]}</div>
                <div className="text-xs text-slate-400 mt-0.5">student{counts[key] === 1 ? "" : "s"} flagged</div>
              </div>
            ))}
          </div>

          <p className="text-sm text-slate-500 mt-6">
            {rows.length === 0
              ? "No students currently show a signal on any of the four dimensions."
              : `${rows.length} student${rows.length === 1 ? "" : "s"} showing at least one signal, most-flagged first.`}
          </p>

          <div className="mt-3 space-y-3">
            {rows.map((r) => {
              const actions = dedupeActions([
                ...(r.recommended_actions || []),
              ]);
              return (
                <div key={r.student_id} className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-ink">{r.student_name}</div>
                      <div className="text-xs text-slate-500">{r.class_name}{r.section_name ? ` — ${r.section_name}` : ""}</div>
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-4 gap-3 mt-3">
                    {Object.entries(DIMENSION_LABELS).map(([key, label]) => {
                      const d = describeDimension(key, r);
                      return (
                        <div key={key} className={`rounded-lg border px-3 py-2 ${d.flagged ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-slate-50"}`}>
                          <div className={`text-xs font-medium ${d.flagged ? "text-amber-700" : "text-slate-400"}`}>{label}</div>
                          <div className={`text-xs mt-0.5 ${d.flagged ? "text-amber-800" : "text-slate-500"}`}>{d.text}</div>
                        </div>
                      );
                    })}
                  </div>

                  {actions.length > 0 && (
                    <div className="mt-3 text-xs text-slate-600">
                      <span className="font-medium text-ink">Suggested next steps: </span>
                      {actions.join(" · ")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
