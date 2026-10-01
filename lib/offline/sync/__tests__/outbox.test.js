import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/offline/db";
import * as outbox from "@/lib/offline/sync/outbox";

describe("Outbox: idempotency and status transitions", () => {
  beforeEach(async () => {
    await db.sync_outbox.clear();
  });

  it("generates a unique idempotency key per enqueue when none is supplied", async () => {
    const a = await outbox.enqueue({ entity: "expenses", entityId: "local-1", payload: { amount: 100 } });
    const b = await outbox.enqueue({ entity: "expenses", entityId: "local-2", payload: { amount: 200 } });
    expect(a.idempotencyKey).toBeTruthy();
    expect(b.idempotencyKey).toBeTruthy();
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });

  it("respects an explicitly supplied idempotency key rather than generating a new one", async () => {
    const fixedKey = "fixed-test-key-1234";
    const { idempotencyKey } = await outbox.enqueue({ entity: "payments", entityId: "local-1", payload: {}, idempotencyKey: fixedKey });
    expect(idempotencyKey).toBe(fixedKey);
    const pending = await outbox.listPending();
    expect(pending[0].idempotency_key).toBe(fixedKey);
  });

  it("listPending returns pending and failed, never synced or conflict entries", async () => {
    const { id: id1 } = await outbox.enqueue({ entity: "expenses", entityId: "l1", payload: {} });
    const { id: id2 } = await outbox.enqueue({ entity: "expenses", entityId: "l2", payload: {} });
    const { id: id3 } = await outbox.enqueue({ entity: "expenses", entityId: "l3", payload: {} });

    await outbox.markSynced(id1);
    await outbox.markFailed(id2, "network error");
    await outbox.markConflict(id3, "INSUFFICIENT_STOCK");

    const pending = await outbox.listPending();
    // id2 (failed) should still show up for retry; id1 (synced) and id3
    // (conflict, needs a human) should not.
    expect(pending.map((p) => p.entity_id)).toEqual(["l2"]);
  });

  it("markFailed increments attempts each time, preserving the original idempotency key", async () => {
    const { id, idempotencyKey } = await outbox.enqueue({ entity: "expenses", entityId: "l1", payload: {} });
    await outbox.markFailed(id, "error 1");
    await outbox.markFailed(id, "error 2");
    const entry = await db.sync_outbox.get(id);
    expect(entry.attempts).toBe(2);
    expect(entry.last_error).toBe("error 2");
    expect(entry.idempotency_key).toBe(idempotencyKey); // never regenerated on retry
  });

  it("countPending matches listPending's length", async () => {
    await outbox.enqueue({ entity: "expenses", entityId: "l1", payload: {} });
    const { id } = await outbox.enqueue({ entity: "expenses", entityId: "l2", payload: {} });
    await outbox.markSynced(id);
    expect(await outbox.countPending()).toBe(1);
  });
});
