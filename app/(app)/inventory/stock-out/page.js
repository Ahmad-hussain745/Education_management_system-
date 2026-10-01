import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import { getRoleContext } from "@/lib/auth/roles";
import StockMovementForm from "../StockMovementForm";

export default async function StockOutPage() {
  await requireRole(["Super Admin", "Accountant"]);
  const supabase = await createClient();

  const today = new Date().toISOString().slice(0, 10);
  const roleContext = await getRoleContext();
  const [{ data: items }, { data: movements }, { data: stockRows }] = await Promise.all([
    supabase.from("inventory_items").select("id, name, unit").eq("active", true).order("name"),
    supabase
      .from("inventory_stock_movements")
      .select("id, quantity, reason, movement_date, item:inventory_items(name, unit)")
      .eq("movement_type", "stock_out")
      .order("movement_date", { ascending: false })
      .limit(30),
    supabase.rpc("inventory_stock_report", { p_from: today, p_to: today }),
  ]);

  // Current stock per item, so the form can show "on server → queued here
  // → after this entry" rather than asking someone to do that math.
  const stockByItem = Object.fromEntries((stockRows || []).map((r) => [r.item_id, r.remaining]));
  const itemsWithStock = (items || []).map((i) => ({ ...i, stock: stockByItem[i.id] ?? null }));

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Inventory — Stock Out</h1>
      <p className="text-sm text-slate-500 mt-1">
        Stock leaving without a sale — issued to a classroom or office, damaged, or otherwise used up.
        Can't take an item below zero on hand; the reason is required.
      </p>

      <div className="mt-6"><StockMovementForm items={itemsWithStock} movementType="stock_out" instituteId={roleContext?.instituteId} /></div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Item</th>
              <th className="text-right px-4 py-3">Quantity</th>
              <th className="text-left px-4 py-3">Reason</th>
              <th className="text-left px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {(movements || []).map((m) => (
              <tr key={m.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-ink">{m.item?.name || "—"}</td>
                <td className="px-4 py-3 text-right font-mono text-brick">−{m.quantity} {m.item?.unit}</td>
                <td className="px-4 py-3 text-slate-600">{m.reason || "—"}</td>
                <td className="px-4 py-3 text-slate-600">{m.movement_date}</td>
              </tr>
            ))}
            {(!movements || movements.length === 0) && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">No stock-out entries yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
