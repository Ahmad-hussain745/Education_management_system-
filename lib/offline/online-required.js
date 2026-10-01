// Phase 30 — the shared boundary between OFFLINE OK and ONLINE REQUIRED.
//
// Everything that already has an offline repository under
// lib/offline/repositories/ (students, attendance, fees/payments,
// expenses, inventory) queues into sync_outbox and reconciles later —
// that's the OFFLINE OK half, and it already existed before this phase.
//
// This file is the other half: a single, explicit message plus a couple of
// small primitives (useOnline, OnlineRequiredGate) for the operations that
// must NOT be queued — user administration, role changes, institute
// registration, month closing, payroll approval, final financial
// corrections (reversals), and sensitive settings (institute profile).
// Those either mutate auth/identity directly (Supabase Auth calls aren't
// outbox-able the way a table insert is), or are explicitly meant to be a
// deliberate, permanent, witnessed action (a month-close snapshot, a
// payroll lock, a ledger reversal) — queuing one silently for "whenever
// the connection comes back" would be the wrong behavior even if it were
// technically possible, not just harder to build.
//
// The point of this file: a person doing one of these hits a clear,
// worded message immediately, in the UI, before they've filled in a form
// and pressed submit only to watch it fail — never a raw fetch/network
// error, and never a silent no-op.
export const ONLINE_REQUIRED_MESSAGE = "This operation requires an internet connection.";
