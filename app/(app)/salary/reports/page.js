import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import { getRoleContext } from "@/lib/auth/roles";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

// Priority 5 — was one .limit(500) pull of individual salary_records rows,
// grouped by month/teacher in JS. Same reasoning as Fee Reports: both
// breakdowns are inherently small once aggregated, so this is a GROUP BY
// RPC (get_salary_by_month/by_teacher), not a paginated list.
export default async function SalaryReportsPage() {
  // Teacher is allowed here (their own salary_records rows only — RLS scopes
  // this by current_teacher_id(), this guard just decides who reaches the page).
  await requireRole(["Super Admin", "Accountant", "Principal", "Teacher"]);
  const supabase = await createClient();
  const rc = await getRoleContext();

  const [{ data: monthRows, error: monthError }, { data: teacherRows, error: teacherError }] = await Promise.all([
    supabase.rpc("get_salary_by_month", { p_institute_id: rc.instituteId, p_months: 12 }),
    supabase.rpc("get_salary_by_teacher", { p_institute_id: rc.instituteId }),
  ]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Salary Reports</h1>
      <p className="text-sm text-slate-500 mt-1">
        Aggregated in Postgres from salary_records — the same rows Payroll generates and locks.
      </p>

      <div className="grid md:grid-cols-2 gap-6 mt-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-sm font-semibold text-ink mb-3">By Month — last 12 months</div>
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-xs uppercase"><tr><th className="text-left py-1">Month</th><th className="text-right py-1">Gross</th><th className="text-right py-1">Paid</th></tr></thead>
            <tbody>
              {(monthRows || []).map((r) => (
                <tr key={r.month} className="border-t border-slate-100">
                  <td className="py-2">{r.month?.slice(0, 7)}</td>
                  <td className="py-2 text-right font-mono">{fmt(r.gross)}</td>
                  <td className="py-2 text-right font-mono">{fmt(r.paid)}</td>
                </tr>
              ))}
              {(!monthRows || monthRows.length === 0) && <tr><td colSpan={3} className="py-6 text-center text-slate-400">No payroll generated yet.</td></tr>}
            </tbody>
          </table>
          {monthError && <p className="text-xs text-brick mt-2">{monthError.message}</p>}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-sm font-semibold text-ink mb-3">By Teacher (all-time)</div>
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-xs uppercase"><tr><th className="text-left py-1">Teacher</th><th className="text-right py-1">Months</th><th className="text-right py-1">Gross</th><th className="text-right py-1">Paid</th></tr></thead>
            <tbody>
              {(teacherRows || []).map((r) => (
                <tr key={r.teacher_name} className="border-t border-slate-100">
                  <td className="py-2">{r.teacher_name}</td>
                  <td className="py-2 text-right font-mono">{r.months}</td>
                  <td className="py-2 text-right font-mono">{fmt(r.gross)}</td>
                  <td className="py-2 text-right font-mono">{fmt(r.paid)}</td>
                </tr>
              ))}
              {(!teacherRows || teacherRows.length === 0) && <tr><td colSpan={4} className="py-6 text-center text-slate-400">No payroll generated yet.</td></tr>}
            </tbody>
          </table>
          {teacherError && <p className="text-xs text-brick mt-2">{teacherError.message}</p>}
        </div>
      </div>
    </div>
  );
}
