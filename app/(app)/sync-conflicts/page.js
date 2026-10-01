import { redirect } from "next/navigation";
import { getRoleContext } from "@/lib/auth/roles";
import SyncConflictsPanel from "./SyncConflictsPanel";

// Phase 31 — this route's only real access control is the redirect below
// (any signed-in user, same as /students — a Teacher can have their own
// attendance-sync conflicts here just as much as a Cashier can have a
// payment one). Everything this page shows lives in THIS browser's
// IndexedDB only — there is no server query to run, so there is nothing
// for Postgres RLS to protect here. That's also why unresolved conflicts
// don't show up for a colleague on a different device: they're local to
// whichever device the offline action (and its rejection) actually
// happened on. See SyncConflictsPanel.js.
export default async function SyncConflictsPage() {
  const roleContext = await getRoleContext();
  if (!roleContext) redirect("/login");

  return <SyncConflictsPanel />;
}
