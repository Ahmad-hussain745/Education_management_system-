"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function linkParent(studentId, parentUserId) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let createdBy = null;
  if (user) {
    const { data: me } = await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle();
    createdBy = me?.id || null;
  }

  const { error } = await supabase.from("parent_students").insert({ student_id: studentId, parent_user_id: parentUserId, created_by: createdBy });
  if (error) {
    if (error.code === "23505") return { error: "That parent account is already linked to this student." };
    return { error: error.message };
  }
  revalidatePath(`/students/${studentId}`);
  return { success: true };
}

export async function unlinkParent(linkId, studentId) {
  const supabase = await createClient();
  const { error } = await supabase.from("parent_students").delete().eq("id", linkId);
  if (error) return { error: error.message };
  revalidatePath(`/students/${studentId}`);
  return { success: true };
}
