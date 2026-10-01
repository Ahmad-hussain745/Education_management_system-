// Statistical, not AI — see 0053_anomaly_detection.sql's header for why
// that's the deliberate choice, not a shortcut around building something
// harder. Every check below is a real historical average compared to a
// real current figure, flagged only past a threshold chosen to avoid
// noise. Nothing here forecasts, trains, or projects — same "real numbers
// only" principle 0052 (management reporting) already established.
//
// Six checks, matching the six examples in the request. Each is
// independent: one check's SQL error doesn't stop the other five from
// running, since a person losing visibility into inventory usage because
// the arrears query happened to fail would be a worse outcome than just
// reporting the arrears check as broken and moving on. Only a genuinely
// unexpected error (a typo'd RPC name, a missing table) throws and fails
// the whole job — an individual detector coming back empty is normal, not
// an error.
import { notifyInstituteAdmins } from "../notify";

function fmtRs(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
function pctLabel(pct) {
  if (pct === null || pct === undefined) return "—";
  return (pct >= 0 ? "+" : "") + pct + "%";
}

export const anomalyDetectionJob = {
  key: "anomaly-detection",
  name: "Anomaly Detection",

  async run({ admin, institute, asOf }) {
    const today = asOf ? new Date(asOf) : new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const checkDate = yesterday.toISOString().slice(0, 10);
    const monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;

    const anomalies = [];

    // 1. Cash collection dropped sharply (yesterday vs trailing 30-day daily average)
    const { data: cashData, error: cashError } = await admin.rpc("detect_cash_collection_anomaly", {
      p_institute_id: institute.id,
      p_date: checkDate,
    });
    if (cashError) throw new Error(`cash collection check: ${cashError.message}`);
    const cash = cashData?.[0];
    if (cash?.is_anomaly) {
      anomalies.push({
        key: "cash_collection",
        title: "Cash collection dropped sharply",
        message: `Cash collected on ${checkDate}: ${fmtRs(cash.current_amount)} vs a typical ${fmtRs(cash.baseline_avg)}/day (${pctLabel(cash.change_pct)}).`,
        investigateHref: "/finance/reports",
      });
    }

    // 2. One cashier with far more reversals than average
    const { data: reversalData, error: reversalError } = await admin.rpc("detect_cashier_reversal_anomaly", {
      p_institute_id: institute.id,
      p_date: checkDate,
    });
    if (reversalError) throw new Error(`cashier reversal check: ${reversalError.message}`);
    for (const row of (reversalData || []).filter((r) => r.is_anomaly)) {
      anomalies.push({
        key: `cashier_reversals:${row.cashier_id}`,
        title: `${row.cashier_name} has an unusual number of reversals`,
        message: `${row.reversal_count} reversal(s) in the last 30 days, vs an average of ${row.institute_avg} per cashier.`,
        investigateHref: "/finance/transactions",
      });
    }

    // 3. An expense category unusually high this month
    const { data: expenseData, error: expenseError } = await admin.rpc("detect_expense_category_anomaly", {
      p_institute_id: institute.id,
      p_month: monthStr,
    });
    if (expenseError) throw new Error(`expense category check: ${expenseError.message}`);
    for (const row of (expenseData || []).filter((r) => r.is_anomaly)) {
      anomalies.push({
        key: `expense_category:${row.category}`,
        title: `${row.category} expense unusually high`,
        message: `Average: ${fmtRs(row.baseline_avg)}. This month: ${fmtRs(row.current_amount)}. Increase: ${pctLabel(row.change_pct)}.`,
        investigateHref: "/finance/expenses",
      });
    }

    // 4. Arrears increasing — baseline is this job's OWN previous run,
    // not a trailing average (see 0053's comment on why there's no
    // history table for this one).
    const { data: prevRun } = await admin
      .from("automation_runs")
      .select("summary")
      .eq("job_key", "anomaly-detection")
      .eq("institute_id", institute.id)
      .eq("status", "success")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: arrearsNow, error: arrearsError } = await admin.rpc("get_current_arrears_total", {
      p_institute_id: institute.id,
    });
    if (arrearsError) throw new Error(`arrears check: ${arrearsError.message}`);

    const prevArrears = prevRun?.summary?.arrears_total ?? null;
    if (prevArrears !== null && prevArrears > 0) {
      const changePct = Math.round(((Number(arrearsNow) - prevArrears) / prevArrears) * 1000) / 10;
      if (Number(arrearsNow) >= prevArrears * 1.2) {
        anomalies.push({
          key: "arrears",
          title: "Student arrears increasing",
          message: `Total outstanding arrears: ${fmtRs(arrearsNow)}, up from ${fmtRs(prevArrears)} at the last check (${pctLabel(changePct)}).`,
          investigateHref: "/reports/pending-fees",
        });
      }
    }

    // 5. Salary cost unusually high this month
    const { data: salaryData, error: salaryError } = await admin.rpc("detect_salary_cost_anomaly", {
      p_institute_id: institute.id,
      p_month: monthStr,
    });
    if (salaryError) throw new Error(`salary cost check: ${salaryError.message}`);
    const salary = salaryData?.[0];
    if (salary?.is_anomaly) {
      anomalies.push({
        key: "salary_cost",
        title: "Salary cost unusually high",
        message: `Average: ${fmtRs(salary.baseline_avg)}. This month: ${fmtRs(salary.current_amount)}. Increase: ${pctLabel(salary.change_pct)}.`,
        investigateHref: "/salary/reports",
      });
    }

    // 6. Inventory usage abnormal, by category
    const { data: invData, error: invError } = await admin.rpc("detect_inventory_usage_anomaly", {
      p_institute_id: institute.id,
      p_month: monthStr,
    });
    if (invError) throw new Error(`inventory usage check: ${invError.message}`);
    for (const row of (invData || []).filter((r) => r.is_anomaly)) {
      anomalies.push({
        key: `inventory_usage:${row.category_name}`,
        title: `${row.category_name} usage abnormal`,
        message: `Average usage: ${row.baseline_avg}. This month: ${row.current_amount}. Increase: ${pctLabel(row.change_pct)}.`,
        investigateHref: "/inventory/stock-report",
      });
    }

    // Persist each as a staff_notifications row (0050's table, extended
    // by 0053 with type='anomaly') — upserted in place, so finding the
    // same thing again tomorrow refreshes one row instead of piling up a
    // new one. investigateHref isn't stored — the UI derives it from the
    // key's prefix (see app/(app)/automation/AnomaliesPanel.js), so this
    // job doesn't need its own column just to remember six URLs.
    for (const a of anomalies) {
      const { error: upsertError } = await admin.rpc("upsert_anomaly_notification", {
        p_institute_id: institute.id,
        p_metric_key: a.key,
        p_severity: "warning",
        p_title: a.title,
        p_message: a.message,
      });
      if (upsertError) {
        console.error(`[anomaly-detection] notification failed for ${a.key}:`, upsertError.message);
      }
    }

    let notifyResult = { skipped: true, reason: "No anomalies found" };
    if (anomalies.length > 0) {
      notifyResult = await notifyInstituteAdmins(admin, institute.id, {
        subject: `🔎 ${anomalies.length} Financial Anomal${anomalies.length === 1 ? "y" : "ies"} — ${institute.name}`,
        html: `
          <h2>🔎 Financial Anomal${anomalies.length === 1 ? "y" : "ies"}</h2>
          <p>${institute.name}</p>
          ${anomalies
            .map(
              (a) => `
            <div style="margin-bottom:12px;padding:12px;border:1px solid #e2e8f0;border-radius:8px">
              <p style="margin:0 0 6px 0"><strong>${a.title}</strong></p>
              <p style="margin:0">${a.message}</p>
            </div>
          `
            )
            .join("")}
          <p style="color:#64748b;font-size:13px">Open the Automation Center to investigate or dismiss these.</p>
        `,
      });
    }

    return {
      itemsProcessed: anomalies.length,
      summary: {
        date: checkDate,
        month: monthStr,
        anomaly_count: anomalies.length,
        anomalies: anomalies.map((a) => ({ key: a.key, title: a.title, message: a.message })),
        arrears_total: Number(arrearsNow) || 0,
        alert_sent: !notifyResult.skipped && !notifyResult.error,
        notify_note: notifyResult.skipped ? notifyResult.reason : notifyResult.error || null,
      },
    };
  },
};
