import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import ReportFilterBar from "@/components/reports/ReportFilterBar";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

export default async function SalarySlipsPage(props) {
  const searchParams = await props.searchParams;
  const role = await requireRole(["Super Admin", "Accountant", "Principal", "Teacher"]);
  const supabase = await createClient();
  const teacherId = searchParams?.teacher_id || "";

  // RLS ("teacher and principal view salary" in 0002_rls.sql) already scopes
  // a Teacher login to only their own rows here — no extra filtering needed
  // for that case, but the Teacher picker below is still hidden for them
  // since it would just always show one option.
  const { data: teachers } = role === "Teacher"
    ? { data: [] }
    : await supabase.from("teachers").select("id, name").eq("status", "active").order("name");

  let query = supabase
    .from("salary_records")
    .select("id, month, gross_salary, paid_total, status, locked, teacher:teachers(name)")
    .order("month", { ascending: false });
  if (teacherId) query = query.eq("teacher_id", teacherId);
  const { data: records } = await query;

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold text-ink">Salary Slips</h1>
        <p className="text-sm text-slate-500 mt-1">Every generated payroll record — open any of them for the full slip, Print or PDF.</p>
      </div>

      {role !== "Teacher" && (
        <ReportFilterBar fields={["teacher"]} values={{ teacher_id: teacherId }} teachers={teachers} />
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-6">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Teacher</th>
              <th className="text-left px-4 py-3">Month</th>
              <th className="text-right px-4 py-3">Gross Salary</th>
              <th className="text-right px-4 py-3">Paid</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(records || []).map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-ink">{r.teacher?.name}</td>
                <td className="px-4 py-3 text-slate-600">{r.month?.slice(0, 7)}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(r.gross_salary)}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(r.paid_total)}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === "paid" ? "bg-green-50 text-sage" : "bg-slate-100 text-slate-500"}`}>
                    {r.status}{r.locked ? " · locked" : ""}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/salary/payroll/${r.id}`} className="text-xs font-medium text-royal hover:underline">View Slip</Link>
                </td>
              </tr>
            ))}
            {(!records || records.length === 0) && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No payroll generated yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
