"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 mt-0.5">
      <circle cx="12" cy="12" r="9" stroke="#166534" strokeWidth="1.6" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" stroke="#166534" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
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

// Step 1 of Supabase Auth's own password-reset flow — no separate password
// mechanism of ours involved. resetPasswordForEmail() emails a one-time
// link that lands on /auth/callback?next=/auth/reset-password, which
// exchanges it for a real session before handing off to the Reset
// Password page.
//
// Deliberately does not reveal whether the address is a real account:
// Supabase resolves this call the same way whether or not the email is
// registered, and the confirmation message below is worded to match, so
// this can't be used to enumerate who has an account here.
export default function ForgotPasswordForm({ onBackToLogin }) {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <div className="p-8 pt-6">
        <div className="flex gap-2 text-sm rounded-lg px-3 py-2.5 border bg-green-50 border-green-200 text-green-800">
          <CheckIcon />
          <span>If an account exists for <strong>{email}</strong>, we've sent a link to reset the password. Check the inbox (and spam folder).</span>
        </div>
        <button
          type="button"
          onClick={onBackToLogin}
          className="w-full mt-4 text-sm px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
        >
          Back to Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 pt-6">
      <p className="text-sm text-slate-500 text-center mb-6">
        Enter the account email and we'll send a link to reset the password.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="forgot-email" className="block text-xs font-medium text-slate-600 mb-1">Email</label>
          <input
            id="forgot-email"
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
          {loading ? "Sending…" : "Send Reset Link"}
        </button>

        <button type="button" onClick={onBackToLogin} className="w-full text-sm text-slate-500 hover:text-ink py-1">
          ← Back to Sign In
        </button>
      </form>
    </div>
  );
}
