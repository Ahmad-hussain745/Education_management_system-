"use client";

import { useState, useRef, useEffect } from "react";
import { studentRepository } from "@/lib/repositories/studentRepository";
import { subscribeConnectivity } from "@/lib/offline/connectivity";

export default function AddStudentForm({ classes, sections, instituteId, registeredByName = "" }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [classId, setClassId] = useState("");
  const [savedOffline, setSavedOffline] = useState(null);
  const formRef = useRef(null);

  const [online, setOnline] = useState(true);
  useEffect(() => subscribeConnectivity(setOnline), []);

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    setSavedOffline(null);

    const res = await studentRepository.create({
      instituteId,
      name: formData.get("name")?.toString().trim(),
      guardianName: formData.get("guardian_name")?.toString().trim() || null,
      guardianPhone: formData.get("guardian_phone")?.toString().trim() || null,
      classId: formData.get("class_id")?.toString() || null,
      sectionId: formData.get("section_id")?.toString() || null,
      admissionDate: formData.get("admission_date")?.toString() || new Date().toISOString().slice(0, 10),
      status: formData.get("status")?.toString() === "inactive" ? "inactive" : "active",
      studentCode: formData.get("student_code")?.toString().trim() || null,
      monthlyFee: formData.get("monthly_fee")?.toString().trim() ? Number(formData.get("monthly_fee")) : null,
      discount: formData.get("discount")?.toString().trim() ? Number(formData.get("discount")) : null,
      discountReason: formData.get("discount_reason")?.toString().trim() || null,
      registeredBy: registeredByName,
    });

    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.mode === "offline") {
      // Stays open a moment longer to show the local reference — the
      // cashier/registrar needs somewhere to write this down before the
      // form resets, unlike the online path where the list itself updates.
      setSavedOffline(res.record);
    }
    formRef.current?.reset();
    setClassId("");
    if (res.mode === "online") setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg"
      >
        + Add Student
      </button>
    );
  }

  const sectionsForClass = (sections || []).filter((s) => s.class_id === classId);

  if (savedOffline) {
    return (
      <div className="bg-white border border-amber-200 rounded-xl p-6 mb-4">
        <div className="text-amber-700 text-lg font-semibold mb-1">🟠 Saved Locally</div>
        <p className="text-xs text-slate-400 mb-4">
          No official student number yet — that's assigned by the server on sync, never in the browser
          (see the local reference below).
        </p>
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-sm">
          <Row label="Local Reference" value={savedOffline.local_ref} mono />
          <Row label="Name" value={savedOffline.name} />
          <Row label="Class" value={(classes || []).find((c) => c.id === savedOffline.class_id)?.name || "—"} />
          <div className="flex justify-between px-4 py-2 bg-amber-50">
            <span className="text-amber-700 font-medium">Status</span>
            <span className="font-semibold text-amber-700">Pending Sync</span>
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-3">
          Once this device is back online, this becomes a real student record with an official ID
          (MSA-{new Date().getFullYear()}-NNNNN) — check the Offline Registrations list below.
        </p>
        <div className="flex gap-2 mt-5">
          <button
            onClick={() => { setSavedOffline(null); setOpen(false); }}
            className="text-sm px-4 py-2 rounded-lg bg-royal text-white ml-auto"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} action={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-3">
      {!online && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm font-medium">
          🟠 Offline — this student is saved locally with a temporary reference and gets its official
          MSA ID automatically once you're back online.
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Student ID</label>
          <input
            name="student_code"
            placeholder={online ? "Auto-generated if left blank" : "Assigned automatically on sync"}
            disabled={!online}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Student Name</label>
          <input name="name" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Guardian Name</label>
          <input name="guardian_name" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Guardian Phone</label>
          <input name="guardian_phone" type="tel" placeholder="03xx-xxxxxxx" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Class</label>
          <select name="class_id" value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">— Select —</option>
            {(classes || []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Section</label>
          <select name="section_id" disabled={!classId} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm disabled:bg-slate-50">
            <option value="">— None —</option>
            {sectionsForClass.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Admission Date</label>
          <input name="admission_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
          <select name="status" defaultValue="active" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Fee Override (Rs.)</label>
          <input name="monthly_fee" type="number" min="0" placeholder="Leave blank to use class fee" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Discount (Rs.)</label>
          <input name="discount" type="number" min="0" placeholder="0" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Discount Reason</label>
          <input name="discount_reason" placeholder="e.g. sibling discount" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {error && <p className="text-sm text-brick">{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-600">
          Cancel
        </button>
        <button type="submit" disabled={pending} className="text-sm px-4 py-2 rounded-lg bg-royal text-white disabled:opacity-60">
          {pending ? "Saving…" : online ? "Save Student" : "Save Locally (Offline)"}
        </button>
      </div>
    </form>
  );
}

function Row({ label, value, mono }) {
  return (
    <div className="flex justify-between px-4 py-2">
      <span className="text-slate-500">{label}</span>
      <span className={`font-medium text-ink text-right ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}
