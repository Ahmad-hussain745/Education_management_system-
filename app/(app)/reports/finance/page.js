import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
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
function nextMonthStr(month) {
  const d = new Date(month + "T00:00:00");
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}
const TYPE_LABEL = { fee_payment: "Fee Payment", income: "Other Income", expense: "Expense", salary_payment: "Salary Payment" };

export default async function FinanceReportPage(props) {
  const searchParams = await props.searchParams;
  await requireRole(["Super Admin", "Principal", "Accountant"]);
  const supabase = await createClient();

  const month = searchParams?.month || currentMonthStr();
  const monthEnd = nextMonthStr(month);

  const { data: txns } = await supabase
    .from("transactions")
    .select("id, type, direction, amount, txn_date, description, account:accounts(name)")
    .gte("txn_date", month).lt("txn_date", monthEnd)
    .order("txn_date", { ascending: false })
    .limit(1000);

  const rows = txns || [];
  const sumOf = (type) => rows.filter((t) => t.type === type).reduce((a, t) => a + Number(t.amount), 0);
  const studentFeeIncome = sumOf("fee_payment");
  const otherIncome = sumOf("income");
  const teacherSalary = sumOf("salary_payment");
  const otherExpenses = sumOf("expense");
  const totalIncome = studentFeeIncome + otherIncome;
  const totalOutflow = teacherSalary + otherExpenses;

  const csvRows = rows.map((t) => ({ date: t.txn_date, type: TYPE_LABEL[t.type] || t.type, account: t.account?.name, description: t.description || "", direction: t.direction, amount: t.amount }));
  const csvColumns = [
    { key: "date", label: "Date" }, { key: "type", label: "Type" }, { key: "account", label: "Account" },
    { key: "description", label: "Description" }, { key: "direction", label: "Direction" }, { key: "amount", label: "Amount" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Finance Report</h1>
          <p className="text-sm text-slate-500 mt-1">Income and outflow for the selected month, grouped from the unified transaction ledger.</p>
        </div>
        <ReportToolbar rows={csvRows} columns={csvColumns} filename={`finance-${month.slice(0, 7)}`} />
      </div>

      <ReportFilterBar fields={["month"]} values={{ month }} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Total Income</div>
          <div className="text-lg font-semibold font-mono text-sage"><AnimatedValue value={fmt(totalIncome)} /></div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Total Outflow</div>
          <div className="text-lg font-semibold font-mono text-brick"><AnimatedValue value={fmt(totalOutflow)} /></div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Fee Collection</div>
          <div className="text-lg font-semibold font-mono"><AnimatedValue value={fmt(studentFeeIncome)} /></div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Net</div>
          <div className={`text-lg font-semibold font-mono ${totalIncome - totalOutflow >= 0 ? "text-sage" : "text-brick"}`}><AnimatedValue value={fmt(totalIncome - totalOutflow)} /></div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-left px-4 py-3">Account</th>
              <th className="text-left px-4 py-3">Description</th>
              <th className="text-right px-4 py-3">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="px-4 py-3 text-slate-600">{t.txn_date}</td>
                <td className="px-4 py-3 text-slate-600">{TYPE_LABEL[t.type] || t.type}</td>
                <td className="px-4 py-3 text-slate-600">{t.account?.name}</td>
                <td className="px-4 py-3 text-slate-600">{t.description || "—"}</td>
                <td className={`px-4 py-3 text-right font-mono ${t.direction === "in" ? "text-sage" : "text-brick"}`}>{t.direction === "in" ? "+" : "−"} {fmt(t.amount)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No transactions for this month.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
