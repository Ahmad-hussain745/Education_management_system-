import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { resolveSelectedChild } from "@/lib/parent-portal/child";
import { fmtDate } from "@/lib/parent-portal/format";

export default async function NotificationsPage(props) {
  const searchParams = await props.searchParams;
  const roleContext = await getRoleContext();
  const kids = roleContext?.children || [];
  if (kids.length === 0) return null;
  const child = resolveSelectedChild(searchParams, kids);

  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, type, rendered_message, sent_at, status, created_at")
    .eq("student_id", child.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = data || [];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-ink">Notices — {child.name}</h1>
      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400 p-5">No notices yet.</p>
        ) : (
          rows.map((n) => (
            <div key={n.id} className="p-4">
              <p className="text-sm text-ink">{n.rendered_message || `${n.type} notification`}</p>
              <div className="text-xs text-slate-400 mt-1">{fmtDate(n.sent_at || n.created_at)}</div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
