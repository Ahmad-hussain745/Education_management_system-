import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { resolveSelectedChild } from "@/lib/parent-portal/child";
import { fmtDate } from "@/lib/parent-portal/format";

export default async function ExamsPage(props) {
  const searchParams = await props.searchParams;
  const roleContext = await getRoleContext();
  const kids = roleContext?.children || [];
  if (kids.length === 0) return null;
  const child = resolveSelectedChild(searchParams, kids);

  const supabase = await createClient();
  const { data } = await supabase
    .from("exam_results")
    .select("id, exam_id, total_marks, total_max_marks, percentage, class_rank, published_at, exam:exams(name), grade:grade_rules(grade, remarks)")
    .eq("student_id", child.id)
    .eq("status", "published")
    .order("published_at", { ascending: false });

  const rows = data || [];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-ink">Exam Results — {child.name}</h1>

      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400 p-5">No published results yet.</p>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-ink">{r.exam?.name}</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {r.total_marks}/{r.total_max_marks} ({Number(r.percentage).toFixed(1)}%)
                  {r.class_rank ? ` · Rank ${r.class_rank}` : ""} · Published {fmtDate(r.published_at)}
                </div>
                {r.grade?.grade && <div className="text-sm font-bold text-royal mt-1">{r.grade.grade}{r.grade.remarks ? ` — ${r.grade.remarks}` : ""}</div>}
              </div>
              <a
                href={`/api/report-cards/${r.exam_id}/${child.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
              >
                Report Card
              </a>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
