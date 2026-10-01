"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// Same guard pattern as settings/users/actions.js — RLS's
// "institute admin can update own institute" policy (0035_multi_tenancy.sql)
// is the real enforcement, this is just so the UI can give a clear message
// instead of a raw Postgres error.
async function requireSuperAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: me } = await supabase
    .from("users")
    .select("institute_id, role:roles(name)")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (me?.role?.name !== "Super Admin") return { error: "Only a Super Admin can edit institute settings." };
  return { ok: true, instituteId: me.institute_id };
}

export async function getMyInstitute() {
  const guard = await requireSuperAdmin();
  if (guard.error) return { error: guard.error };
  const supabase = await createClient();
  const { data, error } = await supabase.from("institutes").select("*").eq("id", guard.instituteId).single();
  if (error) return { error: error.message };
  return { institute: data };
}

export async function updateInstituteProfile(formData) {
  const guard = await requireSuperAdmin();
  if (guard.error) return { error: guard.error };

  const name = formData.get("name")?.toString().trim();
  const address = formData.get("address")?.toString().trim() || null;
  const phone = formData.get("phone")?.toString().trim() || null;
  const email = formData.get("email")?.toString().trim() || null;
  const logo = formData.get("logo");

  if (!name) return { error: "Institute name is required." };

  const supabase = await createClient();
  const updates = { name, address, phone, email };

  // Logo upload needs the service-role client (storage write policy is
  // scoped to admin uploads happening through this action, not arbitrary
  // client-side writes) — same split as registerInstitute().
  if (logo && typeof logo === "object" && logo.size > 0) {
    const admin = createAdminClient();
    const ext = logo.name?.split(".").pop() || "png";
    const path = `${guard.instituteId}/logo.${ext}`;
    const { error: uploadError } = await admin.storage
      .from("institute-logos")
      .upload(path, logo, { upsert: true, contentType: logo.type });
    if (uploadError) return { error: `Logo upload failed: ${uploadError.message}` };
    const { data: pub } = admin.storage.from("institute-logos").getPublicUrl(path);
    updates.logo_url = pub.publicUrl;
  }

  const { error } = await supabase.from("institutes").update(updates).eq("id", guard.instituteId);
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  revalidatePath("/settings/institute");
  return { success: true };
}
