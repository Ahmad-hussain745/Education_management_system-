// Three of the Learning module's four AI-assist capabilities — assignment
// drafting, rubrics, feedback suggestions. The fourth, difficulty
// analysis, is deliberately NOT here — it's a deterministic RPC
// (get_assignment_difficulty, migration 20260927010000) computed from real
// grades, not an LLM opinion. See that migration's header for why.
//
// All three below produce a DRAFT a teacher reviews and edits before
// anything is saved — same workflow as Teacher Copilot's own generative
// tools (lib/teacher-copilot/prompts.js), and the same reason: there's no
// "verified" version of a rubric or a piece of feedback to check the
// model's writing against, so the safety mechanism is entirely the
// review step, not grounding.

const DRAFT_RULES = `This is a DRAFT — the teacher will review and edit it before saving anything. Make ordinary, reasonable choices where the brief is silent, but don't invent a specific fact (a student's name, a prior lesson, a school policy) that wasn't given.`;

export function buildAssignmentDraftPrompt({ className, sectionName, subjectName, assignmentType, topic, difficulty, objectives }) {
  const system = `You draft a school assignment's title and instructions from a brief. Respond in exactly this format, nothing before or after:
TITLE: <one line>
DESCRIPTION:
<the full instructions a student would read, as many lines as needed — what to do, what to submit, and how it will be assessed if that's implied by the brief>

${DRAFT_RULES}`;
  const lines = [];
  if (className) lines.push(`Class: ${className}${sectionName ? ` (Section ${sectionName})` : ""}`);
  if (subjectName) lines.push(`Subject: ${subjectName}`);
  if (assignmentType) lines.push(`Type: ${assignmentType}`);
  if (topic) lines.push(`Topic: ${topic}`);
  if (difficulty) lines.push(`Difficulty: ${difficulty}`);
  if (objectives) lines.push(`Learning objectives: ${objectives}`);
  const user = lines.length ? `${lines.join("\n")}\n\nDraft the assignment now.` : "No detail was given beyond the assignment type — draft a general-purpose assignment and note at the top that specifics are needed.";
  return { system, user };
}

export function buildRubricPrompt({ title, description, maxMarks }) {
  const system = `You draft a grading rubric for a school assignment as a JSON array, nothing else — no markdown fences, no prose before or after. Each element: {"criterion": string, "max_points": number, "description": string}. The max_points across all criteria should sum to the assignment's max marks if given. 3-5 criteria is usually right — enough to be useful, not so many a teacher can't apply it quickly. ${DRAFT_RULES}`;
  const lines = [`Assignment title: ${title}`];
  if (description) lines.push(`Instructions: ${description}`);
  if (maxMarks) lines.push(`Max marks: ${maxMarks}`);
  return { system, user: `${lines.join("\n")}\n\nDraft the rubric now, as a JSON array only.` };
}

export function buildFeedbackSuggestionPrompt({ title, description, rubric, studentSubmission, marksObtained, maxMarks }) {
  const system = `You draft brief, specific feedback for a teacher to give a student on a graded assignment. Use ONLY what's actually in the student's submission below and the mark given — never invent something the student didn't write, and never guess at effort, attitude, or a pattern you weren't shown. 2-4 sentences: what was done well, one concrete thing to improve, matching the tone the mark itself implies (don't write glowing praise for a low mark or harsh criticism for a high one). This is a DRAFT the teacher will edit before sending.`;
  const lines = [`Assignment: ${title}`];
  if (description) lines.push(`Instructions: ${description}`);
  if (rubric?.length) lines.push(`Rubric: ${rubric.map((r) => `${r.criterion} (${r.max_points} pts)`).join("; ")}`);
  if (marksObtained != null && maxMarks) lines.push(`Mark given: ${marksObtained}/${maxMarks}`);
  lines.push(`Student's submission:\n${studentSubmission || "(no text submitted — physical/offline submission)"}`);
  return { system, user: `${lines.join("\n")}\n\nDraft the feedback now.` };
}

// Parses the DRAFT_RULES-constrained TITLE:/DESCRIPTION: format above.
// Falls back to putting everything in the description if the model
// didn't follow the format exactly, rather than throwing — a slightly
// malformed draft the teacher can still see and fix beats a hard error.
export function parseAssignmentDraft(text) {
  const titleMatch = text.match(/^TITLE:\s*(.+)$/m);
  const descMatch = text.match(/DESCRIPTION:\s*([\s\S]*)$/);
  if (titleMatch && descMatch) {
    return { title: titleMatch[1].trim(), description: descMatch[1].trim() };
  }
  return { title: "", description: text.trim() };
}

// Parses the rubric JSON array, tolerating a stray markdown fence the
// model wasn't supposed to add.
export function parseRubric(text) {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of rubric criteria.");
  return parsed.map((r) => ({
    criterion: String(r.criterion || "").trim(),
    max_points: Number(r.max_points) || 0,
    description: String(r.description || "").trim(),
  })).filter((r) => r.criterion);
}
