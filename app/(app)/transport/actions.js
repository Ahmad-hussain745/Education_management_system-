"use server";

import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";

async function assertHrAdmin(rc) {
  if (!(rc?.isAdmin || rc?.isPrincipal)) throw new Error("Managing Transport is only available to Super Admin/Principal.");
}
export async function createVehicle(fields) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  const supabase = await createClient();
  const { data, error } = await supabase.from("transport_vehicles").insert({
    registration_no: fields.registrationNo?.trim(), vehicle_type: fields.vehicleType || "bus",
    make: fields.make?.trim() || null, model: fields.model?.trim() || null, year: fields.year || null,
    capacity: fields.capacity, insurance_expiry: fields.insuranceExpiry || null, fitness_expiry: fields.fitnessExpiry || null,
  }).select("id").single();
  if (error) return { error: error.message };
  return { id: data.id };
}

export async function updateVehicle(id, fields) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  const supabase = await createClient();
  const { error } = await supabase.from("transport_vehicles").update({
    registration_no: fields.registrationNo?.trim(), vehicle_type: fields.vehicleType, make: fields.make?.trim() || null,
    model: fields.model?.trim() || null, year: fields.year || null, capacity: fields.capacity,
    insurance_expiry: fields.insuranceExpiry || null, fitness_expiry: fields.fitnessExpiry || null,
    status: fields.status, updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function createDriver(fields) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  const supabase = await createClient();
  const { error } = await supabase.from("transport_drivers").insert({
    name: fields.name?.trim(), phone: fields.phone?.trim() || null, license_no: fields.licenseNo?.trim() || null,
    license_expiry: fields.licenseExpiry || null, address: fields.address?.trim() || null, employee_id: fields.employeeId || null,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function updateDriver(id, fields) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  const supabase = await createClient();
  const { error } = await supabase.from("transport_drivers").update({
    name: fields.name?.trim(), phone: fields.phone?.trim() || null, license_no: fields.licenseNo?.trim() || null,
    license_expiry: fields.licenseExpiry || null, address: fields.address?.trim() || null, status: fields.status,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function createRoute(fields) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  const supabase = await createClient();
  const { data, error } = await supabase.from("transport_routes").insert({
    name: fields.name?.trim(), description: fields.description?.trim() || null,
    vehicle_id: fields.vehicleId || null, driver_id: fields.driverId || null,
  }).select("id").single();
  if (error) return { error: error.message };
  return { id: data.id };
}

export async function updateRoute(id, fields) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  const supabase = await createClient();
  const { error } = await supabase.from("transport_routes").update({
    name: fields.name?.trim(), description: fields.description?.trim() || null,
    vehicle_id: fields.vehicleId || null, driver_id: fields.driverId || null, status: fields.status,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function addStop(routeId, fields) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  const supabase = await createClient();
  const { error } = await supabase.from("transport_stops").insert({
    route_id: routeId, name: fields.name?.trim(), sequence_order: fields.sequenceOrder,
    pickup_time: fields.pickupTime || null, drop_time: fields.dropTime || null,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function removeStop(id) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  const supabase = await createClient();
  const { error } = await supabase.from("transport_stops").delete().eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function assignStudent(studentId, routeId, stopId) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_student_transport", { p_student_id: studentId, p_route_id: routeId, p_stop_id: stopId || null });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function unassignStudent(studentId) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("end_student_transport", { p_student_id: studentId });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function addMaintenance(vehicleId, fields) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  const supabase = await createClient();
  const { error } = await supabase.from("transport_maintenance").insert({
    vehicle_id: vehicleId, maintenance_type: fields.maintenanceType || "service", description: fields.description?.trim() || null,
    service_date: fields.serviceDate || new Date().toISOString().slice(0, 10), next_due_date: fields.nextDueDate || null,
    cost: fields.cost || null, odometer_reading: fields.odometerReading || null, vendor: fields.vendor?.trim() || null,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function addFuelLog(vehicleId, fields) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  const supabase = await createClient();
  const { error } = await supabase.from("transport_fuel_logs").insert({
    vehicle_id: vehicleId, fuel_date: fields.fuelDate || new Date().toISOString().slice(0, 10),
    liters: fields.liters, cost: fields.cost, odometer_reading: fields.odometerReading || null,
    notes: fields.notes?.trim() || null, filled_by: rc.userId,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function setTransportFeeStructure(fields) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  const supabase = await createClient();
  // One row per route (or per student override) — upsert on the column
  // the matching partial unique index actually covers.
  const conflictTarget = fields.studentId ? "student_id" : "route_id";
  const { error } = await supabase.from("transport_fee_structures").upsert(
    { route_id: fields.routeId || null, student_id: fields.studentId || null, monthly_fee: fields.monthlyFee },
    { onConflict: conflictTarget }
  );
  if (error) return { error: error.message };
  return { ok: true };
}

export async function previewTransportFees(month) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_transport_fee_generation", { p_month: month }).single();
  if (error) return { error: error.message };
  return { preview: data };
}

export async function generateTransportFees(month) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generate_transport_fee_records", { p_month: month }).single();
  if (error) return { error: error.message };
  return { result: data };
}

export async function recordTransportPayment(feeRecordId, studentId, month, amount, method, remarks) {
  const supabase = await createClient();
  const { error } = await supabase.from("transport_fee_payments").insert({
    fee_record_id: feeRecordId, student_id: studentId, month, amount, method: method || "Cash", remarks: remarks || null,
  });
  if (error) return { error: error.message };
  return { ok: true };
}
