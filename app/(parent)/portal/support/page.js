import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/parent-portal/format";
import SupportForm from "./SupportForm";

const STATUS_STYLE = {
  open: "bg-amber-50 text-amber-700 border-amber-200",
  in_progress: "bg-soft-blue text-royal border-royal/20",
  resolved: "bg-sage-tint text-sage border-sage/30",
  closed: "bg-slate-100 text-slate-500 border-slate-200",
};
const STATUS_LABEL = { open: "Open", in_progress: "In Progress", resolved: "Resolved", closed: "Closed" };

export default async function SupportPage() {
  const roleContext = await getRoleContext();
  const kids = roleContext?.children || [];
  if (kids.length === 0) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("support_requests")
    .select("id, category, subject, message, status, staff_response, responded_at, created_at, student:students(name)")
    .order("created_at", { ascending: false });

  const rows = data || [];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-ink">Support Requests</h1>

      <SupportForm children_={kids} />

      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400 p-5">No requests submitted yet.</p>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-ink">{r.subject}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                {r.student?.name ? `${r.student.name} · ` : ""}{r.category} · {fmtDate(r.created_at)}
              </div>
              <p className="text-sm text-slate-600 mt-1.5 whitespace-pre-wrap">{r.message}</p>
              {r.staff_response && (
                <div className="mt-2 bg-slate-50 rounded-lg p-3">
                  <div className="text-xs font-medium text-slate-500 mb-1">School's response{r.responded_at ? ` · ${fmtDate(r.responded_at)}` : ""}</div>
                  <p className="text-sm text-ink whitespace-pre-wrap">{r.staff_response}</p>
                </div>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
