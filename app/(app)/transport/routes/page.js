import Link from "next/link";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import RouteForm from "./RouteForm";

export default async function RoutesPage() {
  await requireRole(["Super Admin", "Principal"]);
  const supabase = await createClient();

  const [{ data: routes }, { data: vehicles }, { data: drivers }] = await Promise.all([
    supabase.from("transport_routes").select("id, name, status, vehicle:transport_vehicles(registration_no, capacity), driver:transport_drivers(name)").order("name"),
    supabase.from("transport_vehicles").select("id, registration_no").eq("status", "active").order("registration_no"),
    supabase.from("transport_drivers").select("id, name").eq("status", "active").order("name"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/transport" className="text-xs text-slate-400 hover:text-ink">← Transport</Link>
        <h1 className="text-xl font-semibold text-ink mt-1">Routes</h1>
      </div>

      <RouteForm vehicles={vehicles || []} drivers={drivers || []} />

      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {(routes || []).length === 0 ? (
          <p className="text-sm text-slate-400 p-4">No routes yet.</p>
        ) : (
          routes.map((r) => (
            <Link key={r.id} href={`/transport/routes/${r.id}`} className="block p-4 hover:bg-slate-50">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="text-sm font-medium text-ink">{r.name}</span>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {r.vehicle?.registration_no || "no vehicle"}{r.driver?.name ? ` · ${r.driver.name}` : ""}
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${r.status === "active" ? "bg-sage-tint text-sage" : "bg-slate-100 text-slate-500"}`}>{r.status}</span>
              </div>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
