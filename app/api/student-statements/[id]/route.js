import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createClient } from "@/lib/supabase/server";

const FEE_TIER = ["Super Admin", "Principal", "Accountant", "Cashier"];

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
function monthLabel(month) {
  if (!month) return "";
  const [y, m] = month.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

// Regenerates the PDF from the database every time (same reasoning as
// /api/receipts and /api/salary-slips) — a statement should be
// re-downloadable later with up-to-date numbers, not a snapshot of whatever
// the browser last rendered. RLS on fee_records ("read: fee staff and
// principal") is the real gate; the role check below just turns "RLS
// returned nothing" into a friendly message instead of a blank PDF.
export async function GET(request, props) {
  const params = await props.params;
  const supabase = await createClient();
  const studentId = params.id;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: me } = await supabase.from("users").select("role:roles(name)").eq("auth_user_id", user.id).maybeSingle();
  if (!FEE_TIER.includes(me?.role?.name)) {
    return NextResponse.json({ error: "Not authorized to view fee statements." }, { status: 403 });
  }

  const { data: student } = await supabase
    .from("students")
    .select("name, student_code, class:classes(name), section:sections(name)")
    .eq("id", studentId)
    .maybeSingle();
  if (!student) return NextResponse.json({ error: "Student not found." }, { status: 404 });

  const { data: feeHistory } = await supabase
    .from("fee_records")
    .select("month, monthly_fee, previous_balance, discount, total_payable, paid_total")
    .eq("student_id", studentId)
    .order("month", { ascending: true });

  const history = feeHistory || [];
  const today = new Date().toISOString().slice(0, 10);
  const currentMonthStr = `${today.slice(0, 7)}-01`;
  const currentBill = history.find((r) => r.month === currentMonthStr) || history[history.length - 1] || null;

  const summaryRows = currentBill
    ? [
        ["Current Fee", fmt(currentBill.monthly_fee)],
        ["Previous Balance", fmt(currentBill.previous_balance)],
        ["Discount", "− " + fmt(currentBill.discount)],
        ["Total Payable", fmt(currentBill.total_payable)],
        ["Paid", fmt(currentBill.paid_total)],
        ["Remaining", fmt(Math.max(0, Number(currentBill.total_payable) - Number(currentBill.paid_total)))],
      ]
    : [];

  const pdf = await PDFDocument.create();
  let page = pdf.addPage([320, 620]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.11, 0.11, 0.16);
  const slate = rgb(0.42, 0.45, 0.5);
  const royal = rgb(0.16, 0.24, 0.55);
  const brick = rgb(0.75, 0.1, 0.15);
  const sage = rgb(0.2, 0.5, 0.35);
  const MARGIN = 24, RIGHT = 320 - MARGIN;

  let y = 580;
  const ensureRoom = (needed) => {
    if (y - needed < 30) {
      page = pdf.addPage([320, 620]);
      y = 580;
    }
  };

  page.drawText(student.name, { x: MARGIN, y, size: 14, font: bold, color: royal });
  y -= 15;
  const sub = `${student.student_code || "no ID assigned"} — ${student.class?.name || ""}${student.section?.name ? ` ${student.section.name}` : ""}`;
  page.drawText(sub, { x: MARGIN, y, size: 8, font, color: slate });
  y -= 12;
  page.drawText("Modern Science Academy - Fee Statement", { x: MARGIN, y, size: 8, font, color: slate });
  y -= 18;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  y -= 16;

  if (!currentBill) {
    page.drawText("No fee bills generated yet for this student.", { x: MARGIN, y, size: 9, font, color: slate });
    y -= 20;
  } else {
    page.drawText("FINANCIAL SUMMARY", { x: MARGIN, y, size: 8, font: bold, color: slate });
    y -= 14;
    for (const [label, value] of summaryRows) {
      page.drawText(label, { x: MARGIN, y, size: 9, font, color: slate });
      const text = String(value ?? "—");
      const width = bold.widthOfTextAtSize(text, 9);
      const color = label === "Remaining" ? (Number(currentBill.total_payable) - Number(currentBill.paid_total) > 0 ? brick : sage) : ink;
      page.drawText(text, { x: RIGHT - width, y, size: 9, font: bold, color });
      y -= 18;
    }

    y -= 8;
    ensureRoom(30 + history.length * 16);
    page.drawText("FEE HISTORY", { x: MARGIN, y, size: 8, font: bold, color: slate });
    y -= 14;
    const cols = [
      { label: "Month", x: MARGIN, w: 110 },
      { label: "Payable", x: MARGIN + 110, w: 62, right: true },
      { label: "Paid", x: MARGIN + 172, w: 62, right: true },
      { label: "Balance", x: MARGIN + 234, w: 62, right: true },
    ];
    cols.forEach((c) => page.drawText(c.label, { x: c.right ? c.x + c.w - font.widthOfTextAtSize(c.label, 7) : c.x, y, size: 7, font, color: slate }));
    y -= 12;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 0.5, color: rgb(0.9, 0.9, 0.9) });
    y -= 12;

    for (const r of history) {
      ensureRoom(16);
      const balance = Number(r.total_payable) - Number(r.paid_total);
      const values = [monthLabel(r.month), fmt(r.total_payable), fmt(r.paid_total), fmt(balance)];
      cols.forEach((c, i) => {
        const text = values[i];
        const size = 8;
        const w = font.widthOfTextAtSize(text, size);
        const color = i === 3 ? (balance > 0 ? brick : sage) : ink;
        page.drawText(text, { x: c.right ? c.x + c.w - w : c.x, y, size, font, color });
      });
      y -= 16;
    }
  }

  const bytes = await pdf.save();
  const safeName = (student.student_code || student.name || "statement").replace(/\s+/g, "-");
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="statement-${safeName}.pdf"`,
    },
  });
}
