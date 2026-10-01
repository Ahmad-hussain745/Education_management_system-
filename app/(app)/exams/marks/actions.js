"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// RLS ("admin/teacher enter/update own classes' exam marks", 0030) is the
// real authorization check — a Teacher submitting this for a class/subject
// they're not assigned in teacher_classes is rejected at the database
// regardless of what this form posts. trg_exam_marks_guard also runs on
// every row here: it rejects any mark over that subject's max_marks, and
// blocks writes entirely once this exam_subject's exam has a published
// result for that student.
export async function saveExamMarks(formData) {
  const supabase = await createClient();
  const exam_subject_id = formData.get("exam_subject_id")?.toString();
  if (!exam_subject_id) return { error: "Missing exam subject." };

  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user ? await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle() : { data: null };

  const studentIds = new Set();
  for (const key of formData.keys()) {
    const match = key.match(/^marks_(.+)$/) || key.match(/^absent_(.+)$/);
    if (match) studentIds.add(match[1]);
  }
  if (studentIds.size === 0) return { error: "Enter at least one student's marks before saving." };

  const rows = [];
  for (const studentId of studentIds) {
    const isAbsent = formData.get(`absent_${studentId}`) === "on";
    const rawMarks = formData.get(`marks_${studentId}`)?.toString().trim();
    if (isAbsent) {
      rows.push({ exam_subject_id, student_id: studentId, marks_obtained: null, is_absent: true, entered_by: me?.id || null });
    } else if (rawMarks) {
      rows.push({ exam_subject_id, student_id: studentId, marks_obtained: Number(rawMarks), is_absent: false, entered_by: me?.id || null });
    }
    // Neither absent nor a value entered: skip — leaves any prior row for
    // that student untouched rather than clobbering it with a blank.
  }
  if (rows.length === 0) return { error: "Enter at least one student's marks before saving." };

  const { error } = await supabase.from("exam_marks").upsert(rows, { onConflict: "exam_subject_id,student_id" });
  if (error) {
    if (error.message?.includes("MARKS_OUT_OF_RANGE")) return { error: error.message.replace(/^[A-Z_]+:\s*/, "") };
    if (error.message?.includes("RESULT_PUBLISHED")) return { error: error.message.replace(/^[A-Z_]+:\s*/, "") };
    return { error: error.message };
  }

  revalidatePath("/exams/marks");
  revalidatePath("/exams/results");
  return { success: true, count: rows.length };
}
