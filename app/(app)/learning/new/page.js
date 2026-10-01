import { requireRole } from "@/lib/auth/guard";
import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getTeacherClasses, groupTeacherClasses } from "@/lib/teacher-copilot/roster";
import NewAssignmentForm from "./NewAssignmentForm";

export default async function NewAssignmentPage() {
  await requireRole(["Teacher"]);
  const rc = await getRoleContext();
  const supabase = await createClient();
  const rows = await getTeacherClasses(supabase, rc.teacherId);
  const classes = groupTeacherClasses(rows);

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-ink mb-1">New Assignment</h1>
      <p className="text-sm text-slate-500 mb-6">Fill in what you know, or let AI draft it from a brief — either way, review before publishing.</p>
      <NewAssignmentForm classes={classes} />
    </div>
  );
}
