"use server";

import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";

export async function submitAssignment(assignmentId, studentId, contentText, contentUrl) {
  const rc = await getRoleContext();
  if (!rc?.isParent) return { error: "Not authorized." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_assignment", {
    p_assignment_id: assignmentId, p_student_id: studentId, p_content_text: contentText || null, p_content_url: contentUrl || null,
  });
  if (error) return { error: error.message };
  return { ok: true };
}
