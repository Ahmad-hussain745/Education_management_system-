import { dispatchPendingEvents } from "@/lib/events/dispatcher";

// The reliability net behind the inline dispatch in recordPayment()
// (app/(app)/fees/payments/actions.js). Inline dispatch handles the
// common case — near-instant reaction, same request. This job exists for
// the request that got cut short before the inline call ran, or where the
// inline call itself failed for a transient reason (a brief network blip
// calling out to Resend, say). Without this, a dropped inline dispatch
// would mean that one payment's audit entry and receipt email never
// happen, silently, forever — same "always have a sweep, not just a
// hopeful fire-and-forget" reasoning as every other automation job here.
export const eventDispatchJob = {
  key: "event-dispatch",
  name: "Domain Event Dispatch",

  async run({ admin, institute }) {
    const results = await dispatchPendingEvents(admin, { instituteId: institute.id, limit: 200 });
    const failed = results.filter((r) => r.errors);

    return {
      itemsProcessed: results.length,
      summary: {
        dispatched: results.length,
        failed: failed.length,
        event_types: [...new Set(results.map((r) => r.event_type))],
      },
    };
  },
};
