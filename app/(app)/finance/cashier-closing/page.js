import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import { getRoleContext } from "@/lib/auth/roles";
import CashierClosingForm from "./CashierClosingForm";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

export default async function CashierClosingPage() {
  await requireRole(["Super Admin", "Accountant", "Principal", "Cashier"]);
  const rc = await getRoleContext();
  const supabase = await createClient();

  // A Cashier only ever sees/closes their own day (cashier_closings' RLS —
  // 0024_daily_cashier_closing.sql — would return nothing else anyway);
  // finance staff/Principal get the cross-cashier history and a picker.
  //
  // Deliberately NOT embedding cashier:users(name) in the query below —
  // users' own RLS ("read own row", 0002_rls.sql) only lets Super Admin
  // read every users row; for Accountant/Principal that embed would
  // silently come back null for every cashier that isn't themselves. Name
  // lookup instead goes through list_cashiers() (0024), the same
  // can_view_finance()-scoped RPC the picker uses, so Accountant/Principal
  // see real names here too, not just Super Admin.
  const historyQuery = rc.isCashier
    ? supabase.from("cashier_closings").select("*").eq("cashier_id", rc.userId).order("closing_date", { ascending: false }).limit(30)
    : supabase.from("cashier_closings").select("*").order("closing_date", { ascending: false }).limit(50);

  const [{ data: history }, { data: cashierList }] = await Promise.all([
    historyQuery,
    rc.isCashier ? Promise.resolve({ data: null }) : supabase.rpc("list_cashiers"),
  ]);
  const cashierName = Object.fromEntries((cashierList || []).map((c) => [c.id, c.name]));

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Cashier Closing</h1>
      <p className="text-sm text-slate-500 mt-1">
        End-of-day cash reconciliation — Expected Cash comes straight from today's Cash-method fee payments and other
        income, so this page always agrees with Fee Payments and Finance &gt; Income.
      </p>

      <div className="mt-5">
        <CashierClosingForm
          isCashier={rc.isCashier}
          selfId={rc.userId}
          selfName={rc.name}
          canPickCashier={!rc.isCashier}
        />
      </div>

      <div className="text-sm font-semibold text-ink mt-8 mb-2">Closing History</div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Date</th>
              {!rc.isCashier && <th className="text-left px-4 py-3">Cashier</th>}
              <th className="text-right px-4 py-3">Expected</th>
              <th className="text-right px-4 py-3">Actual</th>
              <th className="text-right px-4 py-3">Difference</th>
              <th className="text-left px-4 py-3">Reason</th>
            </tr>
          </thead>
          <tbody>
            {(history || []).map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-4 py-3 text-slate-600">{c.closing_date}</td>
                {!rc.isCashier && <td className="px-4 py-3 text-slate-600">{cashierName[c.cashier_id] || "—"}</td>}
                <td className="px-4 py-3 text-right font-mono">{fmt(c.expected_cash)}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(c.actual_cash)}</td>
                <td className={`px-4 py-3 text-right font-mono font-medium ${Number(c.difference) === 0 ? "text-sage" : "text-brick"}`}>
                  {Number(c.difference) === 0 ? fmt(0) : (Number(c.difference) < 0 ? "−" : "+") + " " + fmt(Math.abs(c.difference))}
                </td>
                <td className="px-4 py-3 text-slate-500">{c.reason || "—"}</td>
              </tr>
            ))}
            {(!history || history.length === 0) && (
              <tr><td colSpan={rc.isCashier ? 5 : 6} className="px-4 py-10 text-center text-slate-400">No closings recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
