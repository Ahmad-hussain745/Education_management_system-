"use server";

import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";

export async function submitSupportRequest(studentId, category, subject, message) {
  const rc = await getRoleContext();
  if (!rc?.isParent) return { error: "Not authorized." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_support_request", {
    p_student_id: studentId || null, p_category: category, p_subject: subject, p_message: message,
  });
  if (error) return { error: error.message };
  return { ok: true };
}
