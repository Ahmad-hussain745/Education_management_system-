import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import ConvertEnquiryPanel from "./ConvertEnquiryPanel";

export default async function EnquiriesPage() {
  await requireRole(["Super Admin", "Principal", "Registrar"]);
  const supabase = await createClient();

  const { data: enquiries } = await supabase
    .from("admission_enquiries")
    .select("id, parent_name, parent_phone, parent_email, student_name, status, source, notes, created_at, class:classes(name)")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-ink">Enquiries</h1>
        <Link href="/admissions" className="text-sm text-royal hover:underline">← Admissions Dashboard</Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {(!enquiries || enquiries.length === 0) && (
          <p className="p-6 text-sm text-slate-400 text-center">No enquiries yet.</p>
        )}
        {enquiries?.map((e) => (
          <div key={e.id} className="p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="font-medium text-ink">{e.student_name || "(student name not given yet)"}</div>
                <div className="text-sm text-slate-500">{e.parent_name} · {e.parent_phone}{e.parent_email ? ` · ${e.parent_email}` : ""}</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {e.class?.name ? `Interested in ${e.class.name} · ` : ""}
                  via {e.source.replace(/_/g, " ")} · {new Date(e.created_at).toLocaleDateString()}
                </div>
                {e.notes && <div className="text-xs text-slate-500 mt-1 italic">"{e.notes}"</div>}
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium shrink-0 ${
                e.status === "converted" ? "bg-sage-tint text-sage" :
                e.status === "closed" ? "bg-slate-100 text-slate-500" :
                "bg-soft-blue text-royal"
              }`}>
                {e.status}
              </span>
            </div>
            {e.status !== "converted" && e.status !== "closed" && (
              <ConvertEnquiryPanel enquiryId={e.id} defaultName={e.student_name} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
