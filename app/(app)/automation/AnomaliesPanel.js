"use client";

import { useEffect, useState, useTransition } from "react";
import { getOpenAnomalies, dismissAnomaly } from "./actions";

// related_table holds the metric key (e.g. "expense_category:Electricity",
// "cashier_reversals:<uuid>") — see 0053_anomaly_detection.sql's comment
// on why that column is reused this way instead of adding a new one. The
// prefix before any ":" picks where "Investigate" sends the admin; this
// mapping lives here, in the UI, rather than being stored per-row, since
// it's a fixed fact about the KIND of anomaly, not something that varies
// row to row.
const INVESTIGATE_HREF = {
  cash_collection: "/finance/reports",
  cashier_reversals: "/finance/transactions",
  expense_category: "/finance/expenses",
  arrears: "/reports/pending-fees",
  salary_cost: "/salary/reports",
  inventory_usage: "/inventory/stock-report",
};

function investigateHref(metricKey) {
  const prefix = (metricKey || "").split(":")[0];
  return INVESTIGATE_HREF[prefix] || "/finance/reports";
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "numeric", minute: "2-digit" });
}

export default function AnomaliesPanel() {
  const [anomalies, setAnomalies] = useState(null);
  const [error, setError] = useState(null);
  const [dismissing, startDismissing] = useTransition();

  useEffect(() => {
    getOpenAnomalies().then((res) => {
      if (res.error) setError(res.error);
      else setAnomalies(res.anomalies);
    });
  }, []);

  const handleDismiss = (id) => {
    startDismissing(async () => {
      const res = await dismissAnomaly(id);
      if (!res.error) setAnomalies((prev) => prev.filter((a) => a.id !== id));
    });
  };

  if (error) return <p className="text-sm text-brick">{error}</p>;
  if (anomalies === null) return <p className="text-sm text-slate-400">Loading…</p>;
  if (anomalies.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
        No open anomalies — the daily check compares today's numbers against their own recent history
        (see the Anomaly Detection row above for when it last ran).
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {anomalies.map((a) => (
        <div key={a.id} className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-ink">🔎 {a.title}</p>
              <p className="text-sm text-slate-600 mt-1">{a.message}</p>
              <p className="text-xs text-slate-400 mt-2">Flagged {fmtDateTime(a.created_at)} · last seen {fmtDateTime(a.updated_at)}</p>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <a
                href={investigateHref(a.related_table)}
                className="text-xs px-3 py-1.5 rounded-lg bg-royal hover:bg-royal-dark text-white text-center"
              >
                Investigate
              </a>
              <button
                onClick={() => handleDismiss(a.id)}
                disabled={dismissing}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
