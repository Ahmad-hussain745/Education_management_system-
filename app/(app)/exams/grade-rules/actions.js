"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function readFields(formData) {
  return {
    grade: formData.get("grade")?.toString().trim(),
    min_percentage: Number(formData.get("min_percentage")),
    max_percentage: Number(formData.get("max_percentage")),
    grade_point: formData.get("grade_point")?.toString().trim() ? Number(formData.get("grade_point")) : null,
    remarks: formData.get("remarks")?.toString().trim() || null,
  };
}

// The exclusion constraint (0030_exams_and_results.sql) is what actually
// guarantees no two grade bands can overlap — this validation is just for
// a friendlier message than a raw Postgres error before that constraint
// even gets a chance to fire.
function validate(payload) {
  if (!payload.grade) return "Grade label is required.";
  if (Number.isNaN(payload.min_percentage) || Number.isNaN(payload.max_percentage)) return "Both percentages are required.";
  if (payload.min_percentage < 0 || payload.max_percentage > 100) return "Percentages must be between 0 and 100.";
  if (payload.min_percentage > payload.max_percentage) return "Minimum percentage can't exceed maximum.";
  return null;
}

export async function createGradeRule(formData) {
  const supabase = await createClient();
  const payload = readFields(formData);
  const err = validate(payload);
  if (err) return { error: err };

  const { error } = await supabase.from("grade_rules").insert(payload);
  if (error) {
    if (error.code === "23P01") return { error: "That percentage range overlaps an existing grade band — adjust the range." };
    return { error: error.message };
  }
  revalidatePath("/exams/grade-rules");
  return { success: true };
}

export async function deleteGradeRule(id) {
  const supabase = await createClient();
  const { error } = await supabase.from("grade_rules").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") return { error: "This grade is used by an existing result and can't be deleted." };
    return { error: error.message };
  }
  revalidatePath("/exams/grade-rules");
  return { success: true };
}
