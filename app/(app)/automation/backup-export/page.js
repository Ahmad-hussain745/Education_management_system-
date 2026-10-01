import { requireRole } from "@/lib/auth/guard";
import BackupExportForm from "./BackupExportForm";
import Link from "next/link";

export default async function BackupExportPage() {
  // Same gate as the rest of the Automation Center — see
  // app/api/export/institute-data/route.js for why the API route ALSO
  // checks this independently rather than trusting this page guard alone.
  await requireRole(["Super Admin"]);

  return (
    <div className="p-6 max-w-2xl">
      <Link href="/automation" className="text-xs text-royal hover:underline">← Automation Center</Link>
      <h1 className="text-lg font-semibold text-ink mt-2 mb-1">Local Encrypted Backup</h1>
      <p className="text-sm text-slate-600 mb-6">
        Downloads an encrypted copy of your institute&apos;s data to keep somewhere outside Supabase —
        a filing cabinet USB drive, a personal cloud folder, wherever you&apos;d keep a printed backup.
        This is a supplement to Supabase&apos;s own automatic backups, not a replacement for them.
      </p>

      <div className="bg-soft-blue/40 border border-royal/20 rounded-lg p-4 mb-6 text-sm text-ink space-y-2">
        <p className="font-medium">Where your real backups actually live:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-700">
          <li><strong>Supabase Dashboard → Database → Backups</strong> — automatic daily backups, and Point-in-Time Recovery if enabled. This is the primary, always-on backup.</li>
          <li><strong>The <code>supabase/migrations/</code> folder in your GitHub repo</strong> — every table, function, and rule, recoverable any time your code is.</li>
          <li><strong>This page</strong> — optional, on-demand, encrypted, for keeping a copy somewhere Supabase itself isn&apos;t.</li>
        </ul>
        <p>See <code>docs/BACKUP_AND_RECOVERY.md</code> for the full recovery procedure.</p>
      </div>

      <BackupExportForm />
    </div>
  );
}
