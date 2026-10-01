"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function refresh() {
  revalidatePath("/fees/discounts");
  revalidatePath("/students");
}

// get_or_create_fee_record sums every ACTIVE fee_discounts row for the
// student into the bill's Discount line (0003_fee_generation.sql) — so
// toggling active is how a discount is turned on/off going forward, and
// deleting removes it outright. Neither touches bills already generated
// (fee_records.discount is a snapshot, same as monthly_fee).
export async function createDiscount(formData) {
  const supabase = await createClient();
  const student_id = formData.get("student_id")?.toString();
  const amount = Number(formData.get("amount") || 0);
  const reason = formData.get("reason")?.toString().trim() || null;

  if (!student_id) return { error: "Pick a student." };
  if (!amount || amount <= 0) return { error: "Enter a discount amount greater than 0." };

  const { data: { user } } = await supabase.auth.getUser();
  let createdBy = null;
  if (user) {
    const { data: me } = await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle();
    createdBy = me?.id || null;
  }

  const { error } = await supabase.from("fee_discounts").insert({ student_id, amount, reason, active: true, created_by: createdBy });
  if (error) return { error: error.message };
  refresh();
  return { success: true };
}

export async function toggleDiscountActive(id, active) {
  const supabase = await createClient();
  const { error } = await supabase.from("fee_discounts").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { success: true };
}

export async function deleteDiscount(id) {
  const supabase = await createClient();
  const { error } = await supabase.from("fee_discounts").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { success: true };
}
