"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { subscribeConnectivity } from "@/lib/offline/connectivity";
import { REALTIME_TOPICS } from "@/lib/supabase/realtime-topics";

// Phase 28 — live sync. Replaces the interval polling in
// DashboardLiveRefresh.js with Supabase Realtime's postgres_changes: when a
// cashier records a payment, a teacher marks attendance, etc., every other
// signed-in user at the SAME institute sees it without a manual refresh.
//
// Cross-institute exposure was the reason Realtime was deliberately held
// off earlier (see DashboardLiveRefresh.js's comment) until it could be
// checked against this project's actual setup rather than assumed safe.
// That check is now the comment block at the top of
// supabase/migrations/0058_realtime_sync.sql — short version: Realtime's
// postgres_changes has enforced RLS on every broadcast since Dec 2021, this
// app's browser client always connects as the signed-in user (never
// service-role), and every table this component subscribes to already
// carries the same institute_isolation RLS policy every other query in
// this app is already trusted to enforce. This component adds no new
// authorization surface — it's a push notification for changes the same
// user could already have read by querying directly.
//
// The `institute_id=eq.<id>` filter below is a payload-shaping nicety
// (skip Realtime doing RLS work for events this socket could never see
// anyway), not the actual boundary — RLS still applies underneath it even
// if this filter were wrong or removed.
//
// Mounted once, in AppShell, so it's alive on every page — not just
// whichever list page happens to be open — the same way OfflineStatus.js
// already is.
export default function RealtimeSync({ roleContext }) {
  const router = useRouter();
  const [toasts, setToasts] = useState([]);
  const refreshTimer = useRef(null);
  const toastId = useRef(0);

  const instituteId = roleContext?.instituteId;

  useEffect(() => {
    if (!instituteId) return;

    const supabase = createClient();
    let channel = null;
    let cancelled = false;

    const topics = REALTIME_TOPICS.filter((topic) => topic.visible(roleContext));

    function scheduleRefresh() {
      // Debounced: a bulk operation (e.g. generating monthly fees for a
      // whole class) fires many rows at once — one router.refresh() a
      // moment later, not one per row.
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 600);
    }

    function pushToast(text) {
      const id = ++toastId.current;
      setToasts((t) => [...t.slice(-3), { id, text }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
    }

    function connect() {
      if (cancelled || channel) return;
      channel = supabase.channel(`sync:${instituteId}`);
      for (const topic of topics) {
        for (const event of topic.events) {
          channel.on(
            "postgres_changes",
            { event, schema: "public", table: topic.table, filter: `institute_id=eq.${instituteId}` },
            (payload) => {
              pushToast(topic.label(payload));
              scheduleRefresh();
            }
          );
        }
      }
      channel.subscribe();
    }

    function disconnect() {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    }

    // "When online" — the spec's own qualifier. Tear the socket down while
    // offline instead of leaving it retrying in the background, and
    // reconnect (picking up whatever happened while disconnected via the
    // debounced refresh above, once something new comes in) when back.
    const unsubscribeConnectivity = subscribeConnectivity((isOnline) => {
      if (isOnline) connect();
      else disconnect();
    });

    return () => {
      cancelled = true;
      unsubscribeConnectivity();
      disconnect();
      clearTimeout(refreshTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instituteId, router]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-72">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="rounded-lg bg-white border border-slate-200 shadow-lg px-3 py-2 text-sm text-slate-700 flex items-center gap-2"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-sage shrink-0" />
          {t.text}
        </div>
      ))}
    </div>
  );
}
