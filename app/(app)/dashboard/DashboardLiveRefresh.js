"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Auto-refreshes the dashboard periodically instead of requiring a manual
// page reload, so figures stay reasonably current even outside the push
// path below.
//
// Phase 28 added components/RealtimeSync.js, mounted app-wide in
// AppShell.js, which now pushes a router.refresh() the moment a payment,
// fee update, attendance entry, inventory movement, or notification
// happens anywhere at this institute — that's the primary mechanism this
// page relies on now. This interval is what's left over: a slow safety net
// for the gap between "tab was in the background/socket briefly dropped"
// and Supabase Realtime's own reconnect, not the main refresh path it used
// to be. That's also why the interval widened from 30s to 2 minutes —
// RealtimeSync already covers the "seconds matter" case.
//
// The concern that held Realtime back in the first place (does the
// broadcast payload actually respect RLS, unverified against this
// project's own instance) is resolved and documented at the top of
// supabase/migrations/0058_realtime_sync.sql, not just assumed away here.
//
// Pauses while the tab isn't visible/focused, so it isn't silently
// burning requests in a background tab all day.
export default function DashboardLiveRefresh({ intervalSeconds = 120 }) {
  const router = useRouter();
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const intervalRef = useRef(null);

  useEffect(() => {
    function tick() {
      if (document.visibilityState === "visible") {
        router.refresh();
        setLastRefreshed(new Date());
      }
    }
    intervalRef.current = setInterval(tick, intervalSeconds * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, intervalSeconds]);

  return (
    <p className="text-xs text-slate-400 mt-2">
      Auto-refreshing every {intervalSeconds}s — last updated {lastRefreshed.toLocaleTimeString()}
    </p>
  );
}
