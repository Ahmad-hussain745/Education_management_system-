import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import { getRoleContext } from "@/lib/auth/roles";
import ExpenseEntryForm from "./ExpenseEntryForm";
import PendingExpenses from "./PendingExpenses";
import PendingExpenseApprovals from "./PendingExpenseApprovals";
import ReverseButton from "@/components/ReverseButton";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

export default async function ExpensesPage() {
  const role = await requireRole(["Super Admin", "Accountant", "Principal"]);
  const canReverse = ["Super Admin", "Accountant"].includes(role);
  const canApprove = ["Super Admin", "Principal"].includes(role);
  const roleContext = await getRoleContext();
  const supabase = await createClient();

  const [{ data: rows }, { data: pendingRequests }, { data: users }] = await Promise.all([
    supabase
      .from("expenses")
      .select("id, category, description, amount, method, expense_date, reversed_at")
      .order("expense_date", { ascending: false })
      .limit(20),
    // Only ever populated for someone who can already see it (RLS: can_view_finance())
    // — the requireRole above happens to be a superset of that, so this never
    // silently comes back empty for a role that should see it.
    supabase
      .from("expense_requests")
      .select("id, category, description, amount, requested_by, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    // Plain embedding (requested_by:users(name)) would come back null for
    // anyone but the requester themself — users' own RLS is "read your own
    // row" for everyone except Super Admin (0002_rls.sql). list_institute_
    // users() (0056) is the general-purpose name lookup for exactly this.
    supabase.rpc("list_institute_users"),
  ]);

  const nameById = Object.fromEntries((users || []).map((u) => [u.id, u.name]));
  const requestsWithNames = (pendingRequests || []).map((r) => ({ ...r, requester: { name: nameById[r.requested_by] } }));

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Expenses</h1>
      <p className="text-sm text-slate-500 mt-1">
        Utilities, rent, repairs, and everything else the academy spends on. Below the large-expense
        threshold, a row posts to the Cash/Bank ledger automatically; at or above it, a Super Admin or
        the Principal has to approve it first — see Pending Approval below.
      </p>

      {canReverse ? (
        <div className="mt-6">
          <ExpenseEntryForm instituteId={roleContext?.instituteId} paidByUserId={roleContext?.userId} />
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mt-6">
          You can view expenses, but only Super Admin or Accountant can record new entries.
        </div>
      )}

      <PendingExpenses instituteId={roleContext?.instituteId} />
      <PendingExpenseApprovals requests={requestsWithNames} canApprove={canApprove} />

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Category</th>
              <th className="text-left px-4 py-3">Description</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3">Method</th>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r) => (
              <tr key={r.id} className={"border-t border-slate-100" + (r.reversed_at ? " opacity-50" : "")}>
                <td className="px-4 py-3 font-medium text-ink">{r.category}</td>
                <td className="px-4 py-3 text-slate-600">{r.description || "—"}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(r.amount)}</td>
                <td className="px-4 py-3 text-slate-600">{r.method}</td>
                <td className="px-4 py-3 text-slate-600">{r.expense_date}</td>
                <td className="px-4 py-3">{canReverse && <ReverseButton table="expenses" id={r.id} alreadyReversed={!!r.reversed_at} />}</td>
              </tr>
            ))}
            {(!rows || rows.length === 0) && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No expenses recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
