"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateEmployee, addContract, addDocument, applyLeave, decideLeave,
  markTeacherAttendance, markEmployeeAttendance, addPerformanceReview,
  createTraining, enrollInTraining, setTrainingCompletion, offboardEmployee,
} from "../actions";

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "—";
}
function fmt(n) {
  return n == null ? "—" : "Rs. " + Math.round(Number(n)).toLocaleString("en-US");
}

const TABS = ["Overview", "Contracts", "Documents", "Leave", "Attendance", "Performance", "Training", "Salary History", "Exit"];

const inputCls = "mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm";
const labelCls = "text-xs text-slate-600";
const btnPrimary = "bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60";
const btnSecondary = "border border-slate-300 text-ink hover:bg-slate-50 text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60";

export default function EmployeeProfileClient(props) {
  const { employee, exit } = props;
  const [tab, setTab] = useState("Overview");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">{employee.name}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {employee.employee_code ? `${employee.employee_code} · ` : ""}{employee.designation || "—"}{employee.department ? ` · ${employee.department}` : ""}
            {employee.teacher_id ? " · Teaching staff" : ""}
          </p>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize shrink-0 ${employee.status === "active" ? "bg-sage-tint text-sage" : employee.status === "on_leave" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
          {employee.status.replace("_", " ")}
        </span>
      </div>

      {exit && (
        <div className="bg-slate-100 border border-slate-200 rounded-xl p-3 text-sm text-slate-600">
          Exited {fmtDate(exit.last_working_date)} — {exit.exit_type.replace("_", " ")}{exit.reason ? `: ${exit.reason}` : ""}
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`shrink-0 text-sm px-3 py-2 border-b-2 -mb-px ${tab === t ? "border-royal text-royal font-medium" : "border-transparent text-slate-500 hover:text-ink"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab employee={employee} supervisorOptions={props.supervisorOptions} />}
      {tab === "Contracts" && <ContractsTab employeeId={employee.id} contracts={props.contracts} />}
      {tab === "Documents" && <DocumentsTab employeeId={employee.id} documents={props.documents} />}
      {tab === "Leave" && <LeaveTab employeeId={employee.id} requests={props.leaveRequests} leaveTypes={props.leaveTypes} />}
      {tab === "Attendance" && <AttendanceTab employee={employee} attendance={props.attendance} />}
      {tab === "Performance" && <PerformanceTab employeeId={employee.id} reviews={props.reviews} />}
      {tab === "Training" && <TrainingTab employeeId={employee.id} participants={props.trainingParticipants} trainings={props.trainings} />}
      {tab === "Salary History" && <SalaryHistoryTab salaryHistory={props.salaryHistory} />}
      {tab === "Exit" && <ExitTab employeeId={employee.id} exit={exit} isExited={employee.status === "exited"} />}
    </div>
  );
}

function OverviewTab({ employee, supervisorOptions }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState({
    name: employee.name, designation: employee.designation || "", department: employee.department || "",
    employmentType: employee.employment_type, dateOfBirth: employee.date_of_birth || "", gender: employee.gender || "",
    nationalId: employee.national_id || "", personalPhone: employee.personal_phone || "", personalEmail: employee.personal_email || "",
    address: employee.address || "", emergencyContactName: employee.emergency_contact_name || "", emergencyContactPhone: employee.emergency_contact_phone || "",
    joiningDate: employee.joining_date || "", probationEndDate: employee.probation_end_date || "",
    supervisorId: employee.supervisor_id || "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setPending(true);
    setError(null);
    try {
      const res = await updateEmployee(employee.id, fields);
      if (res.error) setError(res.error);
      else { setEditing(false); router.refresh(); }
    } finally {
      setPending(false);
    }
  }

  const field = (key, label, type = "text") => (
    <label className={labelCls}>
      {label}
      {editing ? (
        <input type={type} value={fields[key]} onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))} className={inputCls} />
      ) : (
        <div className="mt-1 text-sm text-ink">{fields[key] || "—"}</div>
      )}
    </label>
  );

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex justify-end mb-2">
        {editing ? (
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="text-xs text-slate-500">Cancel</button>
            <button onClick={save} disabled={pending} className="text-xs bg-royal hover:bg-royal-dark text-white px-3 py-1.5 rounded-lg disabled:opacity-60">{pending ? "Saving…" : "Save"}</button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="text-xs text-royal hover:underline">Edit</button>
        )}
      </div>
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</div>}
      <div className="grid sm:grid-cols-2 gap-4">
        {field("designation", "Designation")}
        {field("department", "Department")}
        {field("dateOfBirth", "Date of Birth", "date")}
        {field("gender", "Gender")}
        {field("nationalId", "National ID / CNIC")}
        {field("personalPhone", "Personal Phone")}
        {field("personalEmail", "Personal Email")}
        {field("address", "Address")}
        {field("emergencyContactName", "Emergency Contact Name")}
        {field("emergencyContactPhone", "Emergency Contact Phone")}
        {field("joiningDate", "Joining Date", "date")}
        {field("probationEndDate", "Probation End Date", "date")}
        <label className={labelCls}>
          Reports to (leave supervisor)
          {editing ? (
            <select value={fields.supervisorId} onChange={(e) => setFields((f) => ({ ...f, supervisorId: e.target.value }))} className={inputCls}>
              <option value="">None — leave requests go to HR</option>
              {supervisorOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : (
            <div className="mt-1 text-sm text-ink">{supervisorOptions.find((s) => s.id === fields.supervisorId)?.name || "None — leave requests go to HR"}</div>
          )}
        </label>
      </div>
    </div>
  );
}

function ContractsTab({ employeeId, contracts }) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [fields, setFields] = useState({ contractType: "permanent", startDate: "", endDate: "", salaryAmount: "", terms: "", documentUrl: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    if (!fields.startDate) { setError("Start date is required."); return; }
    setPending(true); setError(null);
    try {
      const res = await addContract(employeeId, fields);
      if (res.error) setError(res.error);
      else { setShow(false); router.refresh(); }
    } finally { setPending(false); }
  }

  return (
    <div className="space-y-3">
      <button onClick={() => setShow((v) => !v)} className="text-xs text-royal hover:underline">{show ? "Cancel" : "+ Add Contract"}</button>
      {show && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 grid sm:grid-cols-2 gap-3">
          <label className={labelCls}>Type
            <select value={fields.contractType} onChange={(e) => setFields((f) => ({ ...f, contractType: e.target.value }))} className={inputCls}>
              {["permanent", "probation", "fixed_term", "contract"].map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
            </select>
          </label>
          <label className={labelCls}>Salary Amount (optional)
            <input type="number" value={fields.salaryAmount} onChange={(e) => setFields((f) => ({ ...f, salaryAmount: e.target.value }))} className={inputCls} />
          </label>
          <label className={labelCls}>Start Date
            <input type="date" value={fields.startDate} onChange={(e) => setFields((f) => ({ ...f, startDate: e.target.value }))} className={inputCls} />
          </label>
          <label className={labelCls}>End Date (optional)
            <input type="date" value={fields.endDate} onChange={(e) => setFields((f) => ({ ...f, endDate: e.target.value }))} className={inputCls} />
          </label>
          <label className={`${labelCls} sm:col-span-2`}>Terms (optional)
            <textarea value={fields.terms} onChange={(e) => setFields((f) => ({ ...f, terms: e.target.value }))} rows={2} className={inputCls} />
          </label>
          <label className={`${labelCls} sm:col-span-2`}>Document link (optional)
            <input value={fields.documentUrl} onChange={(e) => setFields((f) => ({ ...f, documentUrl: e.target.value }))} className={inputCls} />
          </label>
          {error && <div className="text-sm text-red-700 sm:col-span-2">{error}</div>}
          <button onClick={submit} disabled={pending} className={`${btnPrimary} sm:col-span-2 w-fit`}>{pending ? "Saving…" : "Save Contract"}</button>
        </div>
      )}
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {contracts.length === 0 ? <p className="text-sm text-slate-400 p-4">No contracts on file.</p> : contracts.map((c) => (
          <div key={c.id} className="p-4 text-sm">
            <div className="flex justify-between"><span className="font-medium text-ink capitalize">{c.contract_type.replace("_", " ")}</span><span className="text-xs text-slate-400 capitalize">{c.status}</span></div>
            <div className="text-xs text-slate-400 mt-0.5">{fmtDate(c.start_date)} – {c.end_date ? fmtDate(c.end_date) : "ongoing"}{c.salary_amount ? ` · ${fmt(c.salary_amount)}` : ""}</div>
            {c.terms && <p className="text-xs text-slate-500 mt-1">{c.terms}</p>}
            {c.document_url && <a href={c.document_url} target="_blank" rel="noopener noreferrer" className="text-xs text-royal hover:underline">View document →</a>}
          </div>
        ))}
      </div>
    </div>
  );
}

function DocumentsTab({ employeeId, documents }) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [fields, setFields] = useState({ title: "", documentType: "other", url: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    if (!fields.title.trim()) { setError("Title is required."); return; }
    setPending(true); setError(null);
    try {
      const res = await addDocument(employeeId, fields);
      if (res.error) setError(res.error);
      else { setShow(false); router.refresh(); }
    } finally { setPending(false); }
  }

  return (
    <div className="space-y-3">
      <button onClick={() => setShow((v) => !v)} className="text-xs text-royal hover:underline">{show ? "Cancel" : "+ Add Document"}</button>
      {show && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 grid sm:grid-cols-2 gap-3">
          <label className={labelCls}>Title
            <input value={fields.title} onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))} className={inputCls} />
          </label>
          <label className={labelCls}>Type
            <select value={fields.documentType} onChange={(e) => setFields((f) => ({ ...f, documentType: e.target.value }))} className={inputCls}>
              {["cnic", "certificate", "contract", "resume", "offer_letter", "other"].map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
            </select>
          </label>
          <label className={`${labelCls} sm:col-span-2`}>Link
            <input value={fields.url} onChange={(e) => setFields((f) => ({ ...f, url: e.target.value }))} className={inputCls} />
          </label>
          {error && <div className="text-sm text-red-700 sm:col-span-2">{error}</div>}
          <button onClick={submit} disabled={pending} className={`${btnPrimary} sm:col-span-2 w-fit`}>{pending ? "Saving…" : "Save"}</button>
        </div>
      )}
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {documents.length === 0 ? <p className="text-sm text-slate-400 p-4">No documents on file.</p> : documents.map((d) => (
          <div key={d.id} className="p-4 text-sm flex justify-between items-center">
            <div><span className="font-medium text-ink">{d.title}</span><span className="text-xs text-slate-400 ml-2 capitalize">{d.document_type.replace("_", " ")}</span></div>
            {d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-xs text-royal hover:underline">Open →</a>}
          </div>
        ))}
      </div>
    </div>
  );
}

const LEAVE_STATUS_STYLE = { pending: "bg-amber-50 text-amber-700", approved: "bg-sage-tint text-sage", rejected: "bg-brick-tint text-brick", cancelled: "bg-slate-100 text-slate-500" };

function LeaveTab({ employeeId, requests, leaveTypes }) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [fields, setFields] = useState({ leaveTypeId: "", dateFrom: "", dateTo: "", reason: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    if (!fields.dateFrom || !fields.dateTo) { setError("Choose a date range."); return; }
    setPending(true); setError(null);
    try {
      const res = await applyLeave(employeeId, fields.leaveTypeId || null, fields.dateFrom, fields.dateTo, fields.reason);
      if (res.error) setError(res.error);
      else { setShow(false); router.refresh(); }
    } finally { setPending(false); }
  }

  async function decide(id, status) {
    await decideLeave(id, status, null);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <button onClick={() => setShow((v) => !v)} className="text-xs text-royal hover:underline">{show ? "Cancel" : "+ Log Leave Request"}</button>
      {show && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 grid sm:grid-cols-2 gap-3">
          <label className={labelCls}>Type
            <select value={fields.leaveTypeId} onChange={(e) => setFields((f) => ({ ...f, leaveTypeId: e.target.value }))} className={inputCls}>
              <option value="">—</option>
              {leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <div />
          <label className={labelCls}>From
            <input type="date" value={fields.dateFrom} onChange={(e) => setFields((f) => ({ ...f, dateFrom: e.target.value }))} className={inputCls} />
          </label>
          <label className={labelCls}>To
            <input type="date" value={fields.dateTo} onChange={(e) => setFields((f) => ({ ...f, dateTo: e.target.value }))} className={inputCls} />
          </label>
          <label className={`${labelCls} sm:col-span-2`}>Reason (optional)
            <textarea value={fields.reason} onChange={(e) => setFields((f) => ({ ...f, reason: e.target.value }))} rows={2} className={inputCls} />
          </label>
          {error && <div className="text-sm text-red-700 sm:col-span-2">{error}</div>}
          <button onClick={submit} disabled={pending} className={`${btnPrimary} sm:col-span-2 w-fit`}>{pending ? "Saving…" : "Submit"}</button>
        </div>
      )}
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {requests.length === 0 ? <p className="text-sm text-slate-400 p-4">No leave requests yet.</p> : requests.map((r) => (
          <div key={r.id} className="p-4">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-ink">{r.leave_type?.name || "Leave"} — {fmtDate(r.date_from)} to {fmtDate(r.date_to)} ({r.days_count}d)</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${LEAVE_STATUS_STYLE[r.status]}`}>{r.status}</span>
            </div>
            {r.reason && <p className="text-xs text-slate-500 mt-1">{r.reason}</p>}
            {r.status === "pending" && (
              <div className="flex gap-2 mt-2">
                <button onClick={() => decide(r.id, "approved")} className="text-xs bg-sage text-white px-3 py-1 rounded-lg">Approve</button>
                <button onClick={() => decide(r.id, "rejected")} className="text-xs border border-slate-300 px-3 py-1 rounded-lg">Reject</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const ATT_STATUS_STYLE = { present: "bg-sage-tint text-sage", late: "bg-amber-50 text-amber-700", absent: "bg-brick-tint text-brick", leave: "bg-soft-blue text-royal" };

function AttendanceTab({ employee, attendance }) {
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState("present");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function mark() {
    setPending(true); setError(null);
    try {
      const res = employee.teacher_id
        ? await markTeacherAttendance(employee.teacher_id, date, status, null, null)
        : await markEmployeeAttendance(employee.id, date, status, null, null);
      if (res.error) setError(res.error);
      else router.refresh();
    } finally { setPending(false); }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        {employee.teacher_id ? "Reads/writes teacher_attendance — the same record Payroll's attendance-based deductions use." : "This employee has no linked teacher record, so this tracks HR attendance only; it doesn't feed any payroll calculation (this app's payroll only processes teaching staff today)."}
      </p>
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <label className={labelCls}>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></label>
        <label className={labelCls}>Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
            {["present", "absent", "late", "leave"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button onClick={mark} disabled={pending} className={btnPrimary}>{pending ? "Saving…" : "Mark"}</button>
      </div>
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {attendance.length === 0 ? <p className="text-sm text-slate-400 p-4">No attendance recorded yet.</p> : attendance.map((a) => (
          <div key={a.date} className="p-3 flex justify-between items-center text-sm">
            <span>{fmtDate(a.date)}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${ATT_STATUS_STYLE[a.status]}`}>{a.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PerformanceTab({ employeeId, reviews }) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [fields, setFields] = useState({ reviewPeriod: "", rating: "", strengths: "", areasForImprovement: "", goals: "", status: "draft" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    if (!fields.reviewPeriod.trim()) { setError("Review period is required (e.g. \"2026 Q3\")."); return; }
    setPending(true); setError(null);
    try {
      const res = await addPerformanceReview(employeeId, fields);
      if (res.error) setError(res.error);
      else { setShow(false); router.refresh(); }
    } finally { setPending(false); }
  }

  return (
    <div className="space-y-3">
      <button onClick={() => setShow((v) => !v)} className="text-xs text-royal hover:underline">{show ? "Cancel" : "+ Add Review"}</button>
      {show && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 grid sm:grid-cols-2 gap-3">
          <label className={labelCls}>Review Period<input value={fields.reviewPeriod} onChange={(e) => setFields((f) => ({ ...f, reviewPeriod: e.target.value }))} placeholder="e.g. 2026 Q3" className={inputCls} /></label>
          <label className={labelCls}>Rating (optional, out of 5)<input type="number" step="0.1" value={fields.rating} onChange={(e) => setFields((f) => ({ ...f, rating: e.target.value }))} className={inputCls} /></label>
          <label className={`${labelCls} sm:col-span-2`}>Strengths<textarea value={fields.strengths} onChange={(e) => setFields((f) => ({ ...f, strengths: e.target.value }))} rows={2} className={inputCls} /></label>
          <label className={`${labelCls} sm:col-span-2`}>Areas for Improvement<textarea value={fields.areasForImprovement} onChange={(e) => setFields((f) => ({ ...f, areasForImprovement: e.target.value }))} rows={2} className={inputCls} /></label>
          <label className={`${labelCls} sm:col-span-2`}>Goals<textarea value={fields.goals} onChange={(e) => setFields((f) => ({ ...f, goals: e.target.value }))} rows={2} className={inputCls} /></label>
          <label className={labelCls}>Status
            <select value={fields.status} onChange={(e) => setFields((f) => ({ ...f, status: e.target.value }))} className={inputCls}>
              <option value="draft">Draft</option><option value="finalized">Finalized</option>
            </select>
          </label>
          {error && <div className="text-sm text-red-700 sm:col-span-2">{error}</div>}
          <button onClick={submit} disabled={pending} className={`${btnPrimary} sm:col-span-2 w-fit`}>{pending ? "Saving…" : "Save Review"}</button>
        </div>
      )}
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {reviews.length === 0 ? <p className="text-sm text-slate-400 p-4">No reviews yet.</p> : reviews.map((r) => (
          <div key={r.id} className="p-4">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-ink">{r.review_period}{r.rating ? ` — ${r.rating}/5` : ""}</span>
              <span className="text-xs text-slate-400 capitalize">{r.status}</span>
            </div>
            {r.strengths && <p className="text-xs text-slate-500 mt-1"><span className="font-medium">Strengths:</span> {r.strengths}</p>}
            {r.areas_for_improvement && <p className="text-xs text-slate-500 mt-1"><span className="font-medium">To improve:</span> {r.areas_for_improvement}</p>}
            {r.goals && <p className="text-xs text-slate-500 mt-1"><span className="font-medium">Goals:</span> {r.goals}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function TrainingTab({ employeeId, participants, trainings }) {
  const router = useRouter();
  const [newTitle, setNewTitle] = useState("");
  const [enrollId, setEnrollId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function createAndEnroll() {
    if (!newTitle.trim()) return;
    setPending(true); setError(null);
    try {
      const res = await createTraining({ title: newTitle });
      if (res.error) { setError(res.error); return; }
      const enrollRes = await enrollInTraining(res.id, employeeId);
      if (enrollRes.error) setError(enrollRes.error);
      else { setNewTitle(""); router.refresh(); }
    } finally { setPending(false); }
  }

  async function enrollExisting() {
    if (!enrollId) return;
    setPending(true); setError(null);
    try {
      const res = await enrollInTraining(enrollId, employeeId);
      if (res.error) setError(res.error);
      else { setEnrollId(""); router.refresh(); }
    } finally { setPending(false); }
  }

  async function updateStatus(participantId, status) {
    await setTrainingCompletion(participantId, status);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <label className={labelCls}>Enroll in existing training
          <select value={enrollId} onChange={(e) => setEnrollId(e.target.value)} className={inputCls}>
            <option value="">Choose…</option>
            {trainings.map((t) => <option key={t.id} value={t.id}>{t.title}{t.training_date ? ` (${fmtDate(t.training_date)})` : ""}</option>)}
          </select>
        </label>
        <button onClick={enrollExisting} disabled={pending || !enrollId} className={btnSecondary}>Enroll</button>
        <span className="text-xs text-slate-400">or</span>
        <label className={labelCls}>New training title<input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className={inputCls} /></label>
        <button onClick={createAndEnroll} disabled={pending || !newTitle.trim()} className={btnPrimary}>Create &amp; Enroll</button>
      </div>
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {participants.length === 0 ? <p className="text-sm text-slate-400 p-4">No training records yet.</p> : participants.map((p) => (
          <div key={p.id} className="p-4 flex justify-between items-center">
            <div>
              <span className="text-sm font-medium text-ink">{p.training?.title}</span>
              {p.training?.training_date && <span className="text-xs text-slate-400 ml-2">{fmtDate(p.training.training_date)}</span>}
            </div>
            <select value={p.completion_status} onChange={(e) => updateStatus(p.id, e.target.value)} className="text-xs border border-slate-300 rounded-lg px-2 py-1">
              {["enrolled", "completed", "no_show"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

function SalaryHistoryTab({ salaryHistory }) {
  if (salaryHistory.type === "payroll") {
    return (
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        <p className="text-xs text-slate-400 p-4 pb-0">From Payroll — the actual processed salary records, unchanged by HR.</p>
        {salaryHistory.rows.length === 0 ? <p className="text-sm text-slate-400 p-4">No payroll history yet.</p> : salaryHistory.rows.map((r) => (
          <div key={r.month} className="p-4 flex justify-between items-center text-sm">
            <span>{new Date(r.month).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
            <span className="font-mono">{fmt(r.gross_salary)}{r.locked ? " · Locked" : ""}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-xs text-slate-400 mb-3">This employee has no linked teacher record, so there's no Payroll history — this app's payroll only processes teaching staff today. Figures below are informational, from their contracts.</p>
      {salaryHistory.rows.length === 0 ? <p className="text-sm text-slate-400">No contract salary figures on file.</p> : salaryHistory.rows.map((c) => (
        <div key={c.id} className="text-sm flex justify-between py-1"><span className="capitalize">{c.contract_type.replace("_", " ")} ({fmtDate(c.start_date)})</span><span className="font-mono">{fmt(c.salary_amount)}</span></div>
      ))}
    </div>
  );
}

function ExitTab({ employeeId, exit, isExited }) {
  const router = useRouter();
  const [fields, setFields] = useState({ exitType: "resignation", lastWorkingDate: "", reason: "", noticeDate: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    if (!fields.lastWorkingDate) { setError("Last working date is required."); return; }
    setPending(true); setError(null);
    try {
      const res = await offboardEmployee(employeeId, fields.exitType, fields.lastWorkingDate, fields.reason, fields.noticeDate || null);
      if (res.error) setError(res.error);
      else router.refresh();
    } finally { setPending(false); }
  }

  if (isExited && exit) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4 text-sm space-y-1">
        <div><span className="text-slate-400">Type:</span> <span className="capitalize text-ink">{exit.exit_type.replace("_", " ")}</span></div>
        <div><span className="text-slate-400">Last working date:</span> <span className="text-ink">{fmtDate(exit.last_working_date)}</span></div>
        {exit.notice_date && <div><span className="text-slate-400">Notice date:</span> <span className="text-ink">{fmtDate(exit.notice_date)}</span></div>}
        {exit.reason && <div><span className="text-slate-400">Reason:</span> <span className="text-ink">{exit.reason}</span></div>}
        <div><span className="text-slate-400">Clearance:</span> <span className="text-ink capitalize">{exit.clearance_status}</span></div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-amber-200 bg-amber-50 rounded-xl p-4">
      <p className="text-xs text-amber-800 mb-3">This marks the employee exited and, if they're linked to a teacher record, sets that record inactive too. Payroll history is never touched.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className={labelCls}>Exit Type
          <select value={fields.exitType} onChange={(e) => setFields((f) => ({ ...f, exitType: e.target.value }))} className={inputCls}>
            {["resignation", "termination", "end_of_contract", "retirement", "other"].map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
          </select>
        </label>
        <label className={labelCls}>Last Working Date<input type="date" value={fields.lastWorkingDate} onChange={(e) => setFields((f) => ({ ...f, lastWorkingDate: e.target.value }))} className={inputCls} /></label>
        <label className={labelCls}>Notice Date (optional)<input type="date" value={fields.noticeDate} onChange={(e) => setFields((f) => ({ ...f, noticeDate: e.target.value }))} className={inputCls} /></label>
        <label className={`${labelCls} sm:col-span-2`}>Reason<textarea value={fields.reason} onChange={(e) => setFields((f) => ({ ...f, reason: e.target.value }))} rows={2} className={inputCls} /></label>
      </div>
      {error && <div className="text-sm text-red-700 mt-2">{error}</div>}
      <button onClick={submit} disabled={pending} className={`${btnSecondary} mt-3 border-brick text-brick hover:bg-brick/10`}>{pending ? "Saving…" : "Offboard Employee"}</button>
    </div>
  );
}
