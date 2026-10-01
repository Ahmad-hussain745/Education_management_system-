// Reconciles YESTERDAY's money, in the order Phase 17 asks for:
//   Receipts (fee_payments) / Payments (income) → Ledger (transactions)
//   → Cashier Closing
//
// Two different kinds of mismatch, two different responses:
//   - fee_records drift, or a Receipts/Payments-vs-Ledger imbalance, is a
//     STRUCTURAL problem — under normal operation these should always
//     match (see 0048_daily_reconciliation.sql's own note on how
//     reversals are handled so they don't cause a false alarm here), so a
//     mismatch means something is actually wrong. Thrown, same as before,
//     so the engine records it as a failure a human investigates.
//   - A Cashier Closing difference, or a cashier who never closed at all,
//     is routine human variance (a miscounted drawer, someone forgetting
//     to close out) — reported via a Finance Alert email, not thrown as
//     a failure. An automated job crying "failed" every time someone's
//     cash count is off by a few hundred rupees would train everyone to
//     ignore it.
import { notifyInstituteAdmins } from "../notify";

function fmtRs(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
function fmtDate(d) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

export const reconciliationJob = {
  key: "reconciliation",
  name: "Ledger Reconciliation",

  async run({ admin, institute, asOf }) {
    // Checks YESTERDAY, not today — "balanced" only means something once
    // a day is actually over. Running this at 2am against "today" would
    // be judging a day that's a few hours old.
    const today = asOf ? new Date(asOf) : new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const checkDate = yesterday.toISOString().slice(0, 10);

    const { data: driftData, error: driftError } = await admin.rpc("reconcile_fee_totals", { p_institute_id: institute.id });
    if (driftError) throw new Error(driftError.message);
    const drifted = driftData || [];

    const { data: ledgerData, error: ledgerError } = await admin.rpc("reconcile_ledger_totals", {
      p_institute_id: institute.id,
      p_date: checkDate,
    });
    if (ledgerError) throw new Error(ledgerError.message);
    const ledgerUnbalanced = (ledgerData || []).filter((r) => !r.balanced);

    if (drifted.length > 0 || ledgerUnbalanced.length > 0) {
      const parts = [];
      if (drifted.length > 0) {
        parts.push(
          `${drifted.length} fee record(s) have paid_total out of step with their payments. ` +
          `First: record ${drifted[0].fee_record_id} stored ${drifted[0].stored_paid} vs actual ${drifted[0].actual_paid}.`
        );
      }
      if (ledgerUnbalanced.length > 0) {
        parts.push(
          ledgerUnbalanced
            .map((r) => `${r.source} on ${checkDate}: records total ${fmtRs(r.records_total)} vs ledger total ${fmtRs(r.ledger_total)}.`)
            .join(" ")
        );
      }
      throw new Error(parts.join(" "));
    }

    const [{ data: discrepancies }, { data: missing }] = await Promise.all([
      admin.rpc("cashier_closing_discrepancies", { p_institute_id: institute.id, p_date: checkDate }),
      admin.rpc("missing_cashier_closings", { p_institute_id: institute.id, p_date: checkDate }),
    ]);
    const discrepancyRows = discrepancies || [];
    const missingRows = missing || [];

    let notifyResult = { skipped: true, reason: "Nothing to alert on" };
    if (discrepancyRows.length > 0 || missingRows.length > 0) {
      const html = `
        <h2>Finance Alert — ${fmtDate(checkDate)}</h2>
        <p>${institute.name}</p>
        ${discrepancyRows.length > 0 ? `
          <h3>Cashier Closing Discrepancies</h3>
          ${discrepancyRows.map((d) => `
            <div style="margin-bottom:12px;padding:12px;border:1px solid #e2e8f0;border-radius:8px">
              <p><strong>Cashier:</strong> ${d.cashier_name}<br/>
              <strong>Date:</strong> ${fmtDate(checkDate)}</p>
              <p>Expected: ${fmtRs(d.expected_cash)}<br/>
              Actual:&nbsp;&nbsp;&nbsp;${fmtRs(d.actual_cash)}</p>
              <p><strong>Difference: ${fmtRs(Math.abs(d.difference))} ${d.difference < 0 ? "(short)" : "(over)"}</strong></p>
              ${d.reason ? `<p style="color:#64748b">Reason given: ${d.reason}</p>` : ""}
            </div>
          `).join("")}
        ` : ""}
        ${missingRows.length > 0 ? `
          <h3>Not Closed Yet</h3>
          <ul>
            ${missingRows.map((m) => `<li>${m.cashier_name} — collected ${fmtRs(m.expected_cash)} in cash, hasn't closed ${fmtDate(checkDate)} yet</li>`).join("")}
          </ul>
        ` : ""}
      `;
      notifyResult = await notifyInstituteAdmins(admin, institute.id, {
        subject: `Finance Alert — ${fmtDate(checkDate)} — ${institute.name}`,
        html,
      });
    }

    return {
      itemsProcessed: discrepancyRows.length + missingRows.length,
      summary: {
        date: checkDate,
        ledger_balanced: true,
        discrepancies: discrepancyRows.length,
        missing_closings: missingRows.length,
        alert_sent: !notifyResult.skipped && !notifyResult.error,
        notify_note: notifyResult.skipped ? notifyResult.reason : notifyResult.error || null,
      },
    };
  },
};
