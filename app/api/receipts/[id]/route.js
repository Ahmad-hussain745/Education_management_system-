import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createClient } from "@/lib/supabase/server";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
function monthLabel(month) {
  if (!month) return "";
  const [y, m] = month.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

// Regenerates the PDF from the database every time, rather than trusting
// whatever the client last had in memory — this is also why it's a GET the
// browser can hit directly (a receipt should be re-downloadable later, not
// just available in the one moment right after payment). RLS on fee_payments
// ("read: fee staff and principal") is what actually decides whether the
// signed-in user is allowed to see this row at all.
export async function GET(request, props) {
  const params = await props.params;
  const supabase = await createClient();
  const paymentId = params.id;

  const { data: payment, error } = await supabase
    .from("fee_payments")
    .select("id, receipt_no, amount, method, paid_on, fee_record_id, student:students(name, student_code, class:classes(name))")
    .eq("id", paymentId)
    .maybeSingle();
  if (error || !payment) {
    return NextResponse.json({ error: "Receipt not found." }, { status: 404 });
  }

  const { data: bill } = await supabase
    .from("fee_records")
    .select("month, monthly_fee, previous_balance, discount, total_payable, paid_total")
    .eq("id", payment.fee_record_id)
    .maybeSingle();

  const remaining = bill ? Math.max(0, Number(bill.total_payable) - Number(bill.paid_total)) : 0;

  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user
    ? await supabase.from("users").select("name").eq("auth_user_id", user.id).maybeSingle()
    : { data: null };

  const rows = [
    ["Receipt No", payment.receipt_no || "—"],
    ["Student", payment.student?.name + (payment.student?.student_code ? ` (${payment.student.student_code})` : "")],
    ["Class", payment.student?.class?.name || "—"],
    ["Month", monthLabel(bill?.month)],
    ["Previous Balance", fmt(bill?.previous_balance)],
    ["Current Fee", fmt(bill?.monthly_fee)],
    ["Discount", "- " + fmt(bill?.discount)],
    ["Paid", fmt(payment.amount)],
    ["Remaining", fmt(remaining)],
    ["Payment Method", payment.method],
    ["Date", payment.paid_on],
    ["Received By", me?.name || "—"],
  ];

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 480]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.11, 0.11, 0.16);
  const slate = rgb(0.42, 0.45, 0.5);
  const sage = rgb(0.2, 0.5, 0.35);

  let y = 440;
  page.drawText("Payment Successful", { x: 24, y, size: 14, font: bold, color: sage });
  y -= 16;
  page.drawText("Modern Science Academy - Fee Receipt", { x: 24, y, size: 8, font, color: slate });
  y -= 20;
  page.drawLine({ start: { x: 24, y }, end: { x: 276, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  y -= 16;

  for (const [label, value] of rows) {
    page.drawText(label, { x: 24, y, size: 9, font, color: slate });
    const text = String(value ?? "—");
    const width = bold.widthOfTextAtSize(text, 9);
    page.drawText(text, { x: 276 - width, y, size: 9, font: bold, color: ink });
    y -= 20;
  }

  const bytes = await pdf.save();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${payment.receipt_no || "receipt"}.pdf"`,
    },
  });
}
