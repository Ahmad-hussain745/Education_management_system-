"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// One insert. The ledger trigger (trg_income_ledger, 0001_init.sql) posts
// the matching transactions row and moves the account balance by itself —
// this action never touches transactions or accounts directly.
export async function recordIncome(formData) {
  const supabase = await createClient();

  const payload = {
    category: formData.get("category")?.toString().trim(),
    description: formData.get("description")?.toString().trim() || null,
    amount: Number(formData.get("amount") || 0),
    method: formData.get("method")?.toString() || "Cash",
    income_date: formData.get("income_date")?.toString() || new Date().toISOString().slice(0, 10),
  };

  if (!payload.category) return { error: "Category is required." };
  if (!payload.amount || payload.amount <= 0) return { error: "Enter an amount greater than 0." };

  const { error } = await supabase.from("income").insert(payload);
  if (error) {
    if (error.message?.includes("MONTH_CLOSED")) {
      return { error: "That accounting month is closed and can't take new income entries. If this corrects a closed month, reverse the original entry and post the correction in the current month instead." };
    }
    return { error: error.message };
  }

  revalidatePath("/finance/income");
  revalidatePath("/dashboard");
  return { success: true };
}
