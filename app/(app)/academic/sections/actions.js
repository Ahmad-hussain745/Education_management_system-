"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function refreshEverywhere() {
  revalidatePath("/academic/sections");
  revalidatePath("/students");
  revalidatePath("/fees/payments");
  revalidatePath("/teachers/classes");
  revalidatePath("/salary/config");
  revalidatePath("/attendance/students");
}

export async function createSection(formData) {
  const supabase = await createClient();
  const class_id = formData.get("class_id")?.toString();
  const name = formData.get("name")?.toString().trim();
  if (!class_id) return { error: "Pick a class." };
  if (!name) return { error: "Section name is required." };

  const { error } = await supabase.from("sections").insert({ class_id, name });
  if (error) {
    if (error.code === "23505") return { error: `This class already has a section named "${name}".` };
    return { error: error.message };
  }
  refreshEverywhere();
  return { success: true };
}

export async function updateSection(formData) {
  const supabase = await createClient();
  const id = formData.get("id")?.toString();
  const name = formData.get("name")?.toString().trim();
  if (!id) return { error: "Missing section." };
  if (!name) return { error: "Section name is required." };

  const { error } = await supabase.from("sections").update({ name }).eq("id", id);
  if (error) {
    if (error.code === "23505") return { error: `This class already has a section named "${name}".` };
    return { error: error.message };
  }
  refreshEverywhere();
  return { success: true };
}

// students.section_id is "on delete set null" — deleting a section never
// deletes students, just unassigns them — but salary_items.section_id is
// "on delete cascade" (0001_init.sql), so deleting a section that's already
// been used in a generated payroll would silently erase that historical
// breakdown row while leaving salary_records.gross_salary (a separately
// stored total) unchanged, making the two disagree. Block that specific
// case; unassigning live students is allowed since nothing is destroyed.
export async function deleteSection(id) {
  const supabase = await createClient();

  const { count: salaryItemCount } = await supabase
    .from("salary_items").select("id", { count: "exact", head: true }).eq("section_id", id);
  if (salaryItemCount > 0) {
    return { error: "This section already has payroll history generated against it and can't be deleted — rename it instead if needed." };
  }

  const { count: studentCount } = await supabase
    .from("students").select("id", { count: "exact", head: true }).eq("section_id", id);

  const { error } = await supabase.from("sections").delete().eq("id", id);
  if (error) return { error: error.message };
  refreshEverywhere();
  return { success: true, unassigned: studentCount || 0 };
}
