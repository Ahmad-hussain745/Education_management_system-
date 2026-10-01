"use client";

import { useState, useTransition } from "react";
import { runJobNow, setJobEnabled, getJobLogs } from "./actions";

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "numeric", minute: "2-digit" });
}

function StatusPill({ status }) {
  const styles = {
    success: "bg-emerald-50 text-emerald-700",
    failed: "bg-red-50 text-red-700",
    skipped: "bg-slate-100 text-slate-500",
    running: "bg-soft-blue text-royal",
  };
  const labels = { success: "✓ Success", failed: "✗ Failed", skipped: "Skipped", running: "Running…" };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] || "bg-slate-100 text-slate-500"}`}>{labels[status] || status}</span>;
}

function fmtRs(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

// Fee generation's summary (lib/automation/jobs/fee-generation.js) gets a
// real layout instead of raw JSON — it's the one job whose numbers a
// Super Admin is actually likely to want to read at a glance here rather
// than in the email. Every other job's summary still falls back to
// JSON.stringify below; adding the same per-job treatment for those isn't
// needed until someone actually asks to read backups/payroll summaries
// this way too.
function RunSummary({ jobKey, summary }) {
  if (!summary) return null;
  if (jobKey === "fee-generation" && "expected_amount" in summary) {
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-slate-500">
        <span>Students: {summary.students}</span>
        <span>Generated: {summary.generated}</span>
        <span>Skipped: {summary.skipped}</span>
        <span className={summary.failed > 0 ? "text-brick" : ""}>Failed: {summary.failed}</span>
        <span className="font-medium text-ink">Expected: {fmtRs(summary.expected_amount)}</span>
        {summary.notify_note && <span className="text-slate-400 italic">({summary.notify_note})</span>}
      </div>
    );
  }
  if (jobKey === "reconciliation" && "ledger_balanced" in summary) {
    const clean = summary.discrepancies === 0 && summary.missing_closings === 0;
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-slate-500">
        <span className="font-medium text-emerald-700">✓ Ledger Balanced</span>
        {clean ? (
          <span>No cashier discrepancies for {summary.date}</span>
        ) : (
          <>
            {summary.discrepancies > 0 && <span className="text-amber-700">⚠ {summary.discrepancies} cashier discrepanc{summary.discrepancies === 1 ? "y" : "ies"}</span>}
            {summary.missing_closings > 0 && <span className="text-amber-700">⚠ {summary.missing_closings} not closed</span>}
            <span className="text-slate-400">{summary.alert_sent ? "Alert sent" : `Alert not sent${summary.notify_note ? ` (${summary.notify_note})` : ""}`}</span>
          </>
        )}
      </div>
    );
  }
  if (jobKey === "anomaly-detection" && "anomaly_count" in summary) {
    return summary.anomaly_count === 0 ? (
      <span className="text-emerald-700">✓ No anomalies</span>
    ) : (
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-slate-500">
        <span className="text-amber-700">⚠ {summary.anomaly_count} anomal{summary.anomaly_count === 1 ? "y" : "ies"}</span>
        {summary.anomalies?.slice(0, 3).map((a) => (
          <span key={a.key} className="text-slate-400">{a.title}</span>
        ))}
        <span className="text-slate-400">{summary.alert_sent ? "Alert sent" : `Alert not sent${summary.notify_note ? ` (${summary.notify_note})` : ""}`}</span>
      </div>
    );
  }
  return <span className="text-slate-400 truncate max-w-md">{JSON.stringify(summary)}</span>;
}

export default function JobRow({ job, canRun = true, canPause = true }) {
  const [enabled, setEnabled] = useState(job.enabled);
  const [busy, startBusy] = useTransition();
  const [message, setMessage] = useState(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState(null);
  const [logsLoading, startLogsLoading] = useTransition();

  const handleRunNow = () => {
    setMessage(null);
    startBusy(async () => {
      const res = await runJobNow(job.key);
      if (res?.error) {
        setMessage({ type: "error", text: res.error });
        return;
      }
      const r = res.result;
      const failedCount = (r.results || []).filter((x) => x.status === "failed").length;
      const first = r.results?.[0];
      if (failedCount) {
        setMessage({ type: "error", text: `Ran with ${failedCount} failure(s) — see logs.` });
      } else if (job.key === "fee-generation" && first && "expected_amount" in first) {
        setMessage({
          type: "success",
          text: `Students ${first.students} · Generated ${first.generated} · Skipped ${first.skipped} · Failed ${first.failed} · Expected ${fmtRs(first.expected_amount)}`,
        });
      } else if (job.key === "reconciliation" && first && "ledger_balanced" in first) {
        const clean = first.discrepancies === 0 && first.missing_closings === 0;
        setMessage({
          type: "success",
          text: clean
            ? `✓ Balanced — no cashier discrepancies for ${first.date}`
            : `✓ Ledger balanced, but ⚠ ${first.discrepancies} discrepanc${first.discrepancies === 1 ? "y" : "ies"} and ${first.missing_closings} not closed — see logs`,
        });
      } else if (job.key === "anomaly-detection" && first && "anomaly_count" in first) {
        setMessage({
          type: first.anomaly_count > 0 ? "error" : "success",
          text: first.anomaly_count === 0 ? "✓ No anomalies found" : `⚠ ${first.anomaly_count} anomal${first.anomaly_count === 1 ? "y" : "ies"} found — see the Anomalies panel below`,
        });
      } else {
        setMessage({ type: "success", text: "Ran successfully." });
      }
    });
  };

  const handleToggle = () => {
    const next = !enabled;
    setMessage(null);
    startBusy(async () => {
      const res = await setJobEnabled(job.key, next);
      if (res?.error) {
        setMessage({ type: "error", text: res.error });
        return;
      }
      setEnabled(next);
    });
  };

  const handleViewLogs = () => {
    const opening = !logsOpen;
    setLogsOpen(opening);
    if (opening && !logs) {
      startLogsLoading(async () => {
        const res = await getJobLogs(job.key);
        if (res?.error) {
          setLogs({ error: res.error });
          return;
        }
        setLogs(res);
      });
    }
  };

  return (
    <>
      <tr className="border-t border-slate-100 align-top">
        <td className="px-4 py-3">
          <div className="font-medium text-ink">{job.name}</div>
          <div className="text-xs text-slate-400 mt-0.5">{job.description}</div>
        </td>
        <td className="px-4 py-3">
          {enabled ? (
            <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium">✅ Enabled</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-700 text-xs font-medium">⏸ Paused</span>
          )}
        </td>
        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{enabled ? job.nextRun : "—"}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          {job.lastRun ? (
            <div className="flex items-center gap-2">
              <StatusPill status={job.lastRun.status} />
              <span className="text-xs text-slate-400">{fmtDateTime(job.lastRun.started_at)}</span>
            </div>
          ) : (
            <span className="text-xs text-slate-400">Never run yet</span>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-2 justify-end">
            {canRun && (
              <button onClick={handleRunNow} disabled={busy} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Run Now
              </button>
            )}
            {canPause && (
              <button onClick={handleToggle} disabled={busy} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {enabled ? "Pause" : "Resume"}
              </button>
            )}
            <button onClick={handleViewLogs} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">
              {logsOpen ? "Hide Logs" : "View Logs"}
            </button>
          </div>
          {message && (
            <p className={`text-xs mt-1.5 text-right ${message.type === "error" ? "text-brick" : "text-emerald-700"}`}>{message.text}</p>
          )}
        </td>
      </tr>

      {logsOpen && (
        <tr className="border-t border-slate-100 bg-slate-50">
          <td colSpan={5} className="px-4 py-3">
            {logsLoading && <p className="text-xs text-slate-400">Loading…</p>}
            {logs?.error && <p className="text-xs text-brick">{logs.error}</p>}
            {logs && !logs.error && (
              <div className="space-y-3">
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Recent Runs</div>
                  {logs.runs.length === 0 && <p className="text-xs text-slate-400">No runs recorded yet for this institute.</p>}
                  <div className="space-y-1">
                    {logs.runs.map((r) => (
                      <div key={r.id} className="flex items-center gap-2 text-xs">
                        <StatusPill status={r.status} />
                        <span className="text-slate-500">{fmtDateTime(r.started_at)}</span>
                        <span className="text-slate-400">{r.items_processed} item(s)</span>
                        <RunSummary jobKey={job.key} summary={r.summary} />
                      </div>
                    ))}
                  </div>
                </div>
                {logs.errors.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-brick uppercase mb-1">Errors</div>
                    <div className="space-y-1">
                      {logs.errors.map((e) => (
                        <div key={e.id} className="text-xs text-brick">
                          {fmtDateTime(e.occurred_at)} — {e.message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
