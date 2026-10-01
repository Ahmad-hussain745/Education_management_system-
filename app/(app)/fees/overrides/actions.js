"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function refresh() {
  revalidatePath("/fees/overrides");
  revalidatePath("/students");
}

// A student override outranks the class fee entirely for that one student
// (see get_or_create_fee_record's resolution order in
// 0005_fee_structure_history.sql) — same dated-history model as Fee
// Structure, just scoped to student_id instead of class_id.
export async function createStudentFee(formData) {
  const supabase = await createClient();
  const student_id = formData.get("student_id")?.toString();
  const monthly_fee = Number(formData.get("monthly_fee") || 0);
  const effective_from = formData.get("effective_from")?.toString() || new Date().toISOString().slice(0, 10);

  if (!student_id) return { error: "Pick a student." };
  if (monthly_fee < 0) return { error: "Monthly fee can't be negative." };

  const { error } = await supabase.from("fee_structures").insert({ student_id, monthly_fee, effective_from, active: true });
  if (error) {
    if (error.code === "23505") return { error: "This student already has a fee scheduled to take effect on that exact date — pick a different date, or edit that row instead." };
    return { error: error.message };
  }
  refresh();
  return { success: true };
}

export async function toggleStudentFeeActive(id, active) {
  const supabase = await createClient();
  const { error } = await supabase.from("fee_structures").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { success: true };
}

export async function deleteStudentFee(id) {
  const supabase = await createClient();
  const { error } = await supabase.from("fee_structures").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { success: true };
}
