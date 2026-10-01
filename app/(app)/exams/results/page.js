import { requireRole } from "@/lib/auth/guard";
import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import ResultActions from "./ResultActions";

export default async function ExamResultsPage(props) {
  const searchParams = await props.searchParams;
  await requireRole(["Super Admin", "Principal", "Accountant", "Teacher"]);
  const rc = await getRoleContext();
  const supabase = await createClient();

  const { data: exams } = await supabase.from("exams").select("id, name").order("created_at", { ascending: false });
  const examId = searchParams?.exam_id || "";

  let results = [];
  if (examId) {
    const { data } = await supabase
      .from("exam_results")
      .select("id, total_marks, total_max_marks, percentage, class_rank, status, published_at, student:students(name, class:classes(name), section:sections(name)), grade_rule:grade_rules(grade)")
      .eq("exam_id", examId)
      .order("percentage", { ascending: false });
    results = data || [];
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Results</h1>
      <p className="text-sm text-slate-500 mt-1">Calculate totals/percentage/grade from entered marks, then publish once ready — report cards only generate for a published result.</p>

      <form method="get" className="mt-6 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Exam</label>
          <select name="exam_id" defaultValue={examId} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-80">
            <option value="">— Select an exam —</option>
            {(exams || []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <button className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Load</button>
      </form>

      {examId && <ResultActions examId={examId} canApprove={!!rc?.canApprove} />}

      {examId && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Student</th>
                <th className="text-left px-4 py-3">Class</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-right px-4 py-3">Percentage</th>
                <th className="text-center px-4 py-3">Grade</th>
                <th className="text-center px-4 py-3">Rank</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-ink">{r.student?.name}</td>
                  <td className="px-4 py-3 text-slate-600">{r.student?.class?.name}{r.student?.section?.name ? `-${r.student.section.name}` : ""}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.total_marks} / {r.total_max_marks}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.percentage}%</td>
                  <td className="px-4 py-3 text-center font-medium">{r.grade_rule?.grade || "—"}</td>
                  <td className="px-4 py-3 text-center font-mono">{r.class_rank ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === "published" ? "bg-green-50 text-sage" : "bg-slate-100 text-slate-500"}`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
              {results.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No results yet — enter marks, then click Calculate Results.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
