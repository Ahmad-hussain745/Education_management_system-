import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { resolveSelectedChild } from "@/lib/parent-portal/child";
import { fmt, monthLabel } from "@/lib/parent-portal/format";

const STATUS_COLOR = {
  paid: "text-sage",
  partial: "text-amber-700",
  unpaid: "text-brick",
};

export default async function FeesPage(props) {
  const searchParams = await props.searchParams;
  const roleContext = await getRoleContext();
  const kids = roleContext?.children || [];
  if (kids.length === 0) return null;
  const child = resolveSelectedChild(searchParams, kids);

  const supabase = await createClient();
  const { data } = await supabase
    .from("fee_records")
    .select("id, month, monthly_fee, previous_balance, discount, total_payable, paid_total, status")
    .eq("student_id", child.id)
    .order("month", { ascending: false });

  const rows = data || [];
  const outstanding = rows.filter((r) => r.status !== "paid").reduce((s, r) => s + (Number(r.total_payable) - Number(r.paid_total)), 0);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-ink">Fees — {child.name}</h1>

      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className={`text-2xl font-bold font-mono ${outstanding > 0 ? "text-brick" : "text-sage"}`}>{fmt(outstanding)}</div>
        <p className="text-xs text-slate-400">{outstanding > 0 ? "Currently outstanding" : "No outstanding balance"}</p>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-ink mb-3">Monthly Ledger</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">No fee records yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="pb-2 font-medium">Month</th>
                  <th className="pb-2 font-medium text-right">Fee</th>
                  <th className="pb-2 font-medium text-right">Previous Balance</th>
                  <th className="pb-2 font-medium text-right">Discount</th>
                  <th className="pb-2 font-medium text-right">Payable</th>
                  <th className="pb-2 font-medium text-right">Paid</th>
                  <th className="pb-2 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50">
                    <td className="py-2">{monthLabel(r.month)}</td>
                    <td className="py-2 text-right font-mono">{fmt(r.monthly_fee)}</td>
                    <td className="py-2 text-right font-mono text-slate-400">{fmt(r.previous_balance)}</td>
                    <td className="py-2 text-right font-mono text-slate-400">{fmt(r.discount)}</td>
                    <td className="py-2 text-right font-mono">{fmt(r.total_payable)}</td>
                    <td className="py-2 text-right font-mono">{fmt(r.paid_total)}</td>
                    <td className={`py-2 text-right capitalize font-medium ${STATUS_COLOR[r.status] || ""}`}>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
