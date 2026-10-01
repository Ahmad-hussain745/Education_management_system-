import Dexie from "dexie";

// One IndexedDB database, shared by every institute that ever logs in on
// this device — every table that holds real data (not just app-wide
// reference lookups) carries institute_id, and every repository query
// filters by it explicitly. IndexedDB has no row-level security the way
// Postgres does, so that filtering is this layer's own job; it exists
// specifically to stop a shared/kiosk device from mixing two institutes'
// cached data in one browser profile.
//
// SCOPE — attendance, expenses, and inventory are fully offline read/write.
// Teachers/classes/sections/fee_structures/fee_records/payments are
// READ-ONLY caches here, refreshed whenever online, used so screens (e.g.
// marking attendance, or looking up what a student currently owes) can
// still show real data while offline.
//
// Fee payments (v3) and student registration (v4) are the two exceptions
// with their own write path instead of the plain outbox pattern the other
// three use — see repositories/payments.js and repositories/students.js
// for why each needed one.
export const db = new Dexie("msa_offline");

db.version(1).stores({
  // ---- read-only reference caches (refreshed from the server whenever online) ----
  students: "id, institute_id, class_id, section_id, status",
  teachers: "id, institute_id, status",
  classes: "id, institute_id",
  sections: "id, institute_id, class_id",
  fee_structures: "id, institute_id, class_id",
  fee_records: "id, institute_id, student_id, month",
  payments: "id, institute_id, student_id, fee_record_id, paid_on",

  // ---- read/write, outbox-backed ----
  attendance: "local_id, institute_id, student_id, date, synced",
  expenses: "local_id, institute_id, expense_date, synced",
  inventory: "local_id, institute_id, item_id, movement_date, synced",

  // ---- sync machinery (v1 shape — superseded by v2 below) ----
  sync_outbox: "++id, table, status, created_at",
  sync_conflicts: "++id, table, local_id, created_at, resolved",
  sync_metadata: "key",
});

// v2 — sync_outbox's fields renamed/extended to the requested shape:
// id, operation, entity, entity_id, payload, idempotency_key, created_at,
// attempts, status, last_error. Dexie upgrade migrates existing rows
// rather than dropping them, so a device with entries already queued
// under the old field names (table/localId/lastError) doesn't lose them.
db.version(2)
  .stores({
    sync_outbox: "++id, entity, status, created_at, idempotency_key",
    sync_conflicts: "++id, entity, entity_id, created_at, resolved",
  })
  .upgrade(async (tx) => {
    await tx
      .table("sync_outbox")
      .toCollection()
      .modify((entry) => {
        if (entry.entity === undefined) entry.entity = entry.table;
        if (entry.entity_id === undefined) entry.entity_id = entry.localId;
        if (entry.last_error === undefined) entry.last_error = entry.lastError;
        if (entry.idempotency_key === undefined) entry.idempotency_key = crypto.randomUUID();
        delete entry.table;
        delete entry.localId;
        delete entry.lastError;
      });
    await tx
      .table("sync_conflicts")
      .toCollection()
      .modify((entry) => {
        if (entry.entity === undefined) entry.entity = entry.table;
        if (entry.entity_id === undefined) entry.entity_id = entry.local_id;
        delete entry.table;
      });
  });

// v3 — provisional (offline-collected) fee payments. Deliberately its own
// table, not a repurposed `payments` (the read-only synced-history cache)
// and not a bare outbox entry: a cashier and an accountant both need to
// *see* a local receipt's status (pending_sync / synced / conflict), which
// means it needs to exist as a real, queryable local record in its own
// right — not just live inside sync_outbox's opaque payload. See
// repositories/payments.js for the full collection flow and the caps that
// make this safe to allow at all.
db.version(3).stores({
  provisional_payments: "local_id, institute_id, student_id, fee_record_id, status, created_at",
});

// v4 — offline student registration (Phase 9). Same reasoning as v3: a
// cashier/registrar needs to *see* "did this student I added this morning
// actually sync yet, and what's their real ID now" — a plain outbox entry
// is opaque to the UI, so this is a real local table. local_id is the
// device-generated uuid from the diagram (offline://<device-id>/<local_id>
// for display — see repositories/students.js getLocalStudentRef()) and
// doubles as create_student()'s idempotency key; official_id/
// official_student_code stay null until sync-engine.js fills them in.
db.version(4).stores({
  local_students: "local_id, institute_id, sync_status, created_at",
});

// v5 — Phase 10, offline attendance. classes/sections have been declared
// since v1 but nothing ever populated them (see repositories/academic.js,
// new in this phase) — that gap is what actually made Phase 8/9's own
// caches unreliable too (a device could have gone offline having never
// cached a single class), fixed here for all of them at once via
// sync/prime-cache.js. teacher_classes is new: which classes a Teacher
// account may mark attendance for has to be enforceable-ish offline too
// (RLS still enforces it for real at sync time either way) so a teacher
// isn't offered classes in the picker that "teacher manages own classes'
// attendance" (0002_rls.sql) would reject at sync.
db.version(5).stores({
  teacher_classes: "id, institute_id, teacher_id, class_id",
});

// v6 — BUG FIX (found by an automated test, Phase 33): `resolved` was
// declared as an indexed field and queried with
// .where("resolved").equals(false) in conflict-resolver.js and
// sync-status.js. IndexedDB's spec only allows number, string, Date,
// binary, and array as key values — boolean is not a valid key type.
// fake-indexeddb (used in tests) enforces this correctly and throws;
// real browsers' native IndexedDB implementations are spec-compliant too,
// so this would have thrown the same DataError the first time anyone
// actually opened the conflict-review panel in production. The "a human
// reviews conflicts" safety net this entire offline architecture depends
// on for its risky cases (insufficient stock, a closed month, a payment
// conflict) would have been silently broken by a schema-declaration typo
// that had nothing to do with any of that logic.
//
// Fix: `resolved` is no longer an indexed field — both call sites now
// fetch the (small, per-device) sync_conflicts table and filter in JS,
// which sidesteps the whole class of "which JS values are valid
// IndexedDB keys" issues rather than finding a different indexable
// encoding (e.g. 0/1) that could hit the same category of surprise again
// with a future field.
db.version(6).stores({
  sync_conflicts: "++id, entity, entity_id, created_at",
});

export default db;
