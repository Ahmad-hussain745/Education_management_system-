"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// auth.users isn't covered by our Postgres RLS at all (Supabase Auth
// manages it separately) — createAdminClient() bypasses RLS by design, so
// every action here that touches it does its own explicit role check
// first, exactly like createTeacherAccount in teachers/profiles/actions.js.
async function requireSuperAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: me } = await supabase.from("users").select("role:roles(name)").eq("auth_user_id", user.id).maybeSingle();
  if (me?.role?.name !== "Super Admin") return { error: "Only a Super Admin can manage user accounts." };
  return { ok: true };
}

// ----------------------------------------------------------------------------
// Super Admin → Create User → Supabase Auth → public.users → Role →
// optional Teacher Link. Same three-step chain and same honesty-under-
// partial-failure as createTeacherAccount: if step 2 (public.users) fails,
// the orphaned Auth account is deleted so retrying doesn't collide on
// email. If step 3 (the teacher link) fails, steps 1-2 already succeeded —
// a real, working login now exists — so this returns an explicit message
// telling the Super Admin exactly what to fix by hand, rather than
// pretending the whole operation rolled back cleanly.
// ----------------------------------------------------------------------------
export async function createUserAccount(formData) {
  const guard = await requireSuperAdmin();
  if (guard.error) return guard;

  const name = formData.get("name")?.toString().trim();
  const email = formData.get("email")?.toString().trim();
  const password = formData.get("password")?.toString();
  const role_id = formData.get("role_id")?.toString();
  const teacher_id = formData.get("teacher_id")?.toString() || null;

  if (!name) return { error: "Name is required." };
  if (!email) return { error: "Email is required." };
  if (!password || password.length < 8) return { error: "Password must be at least 8 characters." };
  if (!role_id) return { error: "Pick a role." };

  const supabase = await createClient();

  if (teacher_id) {
    const { data: teacher } = await supabase.from("teachers").select("id, user_id").eq("id", teacher_id).maybeSingle();
    if (!teacher) return { error: "Teacher not found." };
    if (teacher.user_id) return { error: "This teacher already has a linked account." };
  }

  const admin = createAdminClient();

  // 1. Real Supabase Auth account.
  const { data: created, error: authError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (authError) return { error: authError.message };

  // 2. App-level users row, linked to the auth account.
  const { data: appUser, error: userError } = await admin
    .from("users")
    .insert({ name, email, role_id, auth_user_id: created.user.id, status: "active" })
    .select("id")
    .single();
  if (userError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: userError.message };
  }

  // 3. Optional: complete the chain to a teacher row.
  if (teacher_id) {
    const { error: linkError } = await admin.from("teachers").update({ user_id: appUser.id }).eq("id", teacher_id);
    if (linkError) {
      return {
        error: `Login created (${email}) but linking it to that teacher failed: ${linkError.message}. The account exists and has a role — link teachers.user_id to users.id "${appUser.id}" manually, or remove the login and try again.`,
      };
    }
  }

  revalidatePath("/settings/users");
  revalidatePath("/teachers/profiles");
  return { success: true };
}

// This uses the REGULAR client, not the admin one — "admin manages users"
// in 0002_rls.sql already lets a Super Admin update any users row via RLS,
// so there's no need to bypass it here. (Deactivating here alone isn't
// enough to actually block them, though — see the status check added to
// app/(app)/layout.js, which is what actually enforces it on their next
// request regardless of any session they still hold.)
export async function toggleUserStatus(id, active) {
  const guard = await requireSuperAdmin();
  if (guard.error) return guard;

  const supabase = await createClient();
  const { error } = await supabase.from("users").update({ status: active ? "active" : "inactive" }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/settings/users");
  return { success: true };
}

export async function updateUserRole(id, role_id) {
  const guard = await requireSuperAdmin();
  if (guard.error) return guard;

  const supabase = await createClient();
  const { error } = await supabase.from("users").update({ role_id }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/settings/users");
  return { success: true };
}
