"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function addExamSubject(formData) {
  const supabase = await createClient();
  const exam_id = formData.get("exam_id")?.toString();
  const class_id = formData.get("class_id")?.toString();
  const subject_id = formData.get("subject_id")?.toString();
  const max_marks = Number(formData.get("max_marks"));
  const passing_marks = Number(formData.get("passing_marks") || 0);
  const exam_date = formData.get("exam_date")?.toString() || null;

  if (!exam_id || !class_id || !subject_id) return { error: "Exam, class, and subject are all required." };
  if (!max_marks || max_marks <= 0) return { error: "Max marks must be greater than 0." };
  if (passing_marks < 0 || passing_marks > max_marks) return { error: "Passing marks must be between 0 and max marks." };

  const { error } = await supabase.from("exam_subjects").insert({ exam_id, class_id, subject_id, max_marks, passing_marks, exam_date });
  if (error) {
    if (error.code === "23505") return { error: "That subject is already added for this exam/class." };
    return { error: error.message };
  }
  revalidatePath("/exams/subjects");
  revalidatePath("/exams/marks");
  return { success: true };
}

// exam_marks.exam_subject_id is "on delete cascade" — removing a subject
// from an exam wipes every mark already entered against it. Fine before
// marks entry has started; the UI warns before this once any exist (see
// ExamSubjectList).
export async function removeExamSubject(id) {
  const supabase = await createClient();
  const { error } = await supabase.from("exam_subjects").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/exams/subjects");
  revalidatePath("/exams/marks");
  return { success: true };
}
