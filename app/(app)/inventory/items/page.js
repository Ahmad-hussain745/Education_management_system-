import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import AddItemForm from "./AddItemForm";
import ItemRow from "./ItemRow";

export default async function InventoryItemsPage() {
  await requireRole(["Super Admin", "Accountant"]);
  const supabase = await createClient();

  const today = new Date().toISOString().slice(0, 10);
  const [{ data: items }, { data: categories }, { data: stockRows }] = await Promise.all([
    supabase.from("inventory_items").select("id, name, unit, opening_stock, reorder_level, active, category_id, category:inventory_categories(name)").order("name"),
    supabase.from("inventory_categories").select("id, name").eq("active", true).order("name"),
    // Reuses the Stock Report RPC with a wide-open range so "current stock"
    // for every active item comes back in one call instead of one
    // get_item_stock() round trip per row.
    supabase.rpc("inventory_stock_report", { p_from: "1900-01-01", p_to: today }),
  ]);

  const stockByItem = Object.fromEntries((stockRows || []).map((r) => [r.item_id, Number(r.remaining)]));

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Inventory — Items</h1>
      <p className="text-sm text-slate-500 mt-1">
        What the academy stocks. "Remaining" is opening stock plus every purchase/stock-in minus every
        stock-out ever recorded for the item — never a separately-maintained count.
      </p>

      <div className="mt-6"><AddItemForm categories={categories} /></div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Category</th>
              <th className="text-left px-4 py-3">Unit</th>
              <th className="text-right px-4 py-3">Remaining</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(items || []).map((i) => (
              <ItemRow key={i.id} item={i} categories={categories} stock={stockByItem[i.id] ?? Number(i.opening_stock)} />
            ))}
            {(!items || items.length === 0) && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No items yet — add the first one above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
