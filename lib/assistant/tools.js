import { thisMonthStart, monthLabel } from "./months";
import { resolveClassId, resolveExam, resolveMonth } from "./resolve";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
function pct(n) {
  return (Math.round(n * 10) / 10) + "%";
}

// ============================================================================
// AI → approved tool → validated parameters → authorized RPC → database
//
// This file is the ENTIRE surface the LLM router (lib/assistant/llm.js)
// can act through. Each entry below has exactly three things:
//   input_schema — what Claude is allowed to send (JSON Schema, given to
//                  the API as this tool's declared "function" — Claude
//                  physically cannot call anything not shaped like this)
//   requires     — the same belt-and-braces role check queries.js's
//                  QUERIES always had; RLS on every table/RPC below is
//                  still the real enforcement layer
//   run          — resolves Claude's free-text parameters against real
//                  rows (lib/assistant/resolve.js) and calls ONE
//                  parameterized, authorized RPC — never composes SQL,
//                  never touches a table Claude named itself (it can't;
//                  nothing here takes a table name as a parameter)
//   describe     — the deterministic natural-language template, used
//                  whenever the LLM phrasing step is unavailable OR its
//                  reply fails the grounding check (llm.js's
//                  numbersAreGrounded) — the same guarantee the original
//                  rule-based assistant always had: an answer built only
//                  from what the tool actually returned.
// ============================================================================

export const TOOLS = {
  get_fee_summary: {
    description:
      "Total outstanding/unpaid school fees, and (institute-wide only) the collection rate for a month. Use for questions like 'how much fee is outstanding', 'how much fee is due from Class 10', 'what's our collection rate this month'.",
    input_schema: {
      type: "object",
      properties: {
        class: { type: "string", description: "Class name or number, e.g. 'Class 10' or '10'. Omit for the whole institute." },
        month: { type: "string", description: "A month like 'September' or 'this month'. Omit for the current overall balance." },
      },
    },
    requires: (rc) => rc.canViewFees,
    async run(supabase, instituteId, { class: classText, month: monthText }) {
      let classId = null, className = null;
      if (classText) {
        const resolved = await resolveClassId(supabase, instituteId, classText);
        if (!resolved.id) throw new Error(`Couldn't find a class matching "${classText}".`);
        classId = resolved.id; className = resolved.name;
      }
      const month = resolveMonth(monthText);

      const { data, error } = await supabase.rpc("fee_arrears_summary", {
        p_class_id: classId, p_section_id: null, p_student_id: null, p_month: month, p_status: null, p_min_balance: 0,
      });
      if (error) throw new Error(error.message);
      const row = data?.[0] || { total_outstanding: 0, students_with_arrears: 0, one_month: 0, two_months: 0, three_plus_months: 0 };

      let collectionRate = null;
      if (!classId) {
        const m = month || thisMonthStart();
        const { data: rateData } = await supabase.rpc("get_collection_rate", { p_institute_id: instituteId, p_month: m }).single();
        if (rateData) collectionRate = { month: m, expected: Number(rateData.expected), collected: Number(rateData.collected), rate: Number(rateData.rate) };
      }

      return {
        className, month,
        totalOutstanding: Number(row.total_outstanding),
        studentsWithArrears: Number(row.students_with_arrears),
        oneMonth: Number(row.one_month), twoMonths: Number(row.two_months), threePlusMonths: Number(row.three_plus_months),
        collectionRate,
      };
    },
    describe(d) {
      const scope = d.className ? ` in ${d.className}` : "";
      const when = d.month ? ` for ${monthLabel(d.month)}` : "";
      let out = `${fmt(d.totalOutstanding)} is outstanding${scope}${when}, across ${d.studentsWithArrears} student${d.studentsWithArrears === 1 ? "" : "s"} (${d.oneMonth} one month behind, ${d.twoMonths} two months, ${d.threePlusMonths} three or more).`;
      if (d.collectionRate) out += ` Collection rate for ${monthLabel(d.collectionRate.month)}: ${pct(d.collectionRate.rate)} (${fmt(d.collectionRate.collected)} of ${fmt(d.collectionRate.expected)} expected).`;
      return out;
    },
  },

  get_student_arrears: {
    description:
      "Which classes or individual students have unpaid fees. With no filters, ranks classes by total arrears. With a class and/or a minimum number of unpaid months, lists the actual students matching. Use for 'which class has the most arrears', 'which students have 3+ months unpaid', 'who in Class 10 owes fees'.",
    input_schema: {
      type: "object",
      properties: {
        class: { type: "string", description: "Class name or number, e.g. 'Class 10' or '10'." },
        min_months: { type: "integer", description: "Only students with at least this many unpaid months." },
        limit: { type: "integer", description: "Max students to list. Default 10." },
      },
    },
    requires: (rc) => rc.canViewFees,
    async run(supabase, instituteId, { class: classText, min_months: minMonths, limit }) {
      let classId = null, className = null;
      if (classText) {
        const resolved = await resolveClassId(supabase, instituteId, classText);
        if (!resolved.id) throw new Error(`Couldn't find a class matching "${classText}".`);
        classId = resolved.id; className = resolved.name;
      }

      if (!classId && minMonths == null) {
        const { data, error } = await supabase.rpc("get_class_arrears_summary", { p_institute_id: instituteId });
        if (error) throw new Error(error.message);
        return { mode: "ranked", ranked: (data || []).map((r) => ({ className: r.class_name || "Unassigned", total: Number(r.total_arrears) })) };
      }

      const { data, error } = await supabase.rpc("get_students_with_unpaid_months", {
        p_min_months: minMonths ?? 0, p_limit: limit || 10, p_class_id: classId, p_section_id: null,
      });
      if (error) throw new Error(error.message);
      const rows = data || [];
      return {
        mode: "list", className, minMonths: minMonths ?? 0,
        matches: rows.map((r) => ({ name: r.student_name, className: r.class_name, months: Number(r.months_count), total: Number(r.total_arrears) })),
        totalCount: Number(rows[0]?.total_count || 0),
      };
    },
    describe(d) {
      if (d.mode === "ranked") {
        if (d.ranked.length === 0) return "No class currently has any outstanding fees.";
        const top = d.ranked[0];
        const rest = d.ranked.slice(1, 4).map((r) => `${r.className} (${fmt(r.total)})`);
        return `${top.className} has the most arrears, at ${fmt(top.total)}.` + (rest.length ? ` Next: ${rest.join(", ")}.` : "");
      }
      const scope = d.className ? ` in ${d.className}` : "";
      if (d.totalCount === 0) return `No students${scope} currently have ${d.minMonths || "any"}+ months unpaid.`;
      const names = d.matches.map((m) => `${m.name} (${m.className}, ${m.months} month${m.months === 1 ? "" : "s"}, ${fmt(m.total)})`);
      const more = d.totalCount > d.matches.length ? ` and ${d.totalCount - d.matches.length} more` : "";
      return `${d.totalCount} student${d.totalCount === 1 ? "" : "s"}${scope} have ${d.minMonths || "1+"} month${d.minMonths === 1 ? "" : "s"} or more unpaid: ${names.join("; ")}${more}.`;
    },
  },

  get_attendance: {
    description: "Student or teacher attendance rate for a month. Use for 'what's the attendance rate', 'teacher attendance this month'.",
    input_schema: {
      type: "object",
      properties: {
        who: { type: "string", enum: ["student", "teacher"], description: "Whose attendance. Default student." },
        month: { type: "string", description: "A month like 'September' or 'this month'. Default the current month." },
      },
    },
    requires: (rc) => rc.canViewFinance,
    async run(supabase, instituteId, { who, month: monthText }) {
      const m = resolveMonth(monthText) || thisMonthStart();
      const monthEnd = new Date(m + "T00:00:00Z");
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
      const { data, error } = await supabase.rpc("get_attendance_summary", {
        p_institute_id: instituteId, p_start_date: m, p_end_date: monthEnd.toISOString().slice(0, 10), p_who: who === "teacher" ? "teacher" : "student",
      }).single();
      if (error) throw new Error(error.message);
      return { month: m, who: who === "teacher" ? "teacher" : "student", rate: data.rate === null ? null : Number(data.rate), recordCount: Number(data.total_count) };
    },
    describe(d) {
      return d.rate === null
        ? `No ${d.who} attendance has been recorded for ${monthLabel(d.month)} yet.`
        : `${d.who === "teacher" ? "Teacher" : "Student"} attendance for ${monthLabel(d.month)} is ${pct(d.rate)}, from ${d.recordCount} recorded mark${d.recordCount === 1 ? "" : "s"}.`;
    },
  },

  get_salary_summary: {
    description: "Total salary/payroll spend for a month. Use for 'how much did we spend on salaries', 'payroll cost this month'.",
    input_schema: {
      type: "object",
      properties: { month: { type: "string", description: "A month like 'September' or 'this month'. Default the current month." } },
    },
    requires: (rc) => rc.canViewFinance,
    async run(supabase, instituteId, { month: monthText }) {
      const m = resolveMonth(monthText) || thisMonthStart();
      const monthEnd = new Date(m + "T00:00:00Z");
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
      const { data, error } = await supabase.rpc("get_month_financial_summary", {
        p_institute_id: instituteId, p_start_date: m, p_end_date: monthEnd.toISOString().slice(0, 10),
      }).single();
      if (error) throw new Error(error.message);
      return { month: m, total: Number(data.salaries) };
    },
    describe(d) { return `${fmt(d.total)} was spent on salaries in ${monthLabel(d.month)}.`; },
  },

  get_expense_summary: {
    description: "Total (or one category's) operating expenses for a month, excluding salaries. Use for 'how much did we spend on electricity', 'total expenses this month'.",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "string", description: "A month like 'September' or 'this month'. Default the current month." },
        category: { type: "string", description: "A specific expense category, e.g. Electricity, Stationery, Maintenance, Transport. Omit for the total across all categories." },
      },
    },
    requires: (rc) => rc.canViewFinance,
    async run(supabase, instituteId, { month: monthText, category }) {
      const m = resolveMonth(monthText) || thisMonthStart();
      const monthEnd = new Date(m + "T00:00:00Z");
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
      const { data, error } = await supabase.rpc("get_expense_breakdown", {
        p_institute_id: instituteId, p_start_date: m, p_end_date: monthEnd.toISOString().slice(0, 10),
      });
      if (error) throw new Error(error.message);
      const rows = data || [];
      const matchedCategory = category ? rows.find((r) => r.category?.toLowerCase() === category.toLowerCase())?.category || null : null;
      const total = matchedCategory
        ? Number(rows.find((r) => r.category === matchedCategory).total)
        : rows.reduce((a, r) => a + Number(r.total), 0);
      return { month: m, category: matchedCategory, total };
    },
    describe(d) {
      return d.category
        ? `${fmt(d.total)} was spent on ${d.category} in ${monthLabel(d.month)}.`
        : `${fmt(d.total)} was spent on expenses in ${monthLabel(d.month)}.`;
    },
  },

  get_inventory_alerts: {
    description: "Items currently below their minimum stock level. Use for 'which items are low on stock', 'reorder alerts'.",
    input_schema: { type: "object", properties: {} },
    requires: (rc) => rc.canViewFinance,
    async run(supabase) {
      const { data, error } = await supabase.rpc("low_stock_items");
      if (error) throw new Error(error.message);
      return { items: (data || []).map((i) => ({ name: i.item_name, remaining: Number(i.remaining), reorderLevel: Number(i.reorder_level), unit: i.unit })) };
    },
    describe(d) {
      if (d.items.length === 0) return "No items are currently below their minimum stock level.";
      const list = d.items.slice(0, 10).map((i) => `${i.name} (${i.remaining} ${i.unit}, minimum ${i.reorderLevel})`);
      return `${d.items.length} item${d.items.length === 1 ? "" : "s"} below minimum stock: ${list.join("; ")}.`;
    },
  },

  get_exam_results: {
    description:
      "Exam performance summary — average %, highest/lowest, pass/fail counts — for an exam, optionally narrowed to one class. Use for 'how did Class 10 do in the Mid Term', 'exam results for the last test'.",
    input_schema: {
      type: "object",
      properties: {
        exam: { type: "string", description: "Exam name, e.g. 'Mid Term 2026'. Omit for the most recent exam." },
        class: { type: "string", description: "Class name or number, e.g. 'Class 10' or '10'. Omit for a breakdown across every class." },
      },
    },
    requires: (rc) => rc.canViewFinance,
    async run(supabase, instituteId, { exam: examText, class: classText }) {
      const exam = await resolveExam(supabase, instituteId, examText);
      if (!exam.id) throw new Error(examText ? `Couldn't find an exam matching "${examText}".` : "No exams found for this institute yet.");

      let classId = null, className = null;
      if (classText) {
        const resolved = await resolveClassId(supabase, instituteId, classText);
        if (!resolved.id) throw new Error(`Couldn't find a class matching "${classText}".`);
        classId = resolved.id; className = resolved.name;
      }

      const { data, error } = await supabase.rpc("get_exam_summary", { p_exam_id: exam.id, p_class_id: classId });
      if (error) throw new Error(error.message);
      const rows = (data || []).map((r) => ({
        className: r.class_name, studentsCount: Number(r.students_count), avgPercentage: Number(r.avg_percentage),
        highestPercentage: Number(r.highest_percentage), lowestPercentage: Number(r.lowest_percentage),
        passCount: Number(r.pass_count), failCount: Number(r.fail_count),
      }));
      return { examName: exam.name, filteredClassName: className, classes: rows };
    },
    describe(d) {
      if (d.classes.length === 0) return `No published results yet for ${d.examName}${d.filteredClassName ? ` in ${d.filteredClassName}` : ""}.`;
      if (d.classes.length === 1) {
        const c = d.classes[0];
        return `${d.examName}${c.className && c.className !== "Unassigned" ? ` — ${c.className}` : ""}: average ${pct(c.avgPercentage)} across ${c.studentsCount} student${c.studentsCount === 1 ? "" : "s"}, highest ${pct(c.highestPercentage)}, lowest ${pct(c.lowestPercentage)}. ${c.passCount} passed, ${c.failCount} failed.`;
      }
      const totalStudents = d.classes.reduce((a, c) => a + c.studentsCount, 0);
      const weightedAvg = totalStudents ? d.classes.reduce((a, c) => a + c.avgPercentage * c.studentsCount, 0) / totalStudents : 0;
      const byClass = d.classes.map((c) => `${c.className}: ${pct(c.avgPercentage)} (${c.passCount} passed, ${c.failCount} failed)`);
      return `${d.examName} — overall average ${pct(weightedAvg)} across ${totalStudents} students. By class: ${byClass.join("; ")}.`;
    },
  },

  get_management_report: {
    description:
      "Recent financial trend, this-month-vs-last-month comparison, alerts, and a forward collection forecast. Use for broad 'how are we doing financially', 'give me the management report' style questions.",
    input_schema: {
      type: "object",
      properties: { months: { type: "integer", description: "How many recent months of trend to include, 1-24. Default 6." } },
    },
    requires: (rc) => rc.canViewFinance,
    async run(supabase, instituteId, { months }) {
      const { computeForecast, computeAlerts } = await import("@/lib/reports/management");
      const n = Math.max(1, Math.min(24, months || 6));
      const [{ data: trend, error: trendError }, { data: comparisonRows, error: compError }] = await Promise.all([
        supabase.rpc("finance_monthly_trend", { p_institute_id: instituteId, p_months: n }),
        supabase.rpc("finance_month_comparison", { p_institute_id: instituteId }),
      ]);
      if (trendError) throw new Error(trendError.message);
      if (compError) throw new Error(compError.message);

      const comparison = comparisonRows?.[0] || null;
      const forecast = computeForecast(trend || []);
      const alerts = computeAlerts(trend || [], comparison);

      return {
        months: n,
        comparison: comparison && {
          thisMonth: comparison.this_month, thisCollected: Number(comparison.this_collected), thisExpenses: Number(comparison.this_expenses),
          lastMonth: comparison.last_month, lastCollected: Number(comparison.last_collected), lastExpenses: Number(comparison.last_expenses),
          collectionGrowthPct: comparison.collection_growth_pct == null ? null : Number(comparison.collection_growth_pct),
        },
        forecast,
        alerts,
      };
    },
    describe(d) {
      const parts = [];
      if (d.comparison) {
        const growth = d.comparison.collectionGrowthPct == null ? "no prior month to compare" : `${d.comparison.collectionGrowthPct > 0 ? "+" : ""}${d.comparison.collectionGrowthPct}% vs last month`;
        parts.push(`${monthLabel(d.comparison.thisMonth)}: collected ${fmt(d.comparison.thisCollected)}, expenses ${fmt(d.comparison.thisExpenses)} (${growth}).`);
      }
      if (d.forecast) {
        parts.push(`Forecast for next month: ${fmt(d.forecast.projected)} (projected, based on ${Math.abs(d.forecast.avgGrowthPct)}% average ${d.forecast.avgGrowthPct >= 0 ? "growth" : "decline"} over the last ${d.forecast.basedOnMonths} month${d.forecast.basedOnMonths === 1 ? "" : "s"} — not actual accounting).`);
      } else {
        parts.push("Not enough collection history yet to project a forecast.");
      }
      if (d.alerts.length) parts.push(d.alerts.map((a) => a.text).join(" "));
      return parts.join(" ");
    },
  },
};

// Anthropic tool_use schema shape — name + description + input_schema,
// nothing else. This is the literal list handed to the API; Claude can
// select from these eight and nothing more.
export function toolSchemas() {
  return Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, input_schema: t.input_schema }));
}
