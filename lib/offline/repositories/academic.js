import { db } from "../db";

// Reference data — same READ-ONLY-cache shape as students.js's
// refreshStudents/getStudentById. Small enough (a school has dozens of
// classes/sections, not thousands) to just cache in full rather than
// paginating the way list_students() does.

export async function refreshClasses(supabase, instituteId) {
  const { data, error } = await supabase
    .from("classes")
    .select("id, institute_id, name, sort_order")
    .eq("institute_id", instituteId);
  if (error) throw error;
  await db.classes.where({ institute_id: instituteId }).delete();
  await db.classes.bulkPut(data);
  await db.sync_metadata.put({ key: `last_sync:classes:${instituteId}`, value: new Date().toISOString() });
  return data.length;
}

export async function refreshSections(supabase, instituteId) {
  const { data, error } = await supabase
    .from("sections")
    .select("id, institute_id, class_id, name")
    .eq("institute_id", instituteId);
  if (error) throw error;
  await db.sections.where({ institute_id: instituteId }).delete();
  await db.sections.bulkPut(data);
  await db.sync_metadata.put({ key: `last_sync:sections:${instituteId}`, value: new Date().toISOString() });
  return data.length;
}

// Which classes a Teacher account teaches — cached so the offline class
// picker can apply the same restriction the online page already does
// (StudentAttendancePage, isTeacherOnly branch) instead of offering every
// class in the institute and letting "teacher manages own classes'
// attendance" (0002_rls.sql) reject the sync later with a bare RLS error.
// Only ever queried for Teacher accounts — Super Admin/Principal/
// Accountant/Cashier see every class regardless, same as online.
export async function refreshTeacherClasses(supabase, instituteId, teacherId) {
  if (!teacherId) return 0;
  const { data, error } = await supabase
    .from("teacher_classes")
    .select("id, institute_id, teacher_id, class_id")
    .eq("institute_id", instituteId)
    .eq("teacher_id", teacherId);
  if (error) throw error;
  await db.teacher_classes.where({ institute_id: instituteId, teacher_id: teacherId }).delete();
  await db.teacher_classes.bulkPut(data);
  return data.length;
}

export async function getCachedClasses(instituteId, { teacherId, isTeacherOnly } = {}) {
  const all = await db.classes.where({ institute_id: instituteId }).sortBy("sort_order");
  if (!isTeacherOnly) return all;
  const assigned = await db.teacher_classes.where({ institute_id: instituteId, teacher_id: teacherId }).toArray();
  const allowedIds = new Set(assigned.map((tc) => tc.class_id));
  return all.filter((c) => allowedIds.has(c.id));
}

export async function getCachedSections(instituteId, classId) {
  return db.sections.where({ institute_id: instituteId, class_id: classId }).sortBy("name");
}
