import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import { getRoleContext } from "@/lib/auth/roles";
import ApplicationPipeline from "./ApplicationPipeline";

export default async function ApplicationDetailPage({ params }) {
  await requireRole(["Super Admin", "Principal", "Registrar"]);
  const roleContext = await getRoleContext();
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: application },
    { data: interviews },
    { data: tests },
    { data: documents },
    { data: decisions },
    { data: classes },
    { data: sections },
  ] = await Promise.all([
    supabase.from("admission_applications").select("*, applicant:admission_applicants(*), class:classes(name), student:students(id, name, student_code)").eq("id", id).maybeSingle(),
    supabase.from("admission_interviews").select("*, interviewer:users(name)").eq("application_id", id).order("scheduled_at", { ascending: false }),
    supabase.from("admission_tests").select("*").eq("application_id", id).order("scheduled_at", { ascending: false }),
    supabase.from("admission_documents").select("*").eq("application_id", id).order("created_at", { ascending: false }),
    supabase.from("admission_decisions").select("*, offered_class:classes(name), offered_section:sections(name)").eq("application_id", id).order("decided_at", { ascending: false }),
    supabase.from("classes").select("id, name"),
    supabase.from("sections").select("id, name, class_id"),
  ]);

  if (!application) notFound();

  return (
    <div className="max-w-3xl">
      <Link href="/admissions/applications" className="text-sm text-royal hover:underline">← All Applications</Link>
      <div className="flex items-start justify-between mt-2 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold text-ink">{application.applicant?.name}</h1>
          <p className="text-sm text-slate-500">
            {application.application_number} · applying for {application.class?.name} · {application.academic_year}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            {application.applicant?.guardian_name} · {application.applicant?.guardian_phone}
          </p>
        </div>
        {application.student && (
          <Link href={`/students/${application.student.id}`} className="text-sm px-3 py-2 rounded-lg bg-sage-tint text-sage font-medium">
            ✓ Enrolled as {application.student.student_code}
          </Link>
        )}
      </div>

      <ApplicationPipeline
        application={application}
        interviews={interviews || []}
        tests={tests || []}
        documents={documents || []}
        decisions={decisions || []}
        classes={classes || []}
        sections={sections || []}
        canDecide={!!roleContext?.canApprove}
      />
    </div>
  );
}
