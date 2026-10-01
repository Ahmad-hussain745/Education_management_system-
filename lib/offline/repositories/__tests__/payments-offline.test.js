import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/offline/db";
import { collectPaymentOffline } from "@/lib/offline/repositories/payments";
import * as outbox from "@/lib/offline/sync/outbox";

const INSTITUTE_ID = "11111111-1111-1111-1111-111111111111";
const STUDENT_ID = "22222222-2222-2222-2222-222222222222";
const FEE_RECORD_ID = "33333333-3333-3333-3333-333333333333";

async function seedFreshBillCache() {
  await db.sync_metadata.put({ key: `last_sync:fee_records:${INSTITUTE_ID}`, value: new Date().toISOString() });
}

const BILL = { id: FEE_RECORD_ID, month: "2026-09-01", total_payable: 8000, paid_total: 0 };

// ============================================================================
// THE MANDATORY TEST — "Offline payment → Sync → Duplicate sync attempt →
// Only ONE payment exists."
//
// What this test actually exercises, stated plainly: the offline HALF
// (collectPaymentOffline, real Dexie via fake-indexeddb, genuinely
// executed) is fully real. The SYNC half is a faithful reproduction of
// record_fee_payment()'s actual logic (supabase/migrations/0042_payment_idempotency.sql)
// — "if a row with this idempotency_key already exists, return it and stop,
// checked before anything else" — run here as a plain JS function standing
// in for the real Postgres RPC, because this sandbox has no live database
// to call it against for real. The SQL file
// supabase/tests/duplicate_payment_and_receipt_test.sql runs the identical
// scenario against the real function, meant to be executed against an
// actual Supabase project — this file is what verifies the algorithm
// itself, always, on every commit, without needing one.
// ============================================================================

function makeMockPaymentServer() {
  const rows = [];
  return {
    rows,
    // Faithful copy of record_fee_payment()'s own logic (0042): idempotency
    // check FIRST, before anything else — a retry of an already-successful
    // call must never be rejected or duplicated by state the first call
    // itself already changed.
    recordFeePayment(payload) {
      const existing = rows.find((r) => r.idempotency_key === payload.p_idempotency_key);
      if (existing) return existing;
      const row = {
        id: `payment-${rows.length + 1}`,
        fee_record_id: payload.p_fee_record_id,
        student_id: payload.p_student_id,
        month: payload.p_month,
        amount: payload.p_amount,
        method: payload.p_method,
        idempotency_key: payload.p_idempotency_key,
        receipt_no: `RCP-2026-${String(rows.length + 1).padStart(6, "0")}`,
      };
      rows.push(row);
      return row;
    },
  };
}

describe("Mandatory: offline payment -> sync -> duplicate sync -> only ONE payment exists", () => {
  beforeEach(async () => {
    await db.provisional_payments.clear();
    await db.sync_outbox.clear();
    await db.sync_metadata.clear();
  });

  it("produces exactly one server-side payment even when the sync call is retried with the same idempotency key", async () => {
    await seedFreshBillCache();

    // 1. OFFLINE: cashier collects Rs. 3,000 while disconnected.
    const provisional = await collectPaymentOffline({
      instituteId: INSTITUTE_ID,
      studentId: STUDENT_ID,
      bill: BILL,
      amount: 3000,
      method: "Cash",
      collectedBy: "cashier-1",
    });

    expect(provisional.status).toBe("pending_sync");
    expect(provisional.local_receipt_no).toMatch(/^LOCAL-\d{4}-\d{5}$/);
    expect(provisional.receipt_no).toBeNull(); // no real receipt number yet — that's the whole point

    const pending = await outbox.listPending();
    expect(pending).toHaveLength(1);
    const outboxEntry = pending[0];
    expect(outboxEntry.idempotency_key).toBeTruthy();
    expect(outboxEntry.payload.p_amount).toBe(3000);

    // 2. SYNC: connection returns, the outbox entry is pushed to the server.
    const server = makeMockPaymentServer();
    const firstResult = server.recordFeePayment(outboxEntry.payload);
    expect(server.rows).toHaveLength(1);
    expect(firstResult.amount).toBe(3000);

    // 3. DUPLICATE SYNC ATTEMPT: the exact failure mode this test exists
    //    for — the first sync's response never reached the client (dropped
    //    connection, timeout), so the outbox entry is STILL marked pending
    //    and gets retried with the SAME idempotency key. This is not a
    //    hypothetical: it's exactly what sync-engine.js does on any network
    //    error, and it's exactly why the key is generated once at enqueue
    //    time and never regenerated on retry (outbox.js).
    const secondResult = server.recordFeePayment(outboxEntry.payload);

    // THE ASSERTION THAT MATTERS: still exactly one row, not two.
    expect(server.rows).toHaveLength(1);
    // And the retry got back the SAME row — same id, same receipt number —
    // not a rejection and not a second payment with a different receipt.
    expect(secondResult.id).toBe(firstResult.id);
    expect(secondResult.receipt_no).toBe(firstResult.receipt_no);

    // A third, fourth, fifth retry — same guarantee, not just "the second
    // one happened to be fine."
    for (let i = 0; i < 3; i++) {
      server.recordFeePayment(outboxEntry.payload);
    }
    expect(server.rows).toHaveLength(1);
  });

  it("never produces two DIFFERENT idempotency keys for what the cashier experiences as one payment", async () => {
    // Guards the other way a duplicate could sneak in: if the offline
    // repository generated a NEW key every time collectPaymentOffline()
    // ran, retry-safety at the server would be irrelevant — two
    // genuinely different keys are two genuinely different payments as
    // far as record_fee_payment() is concerned, by design (see 0042: two
    // real payments of the same amount on the same day are legitimate,
    // nothing should silently merge them). This test is about NOT calling
    // collectPaymentOffline() twice for one cashier action — that's a UI
    // concern (the Record Payment button must disable while pending), and
    // is out of scope for this file.
    await seedFreshBillCache();
    const provisional = await collectPaymentOffline({
      instituteId: INSTITUTE_ID, studentId: STUDENT_ID, bill: BILL, amount: 3000, method: "Cash", collectedBy: "cashier-1",
    });
    const entries = await outbox.listPending();
    expect(entries).toHaveLength(1);
    expect(entries[0].idempotency_key).toBe(provisional.idempotency_key);
  });
});

describe("Offline payment guardrails (collectPaymentOffline)", () => {
  beforeEach(async () => {
    await db.provisional_payments.clear();
    await db.sync_outbox.clear();
    await db.sync_metadata.clear();
  });

  it("rejects when the bill cache hasn't synced recently enough to trust", async () => {
    // No seedFreshBillCache() call — sync_metadata is empty, so
    // getBillFreshnessHours() returns Infinity and the guard must refuse.
    await expect(
      collectPaymentOffline({ instituteId: INSTITUTE_ID, studentId: STUDENT_ID, bill: BILL, amount: 1000, method: "Cash", collectedBy: "c1" })
    ).rejects.toThrow(/BILL_CACHE_STALE/);
  });

  it("rejects an amount larger than the cached remaining balance — no local ceiling to trust for more", async () => {
    await seedFreshBillCache();
    await expect(
      collectPaymentOffline({ instituteId: INSTITUTE_ID, studentId: STUDENT_ID, bill: BILL, amount: 9000, method: "Cash", collectedBy: "c1" })
      // BILL.total_payable(8000) - paid_total(0) = 8000 remaining; 9000 > 8000
    ).rejects.toThrow(/EXCEEDS_REMAINING/);
  });

  it("rejects a zero or negative amount", async () => {
    await seedFreshBillCache();
    await expect(
      collectPaymentOffline({ instituteId: INSTITUTE_ID, studentId: STUDENT_ID, bill: BILL, amount: 0, method: "Cash", collectedBy: "c1" })
    ).rejects.toThrow(/INVALID_AMOUNT/);
  });

  it("requires a cached bill to exist at all", async () => {
    await seedFreshBillCache();
    await expect(
      collectPaymentOffline({ instituteId: INSTITUTE_ID, studentId: STUDENT_ID, bill: null, amount: 1000, method: "Cash", collectedBy: "c1" })
    ).rejects.toThrow(/NO_CACHED_BILL/);
  });
});
