import Link from "next/link";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import LeaveDecisionButtons from "./LeaveDecisionButtons";

function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_STYLE = { pending: "bg-amber-50 text-amber-700", approved: "bg-sage-tint text-sage", rejected: "bg-brick-tint text-brick", cancelled: "bg-slate-100 text-slate-500" };

export default async function LeaveQueuePage() {
  await requireRole(["Super Admin", "Principal"]);
  const supabase = await createClient();

  const { data } = await supabase
    .from("leave_requests")
    .select("id, date_from, date_to, days_count, reason, status, days_paid, days_unpaid, payroll_note, decided_as, employee:employees!employee_id(id, name), supervisor:employees!supervisor_id(name), leave_type:leave_types(name, is_paid)")
    .order("status", { ascending: true })
    .order("date_from", { ascending: false })
    .limit(100);

  const rows = data || [];

  return (
    <div className="space-y-4">
      <div>
        <Link href="/hr" className="text-xs text-slate-400 hover:text-ink">← HR</Link>
        <h1 className="text-xl font-semibold text-ink mt-1">Leave Requests</h1>
        <p className="text-sm text-slate-500 mt-1">
          This is the HR override view of every request. Supervisors normally decide their own reports' requests from Leave; HR can step in when there's no supervisor or one is unavailable (but never on their own request). Approving writes attendance — paid days become <strong>leave</strong>, unpaid days (unpaid type, or beyond the annual quota) become <strong>absent</strong> — which Payroll's existing attendance deduction then handles.
        </p>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400 p-5">No leave requests yet.</p>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Link href={`/hr/${r.employee?.id}`} className="text-sm font-medium text-ink hover:underline">{r.employee?.name}</Link>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {r.leave_type?.name || "Leave"}{r.leave_type && !r.leave_type.is_paid ? " (unpaid)" : ""} · {fmtDate(r.date_from)} – {fmtDate(r.date_to)} · {r.days_count} day{r.days_count === 1 ? "" : "s"}
                  </div>
                  {r.reason && <p className="text-xs text-slate-500 mt-1">{r.reason}</p>}
                  <p className="text-xs text-slate-400 mt-1">
                    {r.supervisor?.name ? `Supervisor: ${r.supervisor.name}` : "No supervisor — HR decides"}
                    {r.status === "approved" ? ` · ${r.days_paid} paid, ${r.days_unpaid} unpaid` : ""}
                    {r.decided_as ? ` · decided by ${r.decided_as.replace("_", " ")}` : ""}
                  </p>
                  {r.payroll_note && <p className="text-xs text-amber-700 mt-1">{r.payroll_note}</p>}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize shrink-0 ${STATUS_STYLE[r.status]}`}>{r.status}</span>
              </div>
              {r.status === "pending" && <LeaveDecisionButtons id={r.id} />}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
