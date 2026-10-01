import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import SubmitApplicationForm from "./SubmitApplicationForm";

export default async function ApplicantDetailPage({ params }) {
  await requireRole(["Super Admin", "Principal", "Registrar"]);
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: applicant }, { data: classes }, { data: applications }] = await Promise.all([
    supabase.from("admission_applicants").select("*").eq("id", id).maybeSingle(),
    supabase.from("classes").select("id, name").order("sort_order"),
    supabase.from("admission_applications").select("id, application_number, academic_year, status, class:classes(name)").eq("applicant_id", id).order("created_at", { ascending: false }),
  ]);

  if (!applicant) notFound();

  return (
    <div className="max-w-2xl">
      <Link href="/admissions/enquiries" className="text-sm text-royal hover:underline">← Back</Link>
      <h1 className="text-xl font-semibold text-ink mt-2">{applicant.name}</h1>
      <p className="text-sm text-slate-500">
        {applicant.guardian_name} · {applicant.guardian_phone}
        {applicant.dob ? ` · DOB ${applicant.dob}` : ""}
        {applicant.previous_school ? ` · from ${applicant.previous_school}` : ""}
      </p>

      <div className="bg-white border border-slate-200 rounded-xl p-4 mt-6">
        <h2 className="text-sm font-semibold text-ink mb-3">Applications</h2>
        {applications?.length ? (
          <ul className="space-y-2 mb-4">
            {applications.map((a) => (
              <li key={a.id} className="flex items-center justify-between text-sm border-b border-slate-50 pb-2 last:border-0">
                <span>{a.application_number} · {a.class?.name} · {a.academic_year}</span>
                <span className="flex items-center gap-2">
                  <span className="capitalize text-xs text-slate-500">{a.status.replace(/_/g, " ")}</span>
                  <Link href={`/admissions/applications/${a.id}`} className="text-royal hover:underline text-xs">Open</Link>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400 mb-4">No applications submitted yet for this applicant.</p>
        )}

        <div className="pt-3 border-t border-slate-100">
          <h3 className="text-xs font-semibold text-slate-500 mb-2">Submit a new application</h3>
          <SubmitApplicationForm applicantId={applicant.id} classes={classes || []} />
        </div>
      </div>
    </div>
  );
}
