import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import AddSupplierForm from "./AddSupplierForm";
import SupplierRow from "./SupplierRow";

export default async function InventorySuppliersPage() {
  await requireRole(["Super Admin", "Accountant"]);
  const supabase = await createClient();
  const { data: suppliers } = await supabase.from("inventory_suppliers").select("id, name, phone, address, active").order("name");

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Inventory — Suppliers</h1>
      <p className="text-sm text-slate-500 mt-1">Vendors the academy buys supplies from — picked from this list on the Purchases screen.</p>

      <div className="mt-6"><AddSupplierForm /></div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Phone</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(suppliers || []).map((s) => <SupplierRow key={s.id} supplier={s} />)}
            {(!suppliers || suppliers.length === 0) && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">No suppliers yet — add the first one above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
