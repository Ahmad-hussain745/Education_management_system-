import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import PaymentEntryForm from "./PaymentEntryForm";
import OfflineFeeReceipts from "./OfflineFeeReceipts";
import RequestReversalButton from "./RequestReversalButton";
import PendingFeeReversals from "./PendingFeeReversals";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

export default async function PaymentsPage(props) {
  const searchParams = await props.searchParams;
  // This page is the only real caller of get_or_create_fee_record() —
  // matches its in-function role check exactly (0013_security_and_finance_
  // fixes.sql). This guard is the UX layer; that function's own check is
  // the actual security boundary and would reject the RPC either way.
  await requireRole(["Super Admin", "Accountant", "Cashier"]);
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("users").select("name, institute_id, role:roles(name)").eq("auth_user_id", user.id).maybeSingle();
  // Cashier can record payments but not request a reversal — that's a
  // finance-staff correction, not a front-desk collection action.
  // request_fee_reversal() enforces this itself either way. Authorizing a
  // requested reversal is a further, separate tier — can_approve() (Super
  // Admin/Principal only, not Accountant) — checked inside
  // decide_fee_reversal(), mirrored here only for the UI's own Review
  // button visibility.
  const canReverse = ["Super Admin", "Accountant"].includes(me?.role?.name);
  const canApprove = ["Super Admin", "Principal"].includes(me?.role?.name);

  // "Collect Fee" from Global Search (components/GlobalSearch.js) lands
  // here with ?student_id= set — a single-row lookup, not the unbounded
  // "every active student" fetch this page used to do just to fill a
  // <select> (see PaymentEntryForm, now a StudentPicker typeahead instead).
  const initialStudentId = searchParams?.student_id || "";
  const [{ data: initialStudent }, { data: payments }, { data: pendingReversals }, { data: users }] = await Promise.all([
    initialStudentId ? supabase.from("students").select("name").eq("id", initialStudentId).maybeSingle() : Promise.resolve({ data: null }),
    supabase
      .from("fee_payments")
      .select("id, amount, method, paid_on, remarks, reversed_at, student:students(name)")
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(15),
    supabase
      .from("fee_reversal_requests")
      .select("id, reason, requested_by, created_at, fee_payment_id, payment:fee_payments(amount, student:students(name))")
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    // See finance/expenses/page.js for why this RPC (0056) is needed
    // instead of a plain requested_by:users(name) embed — same reasoning.
    canApprove ? supabase.rpc("list_institute_users") : Promise.resolve({ data: [] }),
  ]);

  const nameById = Object.fromEntries((users || []).map((u) => [u.id, u.name]));
  const reversalsWithNames = (pendingReversals || []).map((r) => ({ ...r, requester: { name: nameById[r.requested_by] } }));
  const pendingByPaymentId = Object.fromEntries((pendingReversals || []).map((r) => [r.fee_payment_id, r.status || "pending"]));

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Payment Entry</h1>
      <p className="text-sm text-slate-500 mt-1">
        Pick a student, confirm the amount, save. The month's bill, the ledger, the account balance and
        the dashboard all update from this one insert — nothing else to enter.
      </p>

      <div className="mt-6">
        <PaymentEntryForm
          initialStudentId={initialStudentId}
          initialStudentName={initialStudent?.name || ""}
          instituteId={me?.institute_id}
          collectedByName={me?.name || user?.email || ""}
        />
      </div>

      <OfflineFeeReceipts instituteId={me?.institute_id} />

      <PendingFeeReversals requests={reversalsWithNames} canApprove={canApprove} />

      <h2 className="text-sm font-semibold text-ink mb-2">Recent Payments</h2>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Student</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3">Method</th>
              <th className="text-left px-4 py-3">Paid On</th>
              <th className="text-left px-4 py-3">Remarks</th>
              <th className="text-left px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(payments || []).map((p) => (
              <tr key={p.id} className={"border-t border-slate-100" + (p.reversed_at ? " opacity-50" : "")}>
                <td className="px-4 py-3 font-medium text-ink">{p.student?.name ?? "—"}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(p.amount)}</td>
                <td className="px-4 py-3 text-slate-600">{p.method}</td>
                <td className="px-4 py-3 text-slate-600">{p.paid_on}</td>
                <td className="px-4 py-3 text-slate-600">{p.remarks || "—"}</td>
                <td className="px-4 py-3">
                  {canReverse && (
                    <RequestReversalButton
                      paymentId={p.id}
                      alreadyReversed={!!p.reversed_at}
                      pendingStatus={pendingByPaymentId[p.id]}
                    />
                  )}
                </td>
              </tr>
            ))}
            {(!payments || payments.length === 0) && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No payments recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
