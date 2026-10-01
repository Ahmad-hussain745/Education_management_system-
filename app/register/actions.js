"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";

// Public — anyone can call this, no session required. That's deliberate:
// it's the whole point of a self-service "Create Account" flow. What it
// does NOT do is grant access. It creates a real Supabase Auth account
// (the normal, non-privileged signUp() path — no service role involved
// here) and a matching public.users row that is hard-coded
// status='inactive', role_id=null — those two values are never taken from
// the form, so this action can't be used to self-grant a role or
// activate an account no matter what's submitted. A Super Admin has to
// pick a role and activate them from Settings → Users before
// app/(app)/layout.js's status check will let them past the login screen.
//
// The admin client is used for exactly one narrow step — inserting that
// row — because "admin manages users" in 0002_rls.sql only allows an
// admin to write to users, and a brand-new registrant has no role to be
// allowed by RLS under yet. That's the only reason this step needs it;
// nothing about who's calling this action is privileged.
export async function registerAccount(formData) {
  const name = formData.get("name")?.toString().trim();
  const email = formData.get("email")?.toString().trim();
  const password = formData.get("password")?.toString();

  if (!name) return { error: "Name is required." };
  if (!email) return { error: "Email is required." };
  if (!password || password.length < 8) return { error: "Password must be at least 8 characters." };

  const supabase = await createClient();
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
  if (signUpError) return { error: signUpError.message };
  if (!signUpData.user) return { error: "Could not create the account. Try again." };

  const admin = createAdminClient();
  const { error: userError } = await admin.from("users").insert({
    name,
    email,
    auth_user_id: signUpData.user.id,
    role_id: null,
    status: "inactive",
  });
  if (userError) {
    // Don't leave an orphaned Auth account with no matching users row —
    // same cleanup-on-partial-failure pattern as createUserAccount in
    // settings/users/actions.js.
    await admin.auth.admin.deleteUser(signUpData.user.id);
    return { error: userError.message };
  }

  return { success: true };
}
