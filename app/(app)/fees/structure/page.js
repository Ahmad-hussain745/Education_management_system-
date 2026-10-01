import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import AddClassFeeForm from "./AddClassFeeForm";
import ClassFeeRow from "./ClassFeeRow";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

export default async function FeeStructurePage() {
  // fee_structures' RLS read policy is "finance staff" only (Super Admin,
  // Accountant) — unlike fee_records/fee_payments, even Principal and
  // Cashier can't read this table, so there's no useful view-only mode to
  // offer them; a hard gate is correct here, not a soft one.
  await requireRole(["Super Admin", "Accountant"]);
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: classes }, { data: rows }] = await Promise.all([
    supabase.from("classes").select("id, name").order("sort_order"),
    supabase.from("fee_structures").select("id, class_id, monthly_fee, effective_from, active").is("student_id", null).order("effective_from", { ascending: false }),
  ]);

  const rowsByClass = new Map();
  (rows || []).forEach((r) => {
    if (!rowsByClass.has(r.class_id)) rowsByClass.set(r.class_id, []);
    rowsByClass.get(r.class_id).push(r);
  });

  // Mirrors get_or_create_fee_record()'s own resolution exactly: the most
  // recent active row on or before today. Shown so it's obvious at a glance
  // which fee a bill generated right now would actually use.
  const currentFeeId = (classRows) => {
    const eligible = (classRows || []).filter((r) => r.active && r.effective_from <= today);
    if (eligible.length === 0) return null;
    return eligible.reduce((a, b) => (a.effective_from > b.effective_from ? a : b)).id;
  };

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Fee Structure</h1>
      <p className="text-sm text-slate-500 mt-1">
        Each class's monthly fee, with full history. Payment Entry and fee-record generation always use
        whichever row's Effective From date is the most recent one on or before the month being billed.
      </p>

      <div className="mt-6"><AddClassFeeForm classes={classes} /></div>

      {(classes || []).map((c) => {
        const classRows = rowsByClass.get(c.id) || [];
        const curId = currentFeeId(classRows);
        const current = classRows.find((r) => r.id === curId);
        return (
          <div key={c.id} className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium text-ink">{c.name}</div>
              <div className="text-sm font-mono text-slate-600">
                {current ? `Current: ${fmt(current.monthly_fee)}/mo` : "No fee set"}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">Effective From</th>
                    <th className="text-right px-4 py-2">Monthly Fee</th>
                    <th className="text-left px-4 py-2">Status</th>
                    <th className="text-right px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {classRows.map((r) => <ClassFeeRow key={r.id} row={r} isCurrent={r.id === curId} />)}
                  {classRows.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-4 text-center text-slate-400 text-sm">No fee scheduled for this class yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
