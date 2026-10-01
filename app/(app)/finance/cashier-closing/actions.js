"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Both calls below go straight to the two RPCs in
// 0024_daily_cashier_closing.sql (get_cashier_closing_summary /
// close_cashier_day) instead of querying fee_payments/income directly from
// here — a Cashier has no SELECT policy on `income` at all, and even for
// fee_payments, computing "today's cash total" correctly needs the exact
// same aggregation the close step uses, so there's exactly one place that
// logic lives, not one for the preview and a slightly-different one here.
export async function listCashiers() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_cashiers");
  if (error) return { error: error.message };
  return { data };
}

export async function getCashierClosingSummary(cashierId, date) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("get_cashier_closing_summary", { p_cashier_id: cashierId, p_date: date })
    .maybeSingle();
  if (error) return { error: error.message };
  return { data };
}

export async function closeCashierDay(formData) {
  const supabase = await createClient();

  const cashier_id = formData.get("cashier_id")?.toString();
  const closing_date = formData.get("closing_date")?.toString();
  const actualRaw = formData.get("actual_cash")?.toString().trim();
  const reason = formData.get("reason")?.toString().trim() || null;

  if (!cashier_id) return { error: "Missing cashier." };
  if (!closing_date) return { error: "Missing date." };
  if (!actualRaw || Number.isNaN(Number(actualRaw))) return { error: "Enter the actual cash counted." };

  const { data, error } = await supabase
    .rpc("close_cashier_day", {
      p_cashier_id: cashier_id,
      p_date: closing_date,
      p_actual_cash: Number(actualRaw),
      p_reason: reason,
    })
    .single();

  if (error) {
    const msg = error.message || "";
    if (msg.includes("REASON_REQUIRED")) return { error: "Actual cash doesn't match expected cash — a reason is required before closing." };
    if (msg.includes("ALREADY_CLOSED")) return { error: "This day has already been closed for this cashier." };
    if (msg.includes("INVALID_ACTUAL_CASH")) return { error: "Enter the actual cash counted (0 or more)." };
    if (msg.includes("NOT_AUTHORIZED")) return { error: "You can only close your own cashier day." };
    return { error: msg };
  }

  revalidatePath("/finance/cashier-closing");
  return { success: true, closing: data };
}
