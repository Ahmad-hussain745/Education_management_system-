import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import AddDiscountForm from "./AddDiscountForm";
import DiscountRow from "./DiscountRow";

export default async function DiscountsPage() {
  // fee_discounts' RLS read policy is "finance staff" only too.
  await requireRole(["Super Admin", "Accountant"]);
  const supabase = await createClient();

  const [{ data: students }, { data: rows }] = await Promise.all([
    supabase.from("students").select("id, name, class:classes(name)").eq("status", "active").order("name"),
    supabase
      .from("fee_discounts")
      .select("id, amount, reason, active, student:students(name, class:classes(name))")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Fee Discounts</h1>
      <p className="text-sm text-slate-500 mt-1">
        Every active discount here is summed straight into that student's Total Payable — the same
        Discount line Payment Entry and Fee Records already show.
      </p>

      <div className="mt-6"><AddDiscountForm students={students} /></div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Student</th>
              <th className="text-left px-4 py-3">Class</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3">Reason</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r) => <DiscountRow key={r.id} row={r} />)}
            {(!rows || rows.length === 0) && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No discounts yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
