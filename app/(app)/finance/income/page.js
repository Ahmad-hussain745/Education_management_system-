import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import IncomeEntryForm from "./IncomeEntryForm";
import ReverseButton from "@/components/ReverseButton";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

export default async function IncomePage() {
  const role = await requireRole(["Super Admin", "Accountant", "Principal"]);
  const canReverse = ["Super Admin", "Accountant"].includes(role);
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("income")
    .select("id, category, description, amount, method, income_date, reversed_at")
    .order("income_date", { ascending: false })
    .limit(20);

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Other Income</h1>
      <p className="text-sm text-slate-500 mt-1">
        Everything that isn't tuition fee income (that comes from Payment Entry). Each row posts to the
        Cash/Bank ledger automatically.
      </p>

      {canReverse ? (
        <div className="mt-6"><IncomeEntryForm /></div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mt-6">
          You can view income, but only Super Admin or Accountant can record new entries.
        </div>
      )}

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
                <td className="px-4 py-3 text-slate-600">{r.income_date}</td>
                <td className="px-4 py-3">{canReverse && <ReverseButton table="income" id={r.id} alreadyReversed={!!r.reversed_at} />}</td>
              </tr>
            ))}
            {(!rows || rows.length === 0) && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No income entries yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
