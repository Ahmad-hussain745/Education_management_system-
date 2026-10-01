"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function nextMonthStr(month) {
  const d = new Date(month + "T00:00:00");
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export async function closeMonth(formData) {
  const supabase = await createClient();
  const month = formData.get("month")?.toString();
  const notes = formData.get("notes")?.toString().trim() || null;
  if (!month) return { error: "Month is required." };

  const monthEnd = nextMonthStr(month);

  // Same source as Finance Reports and the Dashboard — grouped from the
  // unified transactions ledger, not a separately-tracked total anywhere.
  const { data: txns, error: txnError } = await supabase
    .from("transactions")
    .select("type, direction, amount")
    .gte("txn_date", month)
    .lt("txn_date", monthEnd);
  if (txnError) return { error: txnError.message };

  const sumOf = (matchType) => (txns || []).filter((t) => t.type === matchType).reduce((a, t) => a + Number(t.amount), 0);
  const totalIncome = sumOf("fee_payment") + sumOf("income");
  const totalExpenses = sumOf("expense");
  const totalSalary = sumOf("salary_payment");

  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user
    ? await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle()
    : { data: null };

  // The unique constraint on monthly_closing.month (0001_init.sql) is the
  // real guard against closing the same month twice — this just turns that
  // Postgres error into a readable message.
  const { error } = await supabase.from("monthly_closing").insert({
    month,
    closed_by: me?.id || null,
    total_income: totalIncome,
    total_expenses: totalExpenses,
    total_salary: totalSalary,
    snapshot: { totalIncome, totalExpenses, totalSalary, transactionCount: (txns || []).length },
    notes,
  });
  if (error) {
    if (error.code === "23505") return { error: "This month has already been closed." };
    return { error: error.message };
  }

  revalidatePath("/finance/closing");
  return { success: true };
}
