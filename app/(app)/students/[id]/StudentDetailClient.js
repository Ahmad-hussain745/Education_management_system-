"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateStudent, setStudentStatus, deleteStudent } from "../actions";
import { createClient } from "@/lib/supabase/client";
import { useOnline } from "@/lib/offline/useOnline";
import { ONLINE_REQUIRED_MESSAGE } from "@/lib/offline/online-required";
import OnlineRequiredGate from "@/components/OnlineRequiredGate";
import { queueContactUpdate } from "@/lib/offline/repositories/students";

function Field({ label, children }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm text-ink mt-0.5">{children}</div>
    </div>
  );
}

export default function StudentDetailClient({
  student, instituteId, classes, sections, feeHistory, discountHistory,
  currentFeeOverride, currentDiscount, currentDiscountReason, canWrite, startInEdit,
}) {
  const [editing, setEditing] = useState(!!startInEdit);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [classId, setClassId] = useState(student.class_id || "");
  const [statusPending, setStatusPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const router = useRouter();
  const online = useOnline();

  // Phase 31 — guardian_name/guardian_phone/address are the low-risk fields:
  // last-write-wins, editable offline, no conflict possible by design. See
  // lib/offline/repositories/students.js's queueContactUpdate() for why.
  // Deliberately its own small form, separate from the big Edit form below
  // — that one also touches fee_structures/fee_discounts, which ARE
  // financial and stay ONLINE REQUIRED.
  const [contactEditing, setContactEditing] = useState(false);
  const [guardianName, setGuardianName] = useState(student.guardian_name || "");
  const [guardianPhone, setGuardianPhone] = useState(student.guardian_phone || "");
  const [address, setAddress] = useState(student.address || "");
  const [contactSaving, setContactSaving] = useState(false);
  const [contactError, setContactError] = useState("");
  const [contactQueuedOffline, setContactQueuedOffline] = useState(false);

  const boundUpdate = updateStudent.bind(null, student.id);

  const handleSubmit = async (formData) => {
    // The big Edit form can change monthly_fee/discount — financial-
    // adjacent, so ONLINE REQUIRED (see lib/offline/online-required.js),
    // unlike the Guardian/Address quick-edit above.
    if (!online) {
      setError(ONLINE_REQUIRED_MESSAGE);
      return;
    }
    setPending(true);
    setError("");
    const res = await boundUpdate(formData);
    setPending(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    setEditing(false);
  };

  const handleSaveContact = async () => {
    setContactSaving(true);
    setContactError("");
    setContactQueuedOffline(false);
    try {
      if (online) {
        // Fast path: a plain UPDATE, same as queueContactUpdate ends up
        // doing on sync — this is still last-write-wins (no version check,
        // no conflict detection), just applied immediately instead of
        // waiting for the outbox's next pass.
        const supabase = createClient();
        const { error: err } = await supabase
          .from("students")
          .update({ guardian_name: guardianName || null, guardian_phone: guardianPhone || null, address: address || null })
          .eq("id", student.id);
        if (err) throw err;
        router.refresh();
      } else {
        await queueContactUpdate({ instituteId, studentId: student.id, guardianName, guardianPhone, address });
        setContactQueuedOffline(true);
      }
      setContactEditing(false);
    } catch (e) {
      setContactError(e.message || "Couldn't save — try again.");
    } finally {
      setContactSaving(false);
    }
  };

  const toggleStatus = async () => {
    const next = student.status === "active" ? "inactive" : "active";
    if (!confirm(`${next === "inactive" ? "Deactivate" : "Reactivate"} this student? Fee and payment history is kept either way.`)) return;
    setStatusPending(true);
    await setStudentStatus(student.id, next);
    setStatusPending(false);
    window.location.reload();
  };

  const handleDelete = async () => {
    if (!confirm(`Permanently delete ${student.name}? This can't be undone. If this student has any payment history, deletion will be refused automatically — use Deactivate instead for a student who's simply left.`)) return;
    setDeleteError("");
    setDeletePending(true);
    const res = await deleteStudent(student.id);
    setDeletePending(false);
    if (res?.error) {
      setDeleteError(res.error);
      return;
    }
    router.push("/students");
  };

  const sectionsForClass = sections.filter((s) => s.class_id === classId);

  if (!editing) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 mt-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-ink">{student.name}</h1>
            <p className="text-xs font-mono text-slate-400 mt-1">{student.student_code || "no ID assigned"}</p>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full h-fit ${student.status === "active" ? "bg-green-50 text-sage" : "bg-slate-100 text-slate-500"}`}>
            {student.status}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
          {!contactEditing ? (
            <>
              <Field label="Guardian Name">{student.guardian_name || "—"}</Field>
              <Field label="Guardian Phone">{student.guardian_phone || "—"}</Field>
              <Field label="Address">{student.address || "—"}</Field>
            </>
          ) : (
            <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Guardian Name</label>
                <input value={guardianName} onChange={(e) => setGuardianName(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Guardian Phone</label>
                <input value={guardianPhone} onChange={(e) => setGuardianPhone(e.target.value)} type="tel" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Address</label>
                <input value={address} onChange={(e) => setAddress(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="sm:col-span-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveContact}
                  disabled={contactSaving}
                  className="text-xs px-3 py-1.5 rounded-lg bg-royal text-white disabled:opacity-60"
                >
                  {contactSaving ? "Saving…" : online ? "Save" : "Save (will sync when online)"}
                </button>
                <button type="button" onClick={() => setContactEditing(false)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600">
                  Cancel
                </button>
                {!online && <span className="text-xs text-slate-500">Offline OK — last-write-wins, no conflict review needed.</span>}
              </div>
              {contactError && <p className="sm:col-span-3 text-xs text-brick">{contactError}</p>}
            </div>
          )}
          <Field label="Class">{student.class?.name || "—"}</Field>
          <Field label="Section">{student.section?.name || "—"}</Field>
          <Field label="Admission Date">{student.admission_date}</Field>
          <Field label="Fee Override">
            {currentFeeOverride != null ? `Rs. ${Number(currentFeeOverride).toLocaleString()}` : "— (uses class fee)"}
          </Field>
          <Field label="Current Discount">
            {currentDiscount > 0 ? (
              <>Rs. {Number(currentDiscount).toLocaleString()}{currentDiscountReason && <span className="text-slate-400"> — {currentDiscountReason}</span>}</>
            ) : "—"}
          </Field>
        </div>

        {contactQueuedOffline && (
          <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 inline-block">
            Saved on this device — will sync automatically once you're back online.
          </p>
        )}

        {canWrite && !contactEditing && (
          <button onClick={() => setContactEditing(true)} className="mt-2 text-xs text-royal hover:underline">
            Edit guardian / address
          </button>
        )}

        {canWrite && (
          <div className="flex gap-3 mt-6 pt-4 border-t border-slate-100 items-center flex-wrap">
            <OnlineRequiredGate>
              <button onClick={() => setEditing(true)} className="text-sm px-4 py-2 rounded-lg bg-royal text-white">
                Edit
              </button>
            </OnlineRequiredGate>
            <button
              onClick={toggleStatus}
              disabled={statusPending}
              className={`text-sm px-4 py-2 rounded-lg border ${student.status === "active" ? "border-brick text-brick" : "border-sage text-sage"}`}
            >
              {statusPending ? "…" : student.status === "active" ? "Deactivate" : "Reactivate"}
            </button>
            <button
              onClick={handleDelete}
              disabled={deletePending}
              className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-500 hover:border-brick hover:text-brick disabled:opacity-60"
            >
              {deletePending ? "Deleting…" : "Delete Permanently"}
            </button>
            {deleteError && <p className="text-sm text-brick w-full">{deleteError}</p>}
          </div>
        )}

        {feeHistory.length > 1 && (
          <div className="mt-6 pt-4 border-t border-slate-100">
            <div className="text-xs font-medium text-slate-500 uppercase mb-2">Fee Override History</div>
            <ul className="text-sm text-slate-600 space-y-1">
              {feeHistory.map((f, i) => (
                <li key={i}>
                  Rs. {Number(f.monthly_fee).toLocaleString()} — effective {f.effective_from} {!f.active && "(inactive)"}
                </li>
              ))}
            </ul>
          </div>
        )}
        {discountHistory.length > 1 && (
          <div className="mt-4">
            <div className="text-xs font-medium text-slate-500 uppercase mb-2">Discount History</div>
            <ul className="text-sm text-slate-600 space-y-1">
              {discountHistory.map((d, i) => (
                <li key={i}>
                  Rs. {Number(d.amount).toLocaleString()}{d.reason ? ` — ${d.reason}` : ""} {!d.active && "(superseded)"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-6 mt-4 space-y-3">
      <input type="hidden" name="current_fee_override" value={currentFeeOverride ?? ""} />
      <input type="hidden" name="current_discount" value={currentDiscount ?? 0} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Student ID</label>
          <input name="student_code" defaultValue={student.student_code || ""} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Student Name</label>
          <input name="name" required defaultValue={student.name} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Guardian Name</label>
          <input name="guardian_name" defaultValue={student.guardian_name || ""} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Guardian Phone</label>
          <input name="guardian_phone" type="tel" defaultValue={student.guardian_phone || ""} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Class</label>
          <select name="class_id" value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">— Select —</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Section</label>
          <select name="section_id" defaultValue={student.section_id || ""} disabled={!classId} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm disabled:bg-slate-50">
            <option value="">— None —</option>
            {sectionsForClass.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Admission Date</label>
          <input name="admission_date" type="date" defaultValue={student.admission_date} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
          <select name="status" defaultValue={student.status} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Fee Override (Rs.)</label>
          <input name="monthly_fee" type="number" min="0" defaultValue={currentFeeOverride ?? ""} placeholder="Leave blank to use class fee" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Discount (Rs.)</label>
          <input name="discount" type="number" min="0" defaultValue={currentDiscount || ""} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Discount Reason</label>
          <input name="discount_reason" defaultValue={currentDiscountReason || ""} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {error && <p className="text-sm text-brick">{error}</p>}

      <div className="flex gap-2 pt-2">
        <button type="button" onClick={() => setEditing(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-600">
          Cancel
        </button>
        <button type="submit" disabled={pending} className="text-sm px-4 py-2 rounded-lg bg-royal text-white disabled:opacity-60">
          {pending ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
