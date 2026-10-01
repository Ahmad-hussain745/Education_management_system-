"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// One row here = "this teacher earns X% of what this class actually
// collects." Nothing about the amount is typed anywhere else — the Rupee
// figure is computed at payroll time from live fee_payments.
// A whole-class rule and a section-specific rule for the SAME teacher/class
// can never both be active — one always double-counts the other's section.
// Mirrors check_salary_rule_overlap() in 0006_salary_rule_validation.sql.
async function findOverlappingRule(supabase, { teacherId, classId, sectionId }) {
  let query = supabase.from("salary_rules").select("id").eq("teacher_id", teacherId).eq("class_id", classId).eq("active", true);
  query = sectionId ? query.is("section_id", null) : query.not("section_id", "is", null);
  const { data } = await query;
  return (data || [])[0] || null;
}

// Fetches every history segment for the given rule ids in one query,
// grouped by salary_rule_id — used by the page to render each rule's
// "August 60% / September 65%"-style timeline without an N+1 query per row.
export async function getSalaryRuleHistoryByRuleIds(ruleIds) {
  if (!ruleIds || ruleIds.length === 0) return { data: {} };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("salary_rule_history")
    .select("salary_rule_id, percentage, effective_from, effective_to")
    .in("salary_rule_id", ruleIds)
    .order("effective_from", { ascending: true });
  if (error) return { error: error.message };
  const grouped = {};
  (data || []).forEach((h) => {
    (grouped[h.salary_rule_id] ||= []).push(h);
  });
  return { data: grouped };
}

export async function createSalaryRule(formData) {
  const supabase = await createClient();

  const teacher_id = formData.get("teacher_id")?.toString();
  const class_id = formData.get("class_id")?.toString();
  const section_id = formData.get("section_id")?.toString() || null;
  const percentage = Number(formData.get("percentage") || 0);
  const effective_from = formData.get("effective_from")?.toString() || new Date().toISOString().slice(0, 10);

  if (!teacher_id) return { error: "Pick a teacher." };
  if (!class_id) return { error: "Pick a class." };
  if (!percentage || percentage <= 0 || percentage > 100) {
    return { error: "Percentage must be between 0 and 100." };
  }

  const overlap = await findOverlappingRule(supabase, { teacherId: teacher_id, classId: class_id, sectionId: section_id });
  if (overlap) {
    return {
      error: section_id
        ? "This teacher already has a whole-class rule for this class — a section-specific rule would double-count this section's collection. Deactivate the whole-class rule first."
        : "This teacher already has a section-specific rule inside this class — a whole-class rule would double-count that section's collection. Deactivate the section-specific rule(s) first.",
    };
  }

  // salary_rules' unique constraint is (teacher_id, class_id, section_id),
  // but Postgres treats NULL section_id values as distinct from each other —
  // a plain upsert wouldn't catch a re-submitted whole-class rule (no
  // section) and would insert a second row, silently doubling that
  // teacher's calculated share at payroll time. Look the existing row up
  // explicitly instead. (0004_completion.sql adds a real NULL-safe unique
  // index as a backstop for the race this check alone can't close — two
  // simultaneous submissions could both pass this check before either
  // inserts — so a 23505 here means that race actually happened, not that
  // something is broken.)
  let existing;
  if (section_id) {
    ({ data: existing } = await supabase
      .from("salary_rules").select("id, percentage")
      .eq("teacher_id", teacher_id).eq("class_id", class_id).eq("section_id", section_id)
      .maybeSingle());
  } else {
    ({ data: existing } = await supabase
      .from("salary_rules").select("id, percentage")
      .eq("teacher_id", teacher_id).eq("class_id", class_id).is("section_id", null)
      .maybeSingle());
  }

  // effective_from is only sent on the update when the percentage is
  // actually changing (0025_salary_rule_history.sql's trigger logs a new
  // history segment starting there) — re-saving the same rate shouldn't
  // bump "since when has this rate applied" for no reason. Omitting the
  // key entirely (rather than sending the old value) lets Postgres keep
  // the existing effective_from untouched, same outcome as the CASE
  // expression assign_teacher_class_with_salary uses for this exact case
  // (0026_assign_teacher_class_effective_date.sql).
  const updatePayload = { percentage, active: true };
  if (existing && Number(existing.percentage) !== percentage) {
    updatePayload.effective_from = effective_from;
  }

  const { error } = existing
    ? await supabase.from("salary_rules").update(updatePayload).eq("id", existing.id)
    : await supabase.from("salary_rules").insert({ teacher_id, class_id, section_id, percentage, active: true, effective_from });
  if (error) {
    if (error.code === "23505") return { error: "That rule was just saved by someone else — refresh and try again." };
    if (error.message?.includes("OVERLAPPING_SALARY_RULE")) {
      return { error: "Rejected: a whole-class rule and a section-specific rule can't both be active for the same teacher/class." };
    }
    if (error.message?.includes("EFFECTIVE_DATE_MUST_ADVANCE")) {
      return { error: "The effective date can't be earlier than this rule's current effective date." };
    }
    if (error.message?.includes("LOCKED_PAYROLL_CONFLICT")) {
      return { error: "A payroll month on or after that date is already locked for this teacher — pick a later effective date, or leave the locked month alone." };
    }
    return { error: error.message };
  }

  revalidatePath("/salary/config");
  return { success: true };
}

// Reactivating a previously-deactivated rule needs the same overlap check —
// another rule could have taken its place (whole-class ↔ section-specific)
// while this one was off.
export async function toggleSalaryRule(ruleId, active) {
  const supabase = await createClient();

  if (active) {
    const { data: rule } = await supabase.from("salary_rules").select("teacher_id, class_id, section_id").eq("id", ruleId).maybeSingle();
    if (rule) {
      const overlap = await findOverlappingRule(supabase, { teacherId: rule.teacher_id, classId: rule.class_id, sectionId: rule.section_id });
      if (overlap) {
        return {
          error: rule.section_id
            ? "Can't reactivate — this class now has an active whole-class rule that would double-count this section."
            : "Can't reactivate — this class now has an active section-specific rule that this whole-class rule would double-count.",
        };
      }
    }
  }

  const { error } = await supabase.from("salary_rules").update({ active }).eq("id", ruleId);
  if (error) {
    if (error.message?.includes("OVERLAPPING_SALARY_RULE")) return { error: "Rejected: a whole-class rule and a section-specific rule can't both be active for the same teacher/class." };
    return { error: error.message };
  }
  revalidatePath("/salary/config");
  return { success: true };
}
