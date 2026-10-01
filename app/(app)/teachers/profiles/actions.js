"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function createTeacher(formData) {
  const supabase = await createClient();

  const payload = {
    name: formData.get("name")?.toString().trim(),
    subject_id: formData.get("subject_id")?.toString() || null,
    phone: formData.get("phone")?.toString().trim() || null,
    salary_mode: formData.get("salary_mode")?.toString() || "fixed",
    fixed_salary: Number(formData.get("fixed_salary") || 0),
    status: formData.get("status")?.toString() || "active",
  };

  if (!payload.name) return { error: "Teacher name is required." };

  const { error } = await supabase.from("teachers").insert(payload);
  if (error) return { error: error.message };

  revalidatePath("/teachers/profiles");
  return { success: true };
}

// ----------------------------------------------------------------------------
// Teacher → Teacher Account → Supabase Login
//
//   users.auth_user_id → users.id → teachers.user_id
//
// This is what every "own" scope depends on (own attendance, own classes,
// own syllabus, own salary) — the RLS policies in 0002_rls.sql already
// check exactly this chain via current_teacher_id(), so linking it here is
// what actually turns those policies on for a given teacher.
//
// auth.users isn't covered by our Postgres RLS policies at all (Supabase
// Auth manages it separately), so this action does its own explicit role
// check before touching the admin client — unlike most other actions in
// this app, which can safely rely on RLS alone.
// ----------------------------------------------------------------------------
export async function createTeacherAccount({ teacherId, email, password }) {
  if (!teacherId || !email || !password) {
    return { error: "Teacher, email and password are all required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { error: "Not signed in." };
  const { data: me } = await supabase
    .from("users").select("role:roles(name)").eq("auth_user_id", auth.user.id).maybeSingle();
  if (me?.role?.name !== "Super Admin") {
    return { error: "Only a Super Admin can create teacher logins." };
  }

  const { data: teacher } = await supabase.from("teachers").select("id, name, user_id").eq("id", teacherId).maybeSingle();
  if (!teacher) return { error: "Teacher not found." };
  if (teacher.user_id) return { error: "This teacher already has a linked account." };

  const { data: teacherRole } = await supabase.from("roles").select("id").eq("name", "Teacher").maybeSingle();
  if (!teacherRole) return { error: "'Teacher' role isn't seeded in the roles table." };

  const admin = createAdminClient();

  // 1. Real Supabase Auth account.
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError) return { error: authError.message };

  // 2. App-level users row, linked to the auth account.
  const { data: appUser, error: userError } = await admin
    .from("users")
    .insert({ name: teacher.name, email, role_id: teacherRole.id, auth_user_id: created.user.id, status: "active" })
    .select("id")
    .single();
  if (userError) {
    // Roll back the orphaned auth account so retrying doesn't collide on email.
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: userError.message };
  }

  // 3. Complete the chain: teachers.user_id → users.id. If this fails, steps
  // 1-2 already succeeded — a real, working login with a role now exists,
  // just not yet linked to this teacher record. Rather than leave that
  // silent (the Super Admin would have no way to know without checking),
  // surface it explicitly so they know to link it manually via
  // teachers.user_id, or delete the orphaned login (created.user.id) and
  // retry, rather than assuming the whole operation failed cleanly.
  const { error: linkError } = await admin.from("teachers").update({ user_id: appUser.id }).eq("id", teacherId);
  if (linkError) {
    return {
      error: `Login created (${email}) but linking it to this teacher failed: ${linkError.message}. The account exists and has a role — link teachers.user_id to users.id "${appUser.id}" manually, or remove the login and try again.`,
    };
  }

  revalidatePath(`/teachers/profiles/${teacherId}`);
  revalidatePath("/teachers/profiles");
  revalidatePath("/settings/users");
  return { success: true };
}
