"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function refreshEverywhere() {
  revalidatePath("/academic/subjects");
  revalidatePath("/syllabus/subjects");
  revalidatePath("/teachers/classes");
  revalidatePath("/teachers/profiles");
}

export async function createSubject(formData) {
  const supabase = await createClient();
  const name = formData.get("name")?.toString().trim();
  if (!name) return { error: "Subject name is required." };

  const { error } = await supabase.from("subjects").insert({ name });
  if (error) {
    if (error.code === "23505") return { error: `A subject named "${name}" already exists.` };
    return { error: error.message };
  }
  refreshEverywhere();
  return { success: true };
}

export async function updateSubject(formData) {
  const supabase = await createClient();
  const id = formData.get("id")?.toString();
  const name = formData.get("name")?.toString().trim();
  if (!id) return { error: "Missing subject." };
  if (!name) return { error: "Subject name is required." };

  const { error } = await supabase.from("subjects").update({ name }).eq("id", id);
  if (error) {
    if (error.code === "23505") return { error: `A subject named "${name}" already exists.` };
    return { error: error.message };
  }
  refreshEverywhere();
  return { success: true };
}

export async function toggleSubjectActive(id, active) {
  const supabase = await createClient();
  const { error } = await supabase.from("subjects").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  refreshEverywhere();
  return { success: true };
}

// syllabus_chapters.subject_id is "on delete cascade" and NOT NULL
// (0001_init.sql) — deleting a subject that already has chapters built
// against it would silently wipe every one of those chapters, their topics,
// and all progress ticked off against them, across every class. Block that;
// teacher_classes.subject_id is nullable/"on delete set null" so a teaching
// assignment referencing this subject is just unset, which is safe, but
// worth surfacing to whoever's deleting it.
export async function deleteSubject(id) {
  const supabase = await createClient();

  const { count: chapterCount } = await supabase
    .from("syllabus_chapters").select("id", { count: "exact", head: true }).eq("subject_id", id);
  if (chapterCount > 0) {
    return { error: `This subject has ${chapterCount} syllabus chapter${chapterCount === 1 ? "" : "s"} built against it and can't be deleted — remove those first if you really need to.` };
  }

  const { count: assignmentCount } = await supabase
    .from("teacher_classes").select("id", { count: "exact", head: true }).eq("subject_id", id);

  const { error } = await supabase.from("subjects").delete().eq("id", id);
  if (error) return { error: error.message };
  refreshEverywhere();
  return { success: true, unassigned: assignmentCount || 0 };
}
