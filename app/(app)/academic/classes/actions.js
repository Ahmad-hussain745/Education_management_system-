"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function refreshEverywhere() {
  // Classes feed dropdowns across nearly every other module — refresh the
  // pages that read from the classes table, not just this one.
  revalidatePath("/academic/classes");
  revalidatePath("/students");
  revalidatePath("/fees/payments");
  revalidatePath("/teachers/classes");
  revalidatePath("/salary/config");
  revalidatePath("/attendance/students");
  revalidatePath("/syllabus/classes");
}

export async function createClass(formData) {
  const supabase = await createClient();
  const name = formData.get("name")?.toString().trim();
  const sort_order = Number(formData.get("sort_order") || 0);
  if (!name) return { error: "Class name is required." };

  const { error } = await supabase.from("classes").insert({ name, sort_order, status: "active" });
  if (error) {
    if (error.code === "23505") return { error: `A class named "${name}" already exists.` };
    return { error: error.message };
  }
  refreshEverywhere();
  return { success: true };
}

export async function updateClass(formData) {
  const supabase = await createClient();
  const id = formData.get("id")?.toString();
  const name = formData.get("name")?.toString().trim();
  const sort_order = Number(formData.get("sort_order") || 0);
  if (!id) return { error: "Missing class." };
  if (!name) return { error: "Class name is required." };

  const { error } = await supabase.from("classes").update({ name, sort_order }).eq("id", id);
  if (error) {
    if (error.code === "23505") return { error: `A class named "${name}" already exists.` };
    return { error: error.message };
  }
  refreshEverywhere();
  return { success: true };
}

export async function toggleClassStatus(id, active) {
  const supabase = await createClient();
  const { error } = await supabase.from("classes").update({ status: active ? "active" : "inactive" }).eq("id", id);
  if (error) return { error: error.message };
  refreshEverywhere();
  return { success: true };
}

// Deleting a class cascades to its sections, syllabus chapters, teacher
// assignments and salary rules (see the "on delete cascade" FKs in
// 0001_init.sql) — students.class_id is "on delete restrict" so the
// database itself refuses if any student is still enrolled, but nothing
// stops an empty class that already has real sections/chapters/assignments
// built on it from being wiped out by mistake. Block that here explicitly
// with a clear reason, instead of letting people discover it via cascade.
export async function deleteClass(id) {
  const supabase = await createClient();

  const [{ count: studentCount }, { count: sectionCount }] = await Promise.all([
    supabase.from("students").select("id", { count: "exact", head: true }).eq("class_id", id),
    supabase.from("sections").select("id", { count: "exact", head: true }).eq("class_id", id),
  ]);

  if (studentCount > 0) {
    return { error: `${studentCount} student${studentCount === 1 ? "" : "s"} are enrolled in this class. Deactivate it instead, or move them first.` };
  }
  if (sectionCount > 0) {
    return { error: `This class has ${sectionCount} section${sectionCount === 1 ? "" : "s"} set up. Delete those first, or deactivate the class instead.` };
  }

  const { error } = await supabase.from("classes").delete().eq("id", id);
  if (error) return { error: error.message };
  refreshEverywhere();
  return { success: true };
}
