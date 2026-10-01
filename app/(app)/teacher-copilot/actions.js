"use server";

import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";
import { KINDS } from "@/lib/teacher-copilot/kinds";
import { buildGenerativePrompt } from "@/lib/teacher-copilot/prompts";
import { INSIGHTS } from "@/lib/teacher-copilot/insights";
import { getStudentsForClass } from "@/lib/teacher-copilot/roster";
import * as llm from "@/lib/assistant/llm";

// Belt-and-braces, same reasoning as everywhere else in this app: RLS
// and teacher_owns_class() (called inside every RPC below) are the real
// enforcement. This just means a teacher who somehow submits a class
// they don't teach gets a clear message from the action instead of a
// confusing RPC error after an LLM call already ran (and was paid for).
async function assertOwnsClass(supabase, teacherId, classId) {
  if (!classId) return;
  const { data } = await supabase.from("teacher_classes").select("id").eq("teacher_id", teacherId).eq("class_id", classId).limit(1);
  if (!data || data.length === 0) throw new Error("You don't teach this class.");
}

export async function listStudentsForClassAction(classId, sectionId) {
  const rc = await getRoleContext();
  if (!rc?.isTeacher) return { error: "Not authorized." };
  const supabase = await createClient();
  try {
    await assertOwnsClass(supabase, rc.teacherId, classId);
    const students = await getStudentsForClass(supabase, classId, sectionId);
    return { students };
  } catch (err) {
    return { error: err.message };
  }
}

// Class → Subject → Topic → Difficulty → Learning objectives, chosen by
// the teacher → AI produces a draft. This function is the whole pipeline
// for one request: validate the brief, run either the LLM (generative
// tools) or an authorized RPC (grounded tools), save the result as
// status='draft', and hand it back — never shown to anyone but the
// requesting teacher until they call approveDraft below.
export async function generateDraft(kind, brief) {
  const rc = await getRoleContext();
  if (!rc?.isTeacher) return { error: "Teacher Copilot is only available to teachers." };

  const spec = KINDS[kind];
  if (!spec) return { error: "Unknown copilot tool." };

  const { classId, sectionId, subjectId, studentId, topic, difficulty, objectives } = brief || {};
  if (spec.fields.class && !classId) return { error: "Choose a class first." };
  if (spec.fields.subject && !subjectId) return { error: "Choose a subject first." };
  if (spec.fields.student && !studentId) return { error: "Choose a student first." };

  const supabase = await createClient();
  try {
    await assertOwnsClass(supabase, rc.teacherId, classId);
  } catch (err) {
    return { error: err.message };
  }

  let content;
  try {
    if (spec.category === "generate") {
      if (!llm.isConfigured()) return { error: "Teacher Copilot's AI drafting isn't configured yet — ask your Super Admin to set it up." };
      const { system, user } = buildGenerativePrompt(kind, {
        className: brief.className, sectionName: brief.sectionName, subjectName: brief.subjectName,
        studentName: brief.studentName, topic, difficulty, objectives,
      });
      content = await llm.generateDraft(system, user);
    } else {
      const insight = INSIGHTS[kind];
      const data = await insight.run(supabase, { classId, sectionId, subjectId });
      content = insight.describe(data);
    }
  } catch (err) {
    return { error: err.message || String(err) };
  }

  const { data: draftId, error } = await supabase.rpc("create_teacher_draft", {
    p_kind: kind, p_class_id: classId || null, p_section_id: sectionId || null, p_subject_id: subjectId || null,
    p_topic: topic || null, p_difficulty: difficulty || null, p_learning_objectives: objectives || null, p_content: content,
  });
  if (error) return { error: error.message };

  return {
    draft: {
      id: draftId, kind, status: "draft", content,
      className: brief.className || null, sectionName: brief.sectionName || null, subjectName: brief.subjectName || null,
      studentName: brief.studentName || null, topic: topic || null, difficulty: difficulty || null,
      createdAt: new Date().toISOString(),
    },
  };
}

// The "Teacher observations" input to the Student Risk & Early-Warning
// pipeline (see migration 20260925020000 and docs/STUDENT_RISK.md) — a
// short, dated, human note about a student, the one input to that
// pipeline that isn't already a number somewhere else in this app.
// 'concern' notes are what the Engagement signal actually looks at;
// 'positive'/'neutral' are logged too (this is a record, not just a
// complaint box) but never contribute a flag.
export async function logObservation(studentId, classId, sectionId, category, note) {
  const rc = await getRoleContext();
  if (!rc?.isTeacher) return { error: "Not authorized." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_student_observation", {
    p_student_id: studentId, p_class_id: classId, p_section_id: sectionId || null, p_category: category, p_note: note,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

// The "Homework" section of Parent Portal 2.0 — posted here, read there
// via get_child_homework() (migration 20260926010000). A direct insert,
// not a dedicated RPC: homework's RLS policy ("teacher manages own class
// homework", using teacher_owns_class()) already IS the full validation
// this needs, so a wrapper function would just be re-checking the same
// thing RLS already enforces on the insert itself.
export async function postHomework(classId, sectionId, subjectId, title, description, dueDate) {
  const rc = await getRoleContext();
  if (!rc?.isTeacher) return { error: "Not authorized." };
  if (!classId || !title?.trim()) return { error: "Class and title are required." };

  const supabase = await createClient();
  const { error } = await supabase.from("homework").insert({
    class_id: classId, section_id: sectionId || null, subject_id: subjectId || null, teacher_id: rc.teacherId,
    title: title.trim(), description: description?.trim() || null, due_date: dueDate || null,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function decideDraft(id, status) {
  const rc = await getRoleContext();
  if (!rc?.isTeacher) return { error: "Not authorized." };
  if (!["approved", "discarded"].includes(status)) return { error: "Invalid status." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_teacher_draft_status", { p_id: id, p_status: status });
  if (error) return { error: error.message };
  return { ok: true };
}
