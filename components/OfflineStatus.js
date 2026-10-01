"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { subscribeConnectivity, startConnectivityMonitor } from "@/lib/offline/connectivity";
import { getSyncStatus } from "@/lib/offline/sync/sync-status";
import { runSync } from "@/lib/offline/sync/sync-engine";
import { primeCaches } from "@/lib/offline/sync/prime-cache";

// The four states asked for, plus a fifth that isn't optional given what
// this component is promising: a conflict (e.g. insufficient stock,
// overpayment race) is NOT "synchronized" — it's a change that still needs
// a person's decision. Folding that into "All synchronized" would be
// exactly the kind of "the user shouldn't have to wonder" failure this
// component exists to prevent, just moved from payments into inventory.
//
// PAYMENTS/STUDENTS: as of Phase 8/9, offline fee collection and offline
// student registration also go through this same sync_outbox/
// sync_conflicts machinery (lib/offline/repositories/payments.js,
// students.js) — capped/provisional writes, not raw offline inserts. No
// special-casing needed here: pendingCount/conflictCount already include
// their entries the same as attendance/expenses/inventory,
// since they're all read from the same generic tables.
//
// CACHE PRIMING: this component is mounted everywhere (see AppShell.js) and
// already knows institute_id/connectivity, which makes it the natural place
// to also call primeCaches() (sync/prime-cache.js) — once when the app
// loads while online, and again right after a reconnect sync. Nothing else
// in the app ever pulled fresh classes/students/bills into the offline
// caches before Phase 10; this is that missing call.
export default function OfflineStatus() {
  const [online, setOnline] = useState(true);
  const [status, setStatus] = useState({ pendingCount: 0, conflictCount: 0, syncing: false });
  const [justSynced, setJustSynced] = useState(false);

  const refreshStatus = useCallback(async (instituteId) => {
    if (!instituteId) return;
    const s = await getSyncStatus(instituteId);
    setStatus(s);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let instituteId = null;
    let teacherId = null;
    let isTeacherOnly = false;
    let cancelled = false;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data: me } = await supabase
        .from("users")
        .select("institute_id, role:roles(name), teacher:teachers(id)")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      instituteId = me?.institute_id;
      isTeacherOnly = me?.role?.name === "Teacher";
      teacherId = isTeacherOnly ? me?.teacher?.[0]?.id || null : null;
      await refreshStatus(instituteId);
      // Priming is best-effort and never blocks the status pill from
      // showing — a slow/failed prime just means caches stay whatever they
      // were, same as before this phase existed.
      primeCaches(supabase, { instituteId, teacherId, isTeacherOnly }).catch(() => {});
    })();

    const stopMonitor = startConnectivityMonitor({ pollSeconds: 20 });
    const unsubscribe = subscribeConnectivity(async (isOnline) => {
      if (cancelled) return;
      setOnline(isOnline);
      if (isOnline && instituteId) {
        const before = await getSyncStatus(instituteId);
        if (before.pendingCount > 0) {
          await runSync(supabase);
          await refreshStatus(instituteId);
          setJustSynced(true);
          setTimeout(() => setJustSynced(false), 4000);
        } else {
          await refreshStatus(instituteId);
        }
        // Re-prime AFTER the push above, not before — so a just-synced
        // payment's updated paid_total, or a just-synced student's real
        // row, is reflected in the caches immediately instead of waiting
        // for the next reconnect.
        primeCaches(supabase, { instituteId, teacherId, isTeacherOnly }).catch(() => {});
      } else {
        await refreshStatus(instituteId);
      }
    });

    const poll = setInterval(() => refreshStatus(instituteId), 10000);

    return () => {
      cancelled = true;
      stopMonitor();
      unsubscribe();
      clearInterval(poll);
    };
  }, [refreshStatus]);

  if (status.conflictCount > 0) {
    return (
      // Phase 31 — this used to link nowhere; /sync-conflicts is where
      // these actually get resolved now (SyncConflictsPanel.js).
      <Link href="/sync-conflicts">
        <Pill dot="bg-red-500" bg="bg-red-50" text="text-red-700">
          ⚠️ {status.conflictCount} change{status.conflictCount === 1 ? "" : "s"} need review
        </Pill>
      </Link>
    );
  }
  if (status.syncing) {
    return (
      <Pill dot="bg-royal animate-pulse" bg="bg-soft-blue" text="text-royal">
        🔵 Syncing {status.pendingCount} change{status.pendingCount === 1 ? "" : "s"}...
      </Pill>
    );
  }
  if (!online) {
    return (
      <Pill dot="bg-amber-500" bg="bg-amber-50" text="text-amber-700">
        🟠 Offline{status.pendingCount > 0 ? ` — ${status.pendingCount} change${status.pendingCount === 1 ? "" : "s"} saved locally` : ""}
      </Pill>
    );
  }
  if (justSynced) {
    return (
      <Pill dot="bg-sage" bg="bg-emerald-50" text="text-emerald-700">
        ✅ All changes synchronized
      </Pill>
    );
  }
  return (
    <Pill dot="bg-sage" bg="bg-slate-50" text="text-slate-500">
      🟢 Online
    </Pill>
  );
}

function Pill({ dot, bg, text, children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${bg} ${text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}
