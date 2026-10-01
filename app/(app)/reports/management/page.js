import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import { getRoleContext } from "@/lib/auth/roles";
import ManagementCharts from "./ManagementCharts";
import { computeForecast, computeAlerts } from "@/lib/reports/management";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

function monthLabel(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleString("en-US", { month: "long", year: "numeric" });
}

export default async function ManagementReportsPage() {
  await requireRole(["Super Admin", "Principal", "Accountant"]);
  const roleContext = await getRoleContext();
  const supabase = await createClient();

  const [{ data: trend, error: trendError }, { data: comparisonRows, error: compError }] = await Promise.all([
    supabase.rpc("finance_monthly_trend", { p_institute_id: roleContext.instituteId, p_months: 6 }),
    supabase.rpc("finance_month_comparison", { p_institute_id: roleContext.instituteId }),
  ]);

  if (trendError || compError) {
    return <div className="p-6 text-sm text-brick">{trendError?.message || compError?.message}</div>;
  }

  const comparison = comparisonRows?.[0] || null;
  const forecast = computeForecast(trend || []);
  const alerts = computeAlerts(trend || [], comparison);

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-xl font-semibold text-ink">Management Report</h1>
      <p className="text-sm text-slate-500 mt-1">Fee collection — comparison, trend, and a forward projection.</p>

      {alerts.length > 0 && (
        <div className="mt-4 space-y-2">
          {alerts.map((a, i) => (
            <div
              key={i}
              className={`rounded-lg px-3 py-2 text-sm border ${
                a.severity === "good"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-amber-50 border-amber-200 text-amber-800"
              }`}
            >
              {a.severity === "good" ? "✅ " : "⚠ "}{a.text}
            </div>
          ))}
        </div>
      )}

      {comparison && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6">
          <StatCard label={monthLabel(comparison.last_month)} value={fmt(comparison.last_collected)} sub="Collected" />
          <StatCard label={monthLabel(comparison.this_month)} value={fmt(comparison.this_collected)} sub="Collected" highlight />
          <StatCard
            label="Growth"
            value={comparison.collection_growth_pct != null ? `${comparison.collection_growth_pct > 0 ? "+" : ""}${comparison.collection_growth_pct}%` : "—"}
            sub={comparison.collection_growth_pct == null ? "No prior month to compare" : "vs. last month"}
            tone={comparison.collection_growth_pct > 0 ? "good" : comparison.collection_growth_pct < 0 ? "bad" : "neutral"}
          />
        </div>
      )}

      <h2 className="text-sm font-semibold text-ink mt-8 mb-2">Trend — last 6 months</h2>
      <ManagementCharts trend={trend || []} />

      {/* Forecast: visually distinct — dashed border, explicit "projected"
          language throughout, never styled to look like an actual figure. */}
      <h2 className="text-sm font-semibold text-ink mt-8 mb-2">Forecast</h2>
      {forecast ? (
        <div className="bg-white border-2 border-dashed border-royal/40 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-semibold tracking-wider uppercase bg-soft-blue text-royal rounded-full px-2 py-0.5">
              Projected — not actual accounting
            </span>
          </div>
          <div className="text-2xl font-semibold text-ink">{fmt(forecast.projected)}</div>
          <p className="text-sm text-slate-600 mt-1">
            Expected collection next month, based on the average {forecast.avgGrowthPct >= 0 ? "growth" : "decline"} of{" "}
            <strong>{Math.abs(forecast.avgGrowthPct)}%</strong> across the last {forecast.basedOnMonths} month
            {forecast.basedOnMonths === 1 ? "" : "s"}, applied to {monthLabel(forecast.latestMonth)}&apos;s actual of {fmt(forecast.latestActual)}.
          </p>
          <p className="text-xs text-slate-400 mt-2">
            A simple projection from recent trend — it does not account for admission seasons, fee
            structure changes, or anything else you know is coming. Treat it as a starting point for
            planning, not a number to budget against exactly.
          </p>
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-500">
          Not enough collection history yet to project — need at least two months with real collections.
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, highlight, tone }) {
  const toneClass = tone === "good" ? "text-sage" : tone === "bad" ? "text-brick" : "text-ink";
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-royal/30 bg-soft-blue/30" : "border-slate-200 bg-white"}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${toneClass}`}>{value}</div>
      <div className="text-xs text-slate-400 mt-0.5">{sub}</div>
    </div>
  );
}
