import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import SendButtons from "./SendButtons";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
function monthLabel(month) {
  if (!month) return "";
  return new Date(month + "T00:00:00").toLocaleString("en-US", { month: "long", year: "numeric" });
}
function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function dateTimeLabel(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function statusStyle(status) {
  switch (status) {
    case "sent":
      return "bg-green-50 text-sage";
    case "ready":
      return "bg-amber-50 text-amber-700";
    case "failed":
      return "bg-red-50 text-brick";
    case "queued":
    default:
      return "bg-slate-100 text-slate-500";
  }
}
function statusLabel(status) {
  return status === "ready" ? "ready — not confirmed" : status;
}

export default async function NotificationsPage(props) {
  const searchParams = await props.searchParams;
  // Same audience as Fee Records/Payments — reminders are fee-collection work.
  await requireRole(["Super Admin", "Principal", "Accountant", "Cashier"]);
  const supabase = await createClient();

  const month = searchParams?.month || currentMonthStr();

  const [{ data: pending }, { data: history }] = await Promise.all([
    supabase.rpc("pending_fee_reminders", { p_month: month }),
    supabase
      .from("notifications")
      .select("id, type, channel, status, sent_at, created_at, student:students(name)")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Notifications</h1>
      <p className="text-sm text-slate-500 mt-1">
        Fee reminders for every student with an outstanding bill this month. Automated queuing runs on
        the 10th, 20th, and 25th (see Automation Center for the schedule) — nothing is ever sent without
        a staff member clicking Send here. Clicking Send hands the message off (WhatsApp/SMS open the app
        that actually sends it; Email goes through a real provider) — only Email can currently confirm
        back that it was actually sent; WhatsApp/SMS stay marked "Ready" since this system has no way to
        know what happened after the handoff.
      </p>

      <form className="mt-4 mb-6" method="get">
        <input type="month" name="month" defaultValue={month.slice(0, 7)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </form>

      <div className="text-sm font-semibold text-ink mb-2">Outstanding — {monthLabel(month)}</div>
      <div className="grid md:grid-cols-2 gap-4 mb-8">
        {(pending || []).map((r) => (
          <div key={r.fee_record_id} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="font-medium text-ink">{r.student_name}</div>
            <div className="text-sm text-slate-500 mt-1">
              {monthLabel(month)} Fee: {fmt(r.total_payable)}
            </div>
            <div className="text-sm text-brick font-medium">Outstanding: {fmt(r.outstanding)}</div>
            <div className="mt-3">
              <SendButtons
                studentId={r.student_id}
                feeRecordId={r.fee_record_id}
                guardianPhone={r.guardian_phone}
                guardianEmail={r.guardian_email}
              />
            </div>
          </div>
        ))}
        {(!pending || pending.length === 0) && (
          <div className="text-sm text-slate-400 col-span-2">No outstanding bills for this month.</div>
        )}
      </div>

      <div className="text-sm font-semibold text-ink mb-2">Recent Activity</div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Student</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-left px-4 py-3">Channel</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">When</th>
            </tr>
          </thead>
          <tbody>
            {(history || []).map((n) => (
              <tr key={n.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-ink">{n.student?.name}</td>
                <td className="px-4 py-3 text-slate-600 capitalize">{n.type.replace("_", " ")}</td>
                <td className="px-4 py-3 text-slate-600 capitalize">{n.channel || "—"}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusStyle(n.status)}`}>
                    {statusLabel(n.status)}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{dateTimeLabel(n.sent_at || n.created_at)}</td>
              </tr>
            ))}
            {(!history || history.length === 0) && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No notifications yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
