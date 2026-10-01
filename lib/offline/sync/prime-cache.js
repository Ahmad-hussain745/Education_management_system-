import * as academicRepo from "../repositories/academic";
import * as studentsRepo from "../repositories/students";
import * as feesRepo from "../repositories/fees";
import * as paymentsRepo from "../repositories/payments";

// Every repository in this folder has had a refreshX() function since
// Phase 8 — refreshStudents, refreshFeeStructures, refreshFeeRecords,
// refreshPaymentHistory — but nothing anywhere ever called them. A device
// could go offline having never cached a single class, student, or bill,
// which made every "capped against the cached balance" or "picker reads
// the cache" design in Phases 8–10 theoretical rather than actually
// working. This is the fix: one function, called from OfflineStatus.js
// (a) once when the app loads online and (b) again right after a
// reconnect sync clears the outbox — so caches are populated before a
// device ever needs them, and refreshed with whatever just changed
// immediately after.
//
// Deliberately one Promise.allSettled, not a chain that stops at the
// first failure — a missing/renamed table on an older Supabase project
// (see isMissingDbObjectError elsewhere in this app) should degrade to
// "that one cache stays stale" for the rest, not block every other cache
// from refreshing.
export async function primeCaches(supabase, { instituteId, teacherId, isTeacherOnly } = {}) {
  if (!instituteId) return { ok: false, reason: "no institute" };

  const monthsBack = 2; // this month + 2 back — enough for "previous balance" context and recent payment history without pulling a school's entire multi-year ledger onto every device
  const since = new Date();
  since.setMonth(since.getMonth() - monthsBack);
  const sinceMonth = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-01`;

  const tasks = [
    academicRepo.refreshClasses(supabase, instituteId),
    academicRepo.refreshSections(supabase, instituteId),
    studentsRepo.refreshStudents(supabase, instituteId),
    feesRepo.refreshFeeStructures(supabase, instituteId),
    feesRepo.refreshFeeRecords(supabase, instituteId, sinceMonth),
    paymentsRepo.refreshPaymentHistory(supabase, instituteId, sinceMonth),
  ];
  if (isTeacherOnly && teacherId) {
    tasks.push(academicRepo.refreshTeacherClasses(supabase, instituteId, teacherId));
  }

  const results = await Promise.allSettled(tasks);
  const failed = results.filter((r) => r.status === "rejected");
  return { ok: failed.length === 0, failedCount: failed.length };
}
