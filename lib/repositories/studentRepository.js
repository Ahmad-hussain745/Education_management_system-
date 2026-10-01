"use client";

import { getConnectivity } from "@/lib/offline/connectivity";
import { createStudent } from "@/app/(app)/students/actions";
import * as offlineStudents from "@/lib/offline/repositories/students";

// Same shape as paymentRepository — mode: "online" | "offline". No
// try-online-then-fall-back-to-offline the way expenseRepository does:
// strictly gated on getConnectivity() (or an explicit forceOffline), same
// reasoning as paymentRepository — falling back after a lost response
// risks a genuine duplicate (two students for one registration) rather
// than a harmless double-queue, since the online attempt might have
// already landed.
export const studentRepository = {
  async create(student) {
    const offline = !getConnectivity() || student.forceOffline;

    if (offline) {
      const record = await offlineStudents.registerStudentOffline({
        instituteId: student.instituteId,
        name: student.name,
        guardianName: student.guardianName,
        guardianPhone: student.guardianPhone,
        classId: student.classId,
        sectionId: student.sectionId,
        admissionDate: student.admissionDate,
        status: student.status,
        monthlyFee: student.monthlyFee,
        discount: student.discount,
        discountReason: student.discountReason,
        registeredBy: student.registeredBy,
      });
      return { mode: "offline", record };
    }

    const formData = new FormData();
    formData.set("name", student.name);
    if (student.guardianName) formData.set("guardian_name", student.guardianName);
    if (student.guardianPhone) formData.set("guardian_phone", student.guardianPhone);
    if (student.classId) formData.set("class_id", student.classId);
    if (student.sectionId) formData.set("section_id", student.sectionId);
    formData.set("admission_date", student.admissionDate);
    formData.set("status", student.status || "active");
    // Manual student_code override — online only. An offline device never
    // sends one (see registerStudentOffline's payload) so it always takes
    // create_student()'s atomic-counter path.
    if (student.studentCode) formData.set("student_code", student.studentCode);
    if (student.monthlyFee) formData.set("monthly_fee", String(student.monthlyFee));
    if (student.discount) formData.set("discount", String(student.discount));
    if (student.discountReason) formData.set("discount_reason", student.discountReason);
    formData.set("idempotency_key", student.idempotencyKey || crypto.randomUUID());

    const result = await createStudent(formData);
    if (result?.error) return { mode: "online", error: result.error };
    return { mode: "online", ...result };
  },
};
