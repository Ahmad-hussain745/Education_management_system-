import { createClient } from "@/lib/supabase/server";

// Progress = completed topics ÷ total topics × 100, per chapter — and now
// per section too, since a topic can be ticked off independently for each
// section of a class (Chapters page lets a teacher pick which section
// they're marking). Each topic's progress here is the FULL set of rows
// (one per section it's been tracked for, plus possibly a whole-class row)
// — never just the first one, which would silently show one section's
// ticks as if they applied to a different section or to the whole class.
export default async function SyllabusProgressPage() {
  const supabase = await createClient();

  const [{ data: chapters }, { data: sections }] = await Promise.all([
    supabase
      .from("syllabus_chapters")
      .select("id, title, class_id, class:classes(name), subject:subjects(name), topics:syllabus_topics(id, progress:syllabus_progress(completed, section_id))"),
    supabase.from("sections").select("id, name, class_id"),
  ]);

  const sectionsByClass = new Map();
  (sections || []).forEach((s) => {
    if (!sectionsByClass.has(s.class_id)) sectionsByClass.set(s.class_id, []);
    sectionsByClass.get(s.class_id).push(s);
  });

  const rows = [];
  (chapters || []).forEach((ch) => {
    const topics = ch.topics || [];

    const scopes = [{ key: "whole", label: "Whole class", sectionId: null }];
    (sectionsByClass.get(ch.class_id) || []).forEach((s) => scopes.push({ key: s.id, label: s.name, sectionId: s.id }));

    scopes.forEach((scope) => {
      const completed = topics.filter((t) =>
        (t.progress || []).some((p) => (scope.sectionId ? p.section_id === scope.sectionId : p.section_id === null) && p.completed)
      ).length;
      const total = topics.length;
      // Skip a section row with zero ticks AND zero relevance (no progress
      // rows at all for it yet) unless it's the whole-class row, so the
      // table isn't padded with every section for every chapter before
      // anyone has started marking it that way.
      const hasAnyRowForScope = topics.some((t) =>
        (t.progress || []).some((p) => (scope.sectionId ? p.section_id === scope.sectionId : p.section_id === null))
      );
      if (scope.sectionId && !hasAnyRowForScope) return;

      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
      rows.push({
        id: `${ch.id}-${scope.key}`,
        class: ch.class?.name, subject: ch.subject?.name, chapter: ch.title,
        scope: scope.label, pct, total, completed,
      });
    });
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Syllabus Progress</h1>
      <p className="text-sm text-slate-500 mt-1">Completed topics ÷ total topics, per chapter — whole class, and by section once a section has been marked.</p>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-6">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Class</th>
              <th className="text-left px-4 py-3">Subject</th>
              <th className="text-left px-4 py-3">Chapter</th>
              <th className="text-left px-4 py-3">Section</th>
              <th className="text-right px-4 py-3">Progress</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-3">{r.class}</td>
                <td className="px-4 py-3">{r.subject}</td>
                <td className="px-4 py-3 font-medium text-ink">{r.chapter}</td>
                <td className="px-4 py-3 text-slate-600">{r.scope}</td>
                <td className="px-4 py-3 text-right font-mono">
                  {r.completed}/{r.total} ({r.pct}%)
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No chapters tracked yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
