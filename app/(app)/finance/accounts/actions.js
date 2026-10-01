"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createAccount(formData) {
  const supabase = await createClient();
  const name = formData.get("name")?.toString().trim();
  const kind = formData.get("kind")?.toString();
  const openingBalance = Number(formData.get("opening_balance") || 0);

  if (!name) return { error: "Account name is required." };
  if (kind !== "cash" && kind !== "bank") return { error: "Invalid account kind." };

  // current_balance starts equal to opening_balance — every transaction
  // after this point is what moves it, via post_transaction() (0001_init.sql).
  const { error } = await supabase.from("accounts").insert({
    name, kind, opening_balance: openingBalance, current_balance: openingBalance,
  });
  if (error) return { error: error.message };

  revalidatePath("/finance/accounts");
  return { success: true };
}

// Never physically deleted — an account with transaction history disappearing
// would silently break every past ledger row's account_id reference.
export async function setAccountStatus(accountId, status) {
  const supabase = await createClient();
  if (status !== "active" && status !== "inactive") return { error: "Invalid status." };

  const { error } = await supabase.from("accounts").update({ status }).eq("id", accountId);
  if (error) return { error: error.message };

  revalidatePath("/finance/accounts");
  return { success: true };
}
