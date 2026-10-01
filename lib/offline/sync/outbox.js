import { db } from "../db";

// Every entry: id, operation, entity, entity_id, payload, idempotency_key,
// created_at, attempts, status, last_error — exactly the shape asked for.
// The idempotency_key is generated HERE, once, at the moment something is
// queued — never regenerated on retry. That's what makes it useful: the
// server can tell "this is the third attempt at the same entry" from
// "this is a new entry," which its own created_at/attempts alone can't.

export async function enqueue({ entity, entityId, operation = "insert", payload, idempotencyKey: presetKey }) {
  // Almost every caller wants one generated here (see the file comment).
  // The one exception is a provisional fee payment, which needs to know
  // its own idempotency key at the moment it's created — before this
  // function runs — so the same key can be shown/stored on that local
  // record for cross-reference. Passing it in just skips the redundant
  // regeneration; it never lets a caller reuse an old key across genuinely
  // different attempts.
  const idempotencyKey = presetKey || crypto.randomUUID();
  const id = await db.sync_outbox.add({
    operation,
    entity,
    entity_id: entityId,
    payload,
    idempotency_key: idempotencyKey,
    created_at: new Date().toISOString(),
    attempts: 0,
    status: "pending", // pending | syncing | synced | failed | conflict
    last_error: null,
  });
  return { id, idempotencyKey };
}

export async function listPending() {
  return db.sync_outbox.where("status").anyOf(["pending", "failed"]).sortBy("created_at");
}

export async function markSyncing(id) {
  return db.sync_outbox.update(id, { status: "syncing" });
}

// Kept in the table (status="synced") rather than deleted — an outbox
// entry is also the audit trail of "what did this device try to do and
// when," which is worth having even after it succeeds. Callers that only
// care about pending work already filter status in listPending()/countPending().
export async function markSynced(id) {
  return db.sync_outbox.update(id, { status: "synced" });
}

export async function markFailed(id, error) {
  const entry = await db.sync_outbox.get(id);
  return db.sync_outbox.update(id, {
    status: "failed",
    attempts: (entry?.attempts || 0) + 1,
    last_error: error,
  });
}

export async function markConflict(id, error) {
  return db.sync_outbox.update(id, { status: "conflict", last_error: error });
}

export async function countPending() {
  return db.sync_outbox.where("status").anyOf(["pending", "failed"]).count();
}

// Distinct from countPending's "pending" (status='pending', never tried
// yet, or mid-retry-backoff) — this is specifically entries that have
// already failed at least once and are sitting there until the next sync
// attempt or a person intervenes. Surfaced on /automation as "Failed
// Jobs" so a stuck device is visible at a glance, not just lumped into
// a generic pending count.
export async function countFailed() {
  return db.sync_outbox.where("status").equals("failed").count();
}
