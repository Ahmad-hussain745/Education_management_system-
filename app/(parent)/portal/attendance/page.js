import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { resolveSelectedChild } from "@/lib/parent-portal/child";
import { STATUS_LABEL, STATUS_COLOR } from "@/lib/parent-portal/format";

export default async function AttendancePage(props) {
  const searchParams = await props.searchParams;
  const roleContext = await getRoleContext();
  const kids = roleContext?.children || [];
  if (kids.length === 0) return null;
  const child = resolveSelectedChild(searchParams, kids);

  const supabase = await createClient();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data } = await supabase
    .from("student_attendance")
    .select("date, status")
    .eq("student_id", child.id)
    .gte("date", ninetyDaysAgo)
    .order("date", { ascending: false });

  const rows = data || [];
  const counts = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  const presentPct = rows.length > 0 ? Math.round(((counts.present || 0) + (counts.late || 0)) / rows.length * 100) : null;

  // Grouped by month for a readable scroll, most recent first.
  const byMonth = new Map();
  for (const r of rows) {
    const key = r.date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(r);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-ink">Attendance — {child.name}</h1>

      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="text-2xl font-bold font-mono text-ink">{presentPct === null ? "—" : `${presentPct}%`}</div>
        <p className="text-xs text-slate-400 mb-3">present, last 90 days</p>
        <div className="flex gap-2 flex-wrap">
          {Object.entries(counts).map(([status, count]) => (
            <span key={status} className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_COLOR[status] || "bg-slate-100 text-slate-600"}`}>
              {STATUS_LABEL[status] || status}: {count}
            </span>
          ))}
        </div>
      </section>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">No attendance recorded in the last 90 days.</p>
      ) : (
        [...byMonth.entries()].map(([month, entries]) => (
          <section key={month} className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-ink mb-3">
              {new Date(month + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </h2>
            <div className="grid grid-cols-7 gap-1.5">
              {entries.map((e) => (
                <div key={e.date} title={`${e.date}: ${STATUS_LABEL[e.status] || e.status}`}
                  className={`text-xs text-center rounded py-1.5 ${STATUS_COLOR[e.status] || "bg-slate-100 text-slate-600"}`}>
                  {Number(e.date.slice(-2))}
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
