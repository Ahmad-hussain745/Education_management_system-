import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";

const STATUS_TONE = {
  submitted: "bg-soft-blue text-royal",
  under_review: "bg-soft-blue text-royal",
  interview_scheduled: "bg-amber-50 text-amber-700",
  test_scheduled: "bg-amber-50 text-amber-700",
  documents_pending: "bg-amber-50 text-amber-700",
  decision_pending: "bg-amber-50 text-amber-700",
  approved: "bg-sage-tint text-sage",
  enrolled: "bg-sage-tint text-sage",
  rejected: "bg-brick-tint text-brick",
  waitlisted: "bg-slate-100 text-slate-600",
  withdrawn: "bg-slate-100 text-slate-400",
};

export default async function ApplicationsPage({ searchParams }) {
  await requireRole(["Super Admin", "Principal", "Registrar"]);
  const sp = await searchParams;
  const statusFilter = sp?.status || "";
  const supabase = await createClient();

  let query = supabase
    .from("admission_applications")
    .select("id, application_number, academic_year, status, submitted_at, applicant:admission_applicants(name, guardian_phone), class:classes(name)")
    .order("submitted_at", { ascending: false })
    .limit(200);
  if (statusFilter) query = query.eq("status", statusFilter);

  const { data: applications } = await query;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-ink">Applications</h1>
        <Link href="/admissions" className="text-sm text-royal hover:underline">← Admissions Dashboard</Link>
      </div>

      {statusFilter && (
        <div className="mb-3">
          <Link href="/admissions/applications" className="text-xs text-slate-500 hover:underline">
            Showing: {statusFilter.replace(/_/g, " ")} — clear filter ×
          </Link>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-100 bg-slate-50">
              <th className="px-4 py-2.5 font-medium">Application #</th>
              <th className="px-4 py-2.5 font-medium">Applicant</th>
              <th className="px-4 py-2.5 font-medium">Class</th>
              <th className="px-4 py-2.5 font-medium">Year</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {applications?.map((a) => (
              <tr key={a.id} className="border-b border-slate-50">
                <td className="px-4 py-3 font-mono text-xs">{a.application_number}</td>
                <td className="px-4 py-3">{a.applicant?.name}<div className="text-xs text-slate-400">{a.applicant?.guardian_phone}</div></td>
                <td className="px-4 py-3">{a.class?.name}</td>
                <td className="px-4 py-3">{a.academic_year}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${STATUS_TONE[a.status] || "bg-slate-100 text-slate-600"}`}>
                    {a.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/admissions/applications/${a.id}`} className="text-royal hover:underline text-xs">Open</Link>
                </td>
              </tr>
            ))}
            {(!applications || applications.length === 0) && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No applications{statusFilter ? ` with status "${statusFilter}"` : ""} yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
