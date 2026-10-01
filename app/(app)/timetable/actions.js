"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function addRoom(formData) {
  const supabase = await createClient();
  const name = formData.get("name")?.toString().trim();
  if (!name) return { error: "Room name is required." };
  const { error } = await supabase.from("rooms").insert({
    name, capacity: formData.get("capacity") ? Number(formData.get("capacity")) : null, room_type: formData.get("room_type")?.toString() || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/timetable/setup");
  return { success: true };
}

export async function addPeriod(formData) {
  const supabase = await createClient();
  const name = formData.get("name")?.toString().trim();
  const start = formData.get("start_time")?.toString();
  const end = formData.get("end_time")?.toString();
  if (!name || !start || !end) return { error: "Name, start, and end time are all required." };
  const { data: existing } = await supabase.from("periods").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const { error } = await supabase.from("periods").insert({
    name, start_time: start, end_time: end, is_break: formData.get("is_break") === "on",
    sort_order: (existing?.[0]?.sort_order ?? -1) + 1,
  });
  if (error) return { error: error.message };
  revalidatePath("/timetable/setup");
  return { success: true };
}

export async function toggleAcademicDay(dayOfWeek, active) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  void user;
  const { data: existing } = await supabase.from("academic_days").select("id").eq("day_of_week", dayOfWeek).maybeSingle();
  if (existing) {
    await supabase.from("academic_days").update({ active }).eq("id", existing.id);
  } else {
    await supabase.from("academic_days").insert({ day_of_week: dayOfWeek, active });
  }
  revalidatePath("/timetable/setup");
  return { success: true };
}

export async function setSubjectFrequency(formData) {
  const supabase = await createClient();
  const class_id = formData.get("class_id")?.toString();
  const subject_id = formData.get("subject_id")?.toString();
  const periods_per_week = Number(formData.get("periods_per_week") || 0);
  if (!class_id || !subject_id || !periods_per_week) return { error: "Class, subject, and periods/week are all required." };
  const { error } = await supabase.from("subject_frequency").upsert(
    { class_id, subject_id, periods_per_week, max_per_day: Number(formData.get("max_per_day") || 1) },
    { onConflict: "institute_id,class_id,subject_id" }
  );
  if (error) return { error: error.message };
  revalidatePath("/timetable/setup");
  return { success: true };
}

export async function generateSuggestions(classId) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generate_timetable_suggestions", { p_class_id: classId || null });
  if (error) return { error: error.message };
  revalidatePath("/timetable");
  return { success: true, batchId: data };
}

export async function publishBatch(batchId) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_timetable_batch", { p_batch_id: batchId });
  if (error) return { error: error.message };
  revalidatePath("/timetable");
  return { success: true, count: data };
}

export async function discardBatch(batchId) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("discard_timetable_batch", { p_batch_id: batchId });
  if (error) return { error: error.message };
  revalidatePath("/timetable");
  return { success: true };
}

export async function recordSubstitution(formData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("users").select("id").eq("auth_user_id", user?.id).maybeSingle();
  const payload = {
    timetable_entry_id: formData.get("timetable_entry_id")?.toString(),
    date: formData.get("date")?.toString(),
    original_teacher_id: formData.get("original_teacher_id")?.toString() || null,
    substitute_teacher_id: formData.get("substitute_teacher_id")?.toString(),
    reason: formData.get("reason")?.toString() || null,
    created_by: me?.id,
  };
  if (!payload.timetable_entry_id || !payload.date || !payload.substitute_teacher_id) {
    return { error: "Class period, date, and substitute teacher are all required." };
  }
  const { error } = await supabase.from("timetable_substitutions").insert(payload);
  if (error) return { error: error.message };
  revalidatePath("/timetable/substitutions");
  return { success: true };
}
