import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import ReportFilterBar from "@/components/reports/ReportFilterBar";
import ReportToolbar from "@/components/reports/ReportToolbar";

export default async function SyllabusReportPage(props) {
  const searchParams = await props.searchParams;
  // syllabus_* is readable by any signed-in user — this report is scoped
  // to the same roles as the rest of Reports rather than opened to everyone.
  await requireRole(["Super Admin", "Principal", "Accountant", "Teacher"]);
  const supabase = await createClient();

  const classId = searchParams?.class_id || "";
  const sectionId = searchParams?.section_id || "";

  const [{ data: classes }, { data: sections }, { data: chapters }] = await Promise.all([
    supabase.from("classes").select("id, name").order("sort_order"),
    supabase.from("sections").select("id, name, class_id").order("name"),
    supabase
      .from("syllabus_chapters")
      .select("id, title, class_id, class:classes(name), subject:subjects(name), topics:syllabus_topics(id, progress:syllabus_progress(completed, section_id))"),
  ]);

  const sectionsByClass = new Map();
  (sections || []).forEach((s) => {
    if (!sectionsByClass.has(s.class_id)) sectionsByClass.set(s.class_id, []);
    sectionsByClass.get(s.class_id).push(s);
  });

  const rows = [];
  (chapters || []).filter((ch) => !classId || ch.class_id === classId).forEach((ch) => {
    const topics = ch.topics || [];
    const scopes = sectionId
      ? [{ key: sectionId, label: (sections || []).find((s) => s.id === sectionId)?.name || "Section", sectionId }]
      : [{ key: "whole", label: "Whole class", sectionId: null }, ...(sectionsByClass.get(ch.class_id) || []).map((s) => ({ key: s.id, label: s.name, sectionId: s.id }))];

    scopes.forEach((scope) => {
      const completed = topics.filter((t) => (t.progress || []).some((p) => (scope.sectionId ? p.section_id === scope.sectionId : p.section_id === null) && p.completed)).length;
      const total = topics.length;
      const hasAnyRowForScope = topics.some((t) => (t.progress || []).some((p) => (scope.sectionId ? p.section_id === scope.sectionId : p.section_id === null)));
      if (scope.sectionId && !hasAnyRowForScope) return;
      rows.push({
        id: `${ch.id}-${scope.key}`, class: ch.class?.name, subject: ch.subject?.name, chapter: ch.title,
        scope: scope.label, completed, total, pct: total > 0 ? Math.round((completed / total) * 100) : 0,
      });
    });
  });

  const csvColumns = [
    { key: "class", label: "Class" }, { key: "subject", label: "Subject" }, { key: "chapter", label: "Chapter" },
    { key: "scope", label: "Section" }, { key: "completed", label: "Completed" }, { key: "total", label: "Total Topics" }, { key: "pct", label: "Progress %" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Syllabus Progress Report</h1>
          <p className="text-sm text-slate-500 mt-1">Completed topics ÷ total topics, per chapter — filterable by class and section.</p>
        </div>
        <ReportToolbar rows={rows} columns={csvColumns} filename="syllabus-progress" />
      </div>

      <ReportFilterBar fields={["class", "section"]} values={{ class_id: classId, section_id: sectionId }} classes={classes} sections={sections} />

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
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
                <td className="px-4 py-3 text-right font-mono">{r.completed}/{r.total} ({r.pct}%)</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No chapters tracked for this filter.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
