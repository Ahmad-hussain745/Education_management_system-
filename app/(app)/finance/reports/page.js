import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import { getRoleContext } from "@/lib/auth/roles";
import { isMissingDbObjectError } from "@/lib/errors";
import ReportMonthPicker from "./ReportMonthPicker";
import AnimatedValue from "@/components/AnimatedValue";
import Pagination from "@/components/Pagination";
import SortableTh from "@/components/SortableTh";

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

const TYPE_LABEL = {
  fee_payment: "Fee Payment",
  income: "Other Income",
  expense: "Expense",
  salary_payment: "Salary Payment",
};
const PAGE_SIZE = 50;
const VALID_SORTS = new Set(["date_asc", "date_desc", "amount_asc", "amount_desc"]);

// Priority 5 — three separate fixes on this one page:
//   1. Summary figures now come from get_month_financial_summary (Priority
//      4), not a re-sum of a capped 500-row transactions pull.
//   2. Payment Method Breakdown now comes from get_payment_method_breakdown
//      (Priority 5) instead of an UNBOUNDED fee_payments pull for the month.
//   3. The Transaction Ledger table below now uses list_transactions()
//      (already existed, 0029_scalable_listings.sql) with real pagination
//      and column sorting, instead of the same capped 500 rows with no way
//      to see anything past them.
export default async function FinancialReportsPage(props) {
  const searchParams = await props.searchParams;
  await requireRole(["Super Admin", "Accountant", "Principal"]);
  const supabase = await createClient();
  const rc = await getRoleContext();
  const month = searchParams?.month || currentMonthStr();
  const monthEnd = nextMonthStr(month);
  const sort = VALID_SORTS.has(searchParams?.sort) ? searchParams.sort : "date_desc";
  const page = Math.max(1, Number(searchParams?.page) || 1);

  const [{ data: accounts }, fin, { data: methodRows }, { data: txnRows, error: txnError }] = await Promise.all([
    supabase.from("accounts").select("id, name, kind, current_balance").eq("status", "active").order("name"),
    supabase.rpc("get_month_financial_summary", { p_institute_id: rc.instituteId, p_start_date: month, p_end_date: monthEnd }).single(),
    supabase.rpc("get_payment_method_breakdown", { p_institute_id: rc.instituteId, p_start_date: month, p_end_date: monthEnd }),
    supabase.rpc("list_transactions", { p_from: month, p_to: monthEnd, p_sort: sort, p_page: page, p_page_size: PAGE_SIZE }),
  ]);

  const studentFeeIncome = Number(fin.data?.collected || 0);
  const otherIncome = Number(fin.data?.other_income || 0);
  const teacherSalary = Number(fin.data?.salaries || 0);
  const otherExpenses = Number(fin.data?.expenses || 0);
  const totalIncome = studentFeeIncome + otherIncome;
  const totalOutflow = teacherSalary + otherExpenses;
  const net = totalIncome - totalOutflow;

  // payment_method (0001_init.sql) has six values — Easypaisa/JazzCash/Card
  // are grouped under "Online" here since they're all digital wallet/card
  // rails a cashier never physically touches, same distinction Cashier
  // Closing (0024_daily_cashier_closing.sql) draws between Cash and
  // everything else. The bucketing itself now happens inside
  // get_payment_method_breakdown() — this just lays out the fixed display
  // order and fills in zero for a method with no payments this month.
  const METHOD_ORDER = ["Cash", "Bank Transfer", "Online", "Cheque"];
  const methodTotals = Object.fromEntries(METHOD_ORDER.map((m) => [m, 0]));
  (methodRows || []).forEach((r) => { methodTotals[r.method_bucket] = Number(r.total); });
  const methodTotal = METHOD_ORDER.reduce((a, m) => a + methodTotals[m], 0);
  const maxMethodTotal = Math.max(1, ...METHOD_ORDER.map((m) => methodTotals[m]));

  const txns = txnRows || [];
  const totalTxnCount = txns[0]?.total_count ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Financial Reports</h1>
          <p className="text-sm text-slate-500 mt-1">
            Every figure below is grouped straight from the unified transactions ledger — no separate
            income/expense/salary totals kept anywhere else.
          </p>
        </div>
        <ReportMonthPicker month={month} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
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
          <div className="text-lg font-semibold font-mono text-ink"><AnimatedValue value={fmt(studentFeeIncome)} /></div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Net</div>
          <div className={`text-lg font-semibold font-mono ${net >= 0 ? "text-sage" : "text-brick"}`}><AnimatedValue value={fmt(net)} /></div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mt-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-ink mb-3">Income Breakdown</div>
          <div className="flex justify-between text-sm py-1.5 border-t border-slate-100">
            <span className="text-slate-600">Student Fee Income</span>
            <span className="font-mono">{fmt(studentFeeIncome)}</span>
          </div>
          <div className="flex justify-between text-sm py-1.5 border-t border-slate-100">
            <span className="text-slate-600">Other Income</span>
            <span className="font-mono">{fmt(otherIncome)}</span>
          </div>
          <div className="flex justify-between text-sm py-1.5 border-t border-slate-200 font-medium">
            <span>Total</span>
            <span className="font-mono">{fmt(totalIncome)}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-ink mb-3">Outflow Breakdown</div>
          <div className="flex justify-between text-sm py-1.5 border-t border-slate-100">
            <span className="text-slate-600">Teacher Salary</span>
            <span className="font-mono">{fmt(teacherSalary)}</span>
          </div>
          <div className="flex justify-between text-sm py-1.5 border-t border-slate-100">
            <span className="text-slate-600">Other Expenses</span>
            <span className="font-mono">{fmt(otherExpenses)}</span>
          </div>
          <div className="flex justify-between text-sm py-1.5 border-t border-slate-200 font-medium">
            <span>Total</span>
            <span className="font-mono">{fmt(totalOutflow)}</span>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 mt-6">
        <div className="text-sm font-semibold text-ink mb-1">Payment Method Breakdown — {month.slice(0, 7)}</div>
        <p className="text-xs text-slate-400 mb-3">
          Grouped in Postgres from fee_payments.method for the month — Easypaisa, JazzCash and Card are combined under
          "Online" since none of them touch physical cash.
        </p>
        <table className="w-full text-sm mb-4">
          <tbody>
            {METHOD_ORDER.map((m) => (
              <tr key={m} className="border-t border-slate-100">
                <td className="py-1.5 text-slate-600">{m}</td>
                <td className="py-1.5 text-right font-mono">{fmt(methodTotals[m])}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 font-medium">
              <td className="py-1.5">Total</td>
              <td className="py-1.5 text-right font-mono">{fmt(methodTotal)}</td>
            </tr>
          </tbody>
        </table>

        <div className="space-y-2">
          {METHOD_ORDER.map((m) => {
            const pct = methodTotal > 0 ? Math.round((methodTotals[m] / methodTotal) * 100) : 0;
            const barPct = Math.round((methodTotals[m] / maxMethodTotal) * 100);
            return (
              <div key={m} className="flex items-center gap-3">
                <div className="w-28 shrink-0 text-xs text-slate-500">{m}</div>
                <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-royal rounded-full"
                    style={{ width: `${Math.max(barPct, methodTotals[m] > 0 ? 2 : 0)}%` }}
                  />
                </div>
                <div className="w-14 shrink-0 text-right text-xs font-mono text-slate-500">{pct}%</div>
              </div>
            );
          })}
          {methodTotal === 0 && <p className="text-sm text-slate-400">No fee payments recorded for this month.</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 mb-2">
        {(accounts || []).map((a) => (
          <div key={a.id} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500 capitalize">{a.name} ({a.kind}) — current balance</div>
            <div className="text-lg font-semibold font-mono text-ink"><AnimatedValue value={fmt(a.current_balance)} /></div>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-400 mb-6">Account balances are as of today, not scoped to the selected month.</p>

      <div className="text-sm font-semibold text-ink mb-2">Transaction Ledger — {month.slice(0, 7)}</div>
      {txnError && (
        <div className="bg-brick-tint border border-brick/30 text-brick text-sm rounded-lg px-4 py-3 mb-3">
          {txnError.message}
          {isMissingDbObjectError(txnError.message) && " — run every file in supabase/migrations/ against this project, in order."}
        </div>
      )}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <SortableTh label="Date" sortKey="date" currentSort={sort} searchParams={searchParams} />
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-left px-4 py-3">Account</th>
              <th className="text-left px-4 py-3">Description</th>
              <SortableTh label="Amount" sortKey="amount" currentSort={sort} searchParams={searchParams} align="right" />
            </tr>
          </thead>
          <tbody>
            {txns.map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="px-4 py-3 text-slate-600">{t.txn_date}</td>
                <td className="px-4 py-3 text-slate-600">{TYPE_LABEL[t.type] || t.type}</td>
                <td className="px-4 py-3 text-slate-600">{t.account_name}</td>
                <td className="px-4 py-3 text-slate-600">{t.description || "—"}</td>
                <td className={`px-4 py-3 text-right font-mono ${t.direction === "in" ? "text-sage" : "text-brick"}`}>
                  {t.direction === "in" ? "+" : "−"} {fmt(t.amount)}
                </td>
              </tr>
            ))}
            {txns.length === 0 && !txnError && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No transactions posted for this month.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination searchParams={searchParams} page={page} pageSize={PAGE_SIZE} totalCount={totalTxnCount} itemLabel="transactions" />
    </div>
  );
}
