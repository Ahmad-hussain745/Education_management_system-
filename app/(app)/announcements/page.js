import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/parent-portal/format";
import AnnouncementForm from "./AnnouncementForm";

export default async function AnnouncementsPage() {
  await requireRole(["Super Admin", "Principal"]);
  const supabase = await createClient();

  const [{ data: classes }, { data: announcements }] = await Promise.all([
    supabase.from("classes").select("id, name").order("name"),
    supabase.from("announcements").select("id, title, body, audience, published_at, class:classes(name)").order("published_at", { ascending: false }).limit(30),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Announcements</h1>
        <p className="text-sm text-slate-500 mt-1">A persistent notice board parents see in their portal — separate from individual messages sent via Communications.</p>
      </div>

      <AnnouncementForm classes={classes || []} />

      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {(announcements || []).length === 0 ? (
          <p className="text-sm text-slate-400 p-5">No announcements published yet.</p>
        ) : (
          (announcements || []).map((a) => (
            <div key={a.id} className="p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-ink">{a.title}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
                  {a.audience === "class" ? a.class?.name || "One class" : "Whole institute"}
                </span>
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
