// Fills a real gap: audit_logs (0012) only ever logged a payment being
// REVERSED (an UPDATE trigger), never CREATED — every fee payment's
// original entry into the ledger has been unaudited until now. This
// handler is what an event system is actually for: adding that coverage
// didn't require touching the payment-creation code path or its
// trigger at all, just registering a new subscriber.
//
// Writes audit_logs directly rather than calling log_audit() (0012) —
// that function reads auth.uid() for the acting user, which is null when
// this runs from the async dispatcher (service-role, no session). The
// event payload already carries received_by from the row itself, which
// is the correct "who did this" regardless of whether this handler runs
// inline (same request, session live) or later from the cron sweep (no
// session at all).
export async function onPaymentCreated({ admin, institute, event }) {
  const p = event.payload;
  const { error } = await admin.from("audit_logs").insert({
    user_id: p.received_by,
    action: "fee_payment.create",
    table_name: "fee_payments",
    record_id: p.payment_id,
    old_value: null,
    new_value: {
      amount: p.amount,
      method: p.method,
      receipt_no: p.receipt_no,
      is_advance: p.is_advance,
      student_id: p.student_id,
      month: p.month,
    },
  });
  if (error) throw new Error(`audit: ${error.message}`);
}
