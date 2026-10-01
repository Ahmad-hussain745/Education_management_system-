// Single source of truth for what Phase 28 real-time sync listens to, so
// the migration (0058_realtime_sync.sql), RealtimeSync.js, and any future
// page that wants to know "does this table push live updates?" all read
// the same list instead of three copies drifting apart.
//
// `visible(rc)` mirrors the same role-context flags AppShell.js's buildNav
// already uses for the equivalent nav group — someone who can't see Fee
// Management in the sidebar has no reason to hold open a live channel on
// fee_payments either. This is a UX/cost narrowing, NOT the security
// boundary: RLS (0035_multi_tenancy.sql's institute_isolation policy) is
// what actually stops a payload from ever reaching a socket that isn't
// allowed to see that row, same as every other query in this app.
export const REALTIME_TOPICS = [
  {
    table: "fee_payments",
    events: ["INSERT"],
    visible: (rc) => rc.canViewFees,
    label: (payload) => `New payment recorded — Rs. ${fmtAmount(payload.new?.amount)}`,
  },
  {
    table: "fee_records",
    events: ["UPDATE"],
    visible: (rc) => rc.canViewFees,
    label: () => `A fee record was updated`,
  },
  {
    table: "student_attendance",
    events: ["INSERT", "UPDATE"],
    visible: (rc) => rc.isAdmin || rc.isPrincipal || rc.isTeacher,
    label: () => `Attendance was marked`,
  },
  {
    table: "inventory_stock_movements",
    events: ["INSERT"],
    visible: (rc) => rc.isAdmin || rc.isPrincipal || rc.isFinanceStaff,
    label: (payload) => `Inventory movement recorded${payload.new?.movement_type ? ` (${payload.new.movement_type})` : ""}`,
  },
  {
    table: "notifications",
    events: ["INSERT", "UPDATE"],
    visible: (rc) => rc.canViewFees,
    label: () => `A notification was queued`,
  },
];

function fmtAmount(n) {
  return Math.round(Number(n) || 0).toLocaleString("en-US");
}
