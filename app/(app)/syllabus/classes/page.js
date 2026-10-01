import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function SyllabusClassesPage() {
  const supabase = await createClient();
  const { data: classes } = await supabase.from("classes").select("id, name").order("sort_order");

  const { data: chapters } = await supabase
    .from("syllabus_chapters")
    .select("class_id, topics:syllabus_topics(id, progress:syllabus_progress(completed, section_id))");

  const byClass = new Map();
  (chapters || []).forEach((ch) => {
    const cur = byClass.get(ch.class_id) || { total: 0, completed: 0 };
    (ch.topics || []).forEach((t) => {
      cur.total += 1;
      if (t.progress?.some((p) => p.section_id === null && p.completed)) cur.completed += 1;
    });
    byClass.set(ch.class_id, cur);
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Syllabus — Classes</h1>
      <p className="text-sm text-slate-500 mt-1">Pick a class to manage its subjects and chapters.</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
        {(classes || []).map((c) => {
          const p = byClass.get(c.id) || { total: 0, completed: 0 };
          const pct = p.total > 0 ? Math.round((p.completed / p.total) * 100) : 0;
          return (
            <Link key={c.id} href={`/syllabus/subjects?class_id=${c.id}`} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-royal transition">
              <div className="font-medium text-ink">{c.name}</div>
              <div className="text-xs text-slate-500 mt-1">{p.total > 0 ? `${p.completed}/${p.total} topics (${pct}%)` : "No chapters yet"}</div>
            </Link>
          );
        })}
        {(!classes || classes.length === 0) && <div className="text-slate-400 text-sm">No classes yet.</div>}
      </div>
    </div>
  );
}
