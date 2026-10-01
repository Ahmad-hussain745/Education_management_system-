import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";

function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function monthBounds(ym) {
  const [y, m] = ym.split("-").map(Number);
  const from = `${ym}-01`;
  const to = new Date(y, m, 0).toISOString().slice(0, 10); // last day of that month
  return { from, to };
}

export default async function StockReportPage(props) {
  const searchParams = await props.searchParams;
  // Principal gets read-only access here too, same as any other finance
  // report — is_finance_staff() alone would exclude them.
  await requireRole(["Super Admin", "Principal", "Accountant"]);
  const supabase = await createClient();

  const month = searchParams?.month || new Date().toISOString().slice(0, 7);
  const { from, to } = monthBounds(month);

  const { data: rows, error } = await supabase.rpc("inventory_stock_report", { p_from: from, p_to: to });

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Inventory — Stock Report</h1>
      <p className="text-sm text-slate-500 mt-1">
        Opening + Purchased − Used = Remaining, for every active item over the selected month.
        "Purchased" is every stock-in movement in the range — purchases and manual Stock In combined.
      </p>

      <form className="mt-6 flex flex-wrap items-end gap-3" method="get">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Month</label>
          <input type="month" name="month" defaultValue={month} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <button className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg">View</button>
      </form>

      {error ? (
        <p className="text-sm text-brick mt-6">{error.message}</p>
      ) : (
        <div className="mt-6 space-y-3">
          <div className="text-sm font-semibold text-ink">{monthLabel(month)}</div>
          {(rows || []).map((r) => (
            <div key={r.item_id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink">{r.item_name}</span>
                {r.category_name && <span className="text-xs text-slate-400">{r.category_name}</span>}
              </div>
              <div className="mt-2 text-sm space-y-0.5 max-w-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Opening</span>
                  <span className="font-mono">{r.opening} {r.unit}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Purchased</span>
                  <span className="font-mono text-sage">+{r.purchased}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Used</span>
                  <span className="font-mono text-brick">−{r.used}</span>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-1 mt-1">
                  <span className="text-ink font-medium">Remaining</span>
                  <span className="font-mono font-semibold">{r.remaining} {r.unit}</span>
                </div>
              </div>
            </div>
          ))}
          {(!rows || rows.length === 0) && (
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-10 text-center text-slate-400 text-sm">
              No active items yet — add some under Inventory → Items.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
