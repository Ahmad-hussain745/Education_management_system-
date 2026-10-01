"use server";

import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";
import * as llm from "@/lib/assistant/llm";
import {
  buildAssignmentDraftPrompt, parseAssignmentDraft,
  buildRubricPrompt, parseRubric,
  buildFeedbackSuggestionPrompt,
} from "@/lib/learning/prompts";

async function assertOwnsClass(supabase, classId) {
  const rc = await getRoleContext();
  if (!rc?.isTeacher) return rc; // Principal/Super Admin fall through to RLS (teacher_owns_class covers can_approve() too)
  const { data } = await supabase.from("teacher_classes").select("id").eq("teacher_id", rc.teacherId).eq("class_id", classId).limit(1);
  if (!data || data.length === 0) throw new Error("You don't teach this class.");
  return rc;
}

// ---------------------------------------------------------------------------
// Assignment CRUD — direct table writes, relying on assignments' own RLS
// ("teacher manages own class assignments", teacher_owns_class()) as the
// real check; assertOwnsClass above is the same belt-and-braces layer
// used throughout this app, so a bad request gets a clear message instead
// of a raw RLS-denied error.
// ---------------------------------------------------------------------------
export async function createAssignment(fields) {
  const rc = await getRoleContext();
  if (!rc) return { error: "Not signed in." };
  if (!fields.classId || !fields.title?.trim()) return { error: "Class and title are required." };

  const supabase = await createClient();
  try {
    await assertOwnsClass(supabase, fields.classId);
  } catch (err) {
    return { error: err.message };
  }

  const { data, error } = await supabase.from("assignments").insert({
    class_id: fields.classId, section_id: fields.sectionId || null, subject_id: fields.subjectId || null,
    teacher_id: rc.teacherId || null, title: fields.title.trim(), description: fields.description?.trim() || null,
    assignment_type: fields.assignmentType || "homework", max_marks: fields.maxMarks || null,
    due_date: fields.dueDate || null, allow_late: fields.allowLate !== false, rubric: fields.rubric || null,
    status: "draft",
  }).select("id").single();
  if (error) return { error: error.message };
  return { id: data.id };
}

export async function updateAssignment(id, fields) {
  const supabase = await createClient();
  const { error } = await supabase.from("assignments").update({
    title: fields.title?.trim(), description: fields.description?.trim() || null,
    max_marks: fields.maxMarks ?? null, due_date: fields.dueDate || null, allow_late: fields.allowLate !== false,
    rubric: fields.rubric || null, updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function setAssignmentStatus(id, status) {
  if (!["draft", "published"].includes(status)) return { error: "Invalid status." };
  const supabase = await createClient();
  const { error } = await supabase.from("assignments").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function addResource(fields) {
  const supabase = await createClient();
  try {
    await assertOwnsClass(supabase, fields.classId);
  } catch (err) {
    return { error: err.message };
  }
  if (!fields.title?.trim()) return { error: "Title is required." };

  const { error } = await supabase.from("assignment_resources").insert({
    assignment_id: fields.assignmentId || null, class_id: fields.classId, section_id: fields.sectionId || null,
    subject_id: fields.subjectId || null, title: fields.title.trim(), description: fields.description?.trim() || null,
    resource_type: fields.resourceType || "link", url: fields.url?.trim() || null,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function gradeSubmission(assignmentId, studentId, marksObtained, feedback, submissionType) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("grade_submission", {
    p_assignment_id: assignmentId, p_student_id: studentId,
    p_marks_obtained: marksObtained === "" || marksObtained == null ? null : Number(marksObtained),
    p_feedback: feedback || null, p_submission_type: submissionType || "physical",
  });
  if (error) return { error: error.message };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// AI assist — three drafting tools, same LLM client Ask MSA and Teacher
// Copilot already use (lib/assistant/llm.js). Every result here is a
// DRAFT returned to the client for the teacher to edit; none of these
// write anything to the database themselves.
// ---------------------------------------------------------------------------
export async function aiDraftAssignment(brief) {
  const rc = await getRoleContext();
  if (!rc?.isTeacher) return { error: "Not authorized." };
  if (!llm.isConfigured()) return { error: "AI drafting isn't configured yet — ask your Super Admin to set it up." };

  const { system, user } = buildAssignmentDraftPrompt(brief);
  try {
    const text = await llm.generateDraft(system, user, { maxTokens: 900 });
    return { draft: parseAssignmentDraft(text) };
  } catch (err) {
    return { error: err.message };
  }
}

export async function aiGenerateRubric(title, description, maxMarks) {
  const rc = await getRoleContext();
  if (!rc?.isTeacher) return { error: "Not authorized." };
  if (!llm.isConfigured()) return { error: "AI drafting isn't configured yet — ask your Super Admin to set it up." };
  if (!title?.trim()) return { error: "Add a title first." };

  const { system, user } = buildRubricPrompt({ title, description, maxMarks });
  try {
    const text = await llm.generateDraft(system, user, { maxTokens: 700 });
    return { rubric: parseRubric(text) };
  } catch (err) {
    return { error: `Couldn't parse the AI's rubric — try again. (${err.message})` };
  }
}

export async function aiSuggestFeedback(assignmentId, studentId) {
  const rc = await getRoleContext();
  if (!(rc?.isTeacher || rc?.isAdmin || rc?.isPrincipal)) return { error: "Not authorized." };
  if (!llm.isConfigured()) return { error: "AI drafting isn't configured yet — ask your Super Admin to set it up." };

  const supabase = await createClient();
  const [{ data: assignment, error: aErr }, { data: submission, error: sErr }] = await Promise.all([
    supabase.from("assignments").select("title, description, rubric, max_marks").eq("id", assignmentId).maybeSingle(),
    supabase.from("assignment_submissions").select("content_text, marks_obtained").eq("assignment_id", assignmentId).eq("student_id", studentId).maybeSingle(),
  ]);
  if (aErr) return { error: aErr.message };
  if (sErr) return { error: sErr.message };
  if (!assignment) return { error: "Assignment not found." };

  const { system, user } = buildFeedbackSuggestionPrompt({
    title: assignment.title, description: assignment.description, rubric: assignment.rubric,
    studentSubmission: submission?.content_text, marksObtained: submission?.marks_obtained, maxMarks: assignment.max_marks,
  });
  try {
    const text = await llm.generateDraft(system, user, { maxTokens: 400 });
    return { feedback: text };
  } catch (err) {
    return { error: err.message };
  }
}
