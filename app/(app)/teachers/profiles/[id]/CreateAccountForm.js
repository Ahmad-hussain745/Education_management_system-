"use client";

import { useState, useTransition } from "react";
import { createTeacherAccount } from "../actions";

export default function CreateAccountForm({ teacherId, defaultEmail }) {
  const [email, setEmail] = useState(defaultEmail || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await createTeacherAccount({ teacherId, email, password });
      if (res?.error) {
        setError(res.error);
        return;
      }
      setDone(true);
    });
  };

  if (done) {
    return <p className="text-sm text-sage">Account created and linked — refresh to see it below.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 max-w-sm">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Login Email</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="teacher@academy.edu" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Temporary Password</label>
        <input type="text" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder="At least 8 characters" />
        <p className="text-xs text-slate-400 mt-1">Share this with the teacher directly — there's no email invite flow yet, so hand it over securely.</p>
      </div>

      {error && <p className="text-sm text-brick">{error}</p>}

      <button type="submit" disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Creating…" : "Create Teacher Account"}
      </button>
    </form>
  );
}
