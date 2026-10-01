import { createClient } from "@/lib/supabase/server";
import ReportFilterBar from "@/components/reports/ReportFilterBar";
import ReportToolbar from "@/components/reports/ReportToolbar";
import Pagination from "@/components/Pagination";
import SortableTh from "@/components/SortableTh";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

const PAGE_SIZE = 50;
const SORT_COLUMNS = {
  date_desc: { column: "paid_on", ascending: false },
  date_asc: { column: "paid_on", ascending: true },
  amount_desc: { column: "amount", ascending: false },
  amount_asc: { column: "amount", ascending: true },
};

export default async function ReceiptsPage(props) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const studentId = searchParams?.student_id || "";
  const date = searchParams?.date || "";
  const sort = SORT_COLUMNS[searchParams?.sort] ? searchParams.sort : "date_desc";
  const page = Math.max(1, Number(searchParams?.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // Single-table, no cross-row aggregation needed — a plain range() query
  // with an exact count is enough here; no custom SQL function required
  // the way the arrears/transactions pages needed one.
  let query = supabase
    .from("fee_payments")
    .select("id, receipt_no, amount, method, paid_on, month, student:students(name, student_code)", { count: "exact" })
    .order(SORT_COLUMNS[sort].column, { ascending: SORT_COLUMNS[sort].ascending })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (studentId) query = query.eq("student_id", studentId);
  if (date) query = query.eq("paid_on", date);
  const { data: payments, count } = await query;

  // A single-row lookup, not the whole student list — just enough for
  // StudentPicker (via ReportFilterBar) to show the right name on reload.
  const { data: selectedStudent } = studentId
    ? await supabase.from("students").select("name").eq("id", studentId).maybeSingle()
    : { data: null };

  const columns = [
    { key: "receiptNo", label: "Receipt No" },
    { key: "student", label: "Student" },
    { key: "month", label: "Month" },
    { key: "amount", label: "Amount" },
    { key: "method", label: "Method" },
    { key: "date", label: "Date" },
  ];
  // CSV reflects this page only, same as the on-screen table — see
  // README's "Scalability" note for why a full unbounded export isn't
  // offered here anymore.
  const rows = (payments || []).map((p) => ({
    receiptNo: p.receipt_no || "—",
    student: p.student?.name + (p.student?.student_code ? ` (${p.student.student_code})` : ""),
    month: p.month?.slice(0, 7),
    amount: fmt(p.amount),
    method: p.method,
    date: p.paid_on,
  }));

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Receipts</h1>
          <p className="text-sm text-slate-500 mt-1">Every fee payment ever recorded — reprint or re-download the PDF for any of them, any time.</p>
        </div>
        <ReportToolbar rows={rows} columns={columns} filename="Receipts" />
      </div>

      <ReportFilterBar
        fields={["student", "date"]}
        values={{ student_id: studentId, student_name: selectedStudent?.name || "", date, sort }}
      />

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-6">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Receipt No</th>
              <th className="text-left px-4 py-3">Student</th>
              <th className="text-left px-4 py-3">Month</th>
              <SortableTh label="Amount" sortKey="amount" currentSort={sort} searchParams={searchParams} align="right" />
              <th className="text-left px-4 py-3">Method</th>
              <SortableTh label="Date" sortKey="date" currentSort={sort} searchParams={searchParams} />
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(payments || []).map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-mono text-xs">{p.receipt_no || "—"}</td>
                <td className="px-4 py-3 text-ink">{p.student?.name}{p.student?.student_code ? ` (${p.student.student_code})` : ""}</td>
                <td className="px-4 py-3 text-slate-600">{p.month?.slice(0, 7)}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(p.amount)}</td>
                <td className="px-4 py-3 text-slate-600">{p.method}</td>
                <td className="px-4 py-3 text-slate-600">{p.paid_on}</td>
                <td className="px-4 py-3 text-right">
                  <a href={`/api/receipts/${p.id}`} className="text-xs font-medium text-royal hover:underline">PDF</a>
                </td>
              </tr>
            ))}
            {(!payments || payments.length === 0) && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No payments match this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination searchParams={searchParams} page={page} pageSize={PAGE_SIZE} totalCount={count || 0} itemLabel="payments" />
    </div>
  );
}
