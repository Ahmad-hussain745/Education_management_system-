# Ask MSA — Management Copilot

## The request's pipeline, mapped onto what's actually here

```
Ask MSA
  ↓
LLM intent understanding      lib/assistant/llm.js#selectTool
  ↓
Tool selection                one of the 8 tools in lib/assistant/tools.js, or none
  ↓
Authorized SQL/RPC tool       tool.run() — resolves free text against real rows
  ↓                           (lib/assistant/resolve.js), then calls ONE
  ↓                           parameterized RPC
Verified result                exactly what that RPC returned — nothing else
  ↓
Natural-language response      lib/assistant/llm.js#phraseAnswer, checked by
                                numbersAreGrounded() and discarded in favor of
                                the deterministic template if anything doesn't
                                match
```

## The hard rule this whole design exists to enforce

**The AI never directly writes SQL against arbitrary tables.** Concretely:

- The LLM is given exactly 8 tool schemas (`lib/assistant/tools.js#toolSchemas`) in the API request. It is not given database credentials, a SQL execution tool, or a table list. It is *structurally* unable to call anything but one of those 8 names — there is nothing else in the request for it to call.
- Every parameter the LLM fills in is free text ("Class 10", "September", "Mid Term 2026") — never an id. `lib/assistant/resolve.js` re-checks every one of those against real rows (`classes`, `exams`) scoped to the signed-in person's own institute before anything reaches an RPC. A class that doesn't exist fails closed with a clear error; it never gets silently dropped as "no filter" (which would quietly answer a broader question than the one asked).
- Each tool calls exactly one RPC, all of which existed before this upgrade (or are tiny, obviously-scoped additions — see the migration) and are already protected by RLS/`security definer` role checks the same way every other read in this app is. `tool.requires(rc)` is Ask MSA's own belt-and-braces check on top of that, same as the original rule-based version had.
- The worked example from the request:

  > "How much fee is outstanding from Class 10?"
  > → tool = `get_fee_summary`, params = `{ class: "10" }`

  is exactly what happens: Claude picks `get_fee_summary` and fills `class: "10"`; `resolveClassId()` turns `"10"` into the real class row (or fails, with a clear message, if there isn't one); `fee_arrears_summary()` — the same RPC Reports and the Dashboard already call — runs with that real id.

## What's genuinely new vs. what stayed the same

**New:**
- `lib/assistant/llm.js` — the two Claude API calls (tool selection, phrasing), raw `fetch` against `api.anthropic.com` (no new npm dependency — same convention as the WhatsApp/SMS providers), fails soft exactly like `lib/email.js`'s `RESEND_API_KEY` check if `ANTHROPIC_API_KEY` isn't set.
- `lib/assistant/tools.js` — the 8 requested tools: `get_fee_summary`, `get_student_arrears`, `get_attendance`, `get_salary_summary`, `get_expense_summary`, `get_inventory_alerts`, `get_exam_results`, `get_management_report`.
- `lib/assistant/resolve.js` — the "validated parameters" step.
- Two small backend additions the new tools needed: `get_students_with_unpaid_months()` now accepts an optional class/section filter, and a brand-new `get_exam_summary()` RPC (there wasn't one before — see the migration header for why it's built the same GROUP-BY-in-Postgres way as `get_class_arrears_summary`/`finance_monthly_trend`).
- `lib/reports/management.js` — the Management Report page's forecast/alert logic, extracted so `get_management_report` computes the exact same numbers the page shows, not a second implementation that could drift.
- `numbersAreGrounded()` — a heuristic safety net: if Claude's phrased sentence contains a number that doesn't appear anywhere in the verified data it was given, the phrasing is discarded and the deterministic template is used instead. Not a proof of correctness, but a real check against the most likely failure mode of this kind of design.

**Unchanged, and still the actual safety net:**
- `lib/assistant/intents.js` / `queries.js` / `answer-templates.js` — the original regex router, completely intact. If `ANTHROPIC_API_KEY` isn't set, the LLM call errors, or Claude looks at the question and picks none of its 8 tools, `actions.js` falls through to this exact pipeline, logged with a `source` that says which of those three happened (`rule_based`, `llm_unavailable`, `llm_declined`) — visible in `assistant_queries` for whoever wants to know how often the AI layer is actually doing the work.
- Every RPC and its RLS/role checks.

## Why this design, not "give the LLM a read-only DB connection"

A read-only connection still lets a model compose an unbounded query — a
slow one, one that joins tables in a way nobody reviewed, or one that,
through some future prompt-injection path (a maliciously-named student,
a crafted question), extracts something it shouldn't. Fixing the *shape*
of every possible query in advance — 8 named functions, each doing one
specific, reviewed thing — means the worst a compromised or confused
model can do is call one of those 8 things with the wrong Class name,
which fails closed with a clear error. That's the entire reason this is
"tool selection" and not "text-to-SQL."
