"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Runs on the server using the signed-in user's own session, so RLS still
// applies — a Cashier or another teacher calling this directly would be
// rejected at the database level for any teacher_id that isn't their own
// (see "office staff mark any, teacher marks own" in 0002_rls.sql).
export async function saveTeacherAttendance(formData) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const date = formData.get("date")?.toString();
  if (!date) return { error: "Date is required." };

  // The register form renders one row per teacher with fields named
  // status_<teacherId>, checkin_<teacherId>, checkout_<teacherId> — collect
  // every teacher id that has a status selected and build one upsert row
  // each, rather than requiring every teacher to be filled in.
  const teacherIds = new Set();
  for (const key of formData.keys()) {
    const match = key.match(/^status_(.+)$/);
    if (match) teacherIds.add(match[1]);
  }
  if (teacherIds.size === 0) return { error: "Mark at least one teacher's status before saving." };

  // Resolve marked_by = the users.id row for the signed-in auth user (not
  // the auth id itself — users.id is this table's own primary key).
  const { data: me } = await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle();

  const rows = [...teacherIds].map((teacherId) => ({
    teacher_id: teacherId,
    date,
    status: formData.get(`status_${teacherId}`)?.toString(),
    check_in: formData.get(`checkin_${teacherId}`)?.toString() || null,
    check_out: formData.get(`checkout_${teacherId}`)?.toString() || null,
    marked_by: me?.id || null,
  }));

  const { error } = await supabase.from("teacher_attendance").upsert(rows, { onConflict: "teacher_id,date" });
  if (error) return { error: error.message };

  revalidatePath("/attendance/teachers");
  return { success: true, count: rows.length };
}
