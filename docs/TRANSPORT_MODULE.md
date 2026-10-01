# Transport

The README's own "Planned, not built at all" list named this directly.

```
Transport
├── Routes              transport_routes — carries the assigned vehicle + driver
├── Vehicles             transport_vehicles
├── Drivers               transport_drivers (optional link to an HR employees row)
├── Students               (no new table — see transport_assignments)
├── Stops                  transport_stops, ordered per route
├── Assignments            transport_assignments — one ACTIVE row per student
├── Vehicle maintenance    transport_maintenance
├── Fuel                   transport_fuel_logs
└── Transport fees         transport_fee_structures / _records / _payments

maintenance reminders   \
insurance expiry alerts  |  five RPCs, all grounded in real rows — no LLM,
license expiry alerts    >  same "signal from a number, not an opinion"
fuel analytics            | choice as Student Risk Signals and Assignment
route occupancy          /  Difficulty
```

Routes: `/transport` (dashboard), `/transport/routes[/[id]]`,
`/transport/vehicles[/[id]]`, `/transport/drivers`, `/transport/assignments`,
`/transport/fees`. Managing anything is Super Admin/Principal; generating
fees and recording payments also opens to Accountant/Cashier (the same
finance trio as tuition fees). A parent gets one read-only tab,
`/portal/transport`, for their own child.

## Why Transport Fees is its own billing trail, not a column on fee_records

`fee_records.total_payable` is read by more of this app than any other
single number: Ask MSA's `get_fee_summary`, Student Risk's Financial
signal, every Fee/Financial report, receipts, Communication Center
templates. Redefining what it *means* — folding transport charges in —
would silently change "outstanding tuition" everywhere that reads it, for
modules that were never told transport is now mixed in. A second billing
trail (`transport_fee_structures`/`_records`/`_payments`), modeled closely
on `fee_structures`/`fee_records`/`fee_payments` and
`preview_monthly_fee_generation`/`generate_monthly_fee_records` (0001,
0021) but entirely separate, costs one more set of tables and gives every
one of those existing numbers back its original guarantee. Same reasoning
HR used to keep Payroll untouched.

Only a student with an **active** `transport_assignments` row is
billable. Ending an assignment stops future months' bills; past ones are
untouched. A student-specific fee override takes priority over the
route's default rate.

## The five automations, and what "grounded" means for each

- **Maintenance reminders** — each vehicle's *most recent* maintenance
  record (by service date) carries the standing next-due date; an older
  record's due date is superseded, not summed.
- **Insurance / license expiry** — one function, two row kinds, both
  windowed the same way.
- **Fuel analytics** — mileage is (highest − lowest odometer reading
  *actually logged* in the window) ÷ (liters bought in the window). With
  fewer than two odometer readings in the window, mileage comes back
  `null` rather than a number that would look precise but isn't.
- **Route occupancy** — assigned-student count vs. vehicle capacity, with
  an `over_capacity` flag. Not enforced as a hard cap on assignment — a
  route can go over capacity (a real school's reality, e.g. standing room
  on a short run), it's surfaced, not blocked.

## A real bug, found by actually running this against PostgreSQL

No Node/Next.js runtime was available in this session, so the UI itself
was only parsed (esbuild, real JSX parsing — not just brace-matching),
never opened in a browser. But the SQL — the part carrying all the actual
logic — was. A throwaway schema matching this app's real table shapes and
RLS helper signatures was built in a local Postgres 16, every migration
this session has touched (HR, Leave, and this one) was loaded in order,
and the workflow was exercised end to end as different roles.

That caught a real bug before it reached anyone: `get_route_occupancy()`
originally grouped a subquery by a bare `route_id` column. PL/pgSQL
resolves a bare identifier against a function's own OUT parameters
*before* SQL ever sees it — and this function's OUT parameters include
one named `route_id`. The subquery's `route_id` collided with it,
"ambiguous column reference," even though a plain SQL reader would call
the reference obviously unambiguous (there's only one table in that
subquery). Reading the function, this looked completely fine. Running it
didn't lie. The fix was aliasing the subquery's column to something that
doesn't collide (`rid`), and the same defensive aliasing was then applied
to `get_transport_expiry_alerts`' final `ORDER BY`, which had the same
latent shape.

Also verified end to end: quota-free route billing with rollover of
unpaid balances month to month, idempotent regeneration (a second call
for the same month generates nothing new), a student correctly dropped
from future bills the month after their assignment ends, the odometer
bump from maintenance/fuel logs never moving backwards, a single fuel
reading correctly producing no mileage claim, over-capacity correctly
flagged without blocking the assignment, and that the finance-only INSERT
policy on `transport_fee_payments` actually rejects a non-finance role
(tested with a literal fee-record id, specifically because a sub-select
against `transport_fee_records` as an unauthorized role is itself
RLS-blocked and would otherwise turn the test into a silent 0-row no-op
rather than a real rejection — a mistake the test itself made on the
first pass, caught the same way the real bug was: by looking at what
actually happened, not what seemed like it should).

## v1 limits

No vehicle/route history (re-assigning a vehicle or driver on a route
overwrites who was on it before, no log kept), no odometer-based (only
date-based) maintenance due logic, no file attachments for maintenance
invoices or insurance documents, and the UI layer itself was never run in
a browser this session — see above.
