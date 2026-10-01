"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { addRoom, addPeriod, toggleAcademicDay, setSubjectFrequency } from "../actions";

function Section({ title, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 mt-6">
      <div className="text-sm font-semibold text-ink mb-3">{title}</div>
      {children}
    </div>
  );
}

export default function SetupForms({ rooms, periods, activeDayMap, dayNames, classes, subjects, frequencies }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const roomFormRef = useRef(null);
  const periodFormRef = useRef(null);
  const freqFormRef = useRef(null);

  const run = async (fn, formRef) => {
    setPending(true);
    setError("");
    const res = await fn();
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    formRef?.current?.reset();
    router.refresh();
  };

  return (
    <div>
      {error && <p className="text-sm text-brick mt-4">{error}</p>}

      <Section title="Academic Days">
        <div className="flex flex-wrap gap-2">
          {dayNames.map((name, i) => {
            const active = activeDayMap[i] ?? (i >= 1 && i <= 5);
            return (
              <button
                key={i}
                disabled={pending}
                onClick={() => run(() => toggleAcademicDay(i, !active))}
                className={`text-xs px-3 py-1.5 rounded-full border ${active ? "bg-royal text-white border-royal" : "border-slate-300 text-slate-500"}`}
              >
                {name}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Periods">
        <div className="space-y-1 mb-3">
          {periods.map((p) => (
            <div key={p.id} className="text-sm flex justify-between border-t border-slate-100 pt-1 first:border-t-0 first:pt-0">
              <span>{p.name}{p.is_break && <span className="text-xs text-slate-400 ml-1">(break)</span>}</span>
              <span className="text-slate-500">{p.start_time?.slice(0, 5)} – {p.end_time?.slice(0, 5)}</span>
            </div>
          ))}
          {periods.length === 0 && <p className="text-sm text-slate-400">No periods set up yet.</p>}
        </div>
        <form ref={periodFormRef} action={(fd) => run(() => addPeriod(fd), periodFormRef)} className="flex flex-wrap items-end gap-2">
          <input name="name" placeholder="Period 1" required className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-28" />
          <input name="start_time" type="time" required className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input name="end_time" type="time" required className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <label className="text-xs flex items-center gap-1"><input type="checkbox" name="is_break" /> Break</label>
          <button type="submit" disabled={pending} className="text-sm px-3 py-2 rounded-lg bg-royal text-white">Add</button>
        </form>
      </Section>

      <Section title="Rooms">
        <div className="space-y-1 mb-3">
          {rooms.map((r) => (
            <div key={r.id} className="text-sm flex justify-between border-t border-slate-100 pt-1 first:border-t-0 first:pt-0">
              <span>{r.name}</span>
              <span className="text-slate-500">{r.room_type || "—"}{r.capacity ? ` · ${r.capacity} seats` : ""}</span>
            </div>
          ))}
          {rooms.length === 0 && <p className="text-sm text-slate-400">No rooms set up yet.</p>}
        </div>
        <form ref={roomFormRef} action={(fd) => run(() => addRoom(fd), roomFormRef)} className="flex flex-wrap items-end gap-2">
          <input name="name" placeholder="Room 101" required className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-32" />
          <input name="room_type" placeholder="Classroom / Lab" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input name="capacity" type="number" placeholder="Capacity" className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-24" />
          <button type="submit" disabled={pending} className="text-sm px-3 py-2 rounded-lg bg-royal text-white">Add</button>
        </form>
      </Section>

      <Section title="Subject Frequency (periods/week per class)">
        <div className="space-y-1 mb-3">
          {frequencies.map((f) => (
            <div key={f.id} className="text-sm flex justify-between border-t border-slate-100 pt-1 first:border-t-0 first:pt-0">
              <span>{f.class?.name} — {f.subject?.name}</span>
              <span className="text-slate-500">{f.periods_per_week}/week, max {f.max_per_day}/day</span>
            </div>
          ))}
          {frequencies.length === 0 && <p className="text-sm text-slate-400">Not configured yet — the generator needs this to know what to schedule.</p>}
        </div>
        <form ref={freqFormRef} action={(fd) => run(() => setSubjectFrequency(fd), freqFormRef)} className="flex flex-wrap items-end gap-2">
          <select name="class_id" required className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">Class…</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select name="subject_id" required className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">Subject…</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input name="periods_per_week" type="number" min="1" placeholder="Per week" required className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-24" />
          <input name="max_per_day" type="number" min="1" defaultValue={1} placeholder="Max/day" className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-24" />
          <button type="submit" disabled={pending} className="text-sm px-3 py-2 rounded-lg bg-royal text-white">Save</button>
        </form>
      </Section>
    </div>
  );
}
