import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import { getRoleContext } from "@/lib/auth/roles";
import AssignClassForm from "./AssignClassForm";
import AssignmentRow from "./AssignmentRow";

export default async function TeacherClassesPage() {
  // teacher_classes' RLS write policy is "admin only" — but read is any
  // signed-in user, and Accountant genuinely needs to see this mapping
  // (it's exactly what Salary Configuration's percentages are keyed on).
  // Broaden view access to match; the assignment form and each row's
  // Edit/Remove are gated separately below to admin only, matching RLS
  // exactly rather than showing Principal/Accountant controls that would
  // just be rejected on submit.
  await requireRole(["Super Admin", "Principal", "Accountant"]);
  const rc = await getRoleContext();
  const canWrite = rc?.isAdmin || false;
  const supabase = await createClient();

  const [{ data: rawAssignments }, { data: teachers }, { data: classes }, { data: sections }, { data: allSubjects }, { data: rules }] = await Promise.all([
    supabase
      .from("teacher_classes")
      .select("id, teacher_id, class_id, section_id, subject_id, teacher:teachers(name), class:classes(name), section:sections(name), subject:subjects(name)")
      .order("created_at", { ascending: false }),
    supabase.from("teachers").select("id, name").eq("status", "active").order("name"),
    supabase.from("classes").select("id, name").order("sort_order"),
    supabase.from("sections").select("id, name, class_id").order("name"),
    supabase.from("subjects").select("id, name, active").order("name"),
    supabase.from("salary_rules").select("teacher_id, class_id, section_id, percentage").eq("active", true),
  ]);

  // New assignments should only offer active subjects; editing an existing
  // assignment must still show its own subject even if it's since been
  // deactivated (see 0009_subject_status.sql), or the edit form would
  // silently lose track of what it's actually pointing at.
  const activeSubjects = (allSubjects || []).filter((s) => s.active);

  // salary_rules is keyed on (teacher_id, class_id, section_id) — no
  // subject — so match it onto each assignment row for display/editing.
  const ruleFor = (teacherId, classId, sectionId) =>
    (rules || []).find((r) => r.teacher_id === teacherId && r.class_id === classId && (r.section_id || null) === (sectionId || null));

  const assignments = (rawAssignments || []).map((a) => ({
    id: a.id,
    teacher_id: a.teacher_id,
    class_id: a.class_id,
    section_id: a.section_id,
    subject_id: a.subject_id,
    teacher_name: a.teacher?.name,
    class_name: a.class?.name,
    section_name: a.section?.name,
    subject_name: a.subject?.name,
    percentage: ruleFor(a.teacher_id, a.class_id, a.section_id)?.percentage ?? null,
  }));

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Class Assignment</h1>
      <p className="text-sm text-slate-500 mt-1">
        Teacher → Class → Section → Subject, and — where applicable — the percentage they earn from it.
      </p>

      {canWrite && (
        <div className="mt-6">
          <AssignClassForm teachers={teachers} classes={classes} sections={sections} subjects={activeSubjects} />
        </div>
      )}
      {!canWrite && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mt-6 mb-2">
          You can view class assignments, but only Super Admin can create or change them.
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Teacher</th>
              <th className="text-left px-4 py-3">Class</th>
              <th className="text-left px-4 py-3">Section</th>
              <th className="text-left px-4 py-3">Subject</th>
              <th className="text-left px-4 py-3">Earns %</th>
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => (
              <AssignmentRow key={a.id} assignment={a} sections={sections || []} subjects={allSubjects || []} canWrite={canWrite} />
            ))}
            {assignments.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No assignments yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400 mt-2">Percentage shares are also reviewable in Salary Configuration.</p>
    </div>
  );
}
