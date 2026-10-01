import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "numeric", minute: "2-digit" });
}

// Visible to a narrower group than the assistant itself (canViewFinance,
// not canViewFees) — a Cashier can ask questions but doesn't get a feed of
// everyone else's, same tier as who can see Reports.
export default async function RecentQueries() {
  const rc = await getRoleContext();
  if (!rc?.canViewFinance) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("assistant_queries")
    .select("id, question, answer, matched_intent, created_at, user:users(name)")
    .order("created_at", { ascending: false })
    .limit(15);

  if (!data || data.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold text-ink mb-2">Recent Questions (this institute)</h2>
      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        {data.map((r) => (
          <div key={r.id} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-ink">{r.question}</span>
              <span className="text-xs text-slate-400 whitespace-nowrap">{r.user?.name || "—"} · {fmtDateTime(r.created_at)}</span>
            </div>
            <p className={`text-xs mt-1 ${r.matched_intent ? "text-slate-500" : "text-amber-600"}`}>{r.answer}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
