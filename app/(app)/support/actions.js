"use server";

import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";

export async function respondToRequest(id, response, status) {
  const rc = await getRoleContext();
  if (!rc?.userId) return { error: "Not authorized." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_support_request", { p_id: id, p_response: response || null, p_status: status });
  if (error) return { error: error.message };
  return { ok: true };
}
