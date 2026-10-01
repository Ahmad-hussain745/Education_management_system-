"use client";

import { useOnline } from "@/lib/offline/useOnline";
import { ONLINE_REQUIRED_MESSAGE } from "@/lib/offline/online-required";

// Wraps a single ONLINE-REQUIRED control (a form, a button, a select).
// While offline: visually disables it (dimmed, inert to clicks/taps/
// keyboard) and shows the required message right next to it — instead of
// letting the person fill it in and only find out it doesn't work when the
// request fails.
//
// This is a UI courtesy, not the enforcement layer: every action wrapped
// with this ALSO checks useOnline()/isOnline() itself before calling its
// server action (see ReverseButton.js, CloseMonthForm.js, etc.) — because
// connectivity can flip between render and click, and because a disabled
// wrapper with a stale prop is not something to depend on for correctness.
export default function OnlineRequiredGate({ children, className = "" }) {
  const online = useOnline();

  if (online) return children;

  return (
    <div className={className}>
      <div className="opacity-50 pointer-events-none select-none" aria-disabled="true" inert="">
        {children}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
        <span aria-hidden="true">🔒</span> {ONLINE_REQUIRED_MESSAGE}
      </p>
    </div>
  );
}
