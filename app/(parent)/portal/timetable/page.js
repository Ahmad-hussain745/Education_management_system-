import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { resolveSelectedChild } from "@/lib/parent-portal/child";
import { DAY_NAMES, fmtTime } from "@/lib/parent-portal/format";

export default async function TimetablePage(props) {
  const searchParams = await props.searchParams;
  const roleContext = await getRoleContext();
  const kids = roleContext?.children || [];
  if (kids.length === 0) return null;
  const child = resolveSelectedChild(searchParams, kids);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_child_timetable", { p_student_id: child.id });
  const rows = data || [];

  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.day_of_week)) byDay.set(r.day_of_week, []);
    byDay.get(r.day_of_week).push(r);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-ink">Timetable — {child.name}</h1>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error.message}</div>}

      {days.length === 0 && !error && <p className="text-sm text-slate-400">No published timetable for this class yet.</p>}

      <div className="space-y-3">
        {days.map((d) => (
          <section key={d} className="bg-white border border-slate-200 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-ink mb-2">{DAY_NAMES[d]}</h2>
            <div className="space-y-1.5">
              {byDay.get(d).map((p, i) => (
                <div key={i} className={`flex items-center justify-between text-sm rounded-lg px-3 py-2 ${p.is_break ? "bg-slate-50 text-slate-400" : "bg-soft-blue/30"}`}>
                  <span className="text-xs text-slate-400 w-28 shrink-0">{fmtTime(p.start_time)} – {fmtTime(p.end_time)}</span>
                  {p.is_break ? (
                    <span className="flex-1">{p.period_name}</span>
                  ) : (
                    <>
                      <span className="flex-1 text-ink font-medium">{p.subject_name || "—"}</span>
                      <span className="text-xs text-slate-400">{p.teacher_name}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
