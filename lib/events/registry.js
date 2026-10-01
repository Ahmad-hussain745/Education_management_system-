import { onPaymentCreated as auditOnPaymentCreated } from "./handlers/audit";
import { onPaymentCreated as notificationOnPaymentCreated } from "./handlers/notification";

// PAYMENT_CREATED's subscribers, matching the request's diagram — with
// two of the six deliberately absent, and that absence is a design
// decision worth reading, not a gap:
//
//   Ledger        — NOT here. Already reacts synchronously, in the same
//                    transaction as the payment, via a direct Postgres
//                    trigger (see 0001_init.sql/0011_immutable_ledger.sql
//                    for wherever that trigger lives). A payment existing
//                    even briefly without its ledger entry is not
//                    acceptable for financial data — routing this through
//                    an eventually-consistent async queue would be a
//                    correctness regression, not an improvement, no
//                    matter how "decoupled" it sounds.
//   Receipt       — NOT here. The receipt a cashier sees is the direct
//                    return value of recordPayment() (app/(app)/fees/
//                    payments/actions.js), rendered immediately
//                    client-side (Receipt.js). There's no separate
//                    "generation" step for an event to trigger — it's
//                    already synchronous with the action itself, by
//                    construction.
//   Analytics     — NOT here. Every report and chart in this codebase
//                    (Management Report, Dashboard, Anomalies) queries
//                    fee_payments live, on each page load — there's no
//                    cached/pre-aggregated figure anywhere that would
//                    need invalidating when a payment lands. Wiring a
//                    fake "refresh analytics" handler here would do
//                    nothing real.
//   Teacher Payroll — NOT here. A teacher's percentage-share salary is
//                    computed once, in batch, when payroll is drafted for
//                    the month (class_collected_amount() at that moment)
//                    — not incrementally maintained per payment. Reacting
//                    to every single payment to "update payroll" would
//                    mean doing real work for a number nothing reads
//                    until the next drafting run anyway.
//
// Notification and Audit ARE real, both filling gaps that didn't exist
// before this event system — see each handler file for what specifically.
export const EVENT_HANDLERS = {
  PAYMENT_CREATED: [
    { name: "audit", handler: auditOnPaymentCreated },
    { name: "notification", handler: notificationOnPaymentCreated },
  ],
};
