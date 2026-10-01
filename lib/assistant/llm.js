// Centralizes every call to the Claude API so Ask MSA's orchestration
// (actions.js) doesn't repeat the "is this even configured" check —
// same shape as lib/email.js's own ANTHROPIC_API_KEY-equivalent
// (RESEND_API_KEY) fail-soft pattern. If ANTHROPIC_API_KEY isn't set,
// isConfigured() says so and every caller falls back to the original
// regex-based parseIntent() path — Ask MSA keeps working, just without
// the natural-language understanding layer, exactly the "safe but
// limited" mode this upgrade is meant to sit in FRONT of, not replace.
//
// Two calls, two very different trust levels:
//   selectTool()  — Claude sees the question and the 8 approved tool
//                   schemas (lib/assistant/tools.js). It has no database
//                   access of any kind; it can only emit a tool_use
//                   block naming one of those 8 tools plus a few plain-
//                   language parameters. Those parameters are NEVER
//                   trusted directly — lib/assistant/resolve.js re-
//                   checks every one of them against real rows before
//                   anything reaches an authorized RPC.
//   phraseAnswer() — Claude sees the original question and the verified
//                   JSON this app's own tool already returned — nothing
//                   else. It cannot add a fact that isn't in that JSON;
//                   actions.js additionally checks the numbers in its
//                   reply against the verified data (see
//                   numbersAreGrounded()) and discards the reply — using
//                   the deterministic template instead — if anything
//                   doesn't match, so a hallucinated figure can't reach
//                   a Principal even if this step somehow produced one.
const MODEL = "claude-sonnet-5";
const API_URL = "https://api.anthropic.com/v1/messages";

export function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function callClaude(body) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

const SELECT_TOOL_SYSTEM_PROMPT = `You are the query router for Ask MSA, a school management assistant. Your ONLY job is deciding which one tool (if any) answers the person's question, and filling in its parameters from what they actually said.

Rules:
- Call at most one tool. If nothing fits, don't call any tool — just reply with a short plain-text sentence saying so.
- Never invent a parameter that wasn't stated or clearly implied. If no month was mentioned, leave "month" out entirely — do not assume the current month.
- Pass class names exactly as the person said them (e.g. "10", "Class 10", "Nursery") — a separate step resolves that text against real class records, so don't try to normalize it yourself.
- You have no database access. You are only choosing a tool name and its parameters — the actual figures come back afterward from a verified, authorized query you never see the internals of.`;

// Returns { name, input } if Claude picked one of the offered tools, or
// null if it declined (no tool_use block in the reply) — callers treat
// null exactly like the regex parser's own "didn't match anything."
export async function selectTool(question, toolSchemas) {
  const data = await callClaude({
    model: MODEL,
    max_tokens: 512,
    temperature: 0,
    system: SELECT_TOOL_SYSTEM_PROMPT,
    tools: toolSchemas,
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: question }],
  });

  const toolUse = (data.content || []).find((b) => b.type === "tool_use");
  return toolUse ? { name: toolUse.name, input: toolUse.input || {} } : null;
}

const PHRASE_SYSTEM_PROMPT = `You turn verified school-management data into one or two short, natural sentences for a Principal or Accountant. Rules:
- Use ONLY the numbers and facts in the JSON you're given. Never add, round differently, estimate, or state a figure that isn't literally present in that JSON.
- If the JSON shows an empty or zero result, say so plainly — don't soften it into something that sounds like data is missing or the question wasn't understood.
- Currency is Pakistani Rupees — write amounts like "Rs. 12,345", never "$" or a bare number with no currency.
- No preamble like "Based on the data" or "According to the records" — just answer directly.`;

export async function phraseAnswer(question, toolName, verifiedData) {
  const data = await callClaude({
    model: MODEL,
    max_tokens: 400,
    temperature: 0,
    system: PHRASE_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `Question: ${question}\n\nVerified data (from tool "${toolName}"):\n${JSON.stringify(verifiedData)}\n\nAnswer the question using only the numbers above.`,
    }],
  });

  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock?.text?.trim()) throw new Error("Claude returned no text to phrase the answer with.");
  return textBlock.text.trim();
}

// Free-form content generation — used by the Teacher Copilot's six
// generative tools (lib/teacher-copilot/prompts.js), NOT by Ask MSA.
// There's no "verified data" to ground a lesson plan against, so this
// makes no grounding claim at all; the safety mechanism for this call is
// entirely downstream, in the workflow — every result lands as a
// status='draft' row in teacher_copilot_drafts and this app never shows
// it to a student or parent until the requesting teacher reviews and
// explicitly approves it (set_teacher_draft_status, migration
// 20260924030000). Temperature is intentionally not 0 — some genuine
// variation is fine and expected for drafting content a person will
// read, edit, and approve, unlike selectTool/phraseAnswer above where
// deterministic routing/phrasing of verified facts is the whole point.
export async function generateDraft(systemPrompt, userPrompt, { maxTokens = 1800 } = {}) {
  const data = await callClaude({
    model: MODEL,
    max_tokens: maxTokens,
    temperature: 0.4,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock?.text?.trim()) throw new Error("Claude returned no content to draft with.");
  return textBlock.text.trim();
}

// A heuristic net, not a proof: every number-looking token in Claude's
// phrased answer must also appear somewhere in the verified data (as a
// raw value, or rounded to the nearest whole number / one decimal place
// — matching how fmt()/pct() in answer-templates.js already round for
// display, so correctly-rounded real numbers aren't flagged as
// mismatches). A number that appears in the prose but nowhere in the
// data it was supposedly built from is exactly the signature of an
// invented figure — when this trips, actions.js discards the LLM's
// phrasing and falls back to the deterministic template instead of
// ever showing the ungrounded sentence to a Principal.
export function numbersAreGrounded(text, verifiedData) {
  const textNumbers = (text.match(/\d[\d,]*\.?\d*/g) || []).map((s) => Number(s.replace(/,/g, ""))).filter((n) => !Number.isNaN(n));
  if (textNumbers.length === 0) return true; // nothing numeric was said — trivially grounded

  const allowed = new Set();
  const collect = (v) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      allowed.add(v);
      allowed.add(Math.round(v));
      allowed.add(Math.round(v * 10) / 10);
    } else if (Array.isArray(v)) {
      v.forEach(collect);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(collect);
    }
  };
  collect(verifiedData);

  return textNumbers.every((n) => allowed.has(n) || allowed.has(Math.round(n)));
}
