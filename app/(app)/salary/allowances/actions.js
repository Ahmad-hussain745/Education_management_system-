"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// One row here = a standing Rs. amount added to (allowance) or subtracted
// from (deduction) every future payroll draft for this teacher, until
// turned off. Nothing about WHEN it applies is typed anywhere else — it's
// picked up automatically the next time Generate/Refresh Payroll runs
// (interactively or via the monthly cron), same as a percentage rule.
export async function createRecurringItem(formData) {
  const supabase = await createClient();

  const teacher_id = formData.get("teacher_id")?.toString();
  const item_type = formData.get("item_type")?.toString();
  const label = formData.get("label")?.toString().trim();
  const amount = Number(formData.get("amount") || 0);

  if (!teacher_id) return { error: "Pick a teacher." };
  if (item_type !== "allowance" && item_type !== "deduction") return { error: "Pick allowance or deduction." };
  if (!label) return { error: "Give this a label, e.g. \"Transport Allowance\"." };
  if (!amount || amount <= 0) return { error: "Enter an amount greater than 0." };

  const { error } = await supabase.from("salary_recurring_items").insert({ teacher_id, item_type, label, amount, active: true });
  if (error) return { error: error.message };

  revalidatePath("/salary/allowances");
  return { success: true };
}

export async function toggleRecurringItem(id, active) {
  const supabase = await createClient();
  const { error } = await supabase.from("salary_recurring_items").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/salary/allowances");
  return { success: true };
}
