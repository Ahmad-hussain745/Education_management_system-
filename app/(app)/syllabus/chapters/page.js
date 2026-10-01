import { createClient } from "@/lib/supabase/server";
import AddChapterForm from "./AddChapterForm";
import ChapterCard from "./ChapterCard";
import SectionPicker from "./SectionPicker";

export default async function SyllabusChaptersPage(props) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const classId = searchParams?.class_id || "";
  const subjectId = searchParams?.subject_id || "";
  const sectionId = searchParams?.section_id || "";

  if (!classId || !subjectId) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-ink">Syllabus — Chapters</h1>
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm mt-6">
          Pick a class, then a subject, to manage its chapters and topics.
        </div>
      </div>
    );
  }

  const [{ data: klass }, { data: subject }, { data: sections }, { data: chapters }] = await Promise.all([
    supabase.from("classes").select("name").eq("id", classId).maybeSingle(),
    supabase.from("subjects").select("name").eq("id", subjectId).maybeSingle(),
    supabase.from("sections").select("id, name").eq("class_id", classId).order("name"),
    supabase
      .from("syllabus_chapters")
      // progress is fetched in full (every section's row for this topic, not
      // just one) — ChapterCard picks out the row matching whichever section
      // is currently selected below, instead of assuming a single row.
      .select("id, title, sort_order, topics:syllabus_topics(id, title, progress:syllabus_progress(completed, section_id))")
      .eq("class_id", classId).eq("subject_id", subjectId)
      .order("sort_order"),
  ]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">{klass?.name} — {subject?.name}</h1>
      <p className="text-sm text-slate-500 mt-1">Add chapters and topics, then tick each topic off as it's taught.</p>

      <div className="mt-6">
        <AddChapterForm classId={classId} subjectId={subjectId} />
      </div>

      {sections && sections.length > 0 && (
        <SectionPicker classId={classId} subjectId={subjectId} sections={sections} sectionId={sectionId} />
      )}

      {(chapters || []).map((ch) => <ChapterCard key={ch.id} chapter={ch} sectionId={sectionId || null} />)}

      {(!chapters || chapters.length === 0) && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm">
          No chapters yet — add the first one above.
        </div>
      )}
    </div>
  );
}
