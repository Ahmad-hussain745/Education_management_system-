import { requireRole } from "@/lib/auth/guard";
import AskMSA from "./AskMSA";
import RecentQueries from "./RecentQueries";

// Phase 24. Same role tier as Fee Arrears (Reports) — Ask MSA can only ever
// tell someone what they could already see by clicking around the app
// themselves; it's a faster way to ask, not a new grant of access. Salary/
// inventory/attendance questions are further gated per-intent inside
// lib/assistant/queries.js's own `requires` check (canViewFinance, a
// narrower group that excludes Cashier), so a Cashier can still use this
// page for fee questions and gets a plain "you don't have permission" for
// the rest — not a confusing blank or a wrong-looking zero.
export default async function AssistantPage() {
  await requireRole(["Super Admin", "Principal", "Accountant", "Cashier"]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Ask MSA</h1>
      <p className="text-sm text-slate-500 mt-1">
        A natural-language question in, a real number out — every answer is a live, verified query
        against the same records the rest of the app reads. It never guesses, and it says so plainly
        when it doesn't know how to answer something yet.
      </p>

      <div className="mt-6">
        <AskMSA />
      </div>

      <RecentQueries />
    </div>
  );
}
