// Extracted from app/(app)/reports/management/page.js so Ask MSA's
// get_management_report tool computes the forecast and alerts the exact
// same way the Management Report page does — one implementation, not two
// that could quietly drift apart. Forecast lives entirely here, in the
// application layer, computed fresh every call from real numbers —
// never written to any table. See 0052_management_reporting.sql's
// header for why that split is the actual mechanism keeping this
// separate from real accounting, not just a UI label.
//
// Method: average month-over-month growth rate across the last 3 months
// with a real growth rate to compare (skips a month with zero collection
// — a closed school holiday month would otherwise drag the average
// toward a meaningless number), applied to the latest actual figure.
// Chosen over a full linear regression deliberately — a Principal can
// verify "average of the last few months' growth, applied once" by hand
// against the numbers on this same page. A regression coefficient can't
// be hand-checked, and a forecast nobody can verify isn't one they should
// trust.
export function computeForecast(trend) {
  const withData = trend.filter((m) => m.collected > 0);
  if (withData.length < 2) return null;

  const growthRates = [];
  for (let i = 1; i < withData.length; i++) {
    const prev = withData[i - 1].collected;
    const curr = withData[i].collected;
    if (prev > 0) growthRates.push((curr - prev) / prev);
  }
  const recentRates = growthRates.slice(-3);
  if (recentRates.length === 0) return null;

  const avgRate = recentRates.reduce((a, b) => a + b, 0) / recentRates.length;
  const latest = withData[withData.length - 1];
  const projected = latest.collected * (1 + avgRate);

  return {
    basedOnMonths: recentRates.length,
    avgGrowthPct: Math.round(avgRate * 1000) / 10,
    latestActual: latest.collected,
    latestMonth: latest.month,
    projected: Math.max(0, Math.round(projected)),
  };
}

export function computeAlerts(trend, comparison) {
  const alerts = [];
  const withData = trend.filter((m) => m.collected > 0 || m.expenses > 0);

  // Two or more consecutive months of declining collection.
  let decliningStreak = 0;
  for (let i = withData.length - 1; i > 0; i--) {
    if (withData[i].collected < withData[i - 1].collected) decliningStreak++;
    else break;
  }
  if (decliningStreak >= 2) {
    alerts.push({ severity: "warning", text: `Fee collection has declined for ${decliningStreak} consecutive months.` });
  }

  // Expenses growing faster than collection this month — a margin signal,
  // not necessarily a problem, but worth a Principal's attention.
  if (comparison?.last_collected > 0 && comparison?.last_expenses > 0) {
    const collGrowth = (comparison.this_collected - comparison.last_collected) / comparison.last_collected;
    const expGrowth = (comparison.this_expenses - comparison.last_expenses) / comparison.last_expenses;
    if (expGrowth > collGrowth + 0.1) {
      alerts.push({
        severity: "warning",
        text: `Expenses grew ${Math.round(expGrowth * 100)}% this month vs. collection's ${Math.round(collGrowth * 100)}% — the gap is widening.`,
      });
    }
  }

  if (comparison?.collection_growth_pct != null && comparison.collection_growth_pct >= 5) {
    alerts.push({ severity: "good", text: `Collection is up ${comparison.collection_growth_pct}% vs. last month.` });
  }

  return alerts;
}
