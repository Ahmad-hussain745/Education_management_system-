import { processQueue } from "@/lib/communications/processor";

// No day-of-month gate — unlike fee-generation/payroll, there's no "only
// once a month" concept here. Every tick just drains whatever's queued,
// same shape as event-dispatch.
export const communicationsJob = {
  key: "communications",
  name: "Communication Queue",

  async run({ admin, institute }) {
    const result = await processQueue(admin, institute.id);
    return {
      itemsProcessed: result.processed,
      summary: result,
    };
  },
};
