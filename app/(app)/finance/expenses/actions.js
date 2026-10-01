"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// request_expense() (0056_approval_workflows.sql) decides for itself
// whether this posts immediately or becomes a pending expense_requests row
// — below the institute's large_expense_threshold, same one-insert
// behavior this action always had; at or above it, nothing touches the
// ledger until a DIFFERENT person (Super Admin or Principal, never the
// requester) approves it from PendingExpenseApprovals. Either way this is
// one RPC call, not a branch this file has to reason about itself.
export async function recordExpense(formData) {
  const supabase = await createClient();

  const category = formData.get("category")?.toString().trim();
  const description = formData.get("description")?.toString().trim() || null;
  const amount = Number(formData.get("amount") || 0);
  const method = formData.get("method")?.toString() || "Cash";
  const expenseDate = formData.get("expense_date")?.toString() || new Date().toISOString().slice(0, 10);
  const idempotencyKey = formData.get("idempotency_key")?.toString() || null;

  if (!category) return { error: "Category is required." };
  if (!amount || amount <= 0) return { error: "Enter an amount greater than 0." };

  const { data, error } = await supabase.rpc("request_expense", {
    p_category: category,
    p_description: description,
    p_amount: amount,
    p_method: method,
    p_expense_date: expenseDate,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    if (error.message?.includes("MONTH_CLOSED")) {
      return { error: "That accounting month is closed and can't take new expense entries. If this corrects a closed month, reverse the original entry and post the correction in the current month instead." };
    }
    if (error.message?.includes("NOT_AUTHORIZED")) return { error: "You're not authorized to record an expense." };
    if (error.message?.includes("INVALID_AMOUNT")) return { error: "Enter an amount greater than 0." };
    if (error.message?.includes("INVALID_CATEGORY")) return { error: "Category is required." };
    return { error: error.message };
  }

  revalidatePath("/finance/expenses");
  revalidatePath("/dashboard");
  // data: { posted: true, expense_id } once below threshold, or
  // { posted: false, request_id, status: 'pending', threshold } at/above it.
  return { success: true, ...data };
}

// canApprove() (Super Admin/Principal) is checked inside decide_expense_
// request() itself — this action's only job is translating its errors
// (ALREADY_DECIDED, the requester-can't-approve-their-own-request check,
// REASON_REQUIRED for a rejection) into what PendingExpenseApprovals.js
// shows.
export async function decideExpenseRequest(requestId, approve, note) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decide_expense_request", {
    p_request_id: requestId, p_approve: approve, p_note: note || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/finance/expenses");
  revalidatePath("/dashboard");
  return { success: true, ...data };
}
