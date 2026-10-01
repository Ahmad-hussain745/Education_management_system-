import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import AddSubjectForm from "./AddSubjectForm";
import SubjectRow from "./SubjectRow";

export default async function AcademicSubjectsPage() {
  await requireRole(["Super Admin"]);
  const supabase = await createClient();
  const { data: subjects } = await supabase.from("subjects").select("id, name, active").order("name");

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Academic Setup — Subjects</h1>
      <p className="text-sm text-slate-500 mt-1">
        The subjects Teacher Class Assignment and the Syllabus module both pick from. Deactivate a
        subject that already has chapters built on it instead of deleting it — history stays intact.
      </p>

      <div className="mt-6"><AddSubjectForm /></div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(subjects || []).map((s) => <SubjectRow key={s.id} subject={s} />)}
            {(!subjects || subjects.length === 0) && (
              <tr><td colSpan={3} className="px-4 py-10 text-center text-slate-400">No subjects yet — add the first one above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
