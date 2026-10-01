import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import EmployeeProfileClient from "./EmployeeProfileClient";

export default async function EmployeeProfilePage({ params }) {
  const { id } = await params;
  await requireRole(["Super Admin", "Principal"]);
  const supabase = await createClient();

  const { data: employee } = await supabase.from("employees").select("*, teacher:teachers(id, name, status)").eq("id", id).maybeSingle();
  if (!employee) notFound();

  const [
    { data: contracts }, { data: documents }, { data: leaveRequests }, { data: leaveTypes },
    { data: reviews }, { data: trainingParticipants }, { data: trainings }, { data: exit },
    attendanceRes, { data: supervisorOptions },
  ] = await Promise.all([
    supabase.from("employee_contracts").select("*").eq("employee_id", id).order("start_date", { ascending: false }),
    supabase.from("employee_documents").select("*").eq("employee_id", id).order("created_at", { ascending: false }),
    supabase.from("leave_requests").select("*, leave_type:leave_types(name)").eq("employee_id", id).order("date_from", { ascending: false }),
    supabase.from("leave_types").select("id, name").order("name"),
    supabase.from("performance_reviews").select("*").eq("employee_id", id).order("created_at", { ascending: false }),
    supabase.from("training_participants").select("*, training:trainings(title, training_date)").eq("employee_id", id).order("created_at", { ascending: false }),
    supabase.from("trainings").select("id, title, training_date").order("training_date", { ascending: false }).limit(50),
    supabase.from("employee_exits").select("*").eq("employee_id", id).maybeSingle(),
    employee.teacher_id
      ? supabase.from("teacher_attendance").select("date, status, check_in, check_out").eq("teacher_id", employee.teacher_id).order("date", { ascending: false }).limit(30)
      : supabase.from("employee_attendance").select("date, status, check_in, check_out").eq("employee_id", id).order("date", { ascending: false }).limit(30),
    supabase.from("employees").select("id, name").neq("id", id).neq("status", "exited").order("name"),
  ]);

  // Salary history: real payroll data (salary_records) for a teacher-
  // linked employee; otherwise just the informational figure from their
  // contracts, clearly not a payroll figure — see docs/HR_MODULE.md for
  // why this app's payroll only processes teachers today.
  let salaryHistory = null;
  if (employee.teacher_id) {
    const { data } = await supabase.from("salary_records").select("month, gross_salary, paid_total, status, locked")
      .eq("teacher_id", employee.teacher_id).order("month", { ascending: false }).limit(12);
    salaryHistory = { type: "payroll", rows: data || [] };
  } else {
    salaryHistory = { type: "contract_only", rows: (contracts || []).filter((c) => c.salary_amount) };
  }

  return (
    <EmployeeProfileClient
      employee={employee}
      contracts={contracts || []}
      documents={documents || []}
      leaveRequests={leaveRequests || []}
      leaveTypes={leaveTypes || []}
      reviews={reviews || []}
      trainingParticipants={trainingParticipants || []}
      trainings={trainings || []}
      exit={exit}
      attendance={attendanceRes.data || []}
      salaryHistory={salaryHistory}
      supervisorOptions={supervisorOptions || []}
    />
  );
}
