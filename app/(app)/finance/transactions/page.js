import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import { isMissingDbObjectError } from "@/lib/errors";
import ReportFilterBar from "@/components/reports/ReportFilterBar";
import ReportToolbar from "@/components/reports/ReportToolbar";
import Pagination from "@/components/Pagination";
import SortableTh from "@/components/SortableTh";
import AccountTypeFilter from "./AccountTypeFilter";
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
const PAGE_SIZE = 50;
const VALID_SORTS = new Set(["date_desc", "date_asc", "amount_desc", "amount_asc"]);

// list_transactions() paginates; transactions_totals() is a SEPARATE
// aggregate query over the same filter — Total In/Out used to be summed
// from whatever page of rows was in memory, which was only ever correct
// because the old .limit(1000) usually covered the whole month. Once a
// month has more rows than one page, that quietly becomes "total of the
// first N", not "total for the month" — see 0029_scalable_listings.sql.
export default async function TransactionsPage(props) {
  const searchParams = await props.searchParams;
  await requireRole(["Super Admin", "Accountant", "Principal"]);
  const supabase = await createClient();
  const month = searchParams?.month || currentMonthStr();
  const accountId = searchParams?.account_id || "";
  const type = searchParams?.type || "";
  const sort = VALID_SORTS.has(searchParams?.sort) ? searchParams.sort : "date_desc";
  const page = Math.max(1, Number(searchParams?.page) || 1);
  const to = nextMonthStr(month);

  const { data: accounts } = await supabase.from("accounts").select("id, name").order("name");

  const [{ data: rows, error: listError }, { data: totalsRows, error: totalsError }] = await Promise.all([
    supabase.rpc("list_transactions", {
      p_from: month, p_to: to, p_account_id: accountId || null, p_type: type || null,
      p_sort: sort, p_page: page, p_page_size: PAGE_SIZE,
    }),
    supabase.rpc("transactions_totals", { p_from: month, p_to: to, p_account_id: accountId || null, p_type: type || null }),
  ]);
  const rpcError = listError || totalsError;

  const txns = rows || [];
  const totalCount = txns[0]?.total_count ?? 0;
  const totals = totalsRows?.[0] || { total_in: 0, total_out: 0 };

  // Corrections never edit or delete a ledger row (0011_immutable_ledger.sql)
  // — a reversal is its own new, opposite-direction row, distinguishable
  // here by its description ("Reversal: ...") rather than a status flag,
  // since reversed_at lives on the source table (fee_payments etc.), not on
  // transactions itself.
  const displayRows = txns.map((t) => ({
    date: t.txn_date,
    type: TYPE_LABEL[t.type] || t.type,
    account: t.account_name || "—",
    description: t.description || "—",
    amount: (t.direction === "in" ? "+ " : "− ") + fmt(t.amount),
  }));

  const columns = [
    { key: "date", label: "Date" }, { key: "type", label: "Type" }, { key: "account", label: "Account" },
    { key: "description", label: "Description" }, { key: "amount", label: "Amount" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Transactions</h1>
          <p className="text-sm text-slate-500 mt-1">The full unified ledger for the selected month — every posted entry.</p>
        </div>
        {/* CSV reflects this page only — Total In/Out above the table are
            still exact for the whole month regardless. */}
        <ReportToolbar rows={displayRows} columns={columns} filename="Transactions-page" />
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-2">
        <ReportFilterBar fields={["month"]} values={{ month }} />
        <AccountTypeFilter searchParams={searchParams} accountId={accountId} type={type} accounts={accounts || []} typeLabels={TYPE_LABEL} />
      </div>

      {rpcError && (
        <div className="bg-brick-tint border border-brick/30 text-brick text-sm rounded-lg px-4 py-3 mt-2 mb-2">
          <p className="font-medium">Couldn't load transactions.</p>
          <p className="mt-1">
            {rpcError.message}
            {isMissingDbObjectError(rpcError.message) && " — a required database function is missing from this Supabase project (or its schema cache hasn't refreshed yet). Run every file in supabase/migrations/ against this project, in order (see README.md → Setup), then reload the schema cache from Settings → API in the Supabase dashboard if it still fails."}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 mb-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Total In</div>
          <div className="text-lg font-semibold font-mono text-sage"><AnimatedValue value={fmt(totals.total_in)} /></div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Total Out</div>
          <div className="text-lg font-semibold font-mono text-brick"><AnimatedValue value={fmt(totals.total_out)} /></div>
        </div>
      </div>

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
            {displayRows.map((r, i) => (
              <tr key={txns[i].id} className="border-t border-slate-100">
                {columns.map((c) => <td key={c.key} className={`px-4 py-3 ${c.key === "amount" ? "text-right font-mono" : ""}`}>{r[c.key]}</td>)}
              </tr>
            ))}
            {displayRows.length === 0 && (
              <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-slate-400">
                {rpcError ? "Couldn't load transactions — see the message above." : "No transactions for this filter."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination searchParams={searchParams} page={page} pageSize={PAGE_SIZE} totalCount={totalCount} itemLabel="transactions" />
    </div>
  );
}
