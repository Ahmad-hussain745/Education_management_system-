"use client";

import { getConnectivity } from "@/lib/offline/connectivity";
import { saveStudentAttendance } from "@/app/(app)/attendance/students/actions";
import * as offlineAttendance from "@/lib/offline/repositories/attendance";
import * as academicRepo from "@/lib/offline/repositories/academic";
import * as studentsRepo from "@/lib/offline/repositories/students";

// The existing online action (saveStudentAttendance) is a bulk
// "replace this class/date/section's whole register" call — one delete,
// then one multi-row insert, so a half-edited class register can't be left
// in a mixed state. There's no offline equivalent to "delete some rows in
// IndexedDB, then bulk-insert" that's worth building: this repository's
// offline path instead queues one outbox entry per student. Both reach the
// identical end state (one student_attendance row per student/date/class),
// just via N small writes instead of one delete+bulk-insert — the
// difference is invisible to whoever's marking attendance, AND it's why
// save() below is allowed to fall back from a failed online attempt
// straight into the offline queue (unlike paymentRepository/
// studentRepository, which deliberately don't): sync-engine.js's push for
// this entity is delete-then-insert per student, so even if the online
// attempt actually landed before the connection dropped, the offline
// queue's later resubmission just re-applies the same status — harmless,
// not a duplicate.
//
// UI callers never touch saveStudentAttendance or the offline repo
// directly — everything goes through this object.
export const attendanceRepository = {
  async getClasses(supabase, { instituteId, teacherId, isTeacherOnly }) {
    if (!getConnectivity()) {
      return academicRepo.getCachedClasses(instituteId, { teacherId, isTeacherOnly });
    }
    let q = supabase.from("classes").select("id, name").order("sort_order");
    if (isTeacherOnly) {
      const { data: myClasses } = teacherId
        ? await supabase.from("teacher_classes").select("class_id").eq("teacher_id", teacherId)
        : { data: [] };
      const ids = [...new Set((myClasses || []).map((c) => c.class_id))];
      q = ids.length ? q.in("id", ids) : q.eq("id", "00000000-0000-0000-0000-000000000000");
    }
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async getSections(supabase, { instituteId, classId }) {
    if (!classId) return [];
    if (!getConnectivity()) return academicRepo.getCachedSections(instituteId, classId);
    const { data, error } = await supabase.from("sections").select("id, name").eq("class_id", classId).order("name");
    if (error) throw error;
    return data || [];
  },

  // Roster + whatever's already marked for this exact date/class/section —
  // the two things the register screen needs together.
  async getRegister(supabase, { instituteId, classId, sectionId, date }) {
    if (!getConnectivity()) {
      const students = await studentsRepo.getStudentsForClass(instituteId, classId, sectionId || null);
      const existing = await offlineAttendance.getAttendanceForDate(instituteId, classId, sectionId || null, date);
      const existingByStudentId = Object.fromEntries(existing.map((r) => [r.student_id, r]));
      return { students: [...students].sort((a, b) => a.name.localeCompare(b.name)), existingByStudentId };
    }

    let sq = supabase.from("students").select("id, name").eq("class_id", classId).eq("status", "active").order("name");
    if (sectionId) sq = sq.eq("section_id", sectionId);
    const { data: students, error: studentsError } = await sq;
    if (studentsError) throw studentsError;

    let existingByStudentId = {};
    const studentIds = (students || []).map((s) => s.id);
    if (studentIds.length) {
      const { data: existing, error: existingError } = await supabase
        .from("student_attendance")
        .select("student_id, status, marked_by")
        .eq("date", date).eq("class_id", classId).is("subject_id", null)
        .in("student_id", studentIds);
      if (existingError) throw existingError;
      existingByStudentId = Object.fromEntries((existing || []).map((r) => [r.student_id, r]));
      // Mirror into the offline cache so a later offline visit to this same
      // register (same device) shows what was already marked — see
      // repositories/attendance.js's cacheServerAttendance() for why this
      // step exists at all: this online read path never otherwise touches
      // the offline cache.
      offlineAttendance.cacheServerAttendance(instituteId, classId, sectionId || null, date, existing || []).catch(() => {});
    }

    return { students: students || [], existingByStudentId };
  },

  async save({ instituteId, date, classId, sectionId, markedBy, entries }) {
    // entries: [{ studentId, status }, ...]
    if (getConnectivity()) {
      const formData = new FormData();
      formData.set("date", date);
      formData.set("class_id", classId);
      if (sectionId) formData.set("section_id", sectionId);
      for (const { studentId, status } of entries) {
        formData.set(`status_${studentId}`, status);
      }
      try {
        const result = await saveStudentAttendance(formData);
        if (result?.error) throw new Error(result.error);
        return { mode: "online", ...result };
      } catch (err) {
        // Thought we were online, turned out we weren't (or the request
        // itself failed mid-flight) — fall through to the offline queue
        // rather than losing what was just marked. Safe to do here (see
        // file comment) in a way it wouldn't be for a payment or a new
        // student.
        return await this._saveOffline({ instituteId, date, classId, sectionId, markedBy, entries });
      }
    }
    return await this._saveOffline({ instituteId, date, classId, sectionId, markedBy, entries });
  },

  async _saveOffline({ instituteId, date, classId, sectionId, markedBy, entries }) {
    const results = [];
    for (const { studentId, status } of entries) {
      results.push(
        await offlineAttendance.markAttendanceOffline({
          instituteId, studentId, classId, sectionId: sectionId || null, subjectId: null, date, status, markedBy,
        })
      );
    }
    return { mode: "offline", count: results.length };
  },

  async getForDate({ instituteId, classId, sectionId, date }) {
    // Offline-cached view only — used to pre-fill the register when
    // there's no connection. Online, getRegister()'s own live fetch above
    // is the source of truth, as it already was before this repository.
    return offlineAttendance.getAttendanceForDate(instituteId, classId, sectionId || null, date);
  },
};
