import { db } from "../db";
import { enqueue } from "../sync/outbox";
import { getDeviceId } from "../device";

// `students` (the table used by refreshStudents/getStudentById/
// searchStudentsCached below) is a READ-ONLY cache — students are edited
// server-side only, refreshed here so screens like offline attendance-
// marking can still show names/class/section while there's no connection.
//
// Registering a NEW student offline is a different table entirely —
// `local_students`, below — for the same reason provisional_payments isn't
// a repurposed `payments`: a local registration needs its own identity
// (local_id) and its own visible status (pending_sync/synced/conflict)
// until create_student() (0043_offline_student_registration.sql) confirms
// it with a real id and an official student_code. It never gets written
// into the `students` cache pretending to be a real row — that cache is
// only ever a mirror of what the server has actually confirmed.

export async function refreshStudents(supabase, instituteId) {
  const { data, error } = await supabase
    .from("students")
    .select("id, institute_id, student_code, name, guardian_name, guardian_phone, address, class_id, section_id, status")
    .eq("institute_id", instituteId)
    .eq("status", "active");
  if (error) throw error;
  await db.students.where({ institute_id: instituteId }).delete();
  await db.students.bulkPut(data);
  await db.sync_metadata.put({ key: `last_sync:students:${instituteId}`, value: new Date().toISOString() });
  return data.length;
}

export async function getStudentsForClass(instituteId, classId, sectionId) {
  let coll = db.students.where({ institute_id: instituteId, class_id: classId });
  const rows = await coll.toArray();
  return sectionId ? rows.filter((s) => s.section_id === sectionId) : rows;
}

export async function getStudentById(instituteId, studentId) {
  return db.students.get(studentId);
}

// ============================================================================
// Low-risk contact fields — Phase 31. guardian_name/guardian_phone/address
// are the fields this app treats as low-risk: unlike a payment, class
// assignment, or fee override, two people editing the same student's phone
// number from two devices has no real "wrong" outcome to detect — whoever's
// edit reaches the server last is simply correct going forward, which is
// exactly what a plain UPDATE (no idempotency key, no server-side check,
// no sync_conflicts entry) already gives you for free. That's the whole
// implementation: this is deliberately NOT routed through payments.js/
// students.js's conflict-aware pattern above (markConflict/voidLocal)
// because there is nothing here that should ever land in that queue.
//
// The local `students` cache is updated optimistically at the same time —
// this is the one write this read-only cache (see this file's top comment)
// is allowed to take locally ahead of confirmation, specifically because
// there's no confirmation to wait for: LWW means this device's own view is
// already correct by definition, pending only the network catching up.
export async function queueContactUpdate({ instituteId, studentId, guardianName, guardianPhone, address }) {
  const payload = {
    guardian_name: guardianName ?? null,
    guardian_phone: guardianPhone ?? null,
    address: address ?? null,
  };
  await db.students.update(studentId, payload);
  await enqueue({
    entity: "student_contact",
    entityId: studentId,
    payload: { student_id: studentId, ...payload },
  });
}

// The offline stand-in for search_students() (0029_scalable_listings.sql) —
// a plain in-memory filter over the cached table instead of a server RPC.
// Fine at cache size (one institute's active students on one device); this
// is not meant to scale the way the server-side search does.
export async function searchStudentsCached(instituteId, query, limit = 10) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all = await db.students.where({ institute_id: instituteId }).toArray();
  return all
    .filter((s) => s.name?.toLowerCase().includes(q) || s.student_code?.toLowerCase().includes(q))
    .slice(0, limit);
}

// ============================================================================
// Offline registration — Phase 9
// ============================================================================

// sync_status: "pending_sync" | "synced" | "conflict" | "voided"
//
// local_id is generated here and reused as create_student()'s
// p_idempotency_key when sync-engine.js processes the outbox entry — the
// same uuid identifies this record locally AND anchors the server-side
// idempotency check, so a retried sync (this device's own retry, or two
// sync passes after a dropped response) can never register the same child
// twice. Nothing about the official student_code is ever decided here —
// see this function's caller-facing contract: the row this returns has
// official_id/official_student_code both null until markSynced() runs.
export async function registerStudentOffline({
  instituteId, name, guardianName, guardianPhone, classId, sectionId,
  admissionDate, status, monthlyFee, discount, discountReason, registeredBy,
}) {
  const localId = crypto.randomUUID();
  const deviceId = await getDeviceId();
  const record = {
    local_id: localId,
    institute_id: instituteId,
    device_id: deviceId,
    local_ref: `offline://${deviceId}/${localId}`,
    name,
    guardian_name: guardianName || null,
    guardian_phone: guardianPhone || null,
    class_id: classId || null,
    section_id: sectionId || null,
    admission_date: admissionDate,
    person_status: status || "active",
    monthly_fee: monthlyFee || null,
    discount: discount || null,
    discount_reason: discountReason || null,
    registered_by: registeredBy || null,
    official_id: null,
    official_student_code: null,
    sync_status: "pending_sync",
    conflict_reason: null,
    created_at: new Date().toISOString(),
  };
  await db.local_students.put(record);

  await enqueue({
    entity: "students",
    entityId: localId,
    idempotencyKey: localId,
    payload: {
      p_name: name,
      p_guardian_name: guardianName || null,
      p_guardian_phone: guardianPhone || null,
      p_class_id: classId || null,
      p_section_id: sectionId || null,
      p_admission_date: admissionDate,
      p_status: status || "active",
      p_monthly_fee: monthlyFee || null,
      p_discount: discount || null,
      p_discount_reason: discountReason || null,
      // p_student_code intentionally omitted — an offline device never
      // supplies one, so create_student() always takes the atomic-counter
      // path. Letting a device pick its own code is exactly the collision
      // this whole phase exists to avoid.
    },
  });

  return record;
}

export async function markSynced(localId, serverStudent) {
  return db.local_students.update(localId, {
    sync_status: "synced",
    official_id: serverStudent?.id ?? null,
    official_student_code: serverStudent?.student_code ?? null,
  });
}

// Kept, not deleted — a rejected registration (e.g. NOT_AUTHORIZED because
// the registrar's role changed between offline entry and sync) may already
// have physical intake paperwork filled out against its local reference,
// so a registrar/admin needs to see it flagged, not have it silently
// vanish. See sync/conflict-resolver.js for what happens next.
export async function markConflict(localId, reason) {
  return db.local_students.update(localId, { sync_status: "conflict", conflict_reason: reason });
}

export async function voidLocal(localId, reason) {
  return db.local_students.update(localId, { sync_status: "voided", conflict_reason: reason || null });
}

export async function listLocalStudents(instituteId) {
  return db.local_students.where({ institute_id: instituteId }).sortBy("created_at");
}
