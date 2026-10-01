import Link from "next/link";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import VehicleForm from "./VehicleForm";

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

const STATUS_STYLE = { active: "bg-sage-tint text-sage", maintenance: "bg-amber-50 text-amber-700", inactive: "bg-slate-100 text-slate-500" };

export default async function VehiclesPage() {
  await requireRole(["Super Admin", "Principal"]);
  const supabase = await createClient();
  const { data: vehicles } = await supabase.from("transport_vehicles").select("*").order("registration_no");

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/transport" className="text-xs text-slate-400 hover:text-ink">← Transport</Link>
        <h1 className="text-xl font-semibold text-ink mt-1">Vehicles</h1>
      </div>

      <VehicleForm />

      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {(vehicles || []).length === 0 ? (
          <p className="text-sm text-slate-400 p-4">No vehicles yet.</p>
        ) : (
          vehicles.map((v) => (
            <Link key={v.id} href={`/transport/vehicles/${v.id}`} className="block p-4 hover:bg-slate-50">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="text-sm font-medium text-ink">{v.registration_no}</span>
                  <div className="text-xs text-slate-400 mt-0.5 capitalize">
                    {v.vehicle_type} · {v.capacity} seats
                    {v.insurance_expiry && (v.insurance_expiry < today ? <span className="text-brick"> · insurance expired</span> : null)}
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_STYLE[v.status]}`}>{v.status}</span>
              </div>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
