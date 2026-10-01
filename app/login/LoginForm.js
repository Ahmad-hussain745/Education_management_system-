"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ForgotPasswordForm from "./ForgotPasswordForm";

// Small inline icons — no icon library dependency, kept tiny and purposeful.
function ShieldMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2l7 3v6c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V5l7-3z" fill="white" fillOpacity="0.16" stroke="white" strokeWidth="1.4" />
      <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function AlertIcon({ tone }) {
  const color = tone === "amber" ? "#B45309" : "#B91C1C";
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 mt-0.5">
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.6" />
      <path d="M12 8v5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="15.5" r="0.9" fill={color} />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 mt-0.5">
      <circle cx="12" cy="12" r="9" stroke="#166534" strokeWidth="1.6" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" stroke="#166534" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
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

// One place for the three "you were redirected here" states — distinct tone
// and wording for each, since they mean very different things: pending is
// a normal, temporary waiting state; deactivated is a hard stop; reset is
// a plain confirmation that the password-reset flow just succeeded.
function StatusBanner({ kind }) {
  if (!kind) return null;
  if (kind === "reset") {
    return (
      <div className="flex gap-2 text-sm rounded-lg px-3 py-2.5 border bg-green-50 border-green-200 text-green-800">
        <CheckIcon />
        <span>Your password has been reset. Sign in with your new password.</span>
      </div>
    );
  }
  if (kind === "unlinked") {
    return (
      <div className="flex gap-2 text-sm rounded-lg px-3 py-2.5 border bg-red-50 border-red-200 text-red-800">
        <AlertIcon tone="red" />
        <span>
          Your password is correct, but no account record is linked to this login yet — this usually means the
          initial Super Admin setup step wasn't completed. Contact whoever set up this system's Supabase project.
        </span>
      </div>
    );
  }
  const isPending = kind === "pending";
  return (
    <div
      className={
        "flex gap-2 text-sm rounded-lg px-3 py-2.5 border " +
        (isPending ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-red-50 border-red-200 text-red-800")
      }
    >
      <AlertIcon tone={isPending ? "amber" : "red"} />
      <span>
        {isPending
          ? "Your account is awaiting approval from a Super Admin. Try again once it's been activated."
          : "This account has been deactivated. Contact your administrator."}
      </span>
    </div>
  );
}

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [mode, setMode] = useState("signin"); // "signin" | "forgot"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [redirectStatus, setRedirectStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (searchParams.get("pending")) setRedirectStatus("pending");
    else if (searchParams.get("deactivated")) setRedirectStatus("deactivated");
    else if (searchParams.get("unlinked")) setRedirectStatus("unlinked");
    else if (searchParams.get("reset")) setRedirectStatus("reset");
  }, [searchParams]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setRedirectStatus(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-ink px-8 pt-7 pb-6 text-center">
            <div className="w-11 h-11 rounded-full bg-royal flex items-center justify-center mx-auto mb-3">
              <ShieldMark />
            </div>
            <div className="text-[11px] font-semibold tracking-widest uppercase text-blue-300">MSA FinanceOS</div>
            <h1 className="text-lg font-semibold text-white mt-1">Modern Science Academy</h1>
          </div>

          {mode === "forgot" ? (
            <ForgotPasswordForm onBackToLogin={() => setMode("signin")} />
          ) : (
            <div className="p-8 pt-6">
              <p className="text-sm text-slate-500 text-center mb-6">Sign in to your account</p>

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div>
                  <label htmlFor="email" className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                  <input
                    id="email"
                    type="email"
                    required
                    autoFocus
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-soft-blue focus:border-royal transition"
                    placeholder="you@academy.edu"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="password" className="block text-xs font-medium text-slate-600">Password</label>
                    <button
                      type="button"
                      onClick={() => setMode("forgot")}
                      className="text-xs text-royal hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-soft-blue focus:border-royal transition"
                      placeholder="••••••••"
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

                <StatusBanner kind={redirectStatus} />
                {error && (
                  <div className="flex gap-2 text-sm rounded-lg px-3 py-2.5 border bg-red-50 border-red-200 text-red-800">
                    <AlertIcon tone="red" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-royal hover:bg-royal-dark text-white text-sm font-medium rounded-lg py-2.5 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-royal"
                >
                  {loading ? "Signing in…" : "Sign In"}
                </button>
              </form>
            </div>
          )}
        </div>

        {mode === "signin" && (
          <>
            <p className="text-xs text-slate-400 text-center mt-5">
              Don't have an account? <Link href="/register" className="text-royal hover:underline">Request one</Link> — a
              Super Admin still assigns your role before you can sign in.
            </p>
            <p className="text-xs text-slate-400 text-center mt-2">
              New institute? <Link href="/register-institute" className="text-royal hover:underline">Set up your own workspace</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
