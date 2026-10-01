import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/parent-portal/format";

// Not child-scoped in the URL — RLS (migration 20260926010000) already
// shows a parent every institute-wide announcement plus the class
// announcements for whichever of their children's classes apply, all in
// one feed. No child switcher needed on this page.
export default async function AnnouncementsPage() {
  const roleContext = await getRoleContext();
  if (!roleContext?.children?.length) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("announcements")
    .select("id, title, body, audience, published_at, class:classes(name)")
    .order("published_at", { ascending: false })
    .limit(30);

  const rows = data || [];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-ink">Announcements</h1>
      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400 p-5">No announcements yet.</p>
        ) : (
          rows.map((a) => (
            <div key={a.id} className="p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-ink">{a.title}</span>
                {a.audience === "class" && a.class?.name && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-soft-blue text-royal font-medium shrink-0">{a.class.name}</span>
                )}
              </div>
              <p className="text-sm text-slate-600 mt-1.5 whitespace-pre-wrap">{a.body}</p>
              <div className="text-xs text-slate-400 mt-2">{fmtDate(a.published_at)}</div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
