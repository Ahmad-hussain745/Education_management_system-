import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import ClassPicker from "./ClassPicker";
import AddSectionForm from "./AddSectionForm";
import SectionRow from "./SectionRow";

export default async function SectionsPage(props) {
  const searchParams = await props.searchParams;
  await requireRole(["Super Admin"]);
  const supabase = await createClient();
  const classId = searchParams?.class_id || "";

  const { data: classes } = await supabase.from("classes").select("id, name").order("sort_order");

  let sections = [];
  let studentCounts = {};
  if (classId) {
    const { data } = await supabase.from("sections").select("id, name").eq("class_id", classId).order("name");
    sections = data || [];

    const { data: students } = await supabase.from("students").select("section_id").eq("class_id", classId).not("section_id", "is", null);
    (students || []).forEach((s) => { studentCounts[s.section_id] = (studentCounts[s.section_id] || 0) + 1; });
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Academic Setup — Sections</h1>
      <p className="text-sm text-slate-500 mt-1">Pick a class, then manage its sections (e.g. Class 10 → A, B, C).</p>

      <div className="mt-6 mb-6"><ClassPicker classes={classes} classId={classId} /></div>

      {!classId && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm">
          Select a class above to manage its sections.
        </div>
      )}

      {classId && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <AddSectionForm classId={classId} />
          <ul>
            {sections.map((s) => <SectionRow key={s.id} section={s} studentCount={studentCounts[s.id] || 0} />)}
          </ul>
          {sections.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">No sections for this class yet.</p>}
        </div>
      )}
    </div>
  );
}
