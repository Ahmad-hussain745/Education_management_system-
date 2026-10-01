import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createClient } from "@/lib/supabase/server";

const FINANCE_TIER = ["Super Admin", "Principal", "Accountant"];

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
function monthLabel(month) {
  if (!month) return "";
  const [y, m] = month.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

export async function GET(request, props) {
  const params = await props.params;
  const supabase = await createClient();
  const recordId = params.id;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: me } = await supabase.from("users").select("id, role:roles(name)").eq("auth_user_id", user.id).maybeSingle();

  const { data: record } = await supabase
    .from("salary_records")
    .select("id, month, base_salary, percentage_total, allowances_total, deductions_total, adjustments_total, gross_salary, paid_total, status, locked, teacher:teachers(name, user_id)")
    .eq("id", recordId)
    .maybeSingle();
  if (!record) return NextResponse.json({ error: "Salary slip not found." }, { status: 404 });

  // Same rule as the page itself — RLS on salary_records/salary_items is the
  // real gate (a Cashier's query below would just come back empty), this is
  // the friendly error instead of a broken/blank PDF.
  const isFinanceTier = FINANCE_TIER.includes(me?.role?.name);
  const isOwnSlip = record.teacher?.user_id === me?.id;
  if (!isFinanceTier && !isOwnSlip) {
    return NextResponse.json({ error: "Not authorized to view this salary slip." }, { status: 403 });
  }

  const { data: items } = await supabase
    .from("salary_items")
    .select("item_type, students_count, collected_amount, percentage, amount, note, class:classes(name), section:sections(name)")
    .eq("salary_record_id", recordId)
    .order("created_at");

  const remaining = Math.max(0, Number(record.gross_salary) - Number(record.paid_total));
  const shareItems = (items || []).filter((it) => it.item_type === "percentage_share");
  const allowanceItems = (items || []).filter((it) => it.item_type === "allowance");
  const deductionItems = (items || []).filter((it) => it.item_type === "deduction");
  const adjustmentItems = (items || []).filter((it) => it.item_type === "adjustment");

  const headerRows = [
    ["Teacher", record.teacher?.name || "—"],
    ["Month", monthLabel(record.month)],
    ["Base Salary", fmt(record.base_salary)],
    ["Percentage Share", fmt(record.percentage_total)],
    ["Allowances", fmt(record.allowances_total)],
    ["Deductions", "- " + fmt(record.deductions_total)],
    ["Adjustments", fmt(record.adjustments_total)],
    ["Gross Salary", fmt(record.gross_salary)],
    ["Paid", fmt(record.paid_total)],
    ["Remaining", fmt(remaining)],
    ["Status", record.status + (record.locked ? " (locked)" : "")],
  ];

  const pdf = await PDFDocument.create();
  let page = pdf.addPage([320, 620]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.11, 0.11, 0.16);
  const slate = rgb(0.42, 0.45, 0.5);
  const royal = rgb(0.16, 0.24, 0.55);
  const W = 320, MARGIN = 24, RIGHT = W - MARGIN;

  let y = W === 320 ? 580 : 580;
  const ensureRoom = (needed) => {
    if (y - needed < 30) {
      page = pdf.addPage([320, 620]);
      y = 580;
    }
  };

  page.drawText(monthLabel(record.month) + " Salary", { x: MARGIN, y, size: 14, font: bold, color: royal });
  y -= 16;
  page.drawText("Modern Science Academy - Salary Slip", { x: MARGIN, y, size: 8, font, color: slate });
  y -= 20;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  y -= 16;

  for (const [label, value] of headerRows) {
    page.drawText(label, { x: MARGIN, y, size: 9, font, color: slate });
    const text = String(value ?? "—");
    const width = bold.widthOfTextAtSize(text, 9);
    page.drawText(text, { x: RIGHT - width, y, size: 9, font: bold, color: ink });
    y -= 18;
  }

  if (shareItems.length > 0) {
    y -= 8;
    ensureRoom(30 + shareItems.length * 16);
    page.drawText("CLASS-WISE PERCENTAGE SHARE", { x: MARGIN, y, size: 8, font: bold, color: slate });
    y -= 14;
    const cols = [
      { label: "Class", x: MARGIN, w: 90 },
      { label: "Students", x: MARGIN + 92, w: 40, right: true },
      { label: "Collected", x: MARGIN + 136, w: 60, right: true },
      { label: "%", x: MARGIN + 198, w: 25, right: true },
      { label: "Amount", x: MARGIN + 225, w: 71, right: true },
    ];
    cols.forEach((c) => page.drawText(c.label, { x: c.right ? c.x + c.w - font.widthOfTextAtSize(c.label, 7) : c.x, y, size: 7, font, color: slate }));
    y -= 12;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 0.5, color: rgb(0.9, 0.9, 0.9) });
    y -= 12;

    for (const it of shareItems) {
      ensureRoom(16);
      const className = (it.class?.name || "") + (it.section?.name ? ` (${it.section.name})` : "");
      const values = [className, String(it.students_count ?? "—"), fmt(it.collected_amount), `${it.percentage}%`, fmt(it.amount)];
      cols.forEach((c, i) => {
        const text = values[i];
        const size = 8;
        const w = font.widthOfTextAtSize(text, size);
        page.drawText(text, { x: c.right ? c.x + c.w - w : c.x, y, size, font, color: ink });
      });
      y -= 16;
    }
  }

  if (allowanceItems.length > 0) {
    y -= 8;
    ensureRoom(20 + allowanceItems.length * 16);
    page.drawText("ALLOWANCES", { x: MARGIN, y, size: 8, font: bold, color: slate });
    y -= 14;
    for (const it of allowanceItems) {
      ensureRoom(16);
      page.drawText(it.note || "Allowance", { x: MARGIN, y, size: 8, font, color: ink });
      const text = "+ " + fmt(it.amount);
      const w = bold.widthOfTextAtSize(text, 8);
      page.drawText(text, { x: RIGHT - w, y, size: 8, font: bold, color: ink });
      y -= 16;
    }
  }

  if (deductionItems.length > 0) {
    y -= 8;
    ensureRoom(20 + deductionItems.length * 16);
    page.drawText("DEDUCTIONS", { x: MARGIN, y, size: 8, font: bold, color: slate });
    y -= 14;
    for (const it of deductionItems) {
      ensureRoom(16);
      page.drawText(it.note || "Deduction", { x: MARGIN, y, size: 8, font, color: ink });
      const text = "- " + fmt(it.amount);
      const w = bold.widthOfTextAtSize(text, 8);
      page.drawText(text, { x: RIGHT - w, y, size: 8, font: bold, color: ink });
      y -= 16;
    }
  }

  if (adjustmentItems.length > 0) {
    y -= 8;
    ensureRoom(20 + adjustmentItems.length * 16);
    page.drawText("ADJUSTMENTS", { x: MARGIN, y, size: 8, font: bold, color: slate });
    y -= 14;
    for (const it of adjustmentItems) {
      ensureRoom(16);
      page.drawText(it.note || "Adjustment", { x: MARGIN, y, size: 8, font, color: ink });
      const text = fmt(it.amount);
      const w = bold.widthOfTextAtSize(text, 8);
      page.drawText(text, { x: RIGHT - w, y, size: 8, font: bold, color: ink });
      y -= 16;
    }
  }

  const bytes = await pdf.save();
  const safeName = `${monthLabel(record.month).replace(/\s+/g, "-")}-${(record.teacher?.name || "salary").replace(/\s+/g, "-")}`;
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeName}.pdf"`,
    },
  });
}
