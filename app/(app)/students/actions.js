"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function readStudentFields(formData) {
  return {
    student_code: formData.get("student_code")?.toString().trim() || null,
    name: formData.get("name")?.toString().trim(),
    guardian_name: formData.get("guardian_name")?.toString().trim() || null,
    guardian_phone: formData.get("guardian_phone")?.toString().trim() || null,
    class_id: formData.get("class_id")?.toString() || null,
    section_id: formData.get("section_id")?.toString() || null,
    admission_date: formData.get("admission_date")?.toString() || new Date().toISOString().slice(0, 10),
    status: formData.get("status")?.toString() === "inactive" ? "inactive" : "active",
  };
}

// This runs on the server, using the signed-in user's session — so RLS still
// applies. A Cashier account, for example, can be denied INSERT on students
// at the database level even if this action is called directly.
//
// Goes through create_student() (0043_offline_student_registration.sql)
// rather than a raw insert now — that's what moved student_code assignment
// out of this file's old nextStudentCode() (a JS scan-the-table-and-guess
// that could collide) into one atomic claim inside the same transaction as
// the insert. It's also what makes offline registration safe (see
// lib/offline/repositories/students.js): the exact same RPC, called from
// sync-engine.js once a device reconnects, with that device's local_id as
// p_idempotency_key.
export async function createStudent(formData) {
  const supabase = await createClient();

  const payload = readStudentFields(formData);
  if (!payload.name) return { error: "Student name is required." };

  const monthlyFee = formData.get("monthly_fee")?.toString().trim();
  const discount = formData.get("discount")?.toString().trim();
  const discountReason = formData.get("discount_reason")?.toString().trim() || null;
  const idempotencyKey = formData.get("idempotency_key")?.toString() || null;

  const { data: student, error } = await supabase.rpc("create_student", {
    p_name: payload.name,
    p_guardian_name: payload.guardian_name,
    p_guardian_phone: payload.guardian_phone,
    p_class_id: payload.class_id,
    p_section_id: payload.section_id,
    p_admission_date: payload.admission_date,
    p_status: payload.status,
    p_student_code: payload.student_code,
    p_monthly_fee: monthlyFee ? Number(monthlyFee) : null,
    p_discount: discount ? Number(discount) : null,
    p_discount_reason: discountReason,
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    if (error.message?.includes("NOT_AUTHORIZED")) return { error: "You're not authorized to add a student." };
    if (error.message?.includes("INVALID_NAME")) return { error: "Student name is required." };
    return { error: error.message };
  }

  revalidatePath("/students");
  return { success: true, student };
}

// Edits the student's own fields, plus (only if the amount actually
// changed) a new dated fee_structures row and a discount replacement — the
// old rows are never touched/deleted, only superseded, so history holds.
export async function updateStudent(studentId, formData) {
  const supabase = await createClient();

  const payload = readStudentFields(formData);
  if (!payload.name) return { error: "Student name is required." };

  const { error } = await supabase.from("students").update(payload).eq("id", studentId);
  if (error) return { error: error.message };

  const monthlyFee = formData.get("monthly_fee")?.toString().trim();
  const currentFee = formData.get("current_fee_override")?.toString().trim();
  if (monthlyFee && Number(monthlyFee) >= 0 && Number(monthlyFee) !== Number(currentFee || 0)) {
    const { error: feeError } = await supabase
      .from("fee_structures")
      .insert({ student_id: studentId, monthly_fee: Number(monthlyFee) });
    if (feeError) return { error: `Student updated, but the fee override failed: ${feeError.message}` };
  }

  const discount = formData.get("discount")?.toString().trim();
  const discountReason = formData.get("discount_reason")?.toString().trim() || null;
  const currentDiscount = formData.get("current_discount")?.toString().trim();
  if (discount !== undefined && Number(discount || 0) !== Number(currentDiscount || 0)) {
    // Replace, don't stack: deactivate whatever was active, insert the new figure.
    await supabase.from("fee_discounts").update({ active: false }).eq("student_id", studentId).eq("active", true);
    if (Number(discount) > 0) {
      const { error: discError } = await supabase
        .from("fee_discounts")
        .insert({ student_id: studentId, amount: Number(discount), reason: discountReason });
      if (discError) return { error: `Student updated, but the discount failed: ${discError.message}` };
    }
  }

  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  return { success: true };
}

// Students are usually never physically deleted — they have financial and
// academic history attached, so this flips active/inactive instead,
// matching the database architecture (person_status enum) used everywhere
// else in the app. deleteStudent() below is the escape hatch for a genuine
// mistake (a duplicate entry, the wrong student added) rather than an
// ordinary "this student left."
export async function setStudentStatus(studentId, status) {
  const supabase = await createClient();
  if (status !== "active" && status !== "inactive") return { error: "Invalid status." };

  const { error } = await supabase.from("students").update({ status }).eq("id", studentId);
  if (error) return { error: error.message };

  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  return { success: true };
}

// Hard delete — for a genuine mistake (duplicate entry, wrong student
// added), not an ordinary "this student left," which setStudentStatus above
// remains the right tool for. Guarded the same way deleteSubject()
// (academic/subjects/actions.js) guards against deleting something with
// real data built on it: check first, give a specific reason, don't just
// let a raw FK-violation error surface.
//
// fee_payments.student_id is `on delete restrict` (0001_init.sql, "the real
// financial ledger") — Postgres itself refuses this delete outright if any
// payment exists, no matter what this pre-check does. The count below
// exists to give a clear, specific reason before that happens, not to
// replace the database's own guarantee: even if this check were skipped or
// wrong, a student with payment history still can't be deleted.
//
// fee_records/fee_discounts/fee_structures/student_attendance are `on
// delete cascade` — a student with zero payments but, say, an unpaid
// fee_record or attendance history WOULD lose those silently on delete
// without this second check, so it's called out explicitly too rather than
// relying only on the one hard DB guarantee that exists.
export async function deleteStudent(studentId) {
  const supabase = await createClient();

  const { count: paymentCount } = await supabase
    .from("fee_payments").select("id", { count: "exact", head: true }).eq("student_id", studentId);
  if (paymentCount > 0) {
    return { error: `This student has ${paymentCount} recorded payment${paymentCount === 1 ? "" : "s"} — students with any payment history can't be deleted, only deactivated, so that record is never lost.` };
  }

  const { count: attendanceCount } = await supabase
    .from("student_attendance").select("id", { count: "exact", head: true }).eq("student_id", studentId);
  const { count: feeRecordCount } = await supabase
    .from("fee_records").select("id", { count: "exact", head: true }).eq("student_id", studentId);
  if (attendanceCount > 0 || feeRecordCount > 0) {
    const parts = [];
    if (feeRecordCount > 0) parts.push(`${feeRecordCount} fee bill${feeRecordCount === 1 ? "" : "s"}`);
    if (attendanceCount > 0) parts.push(`${attendanceCount} attendance record${attendanceCount === 1 ? "" : "s"}`);
    return { error: `This student has ${parts.join(" and ")} on record — deleting would erase that history. Deactivate instead if they've genuinely left.` };
  }

  const { error } = await supabase.from("students").delete().eq("id", studentId);
  if (error) {
    // Backstop for anything the two checks above didn't anticipate (exam
    // results, parent portal links, a future table with its own FK) —
    // Postgres' own restrict/cascade rules are what actually protect the
    // data either way; this just turns a raw constraint-violation message
    // into something readable.
    if (error.code === "23503") {
      return { error: "This student has other records attached (exams, parent portal access, etc.) that would be lost — deactivate instead." };
    }
    return { error: error.message };
  }

  revalidatePath("/students");
  return { success: true };
}
