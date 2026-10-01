"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Runs generate_salary_records() (0001_init.sql): for every active teacher,
// it sums actual fee_payments for each class they earn a % from and writes
// the resulting salary_items + salary_records — nobody types a Rupee figure
// here, only the % (Salary Configuration) and the fee payments (Payment
// Entry) that were already entered elsewhere. Re-running for the same month
// is safe — it recalculates from current data and skips any teacher whose
// record is already locked.
export async function generatePayroll(month) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("generate_salary_records", { p_month: month });
  if (error) return { error: error.message };
  revalidatePath("/salary/payroll");
  return { success: true };
}

// Freezes a teacher's payroll figures for the month. RLS + the
// enforce_approve_only trigger (0002_rls.sql) do the real enforcement here:
// a Principal may only flip locked/locked_at/locked_by, finance staff can
// still edit; anyone else is rejected by Postgres regardless of what this
// action sends.
export async function approveAndLock(salaryRecordId) {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  let lockedBy = null;
  if (auth?.user) {
    const { data: appUser } = await supabase
      .from("users").select("id").eq("auth_user_id", auth.user.id).maybeSingle();
    lockedBy = appUser?.id ?? null;
  }

  const { error } = await supabase
    .from("salary_records")
    .update({ locked: true, locked_at: new Date().toISOString(), locked_by: lockedBy })
    .eq("id", salaryRecordId);
  if (error) return { error: error.message };

  revalidatePath("/salary/payroll");
  return { success: true };
}

// The "Ahmed's teacher gets paid" moment — a single insert. The trigger on
// salary_payments (0001_init.sql) keeps salary_records.paid_total/status in
// sync and posts the matching ledger row automatically.
export async function recordSalaryPayment(formData) {
  const supabase = await createClient();

  const salary_record_id = formData.get("salary_record_id")?.toString();
  const teacher_id = formData.get("teacher_id")?.toString();
  const month = formData.get("month")?.toString();
  const amount = Number(formData.get("amount") || 0);
  const method = formData.get("method")?.toString() || "Bank Transfer";

  if (!salary_record_id || !teacher_id || !month) return { error: "Missing payroll record." };
  if (!amount || amount <= 0) return { error: "Enter an amount greater than 0." };

  const { data: salary } = await supabase
    .from("salary_records")
    .select("gross_salary, paid_total, status, locked")
    .eq("id", salary_record_id)
    .single();

  if (!salary) {
    return { error: "Salary record not found." };
  }

  const remaining = Number(salary.gross_salary) - Number(salary.paid_total);

  if (amount > remaining) {
    return { error: `Maximum payable amount is Rs. ${remaining.toLocaleString()}` };
  }

  const { error } = await supabase
    .from("salary_payments")
    .insert({ salary_record_id, teacher_id, month, amount, method });
  if (error) {
    if (error.message?.includes("MONTH_CLOSED")) {
      return { error: "That accounting month is closed and can't take new salary payments. If this corrects a closed month, reverse the original payment and post the correction in the current month instead." };
    }
    return { error: error.message };
  }

  revalidatePath("/salary/payroll");
  revalidatePath("/dashboard");
  return { success: true };
}
