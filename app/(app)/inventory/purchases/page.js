import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import { getRoleContext } from "@/lib/auth/roles";
import PurchaseEntryForm from "./PurchaseEntryForm";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

export default async function InventoryPurchasesPage() {
  await requireRole(["Super Admin", "Accountant"]);
  const roleContext = await getRoleContext();
  const supabase = await createClient();

  const [{ data: items }, { data: suppliers }, { data: purchases }] = await Promise.all([
    supabase.from("inventory_items").select("id, name, unit").eq("active", true).order("name"),
    supabase.from("inventory_suppliers").select("id, name").eq("active", true).order("name"),
    supabase
      .from("inventory_purchases")
      .select("id, quantity, unit_price, total_amount, purchase_date, item:inventory_items(name, unit), supplier:inventory_suppliers(name), expense:expenses(method, reversed_at)")
      .order("purchase_date", { ascending: false })
      .limit(30),
  ]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Inventory — Purchases</h1>
      <p className="text-sm text-slate-500 mt-1">
        Every purchase posts an Expense (category "Inventory Purchase") to the Cash/Bank ledger
        automatically, and adds the quantity to stock — one entry, both sides handled.
      </p>

      <div className="mt-6"><PurchaseEntryForm items={items} suppliers={suppliers} instituteId={roleContext?.instituteId} /></div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Item</th>
              <th className="text-left px-4 py-3">Supplier</th>
              <th className="text-right px-4 py-3">Quantity</th>
              <th className="text-right px-4 py-3">Unit Price</th>
              <th className="text-right px-4 py-3">Total</th>
              <th className="text-left px-4 py-3">Method</th>
              <th className="text-left px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {(purchases || []).map((p) => (
              <tr key={p.id} className={"border-t border-slate-100" + (p.expense?.reversed_at ? " opacity-50" : "")}>
                <td className="px-4 py-3 font-medium text-ink">{p.item?.name || "—"}</td>
                <td className="px-4 py-3 text-slate-600">{p.supplier?.name || "—"}</td>
                <td className="px-4 py-3 text-right font-mono">{p.quantity} {p.item?.unit}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(p.unit_price)}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold">{fmt(p.total_amount)}</td>
                <td className="px-4 py-3 text-slate-600">
                  {p.expense?.method || "—"}
                  {p.expense?.reversed_at && <span className="text-xs text-brick ml-1">(expense reversed)</span>}
                </td>
                <td className="px-4 py-3 text-slate-600">{p.purchase_date}</td>
              </tr>
            ))}
            {(!purchases || purchases.length === 0) && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No purchases recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
