"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Assigning a teacher to a class is informational (drives the staff
// directory) and, if a percentage was set, also creates the matching
// salary_rules row in the same action — so ticking "this teacher earns a
// share here" is one step, not two separate screens to remember to visit.
// A whole-class rule and a section-specific rule for the SAME teacher/class
// can never both be active — one always double-counts the other's section.
// This mirrors check_salary_rule_overlap() in 0006_salary_rule_validation.sql;
// checking here first gives a clear message instead of a raw Postgres error,
// but the trigger is what actually stops it if this check is ever bypassed
// (e.g. a race between two simultaneous submissions).
async function findOverlappingRule(supabase, { teacherId, classId, sectionId, excludeRuleId }) {
  let query = supabase.from("salary_rules").select("id, section_id")
    .eq("teacher_id", teacherId).eq("class_id", classId).eq("active", true);
  query = sectionId ? query.is("section_id", null) : query.not("section_id", "is", null);
  const { data } = await query;
  return (data || []).find((r) => r.id !== excludeRuleId) || null;
}

// Assigning a teacher to a class, and (if a percentage was given) the
// matching salary_rules row, now happens as ONE call into the
// assign_teacher_class_with_salary() RPC (0018_atomic_teacher_assignment.sql)
// instead of separate insert/insert statements from this action. That
// function's body is one Postgres transaction: every validation (teacher,
// class, section, percentage, duplicate, overlap) runs first, then both
// writes happen, and if anything after that point fails, EVERYTHING in the
// call — including the teacher_classes insert — rolls back together. Before
// this, a failure on the salary_rules step alone could leave a saved
// assignment with no matching salary rule, silently under-paying that
// teacher with no error visible anywhere.
export async function assignTeacherClass(formData) {
  const supabase = await createClient();

  const teacher_id = formData.get("teacher_id")?.toString();
  const class_id = formData.get("class_id")?.toString();
  const section_id = formData.get("section_id")?.toString() || null;
  const subject_id = formData.get("subject_id")?.toString() || null;
  const percentageRaw = formData.get("percentage")?.toString().trim();
  const percentage = percentageRaw ? Number(percentageRaw) : null;

  if (!teacher_id) return { error: "Pick a teacher." };
  if (!class_id) return { error: "Pick a class." };

  const { error } = await supabase.rpc("assign_teacher_class_with_salary", {
    p_teacher_id: teacher_id,
    p_class_id: class_id,
    p_section_id: section_id,
    p_subject_id: subject_id,
    p_percentage: percentage,
  });

  if (error) {
    const msg = error.message || "";
    if (msg.includes("TEACHER_INACTIVE")) return { error: "This teacher is inactive and can't be assigned to a new class." };
    if (msg.includes("TEACHER_NOT_FOUND")) return { error: "That teacher no longer exists." };
    if (msg.includes("CLASS_INACTIVE")) return { error: "This class is inactive and can't take new assignments." };
    if (msg.includes("CLASS_NOT_FOUND")) return { error: "That class no longer exists." };
    if (msg.includes("SECTION_NOT_FOUND")) return { error: "That section no longer exists." };
    if (msg.includes("SECTION_CLASS_MISMATCH")) return { error: "That section does not belong to the selected class." };
    if (msg.includes("SUBJECT_INACTIVE")) return { error: "This subject is inactive and can't be assigned." };
    if (msg.includes("SUBJECT_NOT_FOUND")) return { error: "That subject no longer exists." };
    if (msg.includes("INVALID_PERCENTAGE")) return { error: "Percentage must be greater than 0 and no more than 100." };
    if (msg.includes("DUPLICATE_ASSIGNMENT") || error.code === "23505") return { error: "That teacher is already assigned to this class/section/subject." };
    if (msg.includes("OVERLAPPING_SALARY_RULE")) {
      return {
        error: section_id
          ? "This teacher already has a whole-class rule for this class — a section-specific rule would double-count this section's collection. Remove or narrow the whole-class rule first."
          : "This teacher already has a section-specific rule inside this class — a whole-class rule would double-count that section's collection. Remove the section-specific rule(s) first, or don't add a whole-class percentage here.",
      };
    }
    if (msg.includes("EFFECTIVE_DATE_MUST_ADVANCE")) return { error: "The effective date can't be earlier than this rule's current effective date." };
    if (msg.includes("LOCKED_PAYROLL_CONFLICT")) return { error: "A payroll month for this teacher is already locked at or after that date — the rate change was rejected to protect that approved payslip." };
    return { error: msg };
  }

  revalidatePath("/teachers/classes");
  revalidatePath("/salary/config");
  return { success: true };
}

function refresh() {
  revalidatePath("/teachers/classes");
  revalidatePath("/salary/config");
}

// "Edit" — teacher and class are the assignment's identity (changing either
// is really a different assignment); Section, Subject and the percentage
// share are what's actually refinable day to day.
export async function updateAssignment({ id, teacherId, classId, sectionId, subjectId, percentage }) {
  const supabase = await createClient();
  if (!id) return { error: "Missing assignment." };
  if (percentage && (Number(percentage) <= 0 || Number(percentage) > 100)) {
    return { error: "Percentage must be greater than 0 and no more than 100." };
  }

  const { data: current } = await supabase.from("teacher_classes").select("teacher_id, class_id, section_id").eq("id", id).maybeSingle();
  if (!current) return { error: "Assignment not found." };

  const { error } = await supabase
    .from("teacher_classes")
    .update({ section_id: sectionId || null, subject_id: subjectId || null })
    .eq("id", id);
  if (error) {
    if (error.code === "23505") return { error: "That teacher is already assigned to this class/section/subject." };
    return { error: error.message };
  }

  // Move/refresh the matching salary_rules row if the section changed, or
  // create/update it to match the new percentage. The rule is keyed on
  // (teacher_id, class_id, section_id) — not subject — per its schema.
  const sectionChanged = (current.section_id || null) !== (sectionId || null);
  if (sectionChanged) {
    let oldRuleQuery = supabase.from("salary_rules").select("id")
      .eq("teacher_id", teacherId).eq("class_id", classId);
    oldRuleQuery = current.section_id ? oldRuleQuery.eq("section_id", current.section_id) : oldRuleQuery.is("section_id", null);
    const { data: oldRule } = await oldRuleQuery.maybeSingle();
    if (oldRule) await supabase.from("salary_rules").update({ active: false }).eq("id", oldRule.id);
  }

  if (percentage && Number(percentage) > 0) {
    const overlap = await findOverlappingRule(supabase, { teacherId, classId, sectionId });
    if (overlap) {
      return {
        error: sectionId
          ? "This teacher already has a whole-class rule for this class — a section-specific rule would double-count this section's collection."
          : "This teacher already has a section-specific rule inside this class — a whole-class rule would double-count that section's collection.",
      };
    }

    let existingQuery = supabase.from("salary_rules").select("id, percentage")
      .eq("teacher_id", teacherId).eq("class_id", classId);
    existingQuery = sectionId ? existingQuery.eq("section_id", sectionId) : existingQuery.is("section_id", null);
    const { data: existing } = await existingQuery.maybeSingle();

    // effective_from is only included in the update when the percentage is
    // actually changing. This isn't just tidiness: 0025_salary_rule_history.sql's
    // trigger closes the current history segment at `new.effective_from - 1` —
    // if effective_from were carried forward UNCHANGED (Postgres' default for
    // a column not mentioned in an UPDATE's SET list) while the percentage
    // DID change, that computes effective_to = (this segment's own start
    // date) - 1, i.e. a segment that "ends" before it "begins", which the
    // history table's own check constraint correctly rejects. Same fix as
    // createSalaryRule (salary/config/actions.js) and the CASE expression in
    // assign_teacher_class_with_salary (0026), applied here for the third
    // write path into salary_rules.percentage.
    const todayStr = new Date().toISOString().slice(0, 10);
    const updatePayload = { percentage: Number(percentage), active: true, updated_at: new Date().toISOString() };
    if (existing && Number(existing.percentage) !== Number(percentage)) {
      updatePayload.effective_from = todayStr;
    }

    const ruleErr = existing
      ? (await supabase.from("salary_rules").update(updatePayload).eq("id", existing.id)).error
      : (await supabase.from("salary_rules").insert({ teacher_id: teacherId, class_id: classId, section_id: sectionId || null, percentage: Number(percentage), active: true, effective_from: todayStr })).error;
    if (ruleErr) {
      if (ruleErr.message?.includes("OVERLAPPING_SALARY_RULE")) return { error: "Assignment updated, but the salary rule was rejected: a whole-class rule and a section-specific rule can't both be active for the same teacher/class." };
      if (ruleErr.message?.includes("LOCKED_PAYROLL_CONFLICT")) return { error: "Assignment updated, but the percentage change was rejected: a payroll month for this teacher is already locked at or after today. Reverse/adjust that month first if the rate genuinely needs to change retroactively." };
      return { error: `Assignment updated, but the salary rule failed: ${ruleErr.message}` };
    }
  }

  refresh();
  return { success: true };
}

// "Remove" — deletes the teaching-duty row. The matching salary_rules row is
// deactivated rather than deleted (same "correct via adjustment, don't erase
// history" principle used for payroll) — any salary_records already
// generated from it are frozen snapshots in their own table regardless.
export async function removeAssignment({ id, teacherId, classId, sectionId }) {
  const supabase = await createClient();
  if (!id) return { error: "Missing assignment." };

  const { error } = await supabase.from("teacher_classes").delete().eq("id", id);
  if (error) return { error: error.message };

  let ruleQuery = supabase.from("salary_rules").update({ active: false })
    .eq("teacher_id", teacherId).eq("class_id", classId);
  ruleQuery = sectionId ? ruleQuery.eq("section_id", sectionId) : ruleQuery.is("section_id", null);
  await ruleQuery;

  refresh();
  return { success: true };
}
