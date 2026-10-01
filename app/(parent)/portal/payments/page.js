import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { resolveSelectedChild } from "@/lib/parent-portal/child";
import { fmt, fmtDate } from "@/lib/parent-portal/format";

// "Online receipt": /api/receipts/[id] regenerates the PDF from the
// database on every request and has no role gate of its own — it relies
// entirely on fee_payments' RLS (0030_parent_portal.sql's "parent reads
// own children's payments" policy) to decide access, so a parent hitting
// this link for their own child's payment already works with no backend
// change needed here.
export default async function PaymentsPage(props) {
  const searchParams = await props.searchParams;
  const roleContext = await getRoleContext();
  const kids = roleContext?.children || [];
  if (kids.length === 0) return null;
  const child = resolveSelectedChild(searchParams, kids);

  const supabase = await createClient();
  const { data } = await supabase
    .from("fee_payments")
    .select("id, amount, method, paid_on, receipt_no, remarks")
    .eq("student_id", child.id)
    .order("paid_on", { ascending: false });

  const rows = data || [];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-ink">Payment History — {child.name}</h1>

      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400 p-5">No payments recorded yet.</p>
        ) : (
          rows.map((p) => (
            <div key={p.id} className="p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-ink font-mono">{fmt(p.amount)}</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {fmtDate(p.paid_on)} · {p.method}{p.receipt_no ? ` · Receipt ${p.receipt_no}` : ""}
                </div>
                {p.remarks && <div className="text-xs text-slate-400 mt-0.5">{p.remarks}</div>}
              </div>
              <a
                href={`/api/receipts/${p.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
              >
                Download Receipt
              </a>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
