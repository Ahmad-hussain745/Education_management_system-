"use server";

import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";

export async function createAnnouncement(title, body, audience, classId) {
  const rc = await getRoleContext();
  if (!(rc?.isAdmin || rc?.isPrincipal)) return { error: "Not authorized." };
  if (!title.trim() || !body.trim()) return { error: "Title and body are required." };
  if (audience === "class" && !classId) return { error: "Choose a class for a class-only announcement." };

  const supabase = await createClient();
  const { error } = await supabase.from("announcements").insert({
    title: title.trim(), body: body.trim(), audience, class_id: audience === "class" ? classId : null, created_by: rc.userId,
  });
  if (error) return { error: error.message };
  return { ok: true };
}
