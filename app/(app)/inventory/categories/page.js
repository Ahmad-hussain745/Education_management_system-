import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import AddCategoryForm from "./AddCategoryForm";
import CategoryRow from "./CategoryRow";

export default async function InventoryCategoriesPage() {
  await requireRole(["Super Admin", "Accountant"]);
  const supabase = await createClient();
  const { data: categories } = await supabase.from("inventory_categories").select("id, name, active").order("name");

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Inventory — Categories</h1>
      <p className="text-sm text-slate-500 mt-1">Group items for Items/Stock Report — Stationery, Cleaning Supplies, Lab Equipment, and so on.</p>

      <div className="mt-6"><AddCategoryForm /></div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(categories || []).map((c) => <CategoryRow key={c.id} category={c} />)}
            {(!categories || categories.length === 0) && (
              <tr><td colSpan={3} className="px-4 py-10 text-center text-slate-400">No categories yet — add the first one above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
