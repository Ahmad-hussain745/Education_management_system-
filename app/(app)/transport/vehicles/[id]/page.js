import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import VehicleDetailClient from "./VehicleDetailClient";

export default async function VehicleDetailPage({ params }) {
  const { id } = await params;
  await requireRole(["Super Admin", "Principal"]);
  const supabase = await createClient();

  const { data: vehicle } = await supabase.from("transport_vehicles").select("*").eq("id", id).maybeSingle();
  if (!vehicle) notFound();

  const [{ data: maintenance }, { data: fuelLogs }, { data: analytics }] = await Promise.all([
    supabase.from("transport_maintenance").select("*").eq("vehicle_id", id).order("service_date", { ascending: false }).limit(20),
    supabase.from("transport_fuel_logs").select("*").eq("vehicle_id", id).order("fuel_date", { ascending: false }).limit(20),
    supabase.rpc("get_vehicle_fuel_analytics", { p_vehicle_id: id, p_months: 6 }).maybeSingle(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/transport/vehicles" className="text-xs text-slate-400 hover:text-ink">← Vehicles</Link>
      </div>
      <VehicleDetailClient vehicle={vehicle} maintenance={maintenance || []} fuelLogs={fuelLogs || []} analytics={analytics} />
    </div>
  );
}
