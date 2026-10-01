import { db } from "../db";
import { enqueue } from "../sync/outbox";
import { isBillCacheFreshEnough } from "./fees";

// Phase 8 — offline fee collection, with the guardrails the earlier
// read-only version of this file said any future version would need.
// Recap of the risk this exists to avoid: two cashiers offline, each
// looking at their own stale copy of the same bill, could both accept a
// payment that looks valid locally and only collide at sync time — by
// which point a parent already has a printed receipt. This file's answer
// is not "trust the offline check," it's "never let the offline check be
// the last word":
//
//   1. A payment can only be collected offline against a bill cache that's
//      recent (isBillCacheFreshEnough, fees.js) — a cashier who hasn't
//      synced in a while is told to sync before collecting, not allowed to
//      guess against day-old numbers.
//   2. The amount is capped at the cached remaining balance. No advance
//      payments offline — advance-vs-remaining has no real ceiling to
//      check against locally, so it always requires a connection.
//   3. The local receipt this produces (LOCAL-YYYY-NNNNN) is stored and
//      shown as PROVISIONAL everywhere — see status field below — never
//      as a final receipt number. It becomes a real fee_payments row (and
//      gets a real receipt_no) only once record_fee_payment() (0042,
//      called from sync-engine.js) accepts it.
//   4. If the server rejects it anyway (someone else's payment landed
//      first, the month closed in the meantime), that's routed to
//      sync_conflicts for a human to resolve — never silently discarded
//      and never silently confirmed. See markConflict() below and
//      sync-engine.js's handling of the "payments" entity.
export const canRecordPaymentsOffline = true;

export async function refreshPaymentHistory(supabase, instituteId, sinceMonth) {
  const { data, error } = await supabase
    .from("fee_payments")
    .select("id, institute_id, student_id, fee_record_id, month, amount, method, receipt_no, paid_on, is_advance")
    .eq("institute_id", instituteId)
    .gte("month", sinceMonth);
  if (error) throw error;
  await db.payments.where({ institute_id: instituteId }).delete();
  await db.payments.bulkPut(data);
  return data.length;
}

export async function getCachedPaymentsForStudent(instituteId, studentId) {
  return db.payments.where({ institute_id: instituteId, student_id: studentId }).sortBy("paid_on");
}

// Local receipt numbers are per-institute-per-year and purely cosmetic —
// they exist so a cashier has something to write on a paper slip and a
// parent has something to reference, not as a real ledger sequence (that's
// still receipt_no, assigned server-side on sync). Stored as a counter in
// sync_metadata rather than "count existing provisional_payments rows",
// because a synced-and-cleared or discarded entry must never free up its
// number for reuse.
async function nextLocalReceiptNumber(instituteId) {
  const year = new Date().getFullYear();
  const key = `local_receipt_seq:${instituteId}:${year}`;
  return db.transaction("rw", db.sync_metadata, async () => {
    const meta = await db.sync_metadata.get(key);
    const next = (meta?.value || 0) + 1;
    await db.sync_metadata.put({ key, value: next });
    return `LOCAL-${year}-${String(next).padStart(5, "0")}`;
  });
}

// status: "pending_sync" | "synced" | "conflict"
//
// Note what this deliberately does NOT do: it never calls
// get_or_create_fee_record() or any server RPC. bill must already be a
// getCachedBill() result the caller loaded (fees.js) — this function's
// whole job is the offline-safe path, so it only ever reasons about what's
// already sitting in the local cache.
export async function collectPaymentOffline({ instituteId, studentId, bill, amount, method, remarks, collectedBy }) {
  if (!(await isBillCacheFreshEnough(instituteId))) {
    throw new Error("BILL_CACHE_STALE: This student's bill hasn't synced recently enough to trust for an offline payment. Connect and sync, then try again.");
  }
  if (!bill) {
    throw new Error("NO_CACHED_BILL: No cached bill for this student/month. Sync while online at least once before collecting offline.");
  }
  const amt = Number(amount);
  if (!amt || amt <= 0) {
    throw new Error("INVALID_AMOUNT: Enter an amount greater than 0.");
  }
  const remaining = Number(bill.total_payable) - Number(bill.paid_total);
  if (amt > remaining) {
    throw new Error(`EXCEEDS_REMAINING: Rs. ${amt.toLocaleString()} is more than the Rs. ${remaining.toLocaleString()} currently due. Advance payments beyond what's due need a connection — this device's cached balance can't be trusted to authorize collecting more than it shows.`);
  }

  const localId = crypto.randomUUID();
  const idempotencyKey = crypto.randomUUID();
  const localReceiptNo = await nextLocalReceiptNumber(instituteId);
  const record = {
    local_id: localId,
    institute_id: instituteId,
    student_id: studentId,
    fee_record_id: bill.id,
    month: bill.month,
    amount: amt,
    method,
    remarks: remarks || null,
    collected_by: collectedBy,
    local_receipt_no: localReceiptNo,
    receipt_no: null, // filled in with the real server receipt_no once synced
    idempotency_key: idempotencyKey,
    status: "pending_sync",
    conflict_reason: null,
    created_at: new Date().toISOString(),
  };
  await db.provisional_payments.put(record);

  await enqueue({
    entity: "payments",
    entityId: localId,
    idempotencyKey,
    payload: {
      p_fee_record_id: bill.id,
      p_student_id: studentId,
      p_month: bill.month,
      p_amount: amt,
      p_method: method,
      p_remarks: remarks || null,
      p_is_advance: false,
    },
  });

  return record;
}

export async function markSynced(localId, serverPayment) {
  return db.provisional_payments.update(localId, {
    status: "synced",
    receipt_no: serverPayment?.receipt_no ?? null,
  });
}

// The server rejected it (or it failed enough times to need a human) —
// left visible in provisional_payments as "conflict" rather than deleted,
// because a cashier and an accountant both need to see that this specific
// receipt didn't go through, not just that it silently vanished. See
// sync/conflict-resolver.js for what happens next: discard it (money never
// really collected against this bill — needs reconciling with the
// cashier/parent) or retry with a corrected amount.
export async function markConflict(localId, reason) {
  return db.provisional_payments.update(localId, { status: "conflict", conflict_reason: reason });
}

// Unlike attendance's discardLocal (a genuine duplicate — nothing to
// reconcile, safe to delete), a voided *payment* already has real cash in
// a cashier's drawer and a printed slip in a parent's hand. Deleting the
// row would erase the one record that a discrepancy needs reconciling
// against, so this keeps it, marked voided, instead.
export async function voidLocal(localId, reason) {
  return db.provisional_payments.update(localId, { status: "voided", conflict_reason: reason || null });
}

export async function listProvisionalForStudent(instituteId, studentId) {
  return db.provisional_payments.where({ institute_id: instituteId, student_id: studentId }).sortBy("created_at");
}

export async function listPendingProvisional(instituteId) {
  // Caught by the same test pass as the resolved-boolean bug (Phase 33):
  // this previously matched anything status !== "synced", which included
  // "voided" and "conflict" — neither is "pending" in any useful sense
  // (voided is dead, conflict needs a human via conflict-resolver.js, not
  // a plain retry). Not yet consumed by any page, so this fix changes
  // nothing live — it just means whichever future screen calls this gets
  // the answer its name promises.
  const rows = await db.provisional_payments.where({ institute_id: instituteId }).toArray();
  return rows.filter((r) => r.status === "pending_sync");
}
