"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function refresh() {
  revalidatePath("/fees/structure");
  revalidatePath("/students");
}

// One insert = one dated fee change. get_or_create_fee_record() (see
// 0005_fee_structure_history.sql) resolves the correct fee for any month by
// finding the most recent active row on or before that month — nothing else
// needs updating when a class's fee changes, and past bills already
// generated are untouched since fee_records stores its own snapshot.
export async function createClassFee(formData) {
  const supabase = await createClient();
  const class_id = formData.get("class_id")?.toString();
  const monthly_fee = Number(formData.get("monthly_fee") || 0);
  const effective_from = formData.get("effective_from")?.toString() || new Date().toISOString().slice(0, 10);

  if (!class_id) return { error: "Pick a class." };
  if (monthly_fee < 0) return { error: "Monthly fee can't be negative." };

  const { error } = await supabase.from("fee_structures").insert({ class_id, monthly_fee, effective_from, active: true });
  if (error) {
    if (error.code === "23505") return { error: "This class already has a fee scheduled to take effect on that exact date — pick a different date, or edit that row instead." };
    return { error: error.message };
  }
  refresh();
  return { success: true };
}

export async function toggleClassFeeActive(id, active) {
  const supabase = await createClient();
  const { error } = await supabase.from("fee_structures").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { success: true };
}

// fee_records.monthly_fee is a plain stored snapshot, not a live reference
// to this row (see the note in 0005_fee_structure_history.sql) — so
// deleting a fee_structures row never touches bills already generated.
// It's always safe.
export async function deleteClassFee(id) {
  const supabase = await createClient();
  const { error } = await supabase.from("fee_structures").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { success: true };
}
