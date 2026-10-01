import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function SyllabusSubjectsPage(props) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const classId = searchParams?.class_id || "";

  const [{ data: subjects }, { data: klass }] = await Promise.all([
    supabase.from("subjects").select("id, name, active").order("name"),
    classId ? supabase.from("classes").select("name").eq("id", classId).maybeSingle() : { data: null },
  ]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Syllabus — Subjects</h1>
          <p className="text-sm text-slate-500 mt-1">
            {klass?.name ? `Pick a subject to manage ${klass.name}'s chapters.` : "All subjects tracked across the curriculum. Pick a class first to manage chapters."}
          </p>
        </div>
        <Link href="/academic/subjects" className="text-sm text-royal whitespace-nowrap">Manage Subjects →</Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
        {(subjects || []).map((s) => (
          <Link
            key={s.id}
            href={classId ? `/syllabus/chapters?class_id=${classId}&subject_id=${s.id}` : `/syllabus/classes`}
            className="bg-white border border-slate-200 rounded-xl p-4 hover:border-royal transition"
          >
            <div className="flex items-center gap-2">
              <div className="font-medium text-ink">{s.name}</div>
              {!s.active && <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">inactive</span>}
            </div>
            {!classId && <div className="text-xs text-slate-400 mt-1">Pick a class first →</div>}
          </Link>
        ))}
        {(!subjects || subjects.length === 0) && (
          <div className="text-slate-400 text-sm">No subjects yet — <Link href="/academic/subjects" className="text-royal">add one in Academic Setup</Link>.</div>
        )}
      </div>
    </div>
  );
}
