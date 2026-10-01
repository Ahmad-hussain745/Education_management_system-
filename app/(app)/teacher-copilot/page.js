import { requireRole } from "@/lib/auth/guard";
import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getTeacherClasses, groupTeacherClasses } from "@/lib/teacher-copilot/roster";
import { KINDS } from "@/lib/teacher-copilot/kinds";
import TeacherCopilotClient from "./TeacherCopilotClient";

// Teacher-only — this is deliberately not a Principal/Super Admin
// oversight tool sharing the same page (Ask MSA's model). teacher_id
// scoping throughout (teacher_owns_class(), RLS on
// teacher_copilot_drafts) means an admin viewing here would see an empty
// "my classes" list anyway; admin visibility into what's been drafted is
// the separate read-only RLS policy on teacher_copilot_drafts, not this
// UI.
export default async function TeacherCopilotPage() {
  await requireRole(["Teacher"]);
  const rc = await getRoleContext();
  const supabase = await createClient();

  const rows = await getTeacherClasses(supabase, rc.teacherId);
  const classes = groupTeacherClasses(rows);

  const { data: draftRows } = await supabase
    .from("teacher_copilot_drafts")
    .select("id, kind, status, content, topic, difficulty, created_at, approved_at, class:classes(name), section:sections(name), subject:subjects(name)")
    .eq("teacher_id", rc.teacherId)
    .order("created_at", { ascending: false })
    .limit(30);

  const recentDrafts = (draftRows || []).map((d) => ({
    id: d.id, kind: d.kind, status: d.status, content: d.content, topic: d.topic, difficulty: d.difficulty,
    className: d.class?.name || null, sectionName: d.section?.name || null, subjectName: d.subject?.name || null,
    createdAt: d.created_at, approvedAt: d.approved_at,
  }));

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Teacher Copilot</h1>
      <p className="text-sm text-slate-500 mt-1">
        Pick a tool, choose the class it's for, and get a first draft. Lesson plans, worksheets, quizzes and
        parent notes are AI-drafted for you to review and approve — nothing generated here is used or shown
        to anyone until you approve it. Attendance, risk, and progress tools instead pull live, verified
        numbers straight from your own class records.
      </p>

      <div className="mt-6">
        <TeacherCopilotClient classes={classes} kinds={KINDS} initialDrafts={recentDrafts} />
      </div>
    </div>
  );
}
