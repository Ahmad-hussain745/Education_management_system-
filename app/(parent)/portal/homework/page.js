import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { resolveSelectedChild } from "@/lib/parent-portal/child";
import { fmtDate } from "@/lib/parent-portal/format";

export default async function HomeworkPage(props) {
  const searchParams = await props.searchParams;
  const roleContext = await getRoleContext();
  const kids = roleContext?.children || [];
  if (kids.length === 0) return null;
  const child = resolveSelectedChild(searchParams, kids);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_child_homework", { p_student_id: child.id, p_limit: 30 });
  const rows = data || [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-ink">Homework — {child.name}</h1>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error.message}</div>}

      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {rows.length === 0 && !error && <p className="text-sm text-slate-400 p-5">No homework has been posted yet.</p>}
        {rows.map((h) => (
          <div key={h.id} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-ink">{h.title}</span>
              {h.due_date && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${h.due_date < today ? "bg-slate-100 text-slate-500" : "bg-amber-50 text-amber-700"}`}>
                  Due {fmtDate(h.due_date)}
                </span>
              )}
            </div>
            {h.subject_name && <div className="text-xs text-slate-400 mt-0.5">{h.subject_name}</div>}
            {h.description && <p className="text-sm text-slate-600 mt-1.5 whitespace-pre-wrap">{h.description}</p>}
          </div>
        ))}
      </section>
    </div>
  );
}
