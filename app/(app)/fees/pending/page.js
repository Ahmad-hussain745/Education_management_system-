import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AnimatedValue from "@/components/AnimatedValue";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

export default async function PendingFeesPage() {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("fee_records")
    .select("id, month, total_payable, paid_total, status, student:students(name, class:classes(name))")
    .neq("status", "paid")
    .order("month", { ascending: false })
    .limit(200);

  const list = (rows || []).map((r) => ({ ...r, remaining: Number(r.total_payable) - Number(r.paid_total) }));
  const totalRemaining = list.reduce((a, r) => a + r.remaining, 0);

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Pending Fees</h1>
          <p className="text-sm text-slate-500 mt-1">
            Every unpaid or partially-paid bill, straight from fee_records — nothing here is a separate count to maintain.
          </p>
        </div>
        <Link href="/reports/pending-fees" className="text-sm px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 whitespace-nowrap">
          Open Fee Arrears report →
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 mt-6 mb-4 inline-block">
        <div className="text-xs text-slate-500">Total Outstanding</div>
        <div className="text-lg font-semibold font-mono text-brick"><AnimatedValue value={fmt(totalRemaining)} /></div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Student</th>
              <th className="text-left px-4 py-3">Class</th>
              <th className="text-left px-4 py-3">Month</th>
              <th className="text-right px-4 py-3">Total Payable</th>
              <th className="text-right px-4 py-3">Paid</th>
              <th className="text-right px-4 py-3">Remaining</th>
              <th className="text-left px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-ink">{r.student?.name}</td>
                <td className="px-4 py-3 text-slate-600">{r.student?.class?.name || "—"}</td>
                <td className="px-4 py-3 text-slate-600">{r.month?.slice(0, 7)}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(r.total_payable)}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(r.paid_total)}</td>
                <td className="px-4 py-3 text-right font-mono text-brick">{fmt(r.remaining)}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === "partial" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-brick"}`}>
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Nothing pending — every bill is fully paid.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
