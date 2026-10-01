import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import AddAccountForm from "./AddAccountForm";
import AccountStatusButton from "./AccountStatusButton";
import VerifyBalancesButton from "./VerifyBalancesButton";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

export default async function AccountsPage() {
  const role = await requireRole(["Super Admin", "Accountant", "Principal"]);
  const canWrite = ["Super Admin", "Accountant"].includes(role);
  const supabase = await createClient();

  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, kind, opening_balance, current_balance, status")
    .order("created_at");

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">Accounts</h1>
          <p className="text-sm text-slate-500 mt-1">
            Every fee payment, expense, income entry and salary payout posts to one of these — see Finance → Transactions for the full ledger.
          </p>
        </div>
      </div>

      {canWrite && <AddAccountForm />}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-4">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Kind</th>
              <th className="text-right px-4 py-3">Opening Balance</th>
              <th className="text-right px-4 py-3">Current Balance</th>
              <th className="text-left px-4 py-3">Status</th>
              {canWrite && <th className="text-right px-4 py-3">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {(accounts || []).map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-ink">{a.name}</td>
                <td className="px-4 py-3 capitalize text-slate-600">{a.kind}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(a.opening_balance)}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold">{fmt(a.current_balance)}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${a.status === "active" ? "bg-green-50 text-sage" : "bg-slate-100 text-slate-500"}`}>
                    {a.status}
                  </span>
                </td>
                {canWrite && (
                  <td className="px-4 py-3 text-right">
                    <AccountStatusButton accountId={a.id} status={a.status} />
                  </td>
                )}
              </tr>
            ))}
            {(!accounts || accounts.length === 0) && (
              <tr><td colSpan={canWrite ? 6 : 5} className="px-4 py-10 text-center text-slate-400">No accounts yet — add Cash in Hand and a bank account to get started.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {accounts && accounts.length > 0 && <VerifyBalancesButton />}
    </div>
  );
}
