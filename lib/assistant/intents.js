import { extractMonths, extractMonthCount } from "./months";

// Every supported intent, in the order they're tried — order matters where
// patterns could overlap (e.g. "compare" must be checked before a bare
// "salary"/"fee" keyword match would otherwise fire on one half of the
// sentence). Each matcher gets the raw question text and either returns
// null (didn't match) or { intent, params }. The FIRST match wins; a
// question matching nothing returns null all the way up, and the caller
// (actions.js) responds by saying so and listing what it can actually
// answer — never by guessing which intent was probably meant.
const MATCHERS = [
  {
    intent: "compare_months",
    test: (q) => /\bcompare\b/i.test(q) || /\bvs\.?\b/i.test(q) || /\b(this|last)\s+month\s+(vs|compared|against)\b/i.test(q),
    params: (q) => {
      const months = extractMonths(q);
      if (months.length < 2) return null; // "compare" with no two identifiable months isn't this intent after all
      return { monthA: months[0], monthB: months[1] };
    },
  },
  {
    intent: "students_unpaid_months",
    test: (q) => /\bstudents?\b/i.test(q) && /(unpaid|pending|outstanding|arrears|overdue)/i.test(q) && /\bmonths?\b/i.test(q),
    params: (q) => ({ minMonths: extractMonthCount(q, 3) }),
  },
  {
    intent: "class_most_arrears",
    test: (q) => /\bclass(es)?\b/i.test(q) && /(arrears|outstanding|unpaid|owes?|owing|pending)/i.test(q),
    params: () => ({}),
  },
  {
    intent: "fee_outstanding",
    test: (q) => /(fee|fees)/i.test(q) && /(outstanding|pending|unpaid|owed|owing|due|arrears)/i.test(q) && !/\bclass(es)?\b/i.test(q) && !/\bstudents?\b/i.test(q),
    params: (q) => {
      const months = extractMonths(q);
      return { month: months[0] || null };
    },
  },
  {
    intent: "salary_spend",
    test: (q) => /(salary|salaries|payroll)/i.test(q) && /(spend|spent|cost|paid|total|expense)/i.test(q),
    params: (q) => {
      const months = extractMonths(q);
      return { month: months[0] || null };
    },
  },
  {
    intent: "expense_total",
    test: (q) => /\bexpenses?\b/i.test(q) && !/(salary|salaries|payroll)/i.test(q),
    params: (q) => {
      const months = extractMonths(q);
      const categories = ["electricity", "stationery", "maintenance", "transport"];
      const category = categories.find((c) => new RegExp(`\\b${c}\\b`, "i").test(q));
      return { month: months[0] || null, category: category ? category[0].toUpperCase() + category.slice(1) : null };
    },
  },
  {
    intent: "collection_rate",
    test: (q) => /(collection rate|how much.*collect|collected)/i.test(q),
    params: (q) => {
      const months = extractMonths(q);
      return { month: months[0] || null };
    },
  },
  {
    intent: "low_stock",
    test: (q) => /(low.?stock|stock.?alert|running low|reorder|out of stock|short of (stock|supplies))/i.test(q),
    params: () => ({}),
  },
  {
    intent: "attendance_rate",
    test: (q) => /attendance/i.test(q) && /(rate|percent|%|how many|how much)/i.test(q),
    params: (q) => {
      const months = extractMonths(q);
      const who = /teacher/i.test(q) ? "teacher" : "student";
      return { month: months[0] || null, who };
    },
  },
  {
    intent: "student_count",
    test: (q) => /how many students/i.test(q) || /\bstudent count\b/i.test(q) || /\btotal students\b/i.test(q),
    params: () => ({}),
  },
];

export function parseIntent(question) {
  const q = (question || "").trim();
  if (!q) return null;
  for (const matcher of MATCHERS) {
    if (matcher.test(q)) {
      const params = matcher.params(q);
      if (params === null) continue; // matched the topic but couldn't extract what it needed — keep trying other matchers
      return { intent: matcher.intent, params };
    }
  }
  return null;
}

// Shown to the person when nothing matched, and on the assistant's own
// landing screen. This list used to be the complete, literal set MATCHERS
// above could answer — still true for everything not marked below, which
// only works through the LLM router (lib/assistant/tools.js) now that Ask
// MSA has one; without ANTHROPIC_API_KEY configured, those two fall
// through to the "I don't have a way to answer that yet" response same as
// any other unmatched question, same honest degrade as everything else in
// this file.
export const EXAMPLE_QUESTIONS = [
  "How much fee is outstanding?",
  "How much fee is outstanding from Class 10?", // LLM tool: get_fee_summary
  "Which class has the most arrears?",
  "How much did we spend on salaries this month?",
  "Compare September with August",
  "Which students have 3 months unpaid?",
  "What's our collection rate this month?",
  "Which items are low on stock?",
  "What's the student attendance rate this month?",
  "How many students do we have?",
  "How did students do in the last exam?", // LLM tool: get_exam_results
  "Give me the management report", // LLM tool: get_management_report
];
