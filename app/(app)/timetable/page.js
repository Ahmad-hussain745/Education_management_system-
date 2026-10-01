import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import { getRoleContext } from "@/lib/auth/roles";
import TimetableControls from "./TimetableControls";
import ClassSelector from "./ClassSelector";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function TimetablePage(props) {
  const searchParams = await props.searchParams;
  const role = await requireRole(["Super Admin", "Principal", "Accountant", "Teacher"]);
  const rc = await getRoleContext();
  const canManage = role === "Super Admin" || role === "Principal";
  const supabase = await createClient();

  const [{ data: classes }, { data: periods }, { data: academicDays }] = await Promise.all([
    supabase.from("classes").select("id, name").order("sort_order"),
    supabase.from("periods").select("id, name, start_time, sort_order, is_break").order("sort_order"),
    supabase.from("academic_days").select("day_of_week, active").eq("active", true).order("day_of_week"),
  ]);

  const classId = searchParams?.class_id || classes?.[0]?.id || "";
  const activeDays = (academicDays || []).map((d) => d.day_of_week);

  const [{ data: published }, { data: draftBatches }] = await Promise.all([
    classId
      ? supabase.from("timetable_entries").select("id, day_of_week, period_id, subject:subjects(name), teacher:teachers(name), room:rooms(name)")
          .eq("class_id", classId).eq("status", "published")
      : Promise.resolve({ data: [] }),
    canManage
      ? supabase.from("timetable_entries").select("batch_id, created_at, class:classes(name)").eq("status", "draft").order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const grid = {};
  (published || []).forEach((e) => { grid[`${e.day_of_week}:${e.period_id}`] = e; });

  const batches = Object.values(
    (draftBatches || []).reduce((acc, r) => {
      if (!acc[r.batch_id]) acc[r.batch_id] = { batchId: r.batch_id, createdAt: r.created_at, className: r.class?.name, count: 0 };
      acc[r.batch_id].count += 1;
      return acc;
    }, {})
  );

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Timetable</h1>
          <p className="text-sm text-slate-500 mt-1">
            Published schedule below. {canManage && "Generating suggestions never publishes automatically — every draft needs a Super Admin or Principal to review and approve it."}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Link href="/timetable/setup" className="text-sm px-3 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Setup</Link>
            <Link href="/timetable/substitutions" className="text-sm px-3 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Substitutions</Link>
          </div>
        )}
      </div>

      <div className="mt-4 mb-4 flex items-center gap-3 flex-wrap">
        <ClassSelector classes={classes} value={classId} />
        {canManage && <TimetableControls classId={classId} />}
      </div>

      {batches.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="text-sm font-semibold text-amber-800 mb-2">Draft timetables awaiting review</div>
          {batches.map((b) => (
            <TimetableControls key={b.batchId} batchToReview={b} reviewOnly />
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2">Period</th>
              {activeDays.map((d) => <th key={d} className="text-left px-3 py-2">{DAY_NAMES[d]}</th>)}
            </tr>
          </thead>
          <tbody>
            {(periods || []).filter((p) => !p.is_break).map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                  {p.name}<div className="text-xs text-slate-400">{p.start_time?.slice(0, 5)}</div>
                </td>
                {activeDays.map((d) => {
                  const e = grid[`${d}:${p.id}`];
                  return (
                    <td key={d} className="px-3 py-2 align-top">
                      {e ? (
                        <div>
                          <div className="font-medium text-ink">{e.subject?.name || "—"}</div>
                          <div className="text-xs text-slate-500">{e.teacher?.name || "—"}</div>
                          <div className="text-xs text-slate-400">{e.room?.name || ""}</div>
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
