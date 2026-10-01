"use client";

export default function DateJumpInput({ date }) {
  return (
    <form method="GET" className="inline">
      <input
        type="date"
        name="date"
        defaultValue={date}
        onChange={(e) => e.target.form.requestSubmit()}
        className="border border-slate-300 rounded-lg px-2.5 py-1.5"
      />
    </form>
  );
}
