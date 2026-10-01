import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import CreateExamForm from "./CreateExamForm";
import ExamList from "./ExamList";

export default async function ExamsPage() {
  await requireRole(["Super Admin", "Principal"]);
  const supabase = await createClient();

  const [{ data: examTypes }, { data: classes }, { data: sections }, { data: exams }] = await Promise.all([
    supabase.from("exam_types").select("id, name").order("name"),
    supabase.from("classes").select("id, name").order("sort_order"),
    supabase.from("sections").select("id, name, class_id"),
    supabase
      .from("exams")
      .select("id, name, start_date, end_date, exam_type:exam_types(name), exam_classes(id, class:classes(name), section:sections(name))")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Exams</h1>
      <p className="text-sm text-slate-500 mt-1">Create an exam, then assign which classes/sections sit it — expand a row below to manage its classes.</p>

      <div className="mt-6"><CreateExamForm examTypes={examTypes} /></div>

      <ExamList exams={exams || []} classes={classes} sections={sections} />
    </div>
  );
}
