import Link from "next/link";
import { redirect } from "next/navigation";
import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

const SECTIONS = [
  { href: "/transport/routes", label: "Routes" },
  { href: "/transport/vehicles", label: "Vehicles" },
  { href: "/transport/drivers", label: "Drivers" },
  { href: "/transport/assignments", label: "Assignments" },
  { href: "/transport/fees", label: "Transport Fees" },
];

// Five grounded signals, all computed from real rows (no LLM — same
// choice this app made for Student Risk and Assignment Difficulty):
// maintenance reminders, insurance + license expiry, fuel analytics
// (per-vehicle, linked from Vehicles rather than crammed in here), and
// route occupancy.
export default async function TransportDashboard() {
  const rc = await getRoleContext();
  if (!rc) redirect("/login");
  if (rc.isParent) redirect("/dashboard?denied=1");

  const supabase = await createClient();
  const [{ data: maintenanceDue }, { data: expiryAlerts }, { data: occupancy }] = await Promise.all([
    supabase.rpc("get_transport_maintenance_due", { p_days: 30 }),
    supabase.rpc("get_transport_expiry_alerts", { p_days: 30 }),
    supabase.rpc("get_route_occupancy"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Transport</h1>
        <p className="text-sm text-slate-500 mt-1">Routes, vehicles, drivers, stops, student assignments, maintenance, fuel and transport fees.</p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="text-sm px-3 py-1.5 rounded-lg border border-slate-300 text-ink hover:bg-slate-50">{s.label}</Link>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <section className="bg-white border border-slate-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-ink mb-2">Maintenance Due — next 30 days</h2>
          {(maintenanceDue || []).length === 0 ? (
            <p className="text-sm text-slate-400">Nothing due.</p>
          ) : (
            <div className="space-y-1.5">
              {maintenanceDue.map((m) => (
                <Link key={m.vehicle_id} href={`/transport/vehicles/${m.vehicle_id}`} className="flex justify-between text-sm hover:bg-slate-50 rounded px-1 -mx-1 py-0.5">
                  <span className="text-ink">{m.registration_no} <span className="text-slate-400 capitalize">({m.vehicle_type})</span></span>
                  <span className={`font-mono text-xs ${m.days_remaining < 0 ? "text-brick" : "text-amber-700"}`}>
                    {m.days_remaining < 0 ? `${-m.days_remaining}d overdue` : `due ${fmtDate(m.next_due_date)}`}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-ink mb-2">Expiry Alerts — next 30 days</h2>
          {(expiryAlerts || []).length === 0 ? (
            <p className="text-sm text-slate-400">Nothing expiring.</p>
          ) : (
            <div className="space-y-1.5">
              {expiryAlerts.map((a) => (
                <Link key={`${a.kind}-${a.subject_id}`} href={a.kind === "insurance" ? `/transport/vehicles/${a.subject_id}` : "/transport/drivers"} className="flex justify-between text-sm hover:bg-slate-50 rounded px-1 -mx-1 py-0.5">
                  <span className="text-ink">{a.subject_name} <span className="text-slate-400">({a.kind === "insurance" ? "insurance" : "license"})</span></span>
                  <span className={`font-mono text-xs ${a.days_remaining < 0 ? "text-brick" : "text-amber-700"}`}>
                    {a.days_remaining < 0 ? `expired ${-a.days_remaining}d ago` : `${fmtDate(a.expiry_date)}`}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-4 md:col-span-2">
          <h2 className="text-sm font-semibold text-ink mb-2">Route Occupancy</h2>
          {(occupancy || []).length === 0 ? (
            <p className="text-sm text-slate-400">No active routes yet.</p>
          ) : (
            <div className="space-y-2">
              {occupancy.map((r) => (
                <Link key={r.route_id} href={`/transport/routes/${r.route_id}`} className="block">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-ink">{r.route_name} <span className="text-slate-400">{r.vehicle_registration || "no vehicle assigned"}</span></span>
                    <span className={`font-mono text-xs ${r.over_capacity ? "text-brick font-semibold" : "text-slate-500"}`}>
                      {r.assigned_count}{r.capacity ? `/${r.capacity}` : ""}{r.occupancy_pct != null ? ` (${r.occupancy_pct}%)` : ""}
                      {r.over_capacity ? " · over capacity" : ""}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full rounded-full ${r.over_capacity ? "bg-brick" : "bg-royal"}`} style={{ width: `${Math.min(100, r.occupancy_pct || 0)}%` }} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <p className="text-xs text-slate-400">
        Fuel analytics are per-vehicle — open a vehicle under Vehicles to see its mileage and cost trend.
      </p>
    </div>
  );
}
