// IMPORTANT — what this job is and isn't.
//
// It does NOT take a database backup. A real backup means a pg_dump or a
// Supabase PITR snapshot, which needs either direct database credentials
// or a Supabase Management API token with project-level access. Putting
// a token that powerful into an HTTP-reachable route is a worse risk than
// the problem it solves, and a job named "backups" that quietly does
// nothing would be actively dangerous — someone would assume they're
// covered when they aren't.
//
// What it actually does: verifies the database is alive and being written
// to, and records row counts over time so a sudden drop (the signature of
// accidental mass deletion) is visible in automation_runs history.
//
// Real backups: Supabase takes automatic daily backups on paid plans;
// on free tier, run `supabase db dump` on a schedule from a machine you
// control. See docs/BACKUP_AND_RECOVERY.md.
export const backupsJob = {
  key: "backups",
  name: "Backup Verification",

  async run({ admin, institute }) {
    const tables = ["students", "fee_records", "fee_payments", "expenses", "student_attendance"];
    const counts = {};

    for (const table of tables) {
      const { count, error } = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("institute_id", institute.id);
      if (error) throw new Error(`Could not count ${table}: ${error.message}`);
      counts[table] = count ?? 0;
    }

    // Compare against the previous successful run to catch a sudden drop.
    const { data: previous } = await admin
      .from("automation_runs")
      .select("summary")
      .eq("job_key", "backups")
      .eq("institute_id", institute.id)
      .eq("status", "success")
      .order("started_at", { ascending: false })
      .limit(1);

    const before = previous?.[0]?.summary?.counts;
    const drops = [];
    if (before) {
      for (const table of tables) {
        if (before[table] != null && counts[table] < before[table]) {
          drops.push(`${table}: ${before[table]} → ${counts[table]}`);
        }
      }
    }

    if (drops.length > 0) {
      throw new Error(`Row counts dropped since the last check — possible data loss. ${drops.join("; ")}`);
    }

    // Tagged here rather than in a separate weekly/monthly job registration
    // — same check, same table, just recorded as also satisfying the
    // weekly/monthly cadence on the days those line up. The Automation
    // Center reads these flags to show three distinct freshness
    // indicators from the one automation_runs history, with no new table.
    const day = new Date().getDay(); // 0=Sun..6=Sat
    const dateOfMonth = new Date().getDate();

    return {
      itemsProcessed: tables.length,
      summary: {
        counts,
        verified_at: new Date().toISOString(),
        note: "Verification only — not a backup. See docs/BACKUP_AND_RECOVERY.md and /automation/backup-export.",
        cadence: {
          daily: true,
          weekly: day === 1, // Monday
          monthly: dateOfMonth === 1,
        },
      },
    };
  },
};
