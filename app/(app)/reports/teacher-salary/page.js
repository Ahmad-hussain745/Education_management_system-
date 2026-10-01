import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import { getRoleContext } from "@/lib/auth/roles";
import ReportFilterBar from "@/components/reports/ReportFilterBar";
import ReportToolbar from "@/components/reports/ReportToolbar";
import AnimatedValue from "@/components/AnimatedValue";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default async function TeacherSalaryReportPage(props) {
  const searchParams = await props.searchParams;
  // salary_records' own RLS scopes a Teacher's SELECT to their own row —
  // admitting Teacher here just means they see themselves, same as
  // /salary/payroll's "My Salary" mode.
  await requireRole(["Super Admin", "Principal", "Accountant", "Teacher"]);
  const rc = await getRoleContext();
  const supabase = await createClient();

  const month = searchParams?.month || currentMonthStr();
  const teacherId = searchParams?.teacher_id || "";

  const { data: teachers } = rc?.isTeacher ? { data: null } : await supabase.from("teachers").select("id, name").order("name");

  let query = supabase
    .from("salary_records")
    .select("id, month, base_salary, percentage_total, adjustments_total, gross_salary, paid_total, status, teacher:teachers(name)")
    .eq("month", month)
    .order("created_at");
  if (teacherId) query = query.eq("teacher_id", teacherId);
  const { data: rows } = await query;

  const totals = (rows || []).reduce((a, r) => ({ gross: a.gross + Number(r.gross_salary), paid: a.paid + Number(r.paid_total) }), { gross: 0, paid: 0 });

  const csvRows = (rows || []).map((r) => ({
    teacher: r.teacher?.name, month: r.month?.slice(0, 7), base: r.base_salary, percentage: r.percentage_total,
    adjustments: r.adjustments_total, gross: r.gross_salary, paid: r.paid_total, status: r.status,
  }));
  const csvColumns = [
    { key: "teacher", label: "Teacher" }, { key: "month", label: "Month" }, { key: "base", label: "Base" },
    { key: "percentage", label: "Percentage Share" }, { key: "adjustments", label: "Adjustments" },
    { key: "gross", label: "Gross" }, { key: "paid", label: "Paid" }, { key: "status", label: "Status" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Teacher Salary Report</h1>
          <p className="text-sm text-slate-500 mt-1">
            {rc?.isTeacher ? "Your salary for the selected month." : "Every teacher's calculated salary for the selected month."}
          </p>
        </div>
        <ReportToolbar rows={csvRows} columns={csvColumns} filename={`teacher-salary-${month.slice(0, 7)}`} />
      </div>

      <ReportFilterBar
        fields={rc?.isTeacher ? ["month"] : ["month", "teacher"]}
        values={{ month, teacher_id: teacherId }}
        teachers={teachers}
      />

      {!rc?.isTeacher && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Total Gross</div>
            <div className="text-lg font-semibold font-mono"><AnimatedValue value={fmt(totals.gross)} /></div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Total Paid</div>
            <div className="text-lg font-semibold font-mono text-sage"><AnimatedValue value={fmt(totals.paid)} /></div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Teacher</th>
              <th className="text-right px-4 py-3">Base</th>
              <th className="text-right px-4 py-3">Percentage</th>
              <th className="text-right px-4 py-3">Gross</th>
              <th className="text-right px-4 py-3">Paid</th>
              <th className="text-left px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-ink">{r.teacher?.name}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(r.base_salary)}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(r.percentage_total)}</td>
                <td className="px-4 py-3 text-right font-mono font-medium">{fmt(r.gross_salary)}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(r.paid_total)}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === "paid" ? "bg-green-50 text-sage" : r.status === "partial" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{r.status}</span>
                </td>
              </tr>
            ))}
            {(!rows || rows.length === 0) && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No payroll generated for this month yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
