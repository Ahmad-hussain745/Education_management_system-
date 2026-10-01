"use client";

import { getConnectivity } from "@/lib/offline/connectivity";
import { recordPayment } from "@/app/(app)/fees/payments/actions";
import * as offlinePayments from "@/lib/offline/repositories/payments";

// Same call shape as attendanceRepository/expenseRepository/inventoryRepository
// — paymentRepository.create(payment) — but unlike those, this deliberately
// does NOT fall back from a failed online attempt straight into the offline
// path. See PaymentEntryForm.js: a failed online request might have
// actually succeeded server-side before the response was lost, and its
// retry contract (same idempotency_key, press Save again) depends on that
// staying an online retry — silently switching to a different code path on
// catch would break it. Offline collection only ever happens when this
// device is actually offline (getConnectivity() === false) or the caller
// explicitly asks for it.
//
// See lib/offline/repositories/payments.js for what makes the offline
// branch safe to have at all: capped to the cached remaining balance,
// requires a recently-synced bill cache, produces a clearly-provisional
// local receipt, and routes any rejection at sync time to a human instead
// of silently resolving it either way.
export const paymentRepository = {
  async create(payment) {
    const offline = !getConnectivity() || payment.forceOffline;

    if (offline) {
      if (payment.isAdvance) {
        return {
          mode: "blocked",
          error: "Advance payments (more than what's currently due) need a connection — there's no reliable cap to check that against offline.",
        };
      }
      try {
        const record = await offlinePayments.collectPaymentOffline({
          instituteId: payment.instituteId,
          studentId: payment.studentId,
          bill: payment.bill,
          amount: payment.amount,
          method: payment.method || "Cash",
          remarks: payment.remarks,
          collectedBy: payment.collectedBy,
        });
        return { mode: "offline", record };
      } catch (err) {
        // collectPaymentOffline throws "CODE: human message" — strip the
        // code prefix for display, callers that care about the code can
        // still check err.message.startsWith(...).
        const message = String(err.message || err).replace(/^[A-Z_]+:\s*/, "");
        return { mode: "blocked", error: message };
      }
    }

    const formData = new FormData();
    formData.set("fee_record_id", payment.feeRecordId);
    formData.set("student_id", payment.studentId);
    formData.set("month", payment.month);
    formData.set("amount", String(payment.amount));
    formData.set("method", payment.method || "Cash");
    if (payment.remarks) formData.set("remarks", payment.remarks);
    formData.set("is_advance", payment.isAdvance ? "true" : "false");
    // Caller-supplied so a retry of the SAME attempt can reuse the same
    // key (see PaymentEntryForm.js) — falls back to a fresh one here only
    // so this repository is never the reason a payment goes through with
    // no idempotency_key at all, not because generating it this late is
    // actually the right place to do it for a real retry.
    formData.set("idempotency_key", payment.idempotencyKey || crypto.randomUUID());

    const result = await recordPayment(formData);
    if (result?.error) return { mode: "online", error: result.error };
    return { mode: "online", ...result };
  },
};
