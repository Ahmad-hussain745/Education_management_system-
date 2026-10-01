import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import ExamSubjectManager from "./ExamSubjectManager";

export default async function ExamSubjectsPage() {
  await requireRole(["Super Admin", "Principal"]);
  const supabase = await createClient();

  const [{ data: exams }, { data: subjects }, { data: examClasses }, { data: examSubjects }] = await Promise.all([
    supabase.from("exams").select("id, name").order("created_at", { ascending: false }),
    supabase.from("subjects").select("id, name").order("name"),
    supabase.from("exam_classes").select("exam_id, class:classes(id, name)"),
    supabase
      .from("exam_subjects")
      .select("id, exam_id, max_marks, passing_marks, exam_date, class:classes(name), subject:subjects(name), exam_marks(count)"),
  ]);

  // Distinct classes per exam (a class can appear twice — once whole-class,
  // once for a specific section — collapse to one entry for this picker).
  const examClassesByExam = {};
  for (const ec of examClasses || []) {
    if (!ec.class) continue;
    if (!examClassesByExam[ec.exam_id]) examClassesByExam[ec.exam_id] = [];
    if (!examClassesByExam[ec.exam_id].some((c) => c.id === ec.class.id)) {
      examClassesByExam[ec.exam_id].push(ec.class);
    }
  }

  const examSubjectsByExam = {};
  for (const es of examSubjects || []) {
    if (!examSubjectsByExam[es.exam_id]) examSubjectsByExam[es.exam_id] = [];
    examSubjectsByExam[es.exam_id].push({ ...es, mark_count: es.exam_marks?.[0]?.count || 0 });
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Exam Subjects</h1>
      <p className="text-sm text-slate-500 mt-1">Which subjects an exam covers per class, and out of how many marks — set once here, referenced by every mark entered against it.</p>
      <ExamSubjectManager
        exams={exams || []}
        subjects={subjects || []}
        examClassesByExam={examClassesByExam}
        examSubjectsByExam={examSubjectsByExam}
      />
    </div>
  );
}
