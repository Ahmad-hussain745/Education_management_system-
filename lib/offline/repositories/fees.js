import { db } from "../db";

// Computing a fee bill (monthly_fee, previous_balance, discount,
// total_payable) always requires a connection — that depends on
// calculate_student_fee_dues() (0039_canonical_fee_engine.sql), which
// reads live discount and payment history at the moment a bill is
// generated. Duplicating that logic into JavaScript here is exactly the
// thing 0039 was written to stop happening, so there is no offline bill
// *generation* and never will be — canRecordFeesOffline below is about
// that, and stays false.
//
// COLLECTING a payment against an already-cached bill is a different
// question, and since Phase 8 the answer is a careful "yes, capped" — see
// repositories/payments.js for the full design (provisional receipts,
// freshness/amount caps, conflict handling). This file's only involvement
// in that is getCachedBill()/isBillCacheFreshEnough() below, which
// payments.js reads and never writes.
export const canRecordFeesOffline = false;

export async function refreshFeeStructures(supabase, instituteId) {
  const { data, error } = await supabase
    .from("fee_structures")
    .select("id, institute_id, class_id, amount, effective_from")
    .eq("institute_id", instituteId);
  if (error) throw error;
  await db.fee_structures.where({ institute_id: instituteId }).delete();
  await db.fee_structures.bulkPut(data);
  return data.length;
}

export async function refreshFeeRecords(supabase, instituteId, sinceMonth) {
  const { data, error } = await supabase
    .from("fee_records")
    .select("id, institute_id, student_id, month, monthly_fee, previous_balance, discount, total_payable, paid_total, status")
    .eq("institute_id", instituteId)
    .gte("month", sinceMonth);
  if (error) throw error;
  await db.fee_records.where({ institute_id: instituteId }).delete();
  await db.fee_records.bulkPut(data);
  await db.sync_metadata.put({ key: `last_sync:fee_records:${instituteId}`, value: new Date().toISOString() });
  return data.length;
}

export async function getCachedBill(instituteId, studentId, month) {
  return db.fee_records.where({ institute_id: instituteId, student_id: studentId, month }).first();
}

// How stale is too stale to collect against? Past this, "remaining" in the
// cache could easily no longer match reality (another cashier's sync,
// a discount added, month closed) closely enough to trust for money — see
// repositories/payments.js's collectPaymentOffline(), the only caller that
// checks this.
const MAX_BILL_AGE_HOURS = 24;

export async function getBillFreshnessHours(instituteId) {
  const meta = await db.sync_metadata.get(`last_sync:fee_records:${instituteId}`);
  if (!meta?.value) return Infinity;
  return (Date.now() - new Date(meta.value).getTime()) / (1000 * 60 * 60);
}

export async function isBillCacheFreshEnough(instituteId) {
  return (await getBillFreshnessHours(instituteId)) <= MAX_BILL_AGE_HOURS;
}
