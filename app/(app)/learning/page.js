import Link from "next/link";
import { redirect } from "next/navigation";
import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/parent-portal/format";

const STATUS_STYLE = {
  draft: "bg-slate-100 text-slate-500",
  published: "bg-sage-tint text-sage",
};

export default async function LearningPage() {
  const roleContext = await getRoleContext();
  if (!roleContext) redirect("/login");
  if (roleContext.isParent) redirect("/dashboard?denied=1");

  const supabase = await createClient();
  const [{ data: assignments }, { data: deadlines }] = await Promise.all([
    supabase.from("assignments")
      .select("id, title, assignment_type, status, due_date, max_marks, class:classes(name), section:sections(name), subject:subjects(name)")
      .order("created_at", { ascending: false }).limit(50),
    supabase.rpc("get_upcoming_deadlines", { p_class_id: null, p_days: 14 }),
  ]);

  const rows = assignments || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Learning</h1>
          <p className="text-sm text-slate-500 mt-1">Assignments, resources, submissions, grading and feedback.</p>
        </div>
        {roleContext.isTeacher && (
          <Link href="/learning/new" className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg">
            New Assignment
          </Link>
        )}
      </div>

      {(deadlines || []).length > 0 && (
        <section className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-amber-800 mb-2">Due in the next 14 days</h2>
          <div className="space-y-1">
            {deadlines.map((d) => (
              <div key={d.id} className="text-sm text-amber-800 flex items-center justify-between">
                <Link href={`/learning/${d.id}`} className="hover:underline">{d.title} — {d.class_name}{d.section_name ? ` (${d.section_name})` : ""}{d.subject_name ? ` · ${d.subject_name}` : ""}</Link>
                <span className="font-mono text-xs">{fmtDate(d.due_date)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400 p-5">No assignments yet.</p>
        ) : (
          rows.map((a) => (
            <Link key={a.id} href={`/learning/${a.id}`} className="block p-4 hover:bg-slate-50">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="text-sm font-medium text-ink">{a.title}</span>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {a.class?.name}{a.section?.name ? ` (${a.section.name})` : ""}{a.subject?.name ? ` · ${a.subject.name}` : ""} · {a.assignment_type}
                    {a.due_date ? ` · Due ${fmtDate(a.due_date)}` : ""}{a.max_marks ? ` · ${a.max_marks} marks` : ""}
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 capitalize ${STATUS_STYLE[a.status]}`}>{a.status}</span>
              </div>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
