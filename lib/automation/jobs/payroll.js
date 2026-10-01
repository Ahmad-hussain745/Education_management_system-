// Drafts each active teacher's salary record for the month.
//
// DRAFTS ONLY — this creates salary_records/salary_items, which is the
// same thing the Payroll screen's "Generate" button does. It does NOT
// approve, lock, or pay anything: salary_payments is untouched, so no
// money moves and no ledger entry is posted. Approval stays a deliberate
// human action (and an already-locked month is skipped outright).
//
// Uses run_payroll_generation_for_institute() (0045) rather than
// generate_salary_records(), which both requires a signed-in role cron
// doesn't have AND had no institute filter — see that migration's header.
export const payrollJob = {
  key: "payroll",
  name: "Monthly Payroll Drafting",

  async run({ admin, institute, asOf }) {
    const today = asOf ? new Date(asOf) : new Date();
    if (today.getDate() !== 1) {
      return { skipped: true, reason: "Not the 1st of the month" };
    }

    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
    const { data, error } = await admin.rpc("run_payroll_generation_for_institute", {
      p_institute_id: institute.id,
      p_month: month,
    });
    if (error) throw new Error(error.message);

    return {
      itemsProcessed: data ?? 0,
      summary: { month, drafted: data ?? 0, paid: 0, note: "Drafted only — approval and payment remain manual." },
    };
  },
};
