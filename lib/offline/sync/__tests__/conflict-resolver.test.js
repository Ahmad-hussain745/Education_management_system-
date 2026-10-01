import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/offline/db";
import { collectPaymentOffline } from "@/lib/offline/repositories/payments";
import { listOpenConflicts, discardConflict } from "@/lib/offline/sync/conflict-resolver";

const INSTITUTE_ID = "11111111-1111-1111-1111-111111111111";
const STUDENT_ID = "22222222-2222-2222-2222-222222222222";
const FEE_RECORD_ID = "33333333-3333-3333-3333-333333333333";
const BILL = { id: FEE_RECORD_ID, month: "2026-09-01", total_payable: 8000, paid_total: 0 };

describe("Conflict handling: a discarded PAYMENT conflict is voided, never deleted", () => {
  beforeEach(async () => {
    await db.provisional_payments.clear();
    await db.sync_outbox.clear();
    await db.sync_conflicts.clear();
    await db.sync_metadata.clear();
    await db.sync_metadata.put({ key: `last_sync:fee_records:${INSTITUTE_ID}`, value: new Date().toISOString() });
  });

  it("keeps the provisional payment record, marked voided, instead of deleting it", async () => {
    // Real cash may have already changed hands offline — deleting the
    // record on discard would erase the one thing a cashier/accountant
    // has to reconcile that cash against later. This is the property this
    // test exists to guard: discard must never be delete for a payment.
    const provisional = await collectPaymentOffline({
      instituteId: INSTITUTE_ID, studentId: STUDENT_ID, bill: BILL, amount: 5000, method: "Cash", collectedBy: "cashier-1",
    });

    // Simulate sync-engine.js routing a sync failure to a conflict — e.g.
    // the month closed between offline collection and sync.
    const conflictId = await db.sync_conflicts.add({
      entity: "payments",
      entity_id: provisional.local_id,
      payload: { amount: 5000 },
      reason: "MONTH_CLOSED",
      created_at: new Date().toISOString(),
      resolved: false,
    });

    let open = await listOpenConflicts();
    expect(open).toHaveLength(1);

    await discardConflict(conflictId);

    // Still exists — not deleted.
    const stillThere = await db.provisional_payments.get(provisional.local_id);
    expect(stillThere).toBeDefined();
    expect(stillThere.status).toBe("voided");
    expect(stillThere.conflict_reason).toContain("reconcile the collected cash manually");

    // No longer open.
    open = await listOpenConflicts();
    expect(open).toHaveLength(0);
    const conflictRow = await db.sync_conflicts.get(conflictId);
    expect(conflictRow.resolved).toBe(true);
    expect(conflictRow.resolution).toBe("discarded");
  });

  it("a voided payment is excluded from what still needs to sync", async () => {
    const provisional = await collectPaymentOffline({
      instituteId: INSTITUTE_ID, studentId: STUDENT_ID, bill: BILL, amount: 5000, method: "Cash", collectedBy: "cashier-1",
    });
    const { voidLocal, listPendingProvisional } = await import("@/lib/offline/repositories/payments");
    await voidLocal(provisional.local_id, "test void");

    const pending = await listPendingProvisional(INSTITUTE_ID);
    expect(pending.find((p) => p.local_id === provisional.local_id)).toBeUndefined();
  });
});
