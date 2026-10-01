"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createExam(formData) {
  const supabase = await createClient();
  const name = formData.get("name")?.toString().trim();
  const exam_type_id = formData.get("exam_type_id")?.toString() || null;
  const start_date = formData.get("start_date")?.toString() || null;
  const end_date = formData.get("end_date")?.toString() || null;
  if (!name) return { error: "Exam name is required." };

  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user ? await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle() : { data: null };

  const { error } = await supabase.from("exams").insert({ name, exam_type_id, start_date, end_date, created_by: me?.id || null });
  if (error) return { error: error.message };
  revalidatePath("/exams");
  return { success: true };
}

// exam_classes/exam_subjects/exam_marks/exam_results all cascade off
// exams.id ("on delete cascade") — deleting an exam wipes every class
// assignment, subject/max-marks setup, mark, and result under it. That's
// the expected shape of "delete an exam," so the UI just needs to say so
// plainly before it happens (see ExamList's confirm).
export async function deleteExam(id) {
  const supabase = await createClient();
  const { error } = await supabase.from("exams").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/exams");
  return { success: true };
}

export async function addExamClass(formData) {
  const supabase = await createClient();
  const exam_id = formData.get("exam_id")?.toString();
  const class_id = formData.get("class_id")?.toString();
  const section_id = formData.get("section_id")?.toString() || null;
  if (!exam_id || !class_id) return { error: "Missing exam/class." };

  const { error } = await supabase.from("exam_classes").insert({ exam_id, class_id, section_id });
  if (error) {
    if (error.code === "23505") return { error: "That class/section is already assigned to this exam." };
    return { error: error.message };
  }
  revalidatePath("/exams");
  return { success: true };
}

export async function removeExamClass(id) {
  const supabase = await createClient();
  const { error } = await supabase.from("exam_classes").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/exams");
  return { success: true };
}
