import { db } from "../db";
import * as inventoryRepo from "../repositories/inventory";
import * as paymentsRepo from "../repositories/payments";
import * as studentsRepo from "../repositories/students";
import { enqueue } from "./outbox";

// Every conflict landing here already went through sync-engine.js's
// automatic handling of the safe case (duplicate attendance — silently
// discarded, no human needed). What's left is genuinely ambiguous:
// insufficient stock, a closed accounting month, or something that failed
// repeatedly for an unclear reason. Nothing in this file auto-picks a
// winner.

export async function listOpenConflicts() {
  // Was db.sync_conflicts.where("resolved").equals(false) — see db.js v6's
  // comment: boolean isn't a valid IndexedDB key, so that threw in every
  // real browser. This table is small (per-device, only unresolved
  // conflicts accumulate), so a full read + JS filter costs nothing
  // meaningful and sidesteps the whole issue.
  const all = await db.sync_conflicts.toArray();
  return all.filter((c) => !c.resolved);
}

// Human says: "discard the offline entry, it's no longer valid" — e.g. the
// stock really was taken by someone else first, this one shouldn't happen.
export async function discardConflict(conflictId) {
  const conflict = await db.sync_conflicts.get(conflictId);
  if (!conflict) return;
  // A discarded PAYMENT conflict means "this offline receipt doesn't
  // become a real payment" — real cash may already have changed hands, so
  // this is voided (kept, flagged) rather than deleted the way an
  // attendance duplicate is. Reconciling that cash with the cashier/parent
  // is a step outside this app.
  if (conflict.entity === "payments") {
    await paymentsRepo.voidLocal(conflict.entity_id, "Discarded by accountant during conflict review — reconcile the collected cash manually.");
  }
  // A discarded STUDENT registration means "this local entry never
  // becomes a real student" — the local_id was never a real id anywhere
  // else in the system (nothing could have referenced it, unlike a
  // payment against a real bill), so kept-and-voided here is about intake
  // paperwork traceability, not undoing anything downstream.
  if (conflict.entity === "students") {
    await studentsRepo.voidLocal(conflict.entity_id, "Discarded during conflict review — this registration was not created.");
  }
  await db.sync_conflicts.update(conflictId, { resolved: true, resolution: "discarded", resolved_at: new Date().toISOString() });
}

// Human says: "try again with an adjusted quantity/value" — re-queues a
// corrected payload (with a FRESH idempotency key, since this is a
// deliberately new attempt, not a mechanical retry of the failed one)
// rather than blindly resubmitting what failed.
export async function retryConflictWithAdjustment(conflictId, adjustedPayload) {
  const conflict = await db.sync_conflicts.get(conflictId);
  if (!conflict) return;

  if (conflict.entity === "inventory") {
    await inventoryRepo.queueStockMovement({
      instituteId: adjustedPayload.institute_id,
      itemId: adjustedPayload.p_item_id ?? conflict.payload.p_item_id,
      movementType: adjustedPayload.p_movement_type ?? conflict.payload.p_movement_type,
      quantity: adjustedPayload.p_quantity ?? conflict.payload.p_quantity,
      reason: adjustedPayload.p_reason ?? conflict.payload.p_reason,
      movementDate: adjustedPayload.p_movement_date ?? conflict.payload.p_movement_date,
    });
  } else if (conflict.entity === "payments") {
    // "Retry" here means an accountant, looking at this online (they're in
    // the conflict-review screen, which needs a connection to fetch
    // conflicts anyway), decided the corrected amount is really owed and
    // is re-submitting it — not the mechanical "same request, ask again"
    // retry a network failure gets. A fresh idempotency key is correct:
    // this is deliberately a new attempt, and the provisional_payments row
    // goes back to pending_sync so the receipt no longer shows "conflict".
    const payload = { ...conflict.payload, ...adjustedPayload };
    const { idempotencyKey } = await enqueue({ entity: "payments", entityId: conflict.entity_id, payload });
    await db.provisional_payments.update(conflict.entity_id, {
      status: "pending_sync",
      idempotency_key: idempotencyKey,
      amount: payload.p_amount,
      conflict_reason: null,
    });
  } else if (conflict.entity === "students") {
    // Same shape as the payments branch above: a fresh idempotency key for
    // a deliberately new attempt (e.g. corrected class_id after the
    // original class was deleted), local_students row goes back to
    // pending_sync.
    const payload = { ...conflict.payload, ...adjustedPayload };
    const { idempotencyKey } = await enqueue({ entity: "students", entityId: conflict.entity_id, payload });
    await db.local_students.update(conflict.entity_id, {
      sync_status: "pending_sync",
      conflict_reason: null,
      ...(adjustedPayload.p_class_id !== undefined ? { class_id: adjustedPayload.p_class_id } : {}),
      ...(adjustedPayload.p_section_id !== undefined ? { section_id: adjustedPayload.p_section_id } : {}),
    });
  } else {
    await enqueue({ entity: conflict.entity, entityId: conflict.entity_id, payload: { ...conflict.payload, ...adjustedPayload } });
  }

  await db.sync_conflicts.update(conflictId, { resolved: true, resolution: "retried", resolved_at: new Date().toISOString() });
}
