"use client";

import { useState } from "react";
import Link from "next/link";
import { registerAccount } from "./actions";

function ShieldMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2l7 3v6c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V5l7-3z" fill="white" fillOpacity="0.16" stroke="white" strokeWidth="1.4" />
      <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 mt-0.5">
      <circle cx="12" cy="12" r="9" stroke="#B91C1C" strokeWidth="1.6" />
      <path d="M12 8v5" stroke="#B91C1C" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="15.5" r="0.9" fill="#B91C1C" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#DCFCE7" />
      <path d="M8 12.5l2.5 2.5L16 9.5" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function EyeIcon({ open }) {
  return open ? (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" stroke="#64748B" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3" stroke="#64748B" strokeWidth="1.5" />
    </svg>
  ) : (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 3l18 18M10.6 10.7a3 3 0 004 4M6.5 6.7C4 8.3 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.7-1.2M9.5 5.2A10.8 10.8 0 0112 5c6.5 0 10 7 10 7a15 15 0 01-3 3.9"
        stroke="#64748B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RegisterForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const formData = new FormData();
    formData.set("name", name);
    formData.set("email", email);
    formData.set("password", password);
    const res = await registerAccount(formData);
    setLoading(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
          <div className="mx-auto mb-4"><CheckIcon /></div>
          <div className="text-lg font-semibold text-ink mb-2">Request submitted</div>
          <p className="text-sm text-slate-500">
            Your account has been created but isn't active yet — a Super Admin needs to review your
            request and assign you a role before you can sign in.
          </p>
          <Link href="/login" className="inline-block mt-6 text-sm text-royal hover:underline">← Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-ink px-8 pt-7 pb-6 text-center">
            <div className="w-11 h-11 rounded-full bg-royal flex items-center justify-center mx-auto mb-3">
              <ShieldMark />
            </div>
            <div className="text-[11px] font-semibold tracking-widest uppercase text-blue-300">MSA FinanceOS</div>
            <h1 className="text-lg font-semibold text-white mt-1">Request an Account</h1>
          </div>

          <div className="p-8 pt-6">
            <p className="text-sm text-slate-500 text-center mb-6">
              Submits a request — a Super Admin still assigns your role before you can sign in.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label htmlFor="name" className="block text-xs font-medium text-slate-600 mb-1">Name</label>
                <input
                  id="name"
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-soft-blue focus:border-royal transition"
                  placeholder="Your full name"
                />
              </div>
              <div>
                <label htmlFor="reg-email" className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                <input
                  id="reg-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@academy.edu"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-soft-blue focus:border-royal transition"
                />
              </div>
              <div>
                <label htmlFor="reg-password" className="block text-xs font-medium text-slate-600 mb-1">Password</label>
                <div className="relative">
                  <input
                    id="reg-password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-soft-blue focus:border-royal transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    <EyeIcon open={showPassword} />
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex gap-2 text-sm rounded-lg px-3 py-2.5 border bg-red-50 border-red-200 text-red-800">
                  <AlertIcon />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-royal hover:bg-royal-dark text-white text-sm font-medium rounded-lg py-2.5 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-royal"
              >
                {loading ? "Submitting…" : "Request Account"}
              </button>
            </form>
          </div>
        </div>

        <p className="text-xs text-slate-400 text-center mt-5">
          Already have an account? <Link href="/login" className="text-royal hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
