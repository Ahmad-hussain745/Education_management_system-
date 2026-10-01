"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createEmployee } from "../actions";

const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract"];

export default function NewEmployeeForm({ teachers, users }) {
  const router = useRouter();
  const [teacherId, setTeacherId] = useState("");
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [designation, setDesignation] = useState("");
  const [department, setDepartment] = useState("");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [joiningDate, setJoiningDate] = useState("");
  const [personalPhone, setPersonalPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  function pickTeacher(id) {
    setTeacherId(id);
    const t = teachers.find((t) => t.id === id);
    if (t && !name) setName(t.name);
  }
  function pickUser(id) {
    setUserId(id);
    const u = users.find((u) => u.id === id);
    if (u && !name) setName(u.name);
  }

  async function submit() {
    if (!name.trim()) { setError("Name is required."); return; }
    setPending(true);
    setError(null);
    try {
      const res = await createEmployee({
        name, employeeCode, teacherId: teacherId || null, userId: userId || null,
        designation, department, employmentType, joiningDate: joiningDate || null, personalPhone,
      });
      if (res.error) setError(res.error);
      else router.push(`/hr/${res.id}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-xs text-slate-600">
          Link to teacher (optional)
          <select value={teacherId} onChange={(e) => pickTeacher(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm">
            <option value="">—</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Link to portal login (optional)
          <select value={userId} onChange={(e) => pickUser(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm">
            <option value="">—</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role?.name})</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600 sm:col-span-2">
          Full name
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
        </label>
        <label className="text-xs text-slate-600">
          Employee code (optional)
          <input value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
        </label>
        <label className="text-xs text-slate-600">
          Employment type
          <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm capitalize">
            {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Designation
          <input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Mathematics Teacher" className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
        </label>
        <label className="text-xs text-slate-600">
          Department
          <input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Academics, Finance" className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
        </label>
        <label className="text-xs text-slate-600">
          Joining date
          <input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
        </label>
        <label className="text-xs text-slate-600">
          Personal phone
          <input value={personalPhone} onChange={(e) => setPersonalPhone(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
        </label>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <button onClick={submit} disabled={pending || !name.trim()} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Saving…" : "Add Employee"}
      </button>
      <p className="text-xs text-slate-400">More detail (CNIC, address, emergency contact, contracts, documents) can be added on the employee's profile afterward.</p>
    </div>
  );
}
