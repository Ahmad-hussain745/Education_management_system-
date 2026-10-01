"use client";

// navigator.onLine alone is unreliable — it reflects whether the device has
// *a* network interface up, not whether it can actually reach your Supabase
// project (a phone on airplane-mode-except-wifi-to-a-router-with-no-internet
// reports online=true). This adds a real reachability check by hitting
// Supabase's own REST root, which always responds fast even unauthenticated.
let listeners = [];
let currentStatus = typeof navigator !== "undefined" ? navigator.onLine : true;

export function getConnectivity() {
  return currentStatus;
}

export function subscribeConnectivity(callback) {
  listeners.push(callback);
  callback(currentStatus);
  return () => {
    listeners = listeners.filter((l) => l !== callback);
  };
}

function setStatus(status) {
  if (status === currentStatus) return;
  currentStatus = status;
  listeners.forEach((l) => l(status));
}

// Cheap reachability probe — HEAD request to Supabase's REST root. No auth
// needed, no row data touched, just "did something answer."
export async function checkReachability() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return navigator.onLine;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${url}/rest/v1/`, { method: "HEAD", signal: controller.signal });
    clearTimeout(timeout);
    return res.ok || res.status === 404; // 404 on bare REST root is still "server answered"
  } catch {
    return false;
  }
}

let pollInterval = null;

export function startConnectivityMonitor({ pollSeconds = 20 } = {}) {
  if (typeof window === "undefined") return () => {};

  const handleBrowserEvent = async () => {
    if (!navigator.onLine) {
      setStatus(false);
      return;
    }
    setStatus(await checkReachability());
  };

  window.addEventListener("online", handleBrowserEvent);
  window.addEventListener("offline", handleBrowserEvent);
  handleBrowserEvent();

  pollInterval = setInterval(handleBrowserEvent, pollSeconds * 1000);

  return () => {
    window.removeEventListener("online", handleBrowserEvent);
    window.removeEventListener("offline", handleBrowserEvent);
    clearInterval(pollInterval);
  };
}
