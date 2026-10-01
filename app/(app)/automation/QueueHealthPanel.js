import { createClient } from "@/lib/supabase/server";
import { QUEUES, QUEUE_NAMES } from "@/lib/queue/queues";
import { QUEUE_HANDLERS } from "@/lib/queue/handlers";

// Read-only view onto queue_metrics()/queue_dead_letter_counts() (see
// migration 20260922060000) — the pgmq queue depth is global (one
// physical queue shared by every institute), while dead-letter counts
// are this institute's own. Queues with no registered worker
// (lib/queue/handlers/index.js) still show up — their depth should
// stay at zero forever, since nothing produces to them yet; that's the
// expected state, not a problem, and the label says so.
export default async function QueueHealthPanel() {
  const supabase = await createClient();
  const [{ data: metricsRows }, { data: deadLetterRows }] = await Promise.all([
    supabase.rpc("queue_metrics"),
    supabase.rpc("queue_dead_letter_counts"),
  ]);

  const metricsByQueue = new Map((metricsRows || []).map((m) => [m.queue_name, m]));
  const deadLettersByQueue = new Map((deadLetterRows || []).map((d) => [d.queue_name, d.unresolved_count]));

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
          <tr>
            <th className="text-left px-4 py-3">Queue</th>
            <th className="text-left px-4 py-3">Depth</th>
            <th className="text-left px-4 py-3">Oldest Message</th>
            <th className="text-left px-4 py-3">Dead Letters</th>
            <th className="text-left px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {QUEUE_NAMES.map((queueName) => {
            const m = metricsByQueue.get(queueName);
            const depth = m?.queue_length ?? 0;
            const oldestSec = m?.oldest_msg_age_sec;
            const deadLetters = deadLettersByQueue.get(queueName) || 0;
            const hasWorker = Boolean(QUEUE_HANDLERS[queueName]);

            return (
              <tr key={queueName} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink">{queueName}</div>
                  <div className="text-xs text-slate-500">{QUEUES[queueName]?.description}</div>
                </td>
                <td className="px-4 py-3 font-mono">{depth}</td>
                <td className="px-4 py-3 text-slate-500">{oldestSec != null ? `${oldestSec}s` : "—"}</td>
                <td className={`px-4 py-3 font-mono ${deadLetters > 0 ? "text-brick" : "text-slate-400"}`}>{deadLetters}</td>
                <td className="px-4 py-3 text-xs">
                  {hasWorker ? (
                    <span className="text-sage">Worker active</span>
                  ) : (
                    <span className="text-slate-400">No worker yet — provisioned only</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
