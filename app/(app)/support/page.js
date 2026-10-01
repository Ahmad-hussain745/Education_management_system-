import { redirect } from "next/navigation";
import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/parent-portal/format";
import RequestCard from "./RequestCard";

// Any active staff member can see and respond — is_active_staff() on
// support_requests' RLS (migration 20260926010000) is "any role except
// Parent", not a fixed list, so the page guard mirrors that directly
// (requireRole's fixed allow-list doesn't fit here) rather than
// enumerating every current and future staff role by hand.
export default async function SupportPage() {
  const roleContext = await getRoleContext();
  if (!roleContext) redirect("/login");
  if (roleContext.isParent) redirect("/dashboard?denied=1");
  const supabase = await createClient();

  const { data } = await supabase
    .from("support_requests")
    .select("id, category, subject, message, status, staff_response, created_at, parent:users!parent_user_id(name), student:students(name)")
    .order("status", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (data || []).map((r) => ({ ...r, parent_name: r.parent?.name }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Support Requests</h1>
        <p className="text-sm text-slate-500 mt-1">Submitted by parents through the Parent Portal.</p>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400 p-5">No support requests yet.</p>
        ) : (
          rows.map((r) => <RequestCard key={r.id} request={r} fmtDate={fmtDate} />)
        )}
      </section>
    </div>
  );
}
