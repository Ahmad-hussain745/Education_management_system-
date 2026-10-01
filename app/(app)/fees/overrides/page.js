import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import AddStudentFeeForm from "./AddStudentFeeForm";
import StudentFeeRow from "./StudentFeeRow";

export default async function StudentFeeOverridesPage() {
  // Same table, same RLS as Fee Structure — finance staff only, even for read.
  await requireRole(["Super Admin", "Accountant"]);
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: students }, { data: rows }] = await Promise.all([
    supabase.from("students").select("id, name, class:classes(name)").eq("status", "active").order("name"),
    supabase
      .from("fee_structures")
      .select("id, student_id, monthly_fee, effective_from, active, student:students(name, class:classes(name))")
      .not("student_id", "is", null)
      .order("effective_from", { ascending: false }),
  ]);

  const rowsByStudent = new Map();
  (rows || []).forEach((r) => {
    if (!rowsByStudent.has(r.student_id)) rowsByStudent.set(r.student_id, []);
    rowsByStudent.get(r.student_id).push(r);
  });
  const currentIdFor = (studentId) => {
    const eligible = (rowsByStudent.get(studentId) || []).filter((r) => r.active && r.effective_from <= today);
    if (eligible.length === 0) return null;
    return eligible.reduce((a, b) => (a.effective_from > b.effective_from ? a : b)).id;
  };

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Student Fee Overrides</h1>
      <p className="text-sm text-slate-500 mt-1">
        Per-student exceptions to the class fee — scholarships, sibling rates, anything non-standard.
        Same active-history model as Fee Structure, just scoped to one student.
      </p>

      <div className="mt-6"><AddStudentFeeForm students={students} /></div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Student</th>
              <th className="text-left px-4 py-3">Class</th>
              <th className="text-left px-4 py-3">Effective From</th>
              <th className="text-right px-4 py-3">Monthly Fee</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r) => <StudentFeeRow key={r.id} row={r} isCurrent={r.id === currentIdFor(r.student_id)} />)}
            {(!rows || rows.length === 0) && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No student overrides yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
