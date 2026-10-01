"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createChapter(formData) {
  const supabase = await createClient();
  const class_id = formData.get("class_id")?.toString();
  const subject_id = formData.get("subject_id")?.toString();
  const title = formData.get("title")?.toString().trim();
  if (!class_id || !subject_id) return { error: "Missing class/subject." };
  if (!title) return { error: "Chapter title is required." };

  const { error } = await supabase.from("syllabus_chapters").insert({ class_id, subject_id, title });
  if (error) return { error: error.message };

  revalidatePath("/syllabus/chapters");
  revalidatePath("/syllabus/progress");
  return { success: true };
}

export async function createTopic(formData) {
  const supabase = await createClient();
  const chapter_id = formData.get("chapter_id")?.toString();
  const title = formData.get("title")?.toString().trim();
  if (!chapter_id) return { error: "Missing chapter." };
  if (!title) return { error: "Topic title is required." };

  const { error } = await supabase.from("syllabus_topics").insert({ chapter_id, title });
  if (error) return { error: error.message };

  revalidatePath("/syllabus/chapters");
  revalidatePath("/syllabus/progress");
  return { success: true };
}

export async function updateChapter(formData) {
  const supabase = await createClient();
  const id = formData.get("id")?.toString();
  const title = formData.get("title")?.toString().trim();
  if (!id) return { error: "Missing chapter." };
  if (!title) return { error: "Chapter title is required." };

  const { error } = await supabase.from("syllabus_chapters").update({ title }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/syllabus/chapters");
  revalidatePath("/syllabus/progress");
  return { success: true };
}

// syllabus_topics.chapter_id is "on delete cascade" (0001_init.sql) — this
// intentionally wipes every topic under the chapter and, in turn, every
// progress row ticked off against those topics. That's the expected shape
// of "delete a chapter," not a side-effect to guard against — the UI just
// needs to say so clearly before it happens (see ChapterCard's confirm).
export async function deleteChapter(id) {
  const supabase = await createClient();
  const { error } = await supabase.from("syllabus_chapters").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/syllabus/chapters");
  revalidatePath("/syllabus/progress");
  revalidatePath("/syllabus/classes");
  return { success: true };
}

export async function updateTopic(formData) {
  const supabase = await createClient();
  const id = formData.get("id")?.toString();
  const title = formData.get("title")?.toString().trim();
  if (!id) return { error: "Missing topic." };
  if (!title) return { error: "Topic title is required." };

  const { error } = await supabase.from("syllabus_topics").update({ title }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/syllabus/chapters");
  revalidatePath("/syllabus/progress");
  return { success: true };
}

// syllabus_progress.topic_id is "on delete cascade" — deleting a topic
// takes its progress ticks (whole-class and every section's) with it,
// which is correct: there's no meaningful "progress on a topic that no
// longer exists" to preserve.
export async function deleteTopic(id) {
  const supabase = await createClient();
  const { error } = await supabase.from("syllabus_topics").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/syllabus/chapters");
  revalidatePath("/syllabus/progress");
  revalidatePath("/syllabus/classes");
  return { success: true };
}

// Ticking a topic off is the one action that drives Syllabus Progress — the
// percentage there is never typed, only derived from these booleans.
// sectionId is null for whole-class tracking, or a specific section's id —
// same NULL-safe existence check used for salary_rules/student_attendance,
// since syllabus_progress's unique (topic_id, section_id) constraint treats
// every NULL section_id as distinct and can't be trusted for upsert. (A real
// NULL-safe unique index backs this in 0004_completion.sql — 23505 below
// means two clicks raced, not that something's broken.)
export async function setTopicProgress(topicId, sectionId, completed) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  let markedBy = null;
  if (user) {
    const { data: me } = await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle();
    markedBy = me?.id || null;
  }

  let existing;
  if (sectionId) {
    ({ data: existing } = await supabase
      .from("syllabus_progress").select("id")
      .eq("topic_id", topicId).eq("section_id", sectionId).maybeSingle());
  } else {
    ({ data: existing } = await supabase
      .from("syllabus_progress").select("id")
      .eq("topic_id", topicId).is("section_id", null).maybeSingle());
  }

  const payload = { completed, completed_on: completed ? new Date().toISOString().slice(0, 10) : null, completed_by: markedBy };
  const { error } = existing
    ? await supabase.from("syllabus_progress").update(payload).eq("id", existing.id)
    : await supabase.from("syllabus_progress").insert({ topic_id: topicId, section_id: sectionId, ...payload });
  if (error) {
    if (error.code === "23505") return { error: "That was just updated elsewhere — refresh and try again." };
    return { error: error.message };
  }

  revalidatePath("/syllabus/chapters");
  revalidatePath("/syllabus/progress");
  return { success: true };
}
