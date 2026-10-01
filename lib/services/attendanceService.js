"use client";

import { attendanceRepository } from "@/lib/repositories/attendanceRepository";

// The page calls this, not the repository directly. Validation here runs
// identically regardless of which branch the repository ends up taking —
// that's the point of this layer existing at all: "is this a sane thing to
// save" is a question with one answer, not one answer per storage backend.
export const attendanceService = {
  async saveClassAttendance({ instituteId, date, classId, sectionId, markedBy, entries }) {
    if (!date) throw new Error("Date is required.");
    if (new Date(date) > new Date(new Date().toDateString())) {
      throw new Error("Can't mark attendance for a future date.");
    }
    if (!classId) throw new Error("Class is required.");
    if (!entries || entries.length === 0) throw new Error("Mark at least one student's status.");

    return attendanceRepository.save({ instituteId, date, classId, sectionId, markedBy, entries });
  },

  async getForDate({ instituteId, classId, date }) {
    return attendanceRepository.getForDate({ instituteId, classId, date });
  },
};
