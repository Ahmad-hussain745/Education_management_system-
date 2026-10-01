import { requireRole } from "@/lib/auth/guard";
import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import MarksEntryTable from "./MarksEntryTable";

export default async function ExamMarksPage(props) {
  const searchParams = await props.searchParams;
  await requireRole(["Super Admin", "Principal", "Teacher"]);
  const rc = await getRoleContext();
  const supabase = await createClient();

  // A Teacher only ever sees exam/class/subject combinations they're
  // actually assigned via teacher_classes — mirrors the RLS write policy
  // exactly (0030_exams_and_results.sql: matched on class_id AND
  // subject_id, not class alone), so this list never offers something the
  // database would then reject.
  let examSubjectsQuery = supabase
    .from("exam_subjects")
    .select("id, max_marks, class_id, subject_id, exam:exams(name), class:classes(name), subject:subjects(name)")
    .order("created_at", { ascending: false });

  const { data: allExamSubjects } = await examSubjectsQuery;

  let examSubjects = allExamSubjects || [];
  if (rc?.isTeacher && rc.teacherId) {
    const { data: myClasses } = await supabase.from("teacher_classes").select("class_id, subject_id").eq("teacher_id", rc.teacherId);
    const allowed = new Set((myClasses || []).map((c) => `${c.class_id}:${c.subject_id}`));
    examSubjects = examSubjects.filter((es) => allowed.has(`${es.class_id}:${es.subject_id}`));
  }

  const examSubjectId = searchParams?.exam_subject_id || "";
  const selected = examSubjects.find((es) => es.id === examSubjectId) || null;

  let students = [];
  let existingByStudentId = {};
  if (selected) {
    const { data: roster } = await supabase
      .from("students")
      .select("id, name")
      .eq("class_id", selected.class_id)
      .eq("status", "active")
      .order("name");
    students = roster || [];

    const { data: marks } = await supabase
      .from("exam_marks")
      .select("student_id, marks_obtained, is_absent")
      .eq("exam_subject_id", examSubjectId);
    existingByStudentId = Object.fromEntries((marks || []).map((m) => [m.student_id, m]));
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Enter Marks</h1>
      <p className="text-sm text-slate-500 mt-1">Pick an exam, class, and subject, then enter marks for the whole class at once.</p>

      <form method="get" className="mt-6 mb-6 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto">
          <label className="block text-xs font-medium text-slate-600 mb-1">Exam — Class — Subject</label>
          <select name="exam_subject_id" defaultValue={examSubjectId} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full sm:w-96">
            <option value="">— Select —</option>
            {examSubjects.map((es) => (
              <option key={es.id} value={es.id}>{es.exam?.name} — {es.class?.name} — {es.subject?.name} (/{es.max_marks})</option>
            ))}
          </select>
        </div>
        <button className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Load</button>
      </form>

      {examSubjects.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-10 text-center text-slate-400 text-sm">
          {rc?.isTeacher
            ? "No exam subjects are assigned to your classes yet."
            : "No exam subjects set up yet — add some under Exams → Subjects."}
        </div>
      )}

      {selected && (
        <MarksEntryTable
          students={students}
          existingByStudentId={existingByStudentId}
          examSubjectId={selected.id}
          maxMarks={selected.max_marks}
        />
      )}
    </div>
  );
}
