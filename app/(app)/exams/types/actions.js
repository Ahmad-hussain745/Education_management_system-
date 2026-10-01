"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createExamType(formData) {
  const supabase = await createClient();
  const name = formData.get("name")?.toString().trim();
  if (!name) return { error: "Name is required." };

  const { error } = await supabase.from("exam_types").insert({ name });
  if (error) {
    if (error.code === "23505") return { error: `An exam type named "${name}" already exists.` };
    return { error: error.message };
  }
  revalidatePath("/exams/types");
  return { success: true };
}

export async function deleteExamType(id) {
  const supabase = await createClient();
  const { error } = await supabase.from("exam_types").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") return { error: "This exam type is used by an existing exam and can't be deleted." };
    return { error: error.message };
  }
  revalidatePath("/exams/types");
  return { success: true };
}
