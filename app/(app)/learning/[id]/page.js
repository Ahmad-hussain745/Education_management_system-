import { redirect, notFound } from "next/navigation";
import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getStudentsForClass } from "@/lib/teacher-copilot/roster";
import AssignmentDetailClient from "./AssignmentDetailClient";

export default async function AssignmentDetailPage({ params }) {
  const { id } = await params;
  const roleContext = await getRoleContext();
  if (!roleContext) redirect("/login");
  if (roleContext.isParent) redirect("/dashboard?denied=1");

  const supabase = await createClient();
  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, title, description, assignment_type, max_marks, due_date, allow_late, rubric, status, class_id, section_id, subject_id, class:classes(name), section:sections(name), subject:subjects(name)")
    .eq("id", id)
    .maybeSingle();

  if (!assignment) notFound();

  const [students, { data: resources }, { data: submissions }, { data: difficulty }] = await Promise.all([
    getStudentsForClass(supabase, assignment.class_id, assignment.section_id),
    supabase.from("assignment_resources").select("id, title, description, resource_type, url").eq("assignment_id", id).order("created_at"),
    supabase.from("assignment_submissions").select("student_id, submission_type, content_text, content_url, submitted_at, is_late, marks_obtained, feedback, status").eq("assignment_id", id),
    roleContext.isTeacher || roleContext.isAdmin || roleContext.isPrincipal
      ? supabase.rpc("get_assignment_difficulty", { p_assignment_id: id }).maybeSingle().then((r) => r.data).catch(() => null)
      : null,
  ]);

  const submissionByStudent = new Map((submissions || []).map((s) => [s.student_id, s]));
  const roster = students.map((s) => ({ ...s, submission: submissionByStudent.get(s.id) || null }));

  return (
    <AssignmentDetailClient
      assignment={assignment}
      resources={resources || []}
      roster={roster}
      difficulty={difficulty}
      canManage={Boolean(roleContext.isTeacher || roleContext.isAdmin || roleContext.isPrincipal)}
    />
  );
}
