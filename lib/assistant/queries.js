import { thisMonthStart, monthLabel } from "./months";

// Each entry: { requires: roleContext => boolean, run: (supabase, instituteId, params) => verified data object }
// "requires" is this file's own belt-and-braces check — RLS on every
// table/RPC queried below is the actual enforcement layer, same as
// everywhere else in this app. This just means a person without access
// gets a clear "you don't have permission" from the assistant instead of a
// confusing "Rs. 0" that LOOKS like a real, checked answer but is really
// just what an empty RLS-filtered result happens to look like.

// Was: pull every transactions row for the month into JS, sum by type
// there. Now one round trip to get_month_financial_summary() (Priority 4 —
// see that migration's header for the full list of places this exact
// pattern got replaced).
async function monthFinancials(supabase, instituteId, monthStr) {
  const monthEnd = new Date(monthStr + "T00:00:00Z");
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
  const monthEndStr = monthEnd.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .rpc("get_month_financial_summary", { p_institute_id: instituteId, p_start_date: monthStr, p_end_date: monthEndStr })
    .single();
  if (error) throw new Error(error.message);
  return {
    month: monthStr,
    collected: Number(data.collected),
    otherIncome: Number(data.other_income),
    expenses: Number(data.expenses),
    salaries: Number(data.salaries),
  };
}

export const QUERIES = {
  fee_outstanding: {
    requires: (rc) => rc.canViewFees,
    async run(supabase, instituteId, { month }) {
      const { data, error } = await supabase.rpc("fee_arrears_summary", {
        p_class_id: null, p_section_id: null, p_student_id: null,
        p_month: month || null, p_status: null, p_min_balance: 0,
      });
      if (error) throw new Error(error.message);
      const row = data?.[0] || { total_outstanding: 0, students_with_arrears: 0 };
      return { month: month || null, totalOutstanding: Number(row.total_outstanding), studentsWithArrears: Number(row.students_with_arrears) };
    },
  },

  class_most_arrears: {
    requires: (rc) => rc.canViewFees,
    // Was: pull up to 5,000 individual arrears rows via fee_arrears_accounts
    // and group them by class in JS. Now one GROUP BY in Postgres via
    // get_class_arrears_summary(), which shares the same underlying
    // fee_arrears_filtered() base as fee_arrears_accounts/fee_arrears_summary
    // — the numbers can't drift apart from what Reports shows.
    async run(supabase, instituteId) {
      const { data, error } = await supabase.rpc("get_class_arrears_summary", { p_institute_id: instituteId });
      if (error) throw new Error(error.message);
      const ranked = (data || []).map((r) => ({ className: r.class_name || "Unassigned", total: Number(r.total_arrears) }));
      return { ranked };
    },
  },

  students_unpaid_months: {
    requires: (rc) => rc.canViewFees,
    // Was: pull up to 5,000 individual arrears rows via fee_arrears_accounts
    // just to filter by months-overdue and sort in JS — one of the largest
    // one-shot reads anywhere in the assistant. get_students_with_unpaid_
    // months() does the filter/sort/limit in Postgres and returns a real
    // total_count alongside the (small) list actually named in the answer.
    async run(supabase, instituteId, { minMonths }) {
      const { data, error } = await supabase.rpc("get_students_with_unpaid_months", { p_min_months: minMonths, p_limit: 10 });
      if (error) throw new Error(error.message);
      const rows = data || [];
      const matches = rows.map((r) => ({ name: r.student_name, className: r.class_name, months: Number(r.months_count), total: Number(r.total_arrears) }));
      return { minMonths, matches, totalCount: Number(rows[0]?.total_count || 0) };
    },
  },

  salary_spend: {
    requires: (rc) => rc.canViewFinance,
    async run(supabase, instituteId, { month }) {
      const m = month || thisMonthStart();
      const fin = await monthFinancials(supabase, instituteId, m);
      return { month: m, total: fin.salaries };
    },
  },

  expense_total: {
    requires: (rc) => rc.canViewFinance,
    // Was: pull every expense row for the month (re-filtered by category
    // client-side) and sum in JS. get_expense_breakdown() returns the full
    // per-category GROUP BY in one call; picking one category or summing
    // all of them is now a few numbers, not a row-by-row reduce.
    async run(supabase, instituteId, { month, category }) {
      const m = month || thisMonthStart();
      const monthEnd = new Date(m + "T00:00:00Z");
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
      const { data, error } = await supabase.rpc("get_expense_breakdown", {
        p_institute_id: instituteId, p_start_date: m, p_end_date: monthEnd.toISOString().slice(0, 10),
      });
      if (error) throw new Error(error.message);
      const rows = data || [];
      const total = category
        ? Number(rows.find((r) => r.category === category)?.total || 0)
        : rows.reduce((a, r) => a + Number(r.total), 0);
      return { month: m, category: category || null, total };
    },
  },

  collection_rate: {
    requires: (rc) => rc.canViewFees,
    // Was: pull every fee_records row for the month, sum total_payable in
    // JS, divide by monthFinancials' own separate sum. Now a single call —
    // get_collection_rate() computes both halves in Postgres and returns
    // the ratio directly.
    async run(supabase, instituteId, { month }) {
      const m = month || thisMonthStart();
      const { data, error } = await supabase.rpc("get_collection_rate", { p_institute_id: instituteId, p_month: m }).single();
      if (error) throw new Error(error.message);
      return { month: m, expected: Number(data.expected), collected: Number(data.collected), rate: Number(data.rate) };
    },
  },

  low_stock: {
    requires: (rc) => rc.canViewFinance,
    async run(supabase, instituteId) {
      const { data, error } = await supabase.rpc("low_stock_items");
      if (error) throw new Error(error.message);
      return {
        items: (data || []).map((i) => ({ name: i.item_name, remaining: Number(i.remaining), reorderLevel: Number(i.reorder_level), unit: i.unit })),
      };
    },
  },

  attendance_rate: {
    requires: (rc) => rc.canViewFinance,
    // Was: pull every attendance row for the month, filter+divide in JS.
    // Now one get_attendance_summary() call — the exact bug this avoids by
    // construction: the old JS here correctly compared against the real
    // lowercase 'present' enum value, but Analytics' own version of this
    // same pattern compared against "Present" (capitalized) and had been
    // silently wrong since it was written. Doing this once, in SQL,
    // against the actual enum, means neither caller can drift from it again.
    async run(supabase, instituteId, { month, who }) {
      const m = month || thisMonthStart();
      const monthEnd = new Date(m + "T00:00:00Z");
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
      const { data, error } = await supabase.rpc("get_attendance_summary", {
        p_institute_id: instituteId, p_start_date: m, p_end_date: monthEnd.toISOString().slice(0, 10), p_who: who === "teacher" ? "teacher" : "student",
      }).single();
      if (error) throw new Error(error.message);
      return { month: m, who, rate: data.rate === null ? null : Number(data.rate), recordCount: Number(data.total_count) };
    },
  },

  student_count: {
    requires: (rc) => rc.canViewFees,
    async run(supabase, instituteId) {
      const { count, error } = await supabase.from("students").select("id", { count: "exact", head: true })
        .eq("institute_id", instituteId).eq("status", "active");
      if (error) throw new Error(error.message);
      return { count: count || 0 };
    },
  },

  compare_months: {
    requires: (rc) => rc.canViewFinance,
    async run(supabase, instituteId, { monthA, monthB }) {
      const [a, b] = await Promise.all([
        monthFinancials(supabase, instituteId, monthA),
        monthFinancials(supabase, instituteId, monthB),
      ]);
      const growth = (curr, prev) => (prev === 0 ? (curr === 0 ? 0 : null) : ((curr - prev) / prev) * 100);
      return {
        a: { ...a, label: monthLabel(monthA) },
        b: { ...b, label: monthLabel(monthB) },
        collectedGrowthPct: growth(a.collected, b.collected),
      };
    },
  },
};
