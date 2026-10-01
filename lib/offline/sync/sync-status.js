import { db } from "../db";
import { countPending, countFailed } from "./outbox";
import { getConnectivity } from "../connectivity";
import { isSyncing } from "./sync-engine";
import { listOpenConflicts } from "./conflict-resolver";

export async function getSyncStatus(instituteId) {
  const [pendingCount, failedCount, openConflicts, lastSyncMeta] = await Promise.all([
    countPending(),
    countFailed(),
    // Was db.sync_conflicts.where("resolved").equals(false).count() — same
    // invalid-boolean-key bug fixed in db.js v6; routed through
    // listOpenConflicts() so there's one place doing the filter, not two
    // copies that could drift.
    listOpenConflicts(),
    db.sync_metadata.get(`last_sync:students:${instituteId}`),
  ]);

  return {
    online: getConnectivity(),
    syncing: isSyncing(),
    pendingCount,
    failedCount,
    conflictCount: openConflicts.length,
    lastSyncAt: lastSyncMeta?.value || null,
  };
}
