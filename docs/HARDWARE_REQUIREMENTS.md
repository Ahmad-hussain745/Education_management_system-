# Phase 29 — Hardware requirements & where work actually runs

This is an audit against the requirement, not a rewrite — the codebase
already follows this split almost everywhere. What follows is what was
checked, what was found, and the two things that were tightened.

## The rule

| Runs on Supabase/PostgreSQL (server) | Runs on the local PC (client) |
|---|---|
| Aggregation, reporting, fee/salary calculation, anomaly detection, reconciliation | UI rendering |
| Cross-table joins, arrears/closing totals | IndexedDB (Dexie) — offline cache + outbox |
| PDF generation for receipts/slips/statements | Sync engine (push/pull the outbox) |
| RLS-enforced authorization | Printing (browser print dialog) |
| | Basic calculations (one student's own statement, form totals) |

The local PC never needs to be more than a normal office machine: no GPU,
no local database server, no local model runtime. Everything that scales
with the size of the *whole institute's* data runs as a Postgres function
and comes back as an already-computed answer.

## What was checked

**166 SQL/PL-pgSQL functions** across `supabase/migrations/`, called from
**28 client call sites** (`supabase.rpc(...)`) — the pattern used
throughout (`resolve_monthly_fee`, `detect_cash_collection_anomaly`,
`compute_cashier_closing_totals`, `preview_monthly_fee_generation`, etc.)
is: client sends parameters, Postgres does the arithmetic/joins/scans,
client renders the result. That's the correct shape for this requirement
and it's already how the app is built, not something Phase 29 introduced.

**Client-side `.reduce()`/aggregation calls** — grepped for anywhere data
gets summed or grouped in JS instead of SQL. Found three real ones, all
fine:
- `app/api/cron/weekly-report/route.js` — a server-side cron route (Vercel
  function), not the academy PC.
- `lib/assistant/queries.js` — also server-side (Server Action), and reads
  results already filtered to one month/one institute, not raw scans.
- `lib/offline/repositories/inventory.js` — runs in the browser, but only
  over that device's own *unsynced* pending items (a handful of rows at
  most), which is exactly the "Sync" bucket the local PC is supposed to
  own.

**xlsx/pdf-lib usage** — `pdf-lib` (receipts, salary slips, report cards,
statements) only runs in `app/api/**/route.js`, server-side. The one
client-side `xlsx` use (`FinancialStatement.js`) exports a single
student's own statement — bounded, "basic calculations" territory, not a
report over the whole institute.

**AI / local models** — grepped the whole app for any LLM, embedding
model, or ML runtime dependency. Found none. `package.json` has no
`tensorflow`, `onnx`, `transformers`, or model-runtime package of any kind.

This matters for the "don't install local LLMs" instruction specifically:
**there currently are no AI features in this app to gate behind a remote
provider.**
- "Ask MSA" (`lib/assistant/`) is regex intent-matching (`intents.js`)
  over a fixed set of questions, each mapped to a parameterized SQL query
  (`queries.js`) and a template string (`answer-templates.js`). No model,
  local or remote, is involved — it's pattern matching, not language
  understanding.
- Anomaly detection (`lib/automation/jobs/anomaly-detection.js`) is
  explicitly statistical by design — its own header says so — comparing a
  real current figure to a real historical average past a threshold.
  Nothing forecasts, trains, or infers.

Both already run entirely server-side (Postgres RPC + a Node
route/action), so both already satisfy "heavy work lives on
Supabase/Postgres" with zero AI dependency, local or remote, needed.

**If/when a real AI feature is added later** (e.g. a chat interface that
needs actual natural-language understanding, not just intent matching),
the pattern to follow is: call a remote provider's API from a server route
(same shape as `lib/email.js` calling Resend), gate the call on a
connectivity check so it degrades to "unavailable — check your
connection" rather than hanging when the academy is offline, and never
bundle a model or run inference locally on the academy PC.

## What changed

Nothing needed correcting in application code — no client-side heavy
computation, no local model dependency to remove. This document is the
deliverable: written down once so future phases have the rule stated
explicitly instead of it only being implicit in how the RPCs happen to be
structured.
