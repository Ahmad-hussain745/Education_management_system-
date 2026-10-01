"use client";

import { useState, useEffect } from "react";
import { savePushSubscription } from "./actions";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export default function PushOptIn() {
  const [status, setStatus] = useState("idle"); // idle | subscribed | unsupported | error
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
    }
  }, []);

  const subscribe = async () => {
    setError("");
    try {
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) {
        setError("Push isn't configured for this school yet (no VAPID key set).");
        return;
      }
      const registration = await navigator.serviceWorker.register("/push-sw.js");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const res = await savePushSubscription(subscription.toJSON());
      if (res?.error) { setError(res.error); return; }
      setStatus("subscribed");
    } catch (err) {
      setError(err.message || "Couldn't enable push notifications.");
    }
  };

  if (status === "unsupported") return null;

  return (
    <div>
      {status === "subscribed" ? (
        <span className="text-xs text-emerald-600">Push enabled on this device ✓</span>
      ) : (
        <button onClick={subscribe} className="text-sm px-3 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
          Enable Push on This Device
        </button>
      )}
      {error && <p className="text-xs text-brick mt-1">{error}</p>}
    </div>
  );
}
