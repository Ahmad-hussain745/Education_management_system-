"use server";

import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";
import { parseIntent, EXAMPLE_QUESTIONS } from "@/lib/assistant/intents";
import { QUERIES } from "@/lib/assistant/queries";
import { ANSWERS } from "@/lib/assistant/answer-templates";
import { TOOLS, toolSchemas } from "@/lib/assistant/tools";
import * as llm from "@/lib/assistant/llm";

async function logQuery(supabase, askedBy, question, intent, params, answer, source) {
  // Best-effort — a logging failure should never be the reason a person
  // doesn't get their answer.
  try {
    await supabase.from("assistant_queries").insert({ asked_by: askedBy, question, matched_intent: intent, params: params || null, answer, source });
  } catch {
    /* ignore */
  }
}

// The full pipeline, in this exact order:
//
//   Ask MSA question
//     -> LLM intent understanding      (llm.selectTool -- sees only the
//                                        question + the 8 tool schemas,
//                                        never the database)
//     -> Tool selection                (Claude names one of TOOLS, or
//                                        none)
//     -> Authorized SQL/RPC tool       (tool.run -- resolves Claude's
//                                        free text against real rows,
//                                        then calls exactly one
//                                        parameterized RPC; see
//                                        lib/assistant/tools.js and
//                                        resolve.js)
//     -> Verified result               (whatever that RPC actually
//                                        returned -- nothing else)
//     -> Natural-language response     (llm.phraseAnswer, checked
//                                        against the verified result by
//                                        llm.numbersAreGrounded and
//                                        discarded -- using
//                                        tool.describe's deterministic
//                                        template instead -- if anything
//                                        doesn't match)
//
// The LLM can select a tool and can phrase a sentence. It can never
// choose what runs against the database (that's always exactly one of
// the 8 functions in tools.js, called with parameters this file itself
// validated) and it can never be the last word on what a number in the
// answer says (that's always checked against -- or replaced by -- the
// verified data).
//
// If ANTHROPIC_API_KEY isn't configured, the LLM call fails, or Claude
// declines to pick any of its 8 tools, everything falls through to
// runRegexFallback() -- the ORIGINAL rule-based pipeline, completely
// unchanged, which still covers a few intents (comparing two months,
// student headcount) the 8 LLM tools don't. Ask MSA never goes down
// because the AI layer did; it just gets less flexible, exactly the
// "safe but limited" mode this upgrade sits in front of rather than
// replaces.
export async function askAssistant(question) {
  const rc = await getRoleContext();
  if (!rc) return { error: "Not signed in." };
  if (!rc.canViewFees) {
    return { error: "Ask MSA isn't available for your role." };
  }

  const q = (question || "").trim();
  if (!q) return { error: "Ask a question first." };
  if (q.length > 300) return { error: "That's a bit long — try asking in one short sentence." };

  const supabase = await createClient();

  if (llm.isConfigured()) {
    try {
      const picked = await llm.selectTool(q, toolSchemas());
      if (picked) return await runTool(supabase, rc, q, picked.name, picked.input);
      return await runRegexFallback(supabase, rc, q, "llm_declined");
    } catch (err) {
      console.error("[ask-msa] LLM call failed, falling back to rule-based parsing:", err.message);
      return await runRegexFallback(supabase, rc, q, "llm_unavailable");
    }
  }

  return await runRegexFallback(supabase, rc, q, "rule_based");
}

// Tool selection -> validated parameters -> authorized RPC -> verified
// result -> natural-language response, for one of the 8 LLM-facing tools.
async function runTool(supabase, rc, question, toolName, rawInput) {
  const tool = TOOLS[toolName];
  if (!tool) {
    // Should be structurally impossible -- Claude was only ever offered
    // these 8 names -- but treated as "no match" rather than ever
    // attempting to run something unrecognized.
    console.error(`[ask-msa] LLM selected an unknown tool: "${toolName}"`);
    return await runRegexFallback(supabase, rc, question, "llm_error");
  }

  if (!tool.requires(rc)) {
    const answer = "You don't have permission to see that.";
    await logQuery(supabase, rc.userId, question, toolName, rawInput, answer, "llm");
    return { answer, matched: true, denied: true };
  }

  try {
    const data = await tool.run(supabase, rc.instituteId, rawInput || {});
    let answer = tool.describe(data); // the deterministic, verified-only answer -- the default

    try {
      const phrased = await llm.phraseAnswer(question, toolName, data);
      if (llm.numbersAreGrounded(phrased, data)) answer = phrased;
      // else: Claude's phrasing mentioned a number not present anywhere
      // in the verified data -- discarded, keep the template answer above.
    } catch {
      // Phrasing failed for any reason -- the template answer already
      // computed is correct and complete; a phrasing hiccup should never
      // turn a good, verified result into an error for the person asking.
    }

    await logQuery(supabase, rc.userId, question, toolName, rawInput, answer, "llm");
    return { answer, matched: true, intent: toolName };
  } catch (err) {
    const message = err?.message || String(err);
    await logQuery(supabase, rc.userId, question, toolName, rawInput, `[error] ${message}`, "llm");
    return { error: message };
  }
}

// The original pipeline: Question -> Intent parser -> Safe query/tool ->
// Database -> Verified result -> Natural-language response -- parseIntent()
// never touches the database, QUERIES[...].run() never produces prose,
// ANSWERS[...] never touches the database. Nothing here can invent a
// fact: an unrecognized question gets told so, an unauthorized one gets
// told so, and a recognized+authorized one gets an answer built only
// from what its query actually returned.
async function runRegexFallback(supabase, rc, question, source) {
  const parsed = parseIntent(question);

  if (!parsed) {
    const answer = "I don't have a way to answer that yet. Here's what I can currently tell you:";
    await logQuery(supabase, rc.userId, question, null, null, answer, source);
    return { answer, matched: false, examples: EXAMPLE_QUESTIONS };
  }

  const handler = QUERIES[parsed.intent];
  if (!handler.requires(rc)) {
    const answer = "You don't have permission to see that.";
    await logQuery(supabase, rc.userId, question, parsed.intent, parsed.params, answer, source);
    return { answer, matched: true, denied: true };
  }

  try {
    const data = await handler.run(supabase, rc.instituteId, parsed.params);
    const answer = ANSWERS[parsed.intent](data);
    await logQuery(supabase, rc.userId, question, parsed.intent, parsed.params, answer, source);
    return { answer, matched: true, intent: parsed.intent };
  } catch (err) {
    const message = err?.message || String(err);
    await logQuery(supabase, rc.userId, question, parsed.intent, parsed.params, `[error] ${message}`, source);
    return { error: message };
  }
}
