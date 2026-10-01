"use server";

import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";

// Every action resolves "who am I as an employee" server-side via
// get_my_leave_context() — the employee id is never taken from the client,
// so applying/previewing for someone else isn't a matter of editing a
// request body. The SQL functions re-check regardless (apply_for_leave,
// preview_leave_impact), this just keeps the client from being the source
// of truth for identity.
async function me(supabase) {
  const rc = await getRoleContext();
  if (!rc || rc.isParent) return null;
  const { data } = await supabase.rpc("get_my_leave_context");
  return data?.[0] || null;
}

export async function previewMyLeave(leaveTypeId, dateFrom, dateTo) {
  const supabase = await createClient();
  const ctx = await me(supabase);
  if (!ctx) return { error: "No HR record is linked to your account." };
  const { data, error } = await supabase.rpc("preview_leave_impact", {
    p_employee_id: ctx.employee_id, p_leave_type_id: leaveTypeId || null, p_date_from: dateFrom, p_date_to: dateTo,
  });
  if (error) return { error: error.message };
  return { impact: data };
}

export async function applyMyLeave(leaveTypeId, dateFrom, dateTo, reason) {
  const supabase = await createClient();
  const ctx = await me(supabase);
  if (!ctx) return { error: "No HR record is linked to your account." };
  const { error } = await supabase.rpc("apply_for_leave", {
    p_employee_id: ctx.employee_id, p_leave_type_id: leaveTypeId || null, p_date_from: dateFrom, p_date_to: dateTo, p_reason: reason || null,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function cancelMyLeave(id) {
  const supabase = await createClient();
  if (!(await me(supabase))) return { error: "Not authorized." };
  const { error } = await supabase.rpc("cancel_leave_request", { p_id: id });
  if (error) return { error: error.message };
  return { ok: true };
}

// Used by the supervisor inbox. The SQL function decides who may decide
// (the request's supervisor, or an HR admin) and blocks self-approval.
export async function decideLeaveRequest(id, status, note) {
  const supabase = await createClient();
  if (!(await me(supabase))) return { error: "Not authorized." };
  const { error } = await supabase.rpc("decide_leave_request", { p_id: id, p_status: status, p_note: note || null });
  if (error) return { error: error.message };
  return { ok: true };
}
