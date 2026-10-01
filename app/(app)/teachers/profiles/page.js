import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import { getRoleContext } from "@/lib/auth/roles";
import AddTeacherForm from "./AddTeacherForm";

export default async function TeacherProfilesPage() {
  // teachers' RLS write policy is "finance staff" (Super Admin, Accountant)
  // — Principal was previously admitted here but Accountant, who can
  // actually write, was hard-blocked entirely. View access is broadened to
  // match who genuinely needs it; the Add Teacher form itself is gated
  // separately below to the roles that can actually save it.
  await requireRole(["Super Admin", "Principal", "Accountant"]);
  const rc = await getRoleContext();
  const canWrite = rc?.isFinanceStaff || false;
  const supabase = await createClient();

  const [{ data: teachers }, { data: subjects }] = await Promise.all([
    supabase.from("teachers").select("id, name, phone, salary_mode, fixed_salary, status, user_id, subject:subjects(name)").order("name"),
    supabase.from("subjects").select("id, name").order("name"),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">Teacher Profiles</h1>
          <p className="text-sm text-slate-500 mt-1">{teachers?.length ?? 0} teachers on record</p>
        </div>
        {canWrite && <AddTeacherForm subjects={subjects} />}
      </div>
      {!canWrite && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mb-4">
          You can view teacher profiles, but only Super Admin or Accountant can add or edit them.
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Subject</th>
              <th className="text-left px-4 py-3">Phone</th>
              <th className="text-left px-4 py-3">Salary Mode</th>
              <th className="text-right px-4 py-3">Fixed / Base</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Login</th>
            </tr>
          </thead>
          <tbody>
            {(teachers || []).map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-ink">
                  <Link href={`/teachers/profiles/${t.id}`} className="hover:underline text-royal">{t.name}</Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{t.subject?.name || "—"}</td>
                <td className="px-4 py-3 text-slate-600">{t.phone || "—"}</td>
                <td className="px-4 py-3 text-slate-600 capitalize">{t.salary_mode}</td>
                <td className="px-4 py-3 text-right font-mono">Rs. {Number(t.fixed_salary || 0).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${t.status === "active" ? "bg-green-50 text-sage" : "bg-slate-100 text-slate-500"}`}>
                    {t.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${t.user_id ? "bg-soft-blue text-royal" : "bg-slate-100 text-slate-400"}`}>
                    {t.user_id ? "Linked" : "None"}
                  </span>
                </td>
              </tr>
            ))}
            {(!teachers || teachers.length === 0) && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No teachers yet — click "Add Teacher" to create the first one.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
