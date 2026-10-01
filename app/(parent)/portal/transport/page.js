import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { resolveSelectedChild } from "@/lib/parent-portal/child";
import { fmtTime } from "@/lib/parent-portal/format";

// get_child_transport() (20260930010000) is the same "RLS is row-level, a
// table with columns a parent shouldn't see needs a narrow function, not
// a policy" pattern as get_child_timetable — it returns the driver's name
// and phone (reasonable for a parent to have) but never their license
// number, and the vehicle's registration/type but never its maintenance
// or insurance detail.
export default async function TransportPage(props) {
  const searchParams = await props.searchParams;
  const roleContext = await getRoleContext();
  const kids = roleContext?.children || [];
  if (kids.length === 0) return null;
  const child = resolveSelectedChild(searchParams, kids);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_child_transport", { p_student_id: child.id });
  const info = data?.[0];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-ink">Transport — {child.name}</h1>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error.message}</div>}

      {!error && !info && <p className="text-sm text-slate-400">No transport assignment on file for this child.</p>}

      {info && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div>
            <div className="text-xs text-slate-400">Route</div>
            <div className="text-sm text-ink font-medium">{info.route_name}{info.stop_name ? ` — ${info.stop_name}` : ""}</div>
          </div>
          {(info.pickup_time || info.drop_time) && (
            <div className="grid grid-cols-2 gap-4">
              <div><div className="text-xs text-slate-400">Pickup</div><div className="text-sm text-ink">{fmtTime(info.pickup_time) || "—"}</div></div>
              <div><div className="text-xs text-slate-400">Drop</div><div className="text-sm text-ink">{fmtTime(info.drop_time) || "—"}</div></div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div><div className="text-xs text-slate-400">Vehicle</div><div className="text-sm text-ink">{info.vehicle_registration || "—"}{info.vehicle_type ? ` (${info.vehicle_type})` : ""}</div></div>
            <div><div className="text-xs text-slate-400">Driver</div><div className="text-sm text-ink">{info.driver_name || "—"}{info.driver_phone ? ` · ${info.driver_phone}` : ""}</div></div>
          </div>
        </section>
      )}
    </div>
  );
}
