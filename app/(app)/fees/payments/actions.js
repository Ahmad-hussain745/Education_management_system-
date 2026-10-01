"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";
import { dispatchPendingEvents } from "@/lib/events/dispatcher";

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// Called the moment a cashier picks a student in Payment Entry. This is the
// "enter once" pipeline starting to work: it doesn't ask anyone to type the
// monthly fee, previous balance or discount — get_or_create_fee_record()
// (0003_fee_generation.sql) derives all three from fee_structures,
// fee_discounts and last month's fee_records, and returns the one bill the
// cashier is allowed to collect against.
export async function getBillPreview(studentId) {
  if (!studentId) return { error: "Pick a student first." };
  const supabase = await createClient();
  const month = currentMonthStr();

  const { data: feeRecordId, error: rpcError } = await supabase.rpc("get_or_create_fee_record", {
    p_student_id: studentId,
    p_month: month,
  });
  if (rpcError) return { error: rpcError.message };

  const { data: record, error: recError } = await supabase
    .from("fee_records")
    .select("id, month, monthly_fee, previous_balance, discount, total_payable, paid_total, status")
    .eq("id", feeRecordId)
    .single();
  if (recError) return { error: recError.message };

  return { record };
}

// The actual "Ahmed paid Rs. 8,000" moment. This inserts exactly one row.
// Everything else — fee_records.paid_total/status, the cash/bank ledger and
// account balance, and (at next payroll generation) the teacher's
// percentage share — is picked up automatically by the triggers already
// wired in 0001_init.sql. Nothing else is written here on purpose.
//
// remaining = total_payable - paid_total, and amount > remaining is
// rejected UNLESS the cashier explicitly ticked "This is an advance
// payment" (isAdvance) — re-checked here against a FRESH read of
// fee_records (not whatever the form loaded with), because the bill could
// have changed since the page opened (another payment recorded elsewhere,
// a discount added, etc). 0007/0040 enforce the same rule as a BEFORE
// INSERT trigger regardless of what this action does, so this check exists
// to give a clear message before that trigger would abort the insert — not
// because the trigger can be bypassed.
export async function recordPayment(formData) {
  const supabase = await createClient();

  const feeRecordId = formData.get("fee_record_id")?.toString();
  const studentId = formData.get("student_id")?.toString();
  const month = formData.get("month")?.toString();
  const amount = Number(formData.get("amount") || 0);
  const method = formData.get("method")?.toString() || "Cash";
  const remarks = formData.get("remarks")?.toString().trim() || null;
  const isAdvance = formData.get("is_advance") === "true";
  const idempotencyKey = formData.get("idempotency_key")?.toString() || null;

  if (!feeRecordId || !studentId || !month) {
    return { error: "Pick a student to load their bill before recording a payment." };
  }
  if (!amount || amount <= 0) {
    return { error: "Enter an amount greater than 0." };
  }

  // Same key PaymentEntryForm.js generated when this bill first loaded,
  // unchanged across retries of the same submission (see that file). If a
  // payment with this key already exists, this is a retry of a request
  // whose response got lost — not a new payment — so skip straight to
  // building the receipt from the row that's already there instead of
  // re-validating amount-vs-remaining against a balance this exact payment
  // may have already changed, and instead of inserting a second row.
  let payment = null;
  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from("fee_payments")
      .select("id, receipt_no, amount, method, paid_on, remarks")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing) payment = existing;
  }

  if (!payment) {
    const { data: bill, error: billError } = await supabase
      .from("fee_records")
      .select("total_payable, paid_total")
      .eq("id", feeRecordId)
      .single();
    if (billError) return { error: billError.message };

    const remaining = Number(bill.total_payable) - Number(bill.paid_total);
    if (amount > remaining && !isAdvance) {
      return {
        error: `Rs. ${amount.toLocaleString()} exceeds the remaining balance of Rs. ${remaining.toLocaleString()} (total payable Rs. ${Number(bill.total_payable).toLocaleString()}, already paid Rs. ${Number(bill.paid_total).toLocaleString()}). Tick "This is an advance payment" to collect more than what's currently due.`,
      };
    }

    // Goes through record_fee_payment() (0042_payment_idempotency.sql)
    // rather than a raw insert now — same authorization and the same
    // fee_payments row shape either way, but this is what lets a retried
    // request short-circuit to the existing row instead of ever reaching
    // the insert a second time.
    const { data: inserted, error } = await supabase.rpc("record_fee_payment", {
      p_fee_record_id: feeRecordId,
      p_student_id: studentId,
      p_month: month,
      p_amount: amount,
      p_method: method,
      p_remarks: remarks,
      p_is_advance: isAdvance,
      p_idempotency_key: idempotencyKey,
    });
    if (error) {
      if (error.message?.includes("PAYMENT_EXCEEDS_REMAINING")) {
        return { error: "That payment exceeds the remaining balance — someone else may have just recorded a payment for this bill. Refresh and try again." };
      }
      if (error.message?.includes("MONTH_CLOSED")) {
        return { error: "That accounting month is closed and can't take new payments. If this corrects a closed month, reverse the original payment and post the correction in the current month instead." };
      }
      if (error.message?.includes("NOT_AUTHORIZED")) {
        return { error: "You're not authorized to record payments." };
      }
      return { error: error.message };
    }
    payment = inserted;

    // Fire-and-forget-but-logged: dispatches this payment's PAYMENT_CREATED
    // event (emitted by the trigger in 0057) to its subscribers (audit,
    // notification) right away, using the service-role client since a
    // handler like the audit log needs to write regardless of RLS. Never
    // allowed to fail the payment itself — it already succeeded above —
    // and any failure here is still caught by the daily event-dispatch
    // automation job as a safety net, so a dropped request here doesn't
    // mean a payment silently never gets audited or emailed.
    try {
      const roleContext = await getRoleContext();
      if (roleContext?.instituteId) {
        const admin = createAdminClient();
        await dispatchPendingEvents(admin, { instituteId: roleContext.instituteId, limit: 5 });
      }
    } catch (dispatchErr) {
      console.error("[recordPayment] inline event dispatch failed (will retry via daily sweep):", dispatchErr.message);
    }
  }

  revalidatePath("/fees/payments");
  revalidatePath("/fees/pending");
  revalidatePath("/fees/records");
  revalidatePath("/dashboard");

  // Everything a receipt needs, gathered fresh right after the insert — the
  // bill numbers below (previous_balance, paid_total, etc) are the
  // post-payment state, exactly what the receipt should show as "as of this
  // payment", not what the form had loaded before it was submitted.
  const [{ data: { user } }, { data: freshBill }, { data: student }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("fee_records").select("month, monthly_fee, previous_balance, discount, total_payable, paid_total").eq("id", feeRecordId).single(),
    supabase.from("students").select("name, student_code, class:classes(name)").eq("id", studentId).single(),
  ]);
  const { data: me } = user
    ? await supabase.from("users").select("name").eq("auth_user_id", user.id).maybeSingle()
    : { data: null };

  return {
    success: true,
    receipt: {
      paymentId: payment.id,
      receiptNo: payment.receipt_no,
      studentName: student?.name || "",
      studentCode: student?.student_code || "",
      className: student?.class?.name || "",
      month: freshBill?.month,
      currentFee: freshBill?.monthly_fee,
      previousBalance: freshBill?.previous_balance,
      discount: freshBill?.discount,
      paid: payment.amount,
      remaining: freshBill ? Number(freshBill.total_payable) - Number(freshBill.paid_total) : 0,
      method: payment.method,
      date: payment.paid_on,
      receivedBy: me?.name || user?.email || "—",
    },
  };
}

// Phase 26 — this used to be a direct reverse_fee_payment() call from
// ReverseButton.js. Now it only ever files a request: the actual reversal
// (still reverse_fee_payment(), unchanged since 0011) is revoked from
// direct authenticated access (0056) and only runs from inside
// decide_fee_reversal(), triggered by a DIFFERENT person below.
export async function requestFeeReversal(paymentId, reason) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_fee_reversal", { p_fee_payment_id: paymentId, p_reason: reason });
  if (error) {
    if (error.message?.includes("ALREADY_REVERSED")) return { error: "This payment was already reversed." };
    if (error.message?.includes("ALREADY_PENDING")) return { error: "A reversal request for this payment is already awaiting authorization." };
    if (error.message?.includes("NOT_AUTHORIZED")) return { error: "You're not authorized to request a fee reversal." };
    if (error.message?.includes("REASON_REQUIRED")) return { error: "A reason is required." };
    return { error: error.message };
  }
  revalidatePath("/fees/payments");
  return { success: true, requestId: data };
}

// can_approve() (Super Admin/Principal) and the "not the same person who
// requested it" check both live inside decide_fee_reversal() itself — this
// action's job is only turning its errors into what PendingFeeReversals.js
// shows.
export async function decideFeeReversal(requestId, approve, note) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_fee_reversal", { p_request_id: requestId, p_approve: approve, p_note: note || null });
  if (error) {
    if (error.message?.includes("NOT_AUTHORIZED")) return { error: error.message.replace(/^NOT_AUTHORIZED:\s*/, "") };
    if (error.message?.includes("ALREADY_DECIDED")) return { error: "This request was already decided." };
    if (error.message?.includes("REASON_REQUIRED")) return { error: "A note is required to deny a reversal." };
    return { error: error.message };
  }
  revalidatePath("/fees/payments");
  revalidatePath("/dashboard");
  return { success: true };
}
