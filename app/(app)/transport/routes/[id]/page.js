import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import RouteDetailClient from "./RouteDetailClient";

export default async function RouteDetailPage({ params }) {
  const { id } = await params;
  await requireRole(["Super Admin", "Principal"]);
  const supabase = await createClient();

  const { data: route } = await supabase.from("transport_routes").select("*").eq("id", id).maybeSingle();
  if (!route) notFound();

  const [{ data: stops }, { data: assignments }, { data: vehicles }, { data: drivers }] = await Promise.all([
    supabase.from("transport_stops").select("*").eq("route_id", id).order("sequence_order"),
    supabase.from("transport_assignments").select("id, student_id, stop_id, student:students(name, class:classes(name))").eq("route_id", id).eq("status", "active"),
    supabase.from("transport_vehicles").select("id, registration_no, capacity").order("registration_no"),
    supabase.from("transport_drivers").select("id, name").order("name"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/transport/routes" className="text-xs text-slate-400 hover:text-ink">← Routes</Link>
      </div>
      <RouteDetailClient
        route={route}
        stops={stops || []}
        assignments={assignments || []}
        vehicles={vehicles || []}
        drivers={drivers || []}
      />
    </div>
  );
}
