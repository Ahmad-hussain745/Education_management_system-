"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitApplication } from "../../actions";

export default function SubmitApplicationForm({ applicantId, classes }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const currentYear = new Date().getFullYear();

  const handleSubmit = async (formData) => {
    setPending(true);
    setError("");
    const res = await submitApplication(formData);
    setPending(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    router.push(`/admissions/applications/${res.applicationId}`);
  };

  return (
    <form action={handleSubmit} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="applicant_id" value={applicantId} />
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Applying for Class</label>
        <select name="applied_class_id" required className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Select class</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Academic Year</label>
        <input name="academic_year" type="number" required defaultValue={currentYear} className="w-28 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <button type="submit" disabled={pending} className="text-sm px-4 py-2 rounded-lg bg-royal text-white disabled:opacity-60">
        {pending ? "Submitting…" : "Submit Application"}
      </button>
      {error && <p className="w-full text-sm text-brick">{error}</p>}
    </form>
  );
}
