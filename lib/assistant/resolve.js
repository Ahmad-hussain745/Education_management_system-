import { extractMonths, thisMonthStart } from "./months";

// This file is the "validated parameters" step, literally: the LLM only
// ever supplies free text ("Class 10", "September", "Mid Term 2026") —
// never a uuid, never something it could have made up that happens to
// look like a real id. Every function here turns that text into a real
// row's id by actually querying for it, scoped to the signed-in
// person's own institute (RLS enforces that scoping too, redundantly —
// same "belt and braces" reasoning as lib/assistant/queries.js's own
// `requires` checks). No match found is a real outcome, returned as
// `null`/`{ id: null }`, never silently substituted with "ignore this
// filter" — a tool call for a class that doesn't exist should fail
// closed and say so, not quietly answer a different, broader question.

export async function resolveClassId(supabase, instituteId, classText) {
  const q = (classText || "").trim();
  if (!q) return { id: null, name: null };

  const digitMatch = q.match(/\d+/);
  const candidates = [q, digitMatch ? `Class ${digitMatch[0]}` : null, digitMatch ? digitMatch[0] : null].filter(Boolean);

  for (const candidate of candidates) {
    const { data } = await supabase.from("classes").select("id, name").eq("institute_id", instituteId).ilike("name", candidate).limit(1);
    if (data?.[0]) return { id: data[0].id, name: data[0].name };
  }

  const { data: loose } = await supabase.from("classes").select("id, name").eq("institute_id", instituteId).ilike("name", `%${q}%`).limit(1);
  return loose?.[0] ? { id: loose[0].id, name: loose[0].name } : { id: null, name: null };
}

// "Mid Term 2026" → the matching exams row for this institute. No name
// given → the most recently started exam (best-effort "the last exam"
// reading of a bare "how did students do?"), NOT "every exam ever" —
// same "don't silently widen scope" rule as resolveClassId.
export async function resolveExam(supabase, instituteId, examText) {
  const q = (examText || "").trim();
  let query = supabase.from("exams").select("id, name, start_date").eq("institute_id", instituteId);
  if (q) query = query.ilike("name", `%${q}%`);
  const { data } = await query.order("start_date", { ascending: false, nullsFirst: false }).limit(1);
  return data?.[0] ? { id: data[0].id, name: data[0].name } : { id: null, name: null };
}

// Month text ("September", "this month", "2026-09", or nothing) →
// YYYY-MM-01, or null when nothing recognizable was said — same
// "couldn't tell which month" contract months.js's extractMonths()
// already documents, not "assume the current month" on the caller's
// behalf. A caller that wants a default (most of them do — "outstanding
// salary" with no month named usually means the current month) applies
// its own fallback to this result, same as the original regex-parsed
// queries.js intents already did.
export function resolveMonth(monthText) {
  const q = (monthText || "").trim();
  if (!q) return null;
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(q)) return q.slice(0, 7) + "-01";
  const [month] = extractMonths(q);
  return month || null;
}

export { thisMonthStart };
