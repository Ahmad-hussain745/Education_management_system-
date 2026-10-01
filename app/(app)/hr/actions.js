"use server";

import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";

async function assertHrAdmin(rc) {
  if (!(rc?.isAdmin || rc?.isPrincipal)) throw new Error("HR is only available to Super Admin/Principal.");
}

export async function createEmployee(fields) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  if (!fields.name?.trim()) return { error: "Name is required." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("employees").insert({
    name: fields.name.trim(), employee_code: fields.employeeCode?.trim() || null,
    user_id: fields.userId || null, teacher_id: fields.teacherId || null,
    designation: fields.designation?.trim() || null, department: fields.department?.trim() || null,
    employment_type: fields.employmentType || "full_time",
    date_of_birth: fields.dateOfBirth || null, gender: fields.gender || null,
    national_id: fields.nationalId?.trim() || null, personal_phone: fields.personalPhone?.trim() || null,
    personal_email: fields.personalEmail?.trim() || null, address: fields.address?.trim() || null,
    emergency_contact_name: fields.emergencyContactName?.trim() || null, emergency_contact_phone: fields.emergencyContactPhone?.trim() || null,
    joining_date: fields.joiningDate || null, probation_end_date: fields.probationEndDate || null,
  }).select("id").single();
  if (error) return { error: error.message };
  return { id: data.id };
}

export async function updateEmployee(id, fields) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }

  const supabase = await createClient();
  const { error } = await supabase.from("employees").update({
    name: fields.name?.trim(), designation: fields.designation?.trim() || null, department: fields.department?.trim() || null,
    employment_type: fields.employmentType, date_of_birth: fields.dateOfBirth || null, gender: fields.gender || null,
    national_id: fields.nationalId?.trim() || null, personal_phone: fields.personalPhone?.trim() || null,
    personal_email: fields.personalEmail?.trim() || null, address: fields.address?.trim() || null,
    emergency_contact_name: fields.emergencyContactName?.trim() || null, emergency_contact_phone: fields.emergencyContactPhone?.trim() || null,
    joining_date: fields.joiningDate || null, probation_end_date: fields.probationEndDate || null,
    supervisor_id: fields.supervisorId || null,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function addContract(employeeId, fields) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  const supabase = await createClient();
  const { error } = await supabase.from("employee_contracts").insert({
    employee_id: employeeId, contract_type: fields.contractType || "permanent",
    start_date: fields.startDate, end_date: fields.endDate || null, salary_amount: fields.salaryAmount || null,
    terms: fields.terms?.trim() || null, document_url: fields.documentUrl?.trim() || null,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function addDocument(employeeId, fields) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  const supabase = await createClient();
  const { error } = await supabase.from("employee_documents").insert({
    employee_id: employeeId, title: fields.title?.trim(), document_type: fields.documentType || "other",
    url: fields.url?.trim() || null, uploaded_by: rc.userId,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function applyLeave(employeeId, leaveTypeId, dateFrom, dateTo, reason) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_for_leave", {
    p_employee_id: employeeId, p_leave_type_id: leaveTypeId || null, p_date_from: dateFrom, p_date_to: dateTo, p_reason: reason || null,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function decideLeave(id, status, note) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_leave_request", { p_id: id, p_status: status, p_note: note || null });
  if (error) return { error: error.message };
  return { ok: true };
}

// Non-teaching staff — writes to the new employee_attendance table.
export async function markEmployeeAttendance(employeeId, date, status, checkIn, checkOut) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  const supabase = await createClient();
  const { error } = await supabase.from("employee_attendance").upsert(
    { employee_id: employeeId, date, status, check_in: checkIn || null, check_out: checkOut || null, marked_by: rc.userId },
    { onConflict: "employee_id,date" }
  );
  if (error) return { error: error.message };
  return { ok: true };
}

// Teaching staff — writes to the EXISTING teacher_attendance table
// (0001_init.sql), the same one payroll's attendance-based deductions
// already read (0049_payroll_allowances_deductions_attendance.sql). This
// is the literal "HR -> Attendance -> Payroll" link: marking it here IS
// marking the same record payroll uses, not a copy of it.
export async function markTeacherAttendance(teacherId, date, status, checkIn, checkOut) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  const supabase = await createClient();
  const { error } = await supabase.from("teacher_attendance").upsert(
    { teacher_id: teacherId, date, status, check_in: checkIn || null, check_out: checkOut || null, marked_by: rc.userId },
    { onConflict: "teacher_id,date" }
  );
  if (error) return { error: error.message };
  return { ok: true };
}

export async function addPerformanceReview(employeeId, fields) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  const supabase = await createClient();
  const { error } = await supabase.from("performance_reviews").insert({
    employee_id: employeeId, review_period: fields.reviewPeriod?.trim(), reviewer_id: rc.userId,
    rating: fields.rating || null, strengths: fields.strengths?.trim() || null,
    areas_for_improvement: fields.areasForImprovement?.trim() || null, goals: fields.goals?.trim() || null,
    status: fields.status || "draft",
  });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function createTraining(fields) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  const supabase = await createClient();
  const { data, error } = await supabase.from("trainings").insert({
    title: fields.title?.trim(), provider: fields.provider?.trim() || null,
    training_date: fields.trainingDate || null, duration_hours: fields.durationHours || null, notes: fields.notes?.trim() || null,
  }).select("id").single();
  if (error) return { error: error.message };
  return { id: data.id };
}

export async function enrollInTraining(trainingId, employeeId) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  const supabase = await createClient();
  const { error } = await supabase.from("training_participants").insert({ training_id: trainingId, employee_id: employeeId });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function setTrainingCompletion(participantId, status) {
  const rc = await getRoleContext();
  try { await assertHrAdmin(rc); } catch (err) { return { error: err.message }; }
  const supabase = await createClient();
  const { error } = await supabase.from("training_participants").update({ completion_status: status }).eq("id", participantId);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function offboardEmployee(employeeId, exitType, lastWorkingDate, reason, noticeDate) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("offboard_employee", {
    p_employee_id: employeeId, p_exit_type: exitType, p_last_working_date: lastWorkingDate, p_reason: reason || null, p_notice_date: noticeDate || null,
  });
  if (error) return { error: error.message };
  return { ok: true };
}
