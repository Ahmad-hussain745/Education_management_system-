import { createClient } from "@/lib/supabase/server";
import SyncHealthPanel from "./SyncHealthPanel";

function fmtRs(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Cashier — "Fee collection, Cash closing, Receipt" (Phase 25). No job
// table at all: a Cashier doesn't administer automation, they need to
// know three things about THEIR OWN day — what they've collected, whether
// their drawer balanced, and whether their offline receipts have synced.
// Every query here is scoped to this cashier specifically (received_by /
// cashier_id = roleContext.userId), matching the same "own data only"
// scope cashier_closings' own RLS policy already enforces server-side.
export default async function CashierView({ roleContext }) {
  const instituteId = roleContext.instituteId;
  const userId = roleContext.userId;
  const supabase = await createClient();
  const today = todayStr();

  const [{ data: feePayments }, { data: income }, { data: closing }] = await Promise.all([
    supabase.from("fee_payments").select("amount").eq("institute_id", instituteId).eq("received_by", userId).eq("paid_on", today),
    supabase.from("income").select("amount").eq("institute_id", instituteId).eq("received_by", userId).eq("income_date", today),
    supabase
      .from("cashier_closings")
      .select("closing_date, expected_cash, actual_cash, difference")
      .eq("cashier_id", userId)
      .order("closing_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const collectedToday =
    (feePayments || []).reduce((s, r) => s + Number(r.amount), 0) + (income || []).reduce((s, r) => s + Number(r.amount), 0);

  const closedToday = closing?.closing_date === today;

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">My Day</h1>
      <p className="text-sm text-slate-500 mt-1">Fee collection, cash closing, and your receipts — just yours, not the whole institute's.</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        <a href="/fees/payments" className="bg-white rounded-xl border border-slate-200 p-4 block hover:border-royal transition-colors">
          <div className="text-xs text-slate-400">Fee collection — today</div>
          <div className="text-2xl font-semibold text-ink mt-1">{fmtRs(collectedToday)}</div>
          <div className="text-xs text-royal mt-2">Record a payment →</div>
        </a>

        <a href="/finance/cashier-closing" className="bg-white rounded-xl border border-slate-200 p-4 block hover:border-royal transition-colors">
          <div className="text-xs text-slate-400">Cash closing</div>
          {closedToday ? (
            <>
              <div className={`text-lg font-semibold mt-1 ${Number(closing.difference) === 0 ? "text-emerald-700" : "text-amber-600"}`}>
                {Number(closing.difference) === 0 ? "✅ Balanced" : `⚠ Off by ${fmtRs(Math.abs(closing.difference))}`}
              </div>
              <div className="text-xs text-slate-500 mt-1">Closed today</div>
            </>
          ) : (
            <>
              <div className="text-lg font-semibold text-amber-600 mt-1">Not closed yet</div>
              <div className="text-xs text-royal mt-2">Close today's drawer →</div>
            </>
          )}
        </a>

        <a href="/fees/receipts" className="bg-white rounded-xl border border-slate-200 p-4 block hover:border-royal transition-colors">
          <div className="text-xs text-slate-400">Receipts</div>
          <div className="text-lg font-semibold text-ink mt-1">View recent</div>
          <div className="text-xs text-royal mt-2">Open →</div>
        </a>
      </div>

      <h2 className="text-sm font-semibold text-ink mt-8 mb-2">Receipt Sync</h2>
      <p className="text-sm text-slate-500 mb-3">
        A receipt saved while offline gets a LOCAL number until this device reconnects and it syncs to a real
        one — this shows this device's own queue.
      </p>
      <SyncHealthPanel instituteId={instituteId} />
    </div>
  );
}
