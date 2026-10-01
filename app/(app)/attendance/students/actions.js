"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Runs with the signed-in user's own session, so RLS still applies — a
// teacher calling this for a class they're not assigned to (teacher_classes)
// is rejected at the database level regardless of what this action sends
// (see "teacher manages own classes' attendance" in 0002_rls.sql).
export async function saveStudentAttendance(formData) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const date = formData.get("date")?.toString();
  const class_id = formData.get("class_id")?.toString();
  const section_id = formData.get("section_id")?.toString() || null;
  if (!date || !class_id) return { error: "Date and class are required." };

  const studentIds = new Set();
  for (const key of formData.keys()) {
    const match = key.match(/^status_(.+)$/);
    if (match) studentIds.add(match[1]);
  }
  if (studentIds.size === 0) return { error: "Mark at least one student's status before saving." };

  const { data: me } = await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle();

  // subject_id is left null (whole-day class register, not per-subject) and
  // section_id can also be null — both are nullable columns in the row's
  // unique key, so a plain upsert can't be trusted to match prior rows for
  // this exact date/class/section. Replace the set explicitly instead.
  let delQuery = supabase.from("student_attendance").delete().eq("date", date).eq("class_id", class_id).is("subject_id", null);
  delQuery = section_id ? delQuery.eq("section_id", section_id) : delQuery.is("section_id", null);
  const { error: delError } = await delQuery;
  if (delError) return { error: delError.message };

  const rows = [...studentIds].map((studentId) => ({
    student_id: studentId,
    class_id,
    section_id,
    subject_id: null,
    date,
    status: formData.get(`status_${studentId}`)?.toString(),
    marked_by: me?.id || null,
  }));

  const { error } = await supabase.from("student_attendance").insert(rows);
  if (error) return { error: error.message };

  revalidatePath("/attendance/students");
  return { success: true, count: rows.length };
}
