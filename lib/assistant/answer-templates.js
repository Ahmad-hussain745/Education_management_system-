import { monthLabel } from "./months";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
function pct(n) {
  return (Math.round(n * 10) / 10) + "%";
}

export const ANSWERS = {
  fee_outstanding: (d) =>
    d.month
      ? `${fmt(d.totalOutstanding)} is outstanding for ${monthLabel(d.month)}, across ${d.studentsWithArrears} student${d.studentsWithArrears === 1 ? "" : "s"}.`
      : `${fmt(d.totalOutstanding)} is currently outstanding in total, across ${d.studentsWithArrears} student${d.studentsWithArrears === 1 ? "" : "s"} with a balance due.`,

  class_most_arrears: (d) => {
    if (d.ranked.length === 0) return "No class currently has any outstanding fees.";
    const top = d.ranked[0];
    const rest = d.ranked.slice(1, 4).map((r) => `${r.className} (${fmt(r.total)})`);
    return `${top.className} has the most arrears, at ${fmt(top.total)}.` + (rest.length ? ` Next: ${rest.join(", ")}.` : "");
  },

  students_unpaid_months: (d) => {
    // d.matches is now capped at 10 rows by get_students_with_unpaid_months()
    // (Priority 5) — d.totalCount is the real count() from Postgres, not
    // matches.length, which would otherwise silently cap at 10 here too.
    if (d.totalCount === 0) return `No students currently have ${d.minMonths} or more months unpaid.`;
    const names = d.matches.map((m) => `${m.name} (${m.className}, ${m.months} month${m.months === 1 ? "" : "s"}, ${fmt(m.total)})`);
    const more = d.totalCount > d.matches.length ? ` and ${d.totalCount - d.matches.length} more` : "";
    return `${d.totalCount} student${d.totalCount === 1 ? "" : "s"} have ${d.minMonths}+ months unpaid: ${names.join("; ")}${more}.`;
  },

  salary_spend: (d) => `${fmt(d.total)} was spent on salaries in ${monthLabel(d.month)}.`,

  expense_total: (d) =>
    d.category
      ? `${fmt(d.total)} was spent on ${d.category} in ${monthLabel(d.month)}.`
      : `${fmt(d.total)} was spent on expenses in ${monthLabel(d.month)}.`,

  collection_rate: (d) =>
    `${pct(d.rate)} collected in ${monthLabel(d.month)} — ${fmt(d.collected)} of ${fmt(d.expected)} expected.`,

  low_stock: (d) => {
    if (d.items.length === 0) return "No items are currently below their minimum stock level.";
    const list = d.items.slice(0, 10).map((i) => `${i.name} (${i.remaining} ${i.unit}, minimum ${i.reorderLevel})`);
    return `${d.items.length} item${d.items.length === 1 ? "" : "s"} below minimum stock: ${list.join("; ")}.`;
  },

  attendance_rate: (d) =>
    d.rate === null
      ? `No ${d.who} attendance has been recorded for ${monthLabel(d.month)} yet.`
      : `${d.who === "teacher" ? "Teacher" : "Student"} attendance for ${monthLabel(d.month)} is ${pct(d.rate)}, from ${d.recordCount} recorded mark${d.recordCount === 1 ? "" : "s"}.`,

  student_count: (d) => `${d.count} active student${d.count === 1 ? "" : "s"} currently.`,

  compare_months: (d) => {
    const growth = d.collectedGrowthPct === null ? "no prior collection to compare against" : `${d.collectedGrowthPct > 0 ? "+" : ""}${pct(d.collectedGrowthPct)} vs ${d.b.label}`;
    return `${d.a.label}: collected ${fmt(d.a.collected)}, expenses ${fmt(d.a.expenses)}, salaries ${fmt(d.a.salaries)}. `
      + `${d.b.label}: collected ${fmt(d.b.collected)}, expenses ${fmt(d.b.expenses)}, salaries ${fmt(d.b.salaries)}. `
      + `Collection growth: ${growth}.`;
  },
};
