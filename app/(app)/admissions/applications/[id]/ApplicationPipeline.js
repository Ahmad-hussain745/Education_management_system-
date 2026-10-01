"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  scheduleInterview, scheduleTest, recordEventResult, addDocument,
  verifyDocument, decideApplication, enrollApplication,
} from "../../actions";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

function Section({ title, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 mt-4">
      <h2 className="text-sm font-semibold text-ink mb-3">{title}</h2>
      {children}
    </div>
  );
}

export default function ApplicationPipeline({ application, interviews, tests, documents, decisions, classes, sections, canDecide }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const run = async (fn, ...args) => {
    setPending(true);
    setError("");
    const res = await fn(...args);
    setPending(false);
    if (res?.error) setError(res.error);
    else router.refresh();
    return res;
  };

  const sectionsForClass = (classId) => sections.filter((s) => s.class_id === classId);
  const alreadyEnrolled = application.status === "enrolled";
  const canEnroll = canDecide && application.status === "approved";

  return (
    <div>
      {/* Interviews */}
      <Section title="Interviews">
        {interviews.map((i) => (
          <div key={i.id} className="border-b border-slate-50 pb-3 mb-3 last:border-0 last:pb-0 last:mb-0">
            <div className="flex justify-between text-sm">
              <span>{new Date(i.scheduled_at).toLocaleString()} · {i.mode.replace(/_/g, " ")}</span>
              <span className="capitalize text-xs text-slate-500">{i.status.replace(/_/g, " ")}</span>
            </div>
            {i.status === "scheduled" ? (
              <form action={(fd) => run(recordEventResult, "admission_interviews", i.id, application.id, fd)} className="flex flex-wrap items-end gap-2 mt-2">
                <select name="status" className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs">
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="no_show">No-show</option>
                </select>
                <input name="score" type="number" step="0.1" placeholder="Score" className="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-xs" />
                <input name="remarks" placeholder="Remarks" className="flex-1 min-w-[120px] border border-slate-300 rounded-lg px-2 py-1.5 text-xs" />
                <button type="submit" disabled={pending} className="text-xs px-3 py-1.5 rounded-lg bg-royal text-white">Save</button>
              </form>
            ) : (
              <div className="text-xs text-slate-500 mt-1">{i.score != null ? `Score: ${i.score} · ` : ""}{i.remarks}</div>
            )}
          </div>
        ))}
        <form action={(fd) => run(scheduleInterview, application.id, fd)} className="flex flex-wrap items-end gap-2 pt-2 border-t border-slate-100">
          <input name="scheduled_at" type="datetime-local" required className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs" />
          <select name="mode" className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs">
            <option value="in_person">In person</option>
            <option value="phone">Phone</option>
            <option value="video">Video</option>
          </select>
          <button type="submit" disabled={pending} className="text-xs px-3 py-1.5 rounded-lg border border-royal text-royal">Schedule Interview</button>
        </form>
      </Section>

      {/* Tests */}
      <Section title="Tests">
        {tests.map((t) => (
          <div key={t.id} className="border-b border-slate-50 pb-3 mb-3 last:border-0 last:pb-0 last:mb-0">
            <div className="flex justify-between text-sm">
              <span>{t.test_name} · {new Date(t.scheduled_at).toLocaleString()}</span>
              <span className="capitalize text-xs text-slate-500">{t.status.replace(/_/g, " ")}</span>
            </div>
            {t.status === "scheduled" ? (
              <form action={(fd) => run(recordEventResult, "admission_tests", t.id, application.id, fd)} className="flex flex-wrap items-end gap-2 mt-2">
                <select name="status" className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs">
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <input name="obtained_marks" type="number" step="0.1" placeholder={`Marks / ${t.max_marks}`} className="w-28 border border-slate-300 rounded-lg px-2 py-1.5 text-xs" />
                <input name="remarks" placeholder="Remarks" className="flex-1 min-w-[120px] border border-slate-300 rounded-lg px-2 py-1.5 text-xs" />
                <button type="submit" disabled={pending} className="text-xs px-3 py-1.5 rounded-lg bg-royal text-white">Save</button>
              </form>
            ) : (
              <div className="text-xs text-slate-500 mt-1">{t.obtained_marks != null ? `${t.obtained_marks} / ${t.max_marks} · ` : ""}{t.remarks}</div>
            )}
          </div>
        ))}
        <form action={(fd) => run(scheduleTest, application.id, fd)} className="flex flex-wrap items-end gap-2 pt-2 border-t border-slate-100">
          <input name="test_name" placeholder="Test name" defaultValue="Entrance Test" className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs" />
          <input name="scheduled_at" type="datetime-local" required className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs" />
          <input name="max_marks" type="number" defaultValue={100} className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-xs" />
          <button type="submit" disabled={pending} className="text-xs px-3 py-1.5 rounded-lg border border-royal text-royal">Schedule Test</button>
        </form>
      </Section>

      {/* Documents */}
      <Section title="Document Verification">
        {documents.map((d) => (
          <div key={d.id} className="flex items-center justify-between text-sm border-b border-slate-50 py-2 last:border-0">
            <span className="capitalize">{d.document_type.replace(/_/g, " ")}</span>
            <span className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                d.status === "verified" ? "bg-sage-tint text-sage" :
                d.status === "rejected" ? "bg-brick-tint text-brick" : "bg-amber-50 text-amber-700"
              }`}>
                {d.status}
              </span>
              {d.status !== "verified" && d.status !== "rejected" && (
                <>
                  <button disabled={pending} onClick={() => run(verifyDocument, d.id, application.id, true)} className="text-xs text-sage hover:underline">Verify</button>
                  <button disabled={pending} onClick={() => run(verifyDocument, d.id, application.id, false)} className="text-xs text-brick hover:underline">Reject</button>
                </>
              )}
            </span>
          </div>
        ))}
        <form action={(fd) => run(addDocument, application.id, fd)} className="flex flex-wrap items-end gap-2 pt-2 border-t border-slate-100 mt-2">
          <select name="document_type" required className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs">
            <option value="">Document type…</option>
            <option value="birth_certificate">Birth Certificate</option>
            <option value="previous_report_card">Previous Report Card</option>
            <option value="photo">Photograph</option>
            <option value="cnic_copy">Guardian CNIC Copy</option>
            <option value="other">Other</option>
          </select>
          <button type="submit" disabled={pending} className="text-xs px-3 py-1.5 rounded-lg border border-royal text-royal">Add Document</button>
        </form>
      </Section>

      {/* Decision */}
      <Section title="Admission Decision">
        {decisions.map((d) => (
          <div key={d.id} className="text-sm border-b border-slate-50 pb-2 mb-2 last:border-0">
            <span className={`font-medium capitalize ${d.decision === "approved" ? "text-sage" : d.decision === "rejected" ? "text-brick" : "text-slate-600"}`}>
              {d.decision}
            </span>
            {" · "}{new Date(d.decided_at).toLocaleDateString()}
            {d.offered_class && ` · offered ${d.offered_class.name}${d.offered_section ? ` (${d.offered_section.name})` : ""}`}
            {d.offered_fee_override != null && ` · fee ${fmt(d.offered_fee_override)}/mo`}
            {d.reason && <div className="text-xs text-slate-400">{d.reason}</div>}
          </div>
        ))}

        {!canDecide && (
          <p className="text-xs text-slate-400">Only a Principal or Super Admin can record a decision.</p>
        )}

        {canDecide && !alreadyEnrolled && (
          <DecisionForm application={application} classes={classes} sectionsForClass={sectionsForClass} pending={pending} run={run} />
        )}

        {canEnroll && (
          <button
            disabled={pending}
            onClick={() => run(enrollApplication, application.id)}
            className="mt-3 text-sm px-4 py-2 rounded-lg bg-sage text-white font-medium disabled:opacity-60"
          >
            {pending ? "Enrolling…" : "Enroll → Create Student"}
          </button>
        )}
      </Section>

      {error && <p className="mt-3 text-sm text-brick">{error}</p>}
    </div>
  );
}

function DecisionForm({ application, classes, sectionsForClass, pending, run }) {
  const [decision, setDecision] = useState("approved");
  const [offeredClass, setOfferedClass] = useState(application.applied_class_id || "");

  return (
    <form action={(fd) => run(decideApplication, application.id, fd)} className="pt-3 border-t border-slate-100 space-y-3">
      <div className="flex gap-3">
        {["approved", "waitlisted", "rejected"].map((d) => (
          <label key={d} className="flex items-center gap-1.5 text-sm">
            <input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} />
            <span className="capitalize">{d}</span>
          </label>
        ))}
      </div>

      {decision === "approved" && (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Offer Class</label>
            <select name="offered_class_id" value={offeredClass} onChange={(e) => setOfferedClass(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs">
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Offer Section</label>
            <select name="offered_section_id" className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs">
              <option value="">— any —</option>
              {sectionsForClass(offeredClass).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Fee Override (optional)</label>
            <input name="offered_fee_override" type="number" placeholder="Rs. / month" className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs" />
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Reason / Notes</label>
        <textarea name="reason" rows={2} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs" />
      </div>

      <button type="submit" disabled={pending} className="text-sm px-4 py-2 rounded-lg bg-royal text-white disabled:opacity-60">
        {pending ? "Saving…" : "Record Decision"}
      </button>
    </form>
  );
}
