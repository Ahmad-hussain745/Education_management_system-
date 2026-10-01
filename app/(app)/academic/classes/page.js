import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import AddClassForm from "./AddClassForm";
import ClassRow from "./ClassRow";

export default async function ClassesPage() {
  await requireRole(["Super Admin"]);
  const supabase = await createClient();
  const { data: classes } = await supabase.from("classes").select("id, name, sort_order, status").order("sort_order");

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Academic Setup — Classes</h1>
      <p className="text-sm text-slate-500 mt-1">
        Every other module — Students, Fees, Teacher assignments, Salary, Attendance, Syllabus — picks its
        class from this list.
      </p>

      <div className="mt-6"><AddClassForm /></div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Sort Order</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(classes || []).map((c) => <ClassRow key={c.id} klass={c} />)}
            {(!classes || classes.length === 0) && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">No classes yet — add the first one above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
