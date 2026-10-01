// Queues reminder/overdue notices on the 10th, 20th and 25th.
//
// QUEUES only — nothing is sent. The notification rows land with
// status='queued' and no channel; a staff member still opens
// Notifications and sends them (which, even then, only reaches 'ready'
// for WhatsApp/SMS — see 0047_notification_status_lifecycle.sql). A cron
// job should not be what puts a message in a parent's inbox unreviewed,
// and this codebase should not claim a message was delivered when all it
// actually knows is that a link got clicked.
export const feeRemindersJob = {
  key: "fee-reminders",
  name: "Fee Reminder Scheduling",

  async run({ admin, institute, asOf }) {
    const date = asOf || new Date().toISOString().slice(0, 10);
    const { data, error } = await admin.rpc("run_fee_reminder_schedule_for_institute", {
      p_institute_id: institute.id,
      p_as_of: date,
    });
    if (error) throw new Error(error.message);

    const r = data?.[0] || {};
    if (!r.template_key) {
      return { skipped: true, reason: "Not a reminder day (10th/20th/25th)" };
    }
    return {
      itemsProcessed: r.queued_count ?? 0,
      summary: { template: r.template_key, queued: r.queued_count ?? 0, sent: 0 },
    };
  },
};
