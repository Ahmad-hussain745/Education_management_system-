"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";

// Public — anyone can call this. Unlike the ordinary "Create Account" flow
// in app/register/actions.js (which creates an inactive, role-less user
// waiting for an existing admin to approve them), this one creates a BRAND
// NEW institute plus its first admin — activated immediately, because
// there is no existing admin at that institute to do the approving. That's
// the one and only case where self-service = instant access is safe: the
// account can only ever see the institute it just created (institute_id
// isolation is enforced in Postgres by 0035_multi_tenancy.sql), so
// there's no path from here into any other institute's data.
export async function registerInstitute(formData) {
  const instituteName = formData.get("institute_name")?.toString().trim();
  const adminName = formData.get("admin_name")?.toString().trim();
  const email = formData.get("email")?.toString().trim();
  const password = formData.get("password")?.toString();
  const logo = formData.get("logo");

  if (!instituteName) return { error: "Institute name is required." };
  if (!adminName) return { error: "Your name is required." };
  if (!email) return { error: "Email is required." };
  if (!password || password.length < 8) return { error: "Password must be at least 8 characters." };

  const admin = createAdminClient();

  // 1. Create the institute row first (no institute_id chicken-and-egg —
  // this insert has none to isolate against yet).
  const { data: institute, error: instituteError } = await admin
    .from("institutes")
    .insert({ name: instituteName })
    .select()
    .single();
  if (instituteError) return { error: instituteError.message };

  // 2. Logo is optional — upload it if provided, and store its public URL.
  if (logo && typeof logo === "object" && logo.size > 0) {
    const ext = logo.name?.split(".").pop() || "png";
    const path = `${institute.id}/logo.${ext}`;
    const { error: uploadError } = await admin.storage
      .from("institute-logos")
      .upload(path, logo, { upsert: true, contentType: logo.type });

    if (!uploadError) {
      const { data: publicUrl } = admin.storage.from("institute-logos").getPublicUrl(path);
      await admin.from("institutes").update({ logo_url: publicUrl.publicUrl }).eq("id", institute.id);
    }
    // Logo upload failing shouldn't block institute creation — the admin
    // can add/replace it later from Settings.
  }

  // 3. Create the real Supabase Auth account (normal, non-privileged
  // signUp() — no service role involved in the auth step itself).
  const supabase = await createClient();
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
  if (signUpError) {
    await admin.from("institutes").delete().eq("id", institute.id);
    return { error: signUpError.message };
  }
  if (!signUpData.user) {
    await admin.from("institutes").delete().eq("id", institute.id);
    return { error: "Could not create the account. Try again." };
  }

  // 4. Look up the (global, shared) Super Admin role.
  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id")
    .eq("name", "Super Admin")
    .single();
  if (roleError || !role) {
    await admin.auth.admin.deleteUser(signUpData.user.id);
    await admin.from("institutes").delete().eq("id", institute.id);
    return { error: "Setup is incomplete — the Super Admin role is missing. Contact support." };
  }

  // 5. Create the users row — institute_id is set explicitly here (the
  // auto-fill trigger only kicks in when it's left null), status is
  // 'active' immediately, and role is Super Admin: this person now fully
  // owns and administers their new, empty institute.
  const { error: userError } = await admin.from("users").insert({
    name: adminName,
    email,
    auth_user_id: signUpData.user.id,
    institute_id: institute.id,
    role_id: role.id,
    status: "active",
  });
  if (userError) {
    await admin.auth.admin.deleteUser(signUpData.user.id);
    await admin.from("institutes").delete().eq("id", institute.id);
    return { error: userError.message };
  }

  return { success: true };
}
