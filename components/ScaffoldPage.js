import { createClient } from "@/lib/supabase/server";

// A real, working page for a module that hasn't been fully built out yet.
// It queries the actual table (count + a few recent rows) so the connection
// to Supabase is proven end-to-end, then tells the next developer exactly
// which file to extend, following the same pattern as /students.
export default async function ScaffoldPage({ title, subtitle, table, columns, orderBy, extendHint }) {
  const supabase = createClient();

  const { count } = await supabase.from(table).select("id", { count: "exact", head: true });
  const { data: rows } = await supabase
    .from(table)
    .select(columns.map((c) => c.key).join(", "))
    .order(orderBy || "created_at", { ascending: false })
    .limit(8);

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">{title}</h1>
      <p className="text-sm text-slate-500 mt-1">{subtitle}</p>

      <div className="bg-white rounded-xl border border-slate-200 p-4 mt-6">
        <div className="text-xs text-slate-500 mb-3">
          Connected to <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{table}</code> —{" "}
          {count ?? 0} row{count === 1 ? "" : "s"} currently in the database.
        </div>

        {rows && rows.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-xs uppercase">
              <tr>{columns.map((c) => <th key={c.key} className="text-left px-2 py-2">{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  {columns.map((c) => <td key={c.key} className="px-2 py-2 text-slate-700">{String(r[c.key] ?? "—")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-400 py-6 text-center">No rows yet.</p>
        )}
      </div>

      <div className="mt-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
        <b>Scaffolded, not fully built.</b> {extendHint} Follow the same pattern as{" "}
        <code className="font-mono">app/(app)/students/page.js</code> (Server Component query) and{" "}
        <code className="font-mono">app/(app)/students/actions.js</code> (Server Action for writes).
      </div>
    </div>
  );
}
