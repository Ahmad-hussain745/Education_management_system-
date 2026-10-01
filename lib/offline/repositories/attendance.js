import { db } from "../db";
import { enqueue } from "../sync/outbox";

// Why this ISN'T "insert and let the unique constraint catch duplicates"
// (the original, simpler plan): student_attendance's unique constraint is
// on (student_id, date, class_id, section_id, subject_id), and section_id/
// subject_id are nullable — Postgres treats NULLs as never equal to each
// other for uniqueness purposes, so two rows for the same student/date/
// class with both section_id AND subject_id null would NOT collide on that
// constraint at all. That's exactly why the existing ONLINE action
// (attendance/students/actions.js) never relies on the constraint either —
// it does an explicit DELETE (matching date/class/section, IS NULL where
// appropriate) before the INSERT. sync-engine.js's push for this entity
// mirrors that same delete-then-insert, scoped to just this one student's
// row, so re-marking the same student/date (a correction made before the
// first mark even synced, or after) always ends up "last write wins,"
// never a silent duplicate row and never a spurious constraint rejection.
//
// That also means there's no genuine ambiguous-conflict case here worth a
// human's attention — same as the online page, where two people saving the
// same register just has the second save win, silently. Attendance is
// low-stakes and easily corrected (unlike a payment or a new student), so
// this file doesn't have a markConflict()/status field the way payments.js
// and students.js do — a queued mark either eventually lands (however many
// corrections deep) or, if sync-engine.js gives up after repeated genuine
// failures, surfaces in the plain sync_conflicts list like any other
// entity's exhausted-retries case.

export async function markAttendanceOffline({ instituteId, studentId, classId, sectionId, subjectId, date, status, markedBy }) {
  const localId = crypto.randomUUID();
  const record = {
    local_id: localId,
    institute_id: instituteId,
    student_id: studentId,
    class_id: classId,
    section_id: sectionId || null,
    subject_id: subjectId || null,
    date,
    status,
    marked_by: markedBy,
    synced: false,
    created_at: new Date().toISOString(),
  };
  await db.attendance.put(record);
  await enqueue({
    entity: "attendance",
    entityId: localId,
    payload: {
      student_id: studentId,
      class_id: classId,
      section_id: sectionId || null,
      subject_id: subjectId || null,
      date,
      status,
      marked_by: markedBy,
    },
  });
  return record;
}

// One student can have several local rows for the same day if corrected
// more than once before syncing (each markAttendanceOffline call above is
// its own row/outbox entry — sync-engine.js's delete-then-insert reconciles
// that fine server-side, but for showing "what's the current draft" on
// THIS screen, only the most recent one per student is the real answer.
export async function getAttendanceForDate(instituteId, classId, sectionId, date) {
  const rows = await db.attendance.where({ institute_id: instituteId, class_id: classId, date }).toArray();
  const scoped = rows.filter((r) => (sectionId ? r.section_id === sectionId : true));
  const latestByStudent = new Map();
  for (const r of scoped) {
    const prev = latestByStudent.get(r.student_id);
    if (!prev || r.created_at > prev.created_at) latestByStudent.set(r.student_id, r);
  }
  return [...latestByStudent.values()];
}

export async function markSynced(localId) {
  return db.attendance.update(localId, { synced: true });
}

export async function discardLocal(localId) {
  return db.attendance.delete(localId);
}

// Mirrors rows the ONLINE save action just wrote straight to the server
// (attendance/students/actions.js's saveStudentAttendance, which never
// touches this offline repo at all) into the same local cache used above —
// otherwise a device that saved a register while online, then went offline
// later that same day, would show an empty register instead of what it
// itself already recorded. Recorded with synced: true immediately (there's
// nothing to sync — the server already has these) and no outbox entry.
//
// Known limitation this does NOT solve: it only ever reflects what THIS
// device has saved. A different teacher/device's save for the same class
// still won't show up here while offline — there's no full attendance
// history sync, only this local mirror.
export async function cacheServerAttendance(instituteId, classId, sectionId, date, rows) {
  const localRows = (rows || []).map((r) => ({
    local_id: crypto.randomUUID(),
    institute_id: instituteId,
    student_id: r.student_id,
    class_id: classId,
    section_id: sectionId || null,
    subject_id: null,
    date,
    status: r.status,
    marked_by: r.marked_by || null,
    synced: true,
    created_at: new Date().toISOString(),
  }));
  if (localRows.length) await db.attendance.bulkPut(localRows);
}
