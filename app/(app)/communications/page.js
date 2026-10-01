import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import Pagination from "@/components/Pagination";
import ReportFilterBar from "@/components/reports/ReportFilterBar";
import NewTemplateForm from "./NewTemplateForm";
import NewCampaignForm from "./NewCampaignForm";
import CampaignRow from "./CampaignRow";
import ProcessQueueButton from "./ProcessQueueButton";
import PushOptIn from "./PushOptIn";

const STATUS_BADGE = {
  queued: "bg-slate-100 text-slate-600",
  sending: "bg-gold-tint text-gold",
  delivered: "bg-emerald-50 text-emerald-700",
  failed: "bg-brick-tint text-brick",
  bounced: "bg-brick-tint text-brick",
};
const CHANNEL_OPTIONS = [
  { value: "whatsapp", label: "WhatsApp" }, { value: "sms", label: "SMS" },
  { value: "email", label: "Email" }, { value: "push", label: "Push" },
];
const PAGE_SIZE = 30;

export default async function CommunicationsPage(props) {
  const searchParams = await props.searchParams;
  await requireRole(["Super Admin", "Principal", "Accountant"]);
  const supabase = await createClient();

  const channel = searchParams?.channel || "";
  const status = searchParams?.status || "";
  const dateFrom = searchParams?.date_from || "";
  const dateTo = searchParams?.date_to || "";
  const page = Math.max(1, Number(searchParams?.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let historyQuery = supabase
    .from("communication_messages")
    .select("id, channel, recipient_type, to_address, status, provider, error, created_at, delivered_at", { count: "exact" })
    .order("created_at", { ascending: false });
  if (channel) historyQuery = historyQuery.eq("channel", channel);
  if (status) historyQuery = historyQuery.eq("status", status);
  if (dateFrom) historyQuery = historyQuery.gte("created_at", dateFrom);
  if (dateTo) historyQuery = historyQuery.lt("created_at", `${dateTo}T23:59:59.999`);

  const [{ data: counts }, { data: templates }, { data: campaigns }, { data: history, count }, { data: classes }] = await Promise.all([
    supabase.rpc("communication_dashboard_counts"),
    supabase.from("communication_templates").select("id, name, channel, subject, body, active").order("created_at", { ascending: false }),
    supabase.from("communication_campaigns").select("id, name, channel, status, audience, created_at").order("created_at", { ascending: false }).limit(10),
    historyQuery.range(from, to),
    supabase.from("classes").select("id, name").order("sort_order"),
  ]);

  const c = counts?.[0] || { queued: 0, delivered: 0, failed: 0, total_last_30_days: 0 };

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Communication Center</h1>
          <p className="text-sm text-slate-500 mt-1">
            WhatsApp, SMS, email, and push — sent through a real provider, queued and retried, every delivery
            recorded. Not a wa.me/mailto: handoff anymore.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PushOptIn />
          <ProcessQueueButton />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 mb-6">
        {[["Queued", c.queued, "text-ink"], ["Delivered", c.delivered, "text-emerald-600"], ["Failed", c.failed, "text-brick"], ["Last 30 Days", c.total_last_30_days, "text-royal"]].map(([label, value, color]) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 p-3">
            <div className="text-xs text-slate-500">{label}</div>
            <div className={`text-xl font-semibold font-mono ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div>
          <h2 className="text-sm font-semibold text-ink mb-2">Templates</h2>
          <NewTemplateForm />
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 mt-3">
            {(templates || []).map((t) => (
              <div key={t.id} className="px-4 py-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium text-ink">{t.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{t.channel}</span>
                </div>
                <p className="text-xs text-slate-500 truncate">{t.body}</p>
              </div>
            ))}
            {(!templates || templates.length === 0) && <p className="px-4 py-6 text-sm text-slate-400 text-center">No templates yet.</p>}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-ink mb-2">Campaigns</h2>
          <NewCampaignForm templates={templates || []} classes={classes || []} />
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 mt-3">
            {(campaigns || []).map((camp) => <CampaignRow key={camp.id} campaign={camp} />)}
            {(!campaigns || campaigns.length === 0) && <p className="px-4 py-6 text-sm text-slate-400 text-center">No campaigns yet.</p>}
          </div>
        </div>
      </div>

      <h2 className="text-sm font-semibold text-ink mb-2">Delivery History</h2>
      <ReportFilterBar
        fields={["dateRange", "category"]}
        values={{ date_from: dateFrom, date_to: dateTo, channel }}
        categoryOptions={CHANNEL_OPTIONS}
        categoryLabel="Channel"
        categoryParam="channel"
      />
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">When</th>
              <th className="text-left px-4 py-3">Channel</th>
              <th className="text-left px-4 py-3">To</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Provider / Error</th>
            </tr>
          </thead>
          <tbody>
            {(history || []).map((m) => (
              <tr key={m.id} className="border-t border-slate-100">
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</td>
                <td className="px-4 py-3 capitalize">{m.channel}</td>
                <td className="px-4 py-3 text-slate-600">{m.to_address || "—"}</td>
                <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[m.status] || ""}`}>{m.status}</span></td>
                <td className="px-4 py-3 text-xs text-slate-500">{m.error || m.provider || "—"}</td>
              </tr>
            ))}
            {(!history || history.length === 0) && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No messages match this filter.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination searchParams={searchParams} page={page} pageSize={PAGE_SIZE} totalCount={count || 0} itemLabel="messages" />
    </div>
  );
}
