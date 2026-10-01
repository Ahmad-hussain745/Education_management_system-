import { db } from "./db";

// A short, stable id for THIS browser/device — generated once, stored in
// sync_metadata (the same table connectivity/last-sync timestamps already
// live in), reused forever after. Not a security identifier and never
// sent to the server as one; it exists purely so a local reference like
// offline://device-a1b2c3/550e8400-... means something to a human reading
// it ("which machine registered this"), the way the Phase 9 example shows.
let cached = null;

export async function getDeviceId() {
  if (cached) return cached;
  const key = "device_id";
  const existing = await db.sync_metadata.get(key);
  if (existing?.value) {
    cached = existing.value;
    return cached;
  }
  const id = `device-${crypto.randomUUID().slice(0, 8)}`;
  await db.sync_metadata.put({ key, value: id });
  cached = id;
  return id;
}
