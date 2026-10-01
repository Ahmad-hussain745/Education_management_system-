"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { convertToApplicant } from "../actions";

// Enquiry -> Applicant. Only asks for what the enquiry didn't already
// capture (parent name/phone/email carry over automatically inside
// convert_enquiry_to_applicant() — see that function's own comment) —
// this form's whole point is to avoid retyping what's already on screen.
export default function ConvertEnquiryPanel({ enquiryId, defaultName }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    const res = await convertToApplicant(formData);
    setPending(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    router.push(`/admissions/applicants/${res.applicantId}`);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 text-xs text-royal hover:underline">
        Convert to Applicant →
      </button>
    );
  }

  return (
    <form action={handleSubmit} className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-3">
      <input type="hidden" name="enquiry_id" value={enquiryId} />
      <div className="col-span-2">
        <label className="block text-xs font-medium text-slate-600 mb-1">Student's Full Name</label>
        <input name="name" required defaultValue={defaultName || ""} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Date of Birth</label>
        <input name="dob" type="date" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Gender</label>
        <select name="gender" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">—</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Guardian CNIC</label>
        <input name="guardian_cnic" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Previous School</label>
        <input name="previous_school" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div className="col-span-2">
        <label className="block text-xs font-medium text-slate-600 mb-1">Address</label>
        <input name="address" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      {error && <p className="col-span-2 text-sm text-brick">{error}</p>}
      <div className="col-span-2 flex gap-2">
        <button type="submit" disabled={pending} className="text-sm px-4 py-2 rounded-lg bg-royal text-white disabled:opacity-60">
          {pending ? "Converting…" : "Create Applicant"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-600">
          Cancel
        </button>
      </div>
    </form>
  );
}
