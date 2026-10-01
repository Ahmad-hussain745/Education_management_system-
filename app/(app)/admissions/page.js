import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import NewEnquiryForm from "./NewEnquiryForm";

function Tile({ label, value, href, tone = "ink" }) {
  const toneClass = {
    ink: "text-ink",
    royal: "text-royal",
    sage: "text-sage",
    brick: "text-brick",
    amber: "text-amber-700",
  }[tone];
  const body = (
    <div className="bg-white border border-slate-200 rounded-xl p-4 hover:-translate-y-0.5 hover:shadow-md transition">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold font-mono ${toneClass}`}>{value ?? 0}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

// The dashboard requested: New Enquiries, Applications, Interviews,
// Approved, Rejected, Enrolled, Pending Documents — one RPC
// (admission_dashboard_summary(), 20260921031716_admissions_module.sql)
// for every tile, scoped to the caller's institute already.
export default async function AdmissionsPage() {
  const roleContext = await requireRole(["Super Admin", "Principal", "Registrar"]);
  const supabase = await createClient();

  const [{ data: summaryRows }, { data: classes }, { data: recentEnquiries }, { data: recentApplications }] = await Promise.all([
    supabase.rpc("admission_dashboard_summary"),
    supabase.from("classes").select("id, name").order("sort_order"),
    supabase.from("admission_enquiries").select("id, parent_name, parent_phone, student_name, status, created_at, class:classes(name)").order("created_at", { ascending: false }).limit(8),
    supabase.from("admission_applications").select("id, application_number, status, submitted_at, applicant:admission_applicants(name), class:classes(name)").order("submitted_at", { ascending: false }).limit(8),
  ]);
  const summary = summaryRows?.[0] || {};

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">Admissions</h1>
          <p className="text-sm text-slate-500 mt-1">Enquiry → Applicant → Application → Interview/Test → Decision → Enrollment.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admissions/applications" className="text-sm px-3 py-2 rounded-lg border border-slate-300 text-slate-600">
            All Applications
          </Link>
          <Link href="/admissions/enquiries" className="text-sm px-3 py-2 rounded-lg border border-slate-300 text-slate-600">
            All Enquiries
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Tile label="New Enquiries (30d)" value={summary.new_enquiries} href="/admissions/enquiries" tone="royal" />
        <Tile label="Applications" value={summary.applications} href="/admissions/applications" />
        <Tile label="Interviews Scheduled" value={summary.interviews} href="/admissions/applications" />
        <Tile label="Approved" value={summary.approved} href="/admissions/applications?status=approved" tone="sage" />
        <Tile label="Rejected" value={summary.rejected} href="/admissions/applications?status=rejected" tone="brick" />
        <Tile label="Enrolled" value={summary.enrolled} href="/admissions/applications?status=enrolled" tone="sage" />
        <Tile label="Pending Documents" value={summary.pending_documents} tone="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-ink">Log a new enquiry</h2>
          </div>
          <NewEnquiryForm classes={classes || []} instituteId={roleContext.instituteId} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-ink mb-3">Recent Enquiries</h2>
          {recentEnquiries?.length ? (
            <ul className="space-y-2">
              {recentEnquiries.map((e) => (
                <li key={e.id} className="text-sm border-b border-slate-50 pb-2 last:border-0">
                  <div className="flex justify-between">
                    <span className="font-medium text-ink">{e.student_name || e.parent_name}</span>
                    <span className="text-xs text-slate-400 capitalize">{e.status}</span>
                  </div>
                  <div className="text-xs text-slate-400">{e.parent_name} · {e.parent_phone}{e.class ? ` · ${e.class.name}` : ""}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">No enquiries yet.</p>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 mt-6">
        <h2 className="text-sm font-semibold text-ink mb-3">Recent Applications</h2>
        {recentApplications?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="pb-2 font-medium">Application #</th>
                  <th className="pb-2 font-medium">Applicant</th>
                  <th className="pb-2 font-medium">Class</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {recentApplications.map((a) => (
                  <tr key={a.id} className="border-b border-slate-50">
                    <td className="py-2 font-mono text-xs">{a.application_number}</td>
                    <td className="py-2">{a.applicant?.name}</td>
                    <td className="py-2">{a.class?.name}</td>
                    <td className="py-2 capitalize">{a.status.replace(/_/g, " ")}</td>
                    <td className="py-2 text-right">
                      <Link href={`/admissions/applications/${a.id}`} className="text-royal hover:underline text-xs">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No applications yet.</p>
        )}
      </div>
    </div>
  );
}
