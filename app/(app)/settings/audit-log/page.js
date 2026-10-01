import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import { isMissingDbObjectError } from "@/lib/errors";
import SearchBox from "@/components/SearchBox";
import Pagination from "@/components/Pagination";
import SortableTh from "@/components/SortableTh";

const ACTION_LABELS = {
  "fee_payments.reverse": "Fee Payment Reversed",
  "income.reverse": "Income Reversed",
  "expenses.reverse": "Expense Reversed",
  "salary_payments.reverse": "Salary Payment Reversed",
  "salary_record.lock": "Payroll Locked/Approved",
  "user.create": "User Account Created",
  "teacher.link_account": "Teacher Linked to Login",
};
const PAGE_SIZE = 50;
const VALID_SORTS = new Set(["date_asc", "date_desc"]);

// Priority 5 — was .limit(200) with no search, no date filter, and no way
// to reach anything past the 200 most recent entries. Now list_audit_logs()
// (Priority 5 migration) does search (action/table/user) + date range +
// sort + real pagination in one round trip, the same shape as
// list_students/list_transactions.
export default async function AuditLogPage(props) {
  const searchParams = await props.searchParams;
  await requireRole(["Super Admin"]);
  const supabase = await createClient();

  const search = searchParams?.q || "";
  const startDate = searchParams?.start || "";
  const endDate = searchParams?.end || "";
  const sort = VALID_SORTS.has(searchParams?.sort) ? searchParams.sort : "date_desc";
  const page = Math.max(1, Number(searchParams?.page) || 1);

  const { data: rows, error: listError } = await supabase.rpc("list_audit_logs", {
    p_search: search || null,
    p_start_date: startDate || null,
    p_end_date: endDate || null,
    p_sort: sort,
    p_page: page,
    p_page_size: PAGE_SIZE,
  });

  const entries = rows || [];
  const totalCount = entries[0]?.total_count ?? 0;

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Audit Log</h1>
      <p className="text-sm text-slate-500 mt-1">
        Written automatically by database triggers — reversals, payroll locks, and account creation.
        This can't be edited or deleted from the app; the underlying table has no update/delete policy at all.
      </p>

      <div className="flex flex-wrap items-end gap-3 mt-4">
        <SearchBox paramKey="q" placeholder="Search action, table, or user…" />
        <form method="get" className="flex flex-wrap items-end gap-3">
          {search && <input type="hidden" name="q" value={search} />}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
            <input type="date" name="start" defaultValue={startDate} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
            <input type="date" name="end" defaultValue={endDate} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button type="submit" className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Apply</button>
        </form>
      </div>

      {listError && (
        <div className="bg-brick-tint border border-brick/30 text-brick text-sm rounded-lg px-4 py-3 mt-4">
          {listError.message}
          {isMissingDbObjectError(listError.message) && " — run every file in supabase/migrations/ against this project, in order."}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-4">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <SortableTh label="When" sortKey="date" currentSort={sort} searchParams={searchParams} />
              <th className="text-left px-4 py-3">Action</th>
              <th className="text-left px-4 py-3">By</th>
              <th className="text-left px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 align-top">
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-3 font-medium text-ink whitespace-nowrap">
                  {ACTION_LABELS[r.action] || r.action}
                </td>
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                  {r.user_name || r.user_email || "—"}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs font-mono">
                  {r.new_value ? JSON.stringify(r.new_value) : "—"}
                </td>
              </tr>
            ))}
            {entries.length === 0 && !listError && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">No audited actions match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination searchParams={searchParams} page={page} pageSize={PAGE_SIZE} totalCount={totalCount} itemLabel="audit entries" />
    </div>
  );
}
