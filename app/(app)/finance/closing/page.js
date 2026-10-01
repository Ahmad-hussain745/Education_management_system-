import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import CloseMonthForm from "./CloseMonthForm";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default async function MonthlyClosingPage() {
  const role = await requireRole(["Super Admin", "Accountant", "Principal"]);
  const canClose = ["Super Admin", "Accountant"].includes(role);
  const supabase = await createClient();

  const { data: closingsRaw } = await supabase
    .from("monthly_closing")
    .select("id, month, total_income, total_expenses, total_salary, net_income, closed_at, closed_by")
    .order("month", { ascending: false });

  const closerIds = [...new Set((closingsRaw || []).map((c) => c.closed_by).filter(Boolean))];
  const { data: closers } = closerIds.length
    ? await supabase.from("users").select("id, name").in("id", closerIds)
    : { data: [] };
  const closerName = Object.fromEntries((closers || []).map((u) => [u.id, u.name]));
  const closings = (closingsRaw || []).map((c) => ({ ...c, closerName: closerName[c.closed_by] || "—" }));

  const alreadyClosedMonths = new Set((closings || []).map((c) => c.month));

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div>
          <h1 className="text-xl font-semibold text-ink">Monthly Closing</h1>
          <p className="text-sm text-slate-500 mt-1">
            Freezes a month's income/expense/salary totals as a permanent snapshot. Once closed, that month's figures here never change again —
            corrections after closing still go through the normal reversal flow, they just won't retroactively edit a closed snapshot.
          </p>
        </div>
      </div>

      {canClose && (
        <div className="mt-4">
          <CloseMonthForm defaultMonth={currentMonthStr()} alreadyClosedMonths={[...alreadyClosedMonths]} />
        </div>
      )}
      {!canClose && (
        <p className="text-sm text-slate-400 mt-4">Closing a month is done by Super Admin or Accountant — you can review what's already closed below.</p>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-6">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Month</th>
              <th className="text-right px-4 py-3">Income</th>
              <th className="text-right px-4 py-3">Expenses</th>
              <th className="text-right px-4 py-3">Salary</th>
              <th className="text-right px-4 py-3">Net</th>
              <th className="text-left px-4 py-3">Closed By</th>
              <th className="text-left px-4 py-3">Closed On</th>
            </tr>
          </thead>
          <tbody>
            {(closings || []).map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-ink">{c.month?.slice(0, 7)}</td>
                <td className="px-4 py-3 text-right font-mono text-sage">{fmt(c.total_income)}</td>
                <td className="px-4 py-3 text-right font-mono text-brick">{fmt(c.total_expenses)}</td>
                <td className="px-4 py-3 text-right font-mono text-brick">{fmt(c.total_salary)}</td>
                <td className={`px-4 py-3 text-right font-mono font-semibold ${Number(c.net_income) >= 0 ? "text-sage" : "text-brick"}`}>{fmt(c.net_income)}</td>
                <td className="px-4 py-3 text-slate-600">{c.closerName}</td>
                <td className="px-4 py-3 text-slate-600">{new Date(c.closed_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {(!closings || closings.length === 0) && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No months closed yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
