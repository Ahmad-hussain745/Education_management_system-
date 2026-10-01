"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Same tiny inline icons as app/login/LoginForm.js — kept local rather than
// shared, matching how that file already does it ("no icon library
// dependency, kept tiny and purposeful").
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

// Reached only via the link in a Supabase "reset your password" email.
// resetPasswordForEmail() (see app/login/ForgotPasswordForm.js) points that
// link at /auth/callback?next=/auth/reset-password, and the callback route
// exchanges the one-time code for a real session BEFORE redirecting here —
// so by the time this page renders, either:
//   - a valid (recovery) session already exists → show the new-password form
//   - the link was invalid, already used, or expired → no session, and we
//     say so rather than showing a form that would just fail on submit
//
// This is Supabase Auth's own reset mechanism end to end (resetPasswordForEmail
// → exchangeCodeForSession → updateUser) — nothing here stores, checks, or
// compares a password itself.
export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setHasSession(!!data.user);
      setChecking(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }

    // Sign out of the one-time recovery session and send them to a normal
    // sign-in with the new password — same "prove it once, cleanly" reasoning
    // as the rest of the auth flow, rather than silently carrying a session
    // over from the email link.
    await supabase.auth.signOut();
    router.push("/login?reset=1");
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
            <h1 className="text-lg font-semibold text-white mt-1">Reset Your Password</h1>
          </div>

          <div className="p-8 pt-6">
            {checking ? (
              <p className="text-sm text-slate-400 text-center py-4">Checking the link…</p>
            ) : !hasSession ? (
              <>
                <div className="flex gap-2 text-sm rounded-lg px-3 py-2.5 border bg-red-50 border-red-200 text-red-800">
                  <AlertIcon />
                  <span>This password reset link is invalid or has expired. Request a new one from the login page.</span>
                </div>
                <a
                  href="/login"
                  className="block w-full mt-4 text-center text-sm px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
                >
                  Back to Sign In
                </a>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-500 text-center mb-6">Choose a new password for the account.</p>
                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  <div>
                    <label htmlFor="new-password" className="block text-xs font-medium text-slate-600 mb-1">New Password</label>
                    <div className="relative">
                      <input
                        id="new-password"
                        type={showPassword ? "text" : "password"}
                        required
                        autoFocus
                        autoComplete="new-password"
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

                  <div>
                    <label htmlFor="confirm-password" className="block text-xs font-medium text-slate-600 mb-1">Confirm Password</label>
                    <input
                      id="confirm-password"
                      type={showPassword ? "text" : "password"}
                      required
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-soft-blue focus:border-royal transition"
                      placeholder="••••••••"
                    />
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
                    {loading ? "Updating…" : "Reset Password"}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
