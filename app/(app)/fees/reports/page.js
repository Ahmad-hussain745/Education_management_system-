import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

// Priority 5 — was one unbounded-ish .limit(2000) pull of individual
// fee_records rows, grouped by month/class in JS. Both breakdowns here are
// inherently small once aggregated (12 months, N classes) — there's no
// "page 2" of 12 months worth building real pagination for, so this gets a
// GROUP BY aggregate RPC (get_fee_collection_by_month/by_class), not a
// paginated list. Contrast with Financial Reports' Transaction Ledger,
// which IS a growing list of individual rows and DOES get real pagination.
export default async function FeeReportsPage() {
  const supabase = await createClient();
  const rc = await getRoleContext();

  const [{ data: monthRows, error: monthError }, { data: classRows, error: classError }] = await Promise.all([
    supabase.rpc("get_fee_collection_by_month", { p_institute_id: rc.instituteId, p_months: 12 }),
    supabase.rpc("get_fee_collection_by_class", { p_institute_id: rc.instituteId }),
  ]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Fee Reports</h1>
      <p className="text-sm text-slate-500 mt-1">
        Collection by month and by class, aggregated in Postgres from fee_records — nothing pre-computed or stored separately.
      </p>

      <div className="grid md:grid-cols-2 gap-6 mt-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-sm font-semibold text-ink mb-3">Monthly Collection — last 12 months</div>
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-xs uppercase"><tr><th className="text-left py-1">Month</th><th className="text-right py-1">Expected</th><th className="text-right py-1">Collected</th><th className="text-right py-1">%</th></tr></thead>
            <tbody>
              {(monthRows || []).map((r) => (
                <tr key={r.month} className="border-t border-slate-100">
                  <td className="py-2">{r.month?.slice(0, 7)}</td>
                  <td className="py-2 text-right font-mono">{fmt(r.expected)}</td>
                  <td className="py-2 text-right font-mono">{fmt(r.collected)}</td>
                  <td className="py-2 text-right font-mono">{r.expected > 0 ? ((r.collected / r.expected) * 100).toFixed(0) : 0}%</td>
                </tr>
              ))}
              {(!monthRows || monthRows.length === 0) && <tr><td colSpan={4} className="py-6 text-center text-slate-400">No data yet.</td></tr>}
            </tbody>
          </table>
          {monthError && <p className="text-xs text-brick mt-2">{monthError.message}</p>}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-sm font-semibold text-ink mb-3">Class-wise Collection (all-time)</div>
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-xs uppercase"><tr><th className="text-left py-1">Class</th><th className="text-right py-1">Expected</th><th className="text-right py-1">Collected</th><th className="text-right py-1">%</th></tr></thead>
            <tbody>
              {(classRows || []).map((r) => (
                <tr key={r.class_name} className="border-t border-slate-100">
                  <td className="py-2">{r.class_name}</td>
                  <td className="py-2 text-right font-mono">{fmt(r.expected)}</td>
                  <td className="py-2 text-right font-mono">{fmt(r.collected)}</td>
                  <td className="py-2 text-right font-mono">{r.expected > 0 ? ((r.collected / r.expected) * 100).toFixed(0) : 0}%</td>
                </tr>
              ))}
              {(!classRows || classRows.length === 0) && <tr><td colSpan={4} className="py-6 text-center text-slate-400">No data yet.</td></tr>}
            </tbody>
          </table>
          {classError && <p className="text-xs text-brick mt-2">{classError.message}</p>}
        </div>
      </div>
    </div>
  );
}
