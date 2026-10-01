// Display-only "when does this job next actually do something" — mirrors,
// BY HAND, the real date-gating condition already inside each job's own
// run() function (lib/automation/jobs/*.js: fee-generation/payroll check
// for the 1st, fee-reminders checks for the 10th/20th/25th). This file
// doesn't drive that behavior and isn't read by the jobs themselves; it
// exists purely so the Automation Center can show "01 Oct" / "Tonight"
// instead of a raw cron string a Super Admin has to mentally parse.
//
// Same accepted trade-off already used elsewhere in this codebase —
// lib/auth/roles.js mirrors RLS role names by hand, reports/page.js
// mirrors each report's requireRole() list by hand — a display/UX layer
// kept in sync with the real logic by convention, not by import, because
// the real logic lives inside a date check a cron-triggered function
// makes at run time, not a value this module could import instead.
const DAY_MS = 24 * 60 * 60 * 1000;

function fmt(date) {
  return date.toLocaleDateString("en-US", { day: "2-digit", month: "short" });
}

export function nextRunLabel(jobKey, now = new Date()) {
  switch (jobKey) {
    case "fee-generation":
    case "payroll": {
      // Cron fires daily at 4am/5am but the job itself no-ops unless
      // today is the 1st (see those jobs' own date check).
      if (now.getDate() === 1) return "Today";
      return fmt(new Date(now.getFullYear(), now.getMonth() + 1, 1));
    }
    case "fee-reminders": {
      const dates = [10, 20, 25];
      const upcoming = dates.find((d) => d >= now.getDate());
      if (upcoming === undefined) return fmt(new Date(now.getFullYear(), now.getMonth() + 1, 10));
      if (upcoming === now.getDate()) return "Today";
      return fmt(new Date(now.getFullYear(), now.getMonth(), upcoming));
    }
    case "reconciliation":
      // Cron hour: 2am (0 2 * * *)
      return now.getHours() < 2 ? "Tonight" : "Tomorrow";
    case "anomaly-detection":
      // Cron hour: 4am (0 4 * * *) — same tick as fee-generation/fee-reminders,
      // via the shared /api/cron/automation daily run (see scheduler.js's
      // runDailyJobs).
      return now.getHours() < 4 ? "Tonight" : "Tomorrow";
    case "backups":
      // Cron hour: 1am (0 1 * * *)
      return now.getHours() < 1 ? "Tonight" : "Tomorrow";
    case "queue-worker":
      // Cron hour: hourly (0 * * * *) — see vercel.json. Genuinely the
      // job's real cadence, unlike communications' documented-but-not-
      // wired hourly schedule (its automation_jobs row says hourly, but
      // no vercel.json entry actually triggers it more than daily).
      return "Within the hour";
    case "inventory-alerts": {
      // Weekly, Monday 6am (0 6 * * 1)
      const day = now.getDay(); // 0=Sun..6=Sat
      if (day === 1 && now.getHours() < 6) return "Today";
      const daysUntilMonday = (8 - day) % 7 || 7;
      if (daysUntilMonday === 1) return "Tomorrow";
      return fmt(new Date(now.getTime() + daysUntilMonday * DAY_MS));
    }
    default:
      return "—";
  }
}
