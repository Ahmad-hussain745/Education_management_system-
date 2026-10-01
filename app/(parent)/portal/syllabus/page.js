import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { resolveSelectedChild } from "@/lib/parent-portal/child";

export default async function SyllabusPage(props) {
  const searchParams = await props.searchParams;
  const roleContext = await getRoleContext();
  const kids = roleContext?.children || [];
  if (kids.length === 0) return null;
  const child = resolveSelectedChild(searchParams, kids);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_child_syllabus_progress", { p_student_id: child.id });
  const rows = data || [];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-ink">Syllabus Progress — {child.name}</h1>
      <p className="text-xs text-slate-400">How much of each subject's syllabus has been marked complete so far this term.</p>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error.message}</div>}

      <div className="space-y-3">
        {rows.length === 0 && !error && <p className="text-sm text-slate-400">No syllabus has been set up for this class yet.</p>}
        {rows.map((r) => (
          <section key={r.subject_name} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-ink">{r.subject_name}</span>
              <span className="text-sm font-mono text-ink">{r.completion_pct == null ? "—" : `${r.completion_pct}%`}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-royal rounded-full" style={{ width: `${r.completion_pct || 0}%` }} />
            </div>
            <div className="text-xs text-slate-400 mt-1.5">{r.topics_completed} of {r.topics_total} topics complete</div>
          </section>
        ))}
      </div>
    </div>
  );
}
