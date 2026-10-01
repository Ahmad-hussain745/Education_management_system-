import { createClient } from "@/lib/supabase/server";
import MonthPicker from "./MonthPicker";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default async function FeeRecordsPage(props) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const month = searchParams?.month || currentMonthStr();

  const { data: rows } = await supabase
    .from("fee_records")
    .select("id, monthly_fee, previous_balance, discount, total_payable, paid_total, status, student:students(name, class:classes(name))")
    .eq("month", month)
    .order("status");

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Fee Records</h1>
      <p className="text-sm text-slate-500 mt-1">
        One bill per student per month — generated automatically the first time Payment Entry is opened for
        them that month (Monthly Fee + Previous Balance − Discount = Total Payable).
      </p>

      <MonthPicker month={month} />

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Student</th>
              <th className="text-left px-4 py-3">Class</th>
              <th className="text-right px-4 py-3">Monthly Fee</th>
              <th className="text-right px-4 py-3">Prev. Balance</th>
              <th className="text-right px-4 py-3">Discount</th>
              <th className="text-right px-4 py-3">Total Payable</th>
              <th className="text-right px-4 py-3">Paid</th>
              <th className="text-left px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-ink">{r.student?.name}</td>
                <td className="px-4 py-3 text-slate-600">{r.student?.class?.name || "—"}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(r.monthly_fee)}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(r.previous_balance)}</td>
                <td className="px-4 py-3 text-right font-mono">− {fmt(r.discount)}</td>
                <td className="px-4 py-3 text-right font-mono font-medium">{fmt(r.total_payable)}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(r.paid_total)}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === "paid" ? "bg-green-50 text-sage" : r.status === "partial" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-brick"}`}>
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
            {(!rows || rows.length === 0) && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No bills generated for this month yet — they're created automatically from Payment Entry.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
