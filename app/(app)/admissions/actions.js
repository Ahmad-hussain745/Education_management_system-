"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function friendlyError(error, fallback) {
  const msg = error?.message || "";
  if (msg.includes("NOT_AUTHORIZED")) return "You're not authorized for that.";
  if (msg.includes("INVALID_STATE")) return msg.split("INVALID_STATE:")[1]?.trim() || "That action isn't valid for this application's current status.";
  if (msg.includes("INVALID_INPUT")) return msg.split("INVALID_INPUT:")[1]?.trim() || "Please check the details entered.";
  if (msg.includes("INVALID_INSTITUTE")) return "That institute couldn't be found.";
  return fallback;
}

export async function createEnquiry(formData) {
  const supabase = await createClient();
  const parentName = formData.get("parent_name")?.toString().trim();
  const parentPhone = formData.get("parent_phone")?.toString().trim();
  const parentEmail = formData.get("parent_email")?.toString().trim() || null;
  const studentName = formData.get("student_name")?.toString().trim() || null;
  const classId = formData.get("interested_class_id")?.toString() || null;
  const notes = formData.get("notes")?.toString().trim() || null;
  const instituteId = formData.get("institute_id")?.toString();

  if (!parentName) return { error: "Parent name is required." };
  if (!parentPhone) return { error: "Parent phone is required." };

  // submit_public_enquiry() is what an unauthenticated public form would
  // call too (see the migration's own header) — staff use the exact same
  // path here rather than a second, staff-only insert function, so
  // there's only one enquiry-creation code path to ever have to trust.
  const { error } = await supabase.rpc("submit_public_enquiry", {
    p_institute_id: instituteId,
    p_parent_name: parentName,
    p_parent_phone: parentPhone,
    p_parent_email: parentEmail,
    p_student_name: studentName,
    p_interested_class_id: classId,
    p_notes: notes,
  });

  if (error) return { error: friendlyError(error, "Couldn't save that enquiry.") };
  revalidatePath("/admissions");
  revalidatePath("/admissions/enquiries");
  return { success: true };
}

export async function convertToApplicant(formData) {
  const supabase = await createClient();
  const enquiryId = formData.get("enquiry_id")?.toString();
  const name = formData.get("name")?.toString().trim();
  const dob = formData.get("dob")?.toString() || null;
  const gender = formData.get("gender")?.toString() || null;
  const guardianCnic = formData.get("guardian_cnic")?.toString().trim() || null;
  const address = formData.get("address")?.toString().trim() || null;
  const previousSchool = formData.get("previous_school")?.toString().trim() || null;

  if (!name) return { error: "Student name is required." };

  const { data, error } = await supabase.rpc("convert_enquiry_to_applicant", {
    p_enquiry_id: enquiryId,
    p_name: name,
    p_dob: dob,
    p_gender: gender,
    p_guardian_cnic: guardianCnic,
    p_address: address,
    p_previous_school: previousSchool,
  });

  if (error) return { error: friendlyError(error, "Couldn't convert this enquiry.") };
  revalidatePath("/admissions/enquiries");
  revalidatePath("/admissions/applicants");
  return { success: true, applicantId: data };
}

export async function submitApplication(formData) {
  const supabase = await createClient();
  const applicantId = formData.get("applicant_id")?.toString();
  const classId = formData.get("applied_class_id")?.toString();
  const academicYear = Number(formData.get("academic_year"));

  if (!applicantId || !classId) return { error: "An applicant and class are required." };
  if (!academicYear) return { error: "Enter a valid academic year." };

  const { data, error } = await supabase.rpc("submit_application", {
    p_applicant_id: applicantId,
    p_applied_class_id: classId,
    p_academic_year: academicYear,
  });

  if (error) return { error: friendlyError(error, "Couldn't submit this application.") };
  revalidatePath("/admissions/applicants");
  revalidatePath("/admissions/applications");
  return { success: true, applicationId: data };
}

export async function scheduleInterview(applicationId, formData) {
  const supabase = await createClient();
  const scheduledAt = formData.get("scheduled_at")?.toString();
  const mode = formData.get("mode")?.toString() || "in_person";
  if (!scheduledAt) return { error: "Pick a date/time for the interview." };

  const { error } = await supabase.from("admission_interviews").insert({
    application_id: applicationId,
    scheduled_at: scheduledAt,
    mode,
  });
  if (error) return { error: "Couldn't schedule the interview." };
  await supabase.from("admission_applications").update({ status: "interview_scheduled" }).eq("id", applicationId).eq("status", "submitted");
  revalidatePath(`/admissions/applications/${applicationId}`);
  return { success: true };
}

export async function scheduleTest(applicationId, formData) {
  const supabase = await createClient();
  const scheduledAt = formData.get("scheduled_at")?.toString();
  const testName = formData.get("test_name")?.toString().trim() || "Entrance Test";
  const maxMarks = Number(formData.get("max_marks")) || 100;
  if (!scheduledAt) return { error: "Pick a date/time for the test." };

  const { error } = await supabase.from("admission_tests").insert({
    application_id: applicationId,
    scheduled_at: scheduledAt,
    test_name: testName,
    max_marks: maxMarks,
  });
  if (error) return { error: "Couldn't schedule the test." };
  revalidatePath(`/admissions/applications/${applicationId}`);
  return { success: true };
}

export async function recordEventResult(table, id, applicationId, formData) {
  const supabase = await createClient();
  const status = formData.get("status")?.toString();
  const remarks = formData.get("remarks")?.toString().trim() || null;
  const patch = { status, remarks };
  if (table === "admission_interviews") patch.score = formData.get("score") ? Number(formData.get("score")) : null;
  if (table === "admission_tests") patch.obtained_marks = formData.get("obtained_marks") ? Number(formData.get("obtained_marks")) : null;

  const { error } = await supabase.from(table).update(patch).eq("id", id);
  if (error) return { error: "Couldn't save the result." };
  revalidatePath(`/admissions/applications/${applicationId}`);
  return { success: true };
}

export async function addDocument(applicationId, formData) {
  const supabase = await createClient();
  const documentType = formData.get("document_type")?.toString().trim();
  if (!documentType) return { error: "Document type is required." };

  const { error } = await supabase.from("admission_documents").insert({
    application_id: applicationId,
    document_type: documentType,
    status: "submitted",
  });
  if (error) return { error: "Couldn't add that document." };
  revalidatePath(`/admissions/applications/${applicationId}`);
  return { success: true };
}

export async function verifyDocument(documentId, applicationId, approve) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("admission_documents")
    .update({ status: approve ? "verified" : "rejected", verified_at: new Date().toISOString() })
    .eq("id", documentId);
  if (error) return { error: "Couldn't update that document." };
  revalidatePath(`/admissions/applications/${applicationId}`);
  return { success: true };
}

export async function decideApplication(applicationId, formData) {
  const supabase = await createClient();
  const decision = formData.get("decision")?.toString();
  const offeredClassId = formData.get("offered_class_id")?.toString() || null;
  const offeredSectionId = formData.get("offered_section_id")?.toString() || null;
  const feeOverrideRaw = formData.get("offered_fee_override")?.toString();
  const offeredFeeOverride = feeOverrideRaw ? Number(feeOverrideRaw) : null;
  const reason = formData.get("reason")?.toString().trim() || null;

  if (!["approved", "rejected", "waitlisted"].includes(decision)) {
    return { error: "Choose approved, rejected, or waitlisted." };
  }

  const { error } = await supabase.rpc("decide_admission", {
    p_application_id: applicationId,
    p_decision: decision,
    p_offered_class_id: offeredClassId,
    p_offered_section_id: offeredSectionId,
    p_offered_fee_override: offeredFeeOverride,
    p_reason: reason,
  });

  if (error) return { error: friendlyError(error, "Couldn't record that decision.") };
  revalidatePath(`/admissions/applications/${applicationId}`);
  revalidatePath("/admissions");
  return { success: true };
}

// The one action that turns an approved application into a real,
// enrolled student — see enroll_admission_application()'s own header for
// why this is a single RPC and not a client-side sequence of inserts.
export async function enrollApplication(applicationId) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("enroll_admission_application", { p_application_id: applicationId });
  if (error) return { error: friendlyError(error, "Couldn't enroll this applicant.") };
  revalidatePath(`/admissions/applications/${applicationId}`);
  revalidatePath("/admissions");
  revalidatePath("/students");
  return { success: true, studentId: data };
}
