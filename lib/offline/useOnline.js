"use client";

import { useEffect, useState } from "react";
import { subscribeConnectivity, startConnectivityMonitor } from "./connectivity";

// Reads the same connectivity signal OfflineStatus.js and RealtimeSync.js
// already use (a real reachability probe against Supabase's REST root, not
// just navigator.onLine — see connectivity.js's own header for why that
// distinction matters on a flaky academy internet connection).
//
// Safe to mount on a page that has no AppShell around it at all — e.g.
// app/register-institute, which renders before anyone's signed in and
// outside the (app) layout that normally hosts OfflineStatus. Calling
// startConnectivityMonitor() here if nothing else on the page already has
// is what makes that work standalone; on pages where OfflineStatus is
// already running it (every page inside (app)), this just starts a second,
// harmless poll of the same cheap HEAD request — the same overlap
// OfflineStatus.js already has with itself today (it's mounted twice, once
// per header breakpoint). Not something this hook needed to fix to do its
// own job correctly.
export function useOnline() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const stopMonitor = startConnectivityMonitor({ pollSeconds: 20 });
    const unsubscribe = subscribeConnectivity(setOnline);
    return () => {
      stopMonitor();
      unsubscribe();
    };
  }, []);

  return online;
}
