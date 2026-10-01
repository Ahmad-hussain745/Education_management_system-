# Phase 34 — Production Architecture

This is the definitive top-level picture of how the deployed system actually
works, checked against the codebase rather than assumed. It cross-references
three existing detailed audits (`HARDWARE_REQUIREMENTS.md`, Phase 29;
`EVENT_LEDGER_MODEL.md`, Phase 32; `BACKUP_AND_RECOVERY.md`) rather than
repeating them — this document is the map, those are the territory.

Two things in the requested diagram don't match reality and are corrected
below rather than reproduced as asked, with the reasoning kept in place
rather than silently changed: **there is no PC-to-PC sync**, and
**Analytics is not an automation job**. Everything else matches.

## Network topology (corrected)

```
                       INTERNET
                          │
              ┌───────────┴──────────┐
              │                      │
           Vercel                  Supabase
              │                      │
           Next.js                 Auth
        (Server Actions,          PostgreSQL (RLS)
         API routes, cron)         Storage (logos)
              │                    Realtime (postgres_changes)
              │                      │
              └───────────┬──────────┘
                          │
              Each device syncs independently
              with Supabase — never with each other
                          │
              ┌───────────┴───────────┐
              │                       │
         Office PC 1              Office PC 2
        (e.g. Cashier)          (e.g. Principal)
              │                       │
          IndexedDB               IndexedDB
        (Dexie: outbox +          (Dexie: outbox +
         read cache)               read cache)
```

**Why the correction matters, not just cosmetically:** the requested
diagram's middle connector reads as if Office PC 1 and Office PC 2
exchange data with each other — a "Sync Protocol" between them. That
would mean an offline conflict between two cashiers is something the
*devices* have to negotiate. They don't. Every device's IndexedDB outbox
(`lib/offline/sync/outbox.js`) pushes only to Supabase; Supabase's own
constraints (the immutable-ledger triggers, `record_stock_movement()`'s
live availability check, unique indexes) are the only conflict authority.
Two cashiers offline at the same time never talk to one another, directly
or indirectly — they each independently race against the same server-side
rules, and the loser gets a real, human-reviewed conflict
(`lib/offline/sync/conflict-resolver.js`), not a peer negotiation.

**Realtime, not just polling:** `Office PC 2` seeing `Office PC 1`'s
payment without a manual refresh is real (Phase 28,
`components/RealtimeSync.js`) — but it flows *through* Supabase
(`postgres_changes`, RLS-evaluated per subscriber), not PC-to-PC. See that
file's own comment for why this was safe to turn on; it was deliberately
held off in an earlier phase until checked.

## What runs where

Full audit: `docs/HARDWARE_REQUIREMENTS.md` (Phase 29). Short version: the
office PC is disposable commodity hardware — no GPU, no local database
server, nothing that scales with the whole institute's data. Aggregation,
fee/salary calculation, anomaly detection, and authorization are Postgres
functions; the PC renders results, holds the offline outbox, and prints.

## The ledger model

Full audit: `docs/EVENT_LEDGER_MODEL.md` (Phase 32). Short version: every
financial fact is an immutable, append-only event row
(`fee_payments`/`income`/`expenses`/`salary_payments`), corrections post a
new reversal event rather than editing history, and every stored total
(`paid_total`, `current_balance`, item stock) is a derivation from those
events, self-healingly recomputed, never an independently-trusted counter.

## Automation (corrected)

```
Automation (lib/automation/scheduler.js, daily cron + on-demand)
    │
    ├── Fee Generator        — fee-generation
    ├── Reminders             — fee-reminders (queues only, never sends unattended)
    ├── Payroll               — payroll (drafts only, never pays)
    ├── Reconciliation        — reconciliation (reports drift, never auto-corrects)
    ├── Inventory Alerts      — inventory-alerts
    ├── Backups               — backups (verification only — see below)
    ├── Anomaly Detection      — anomaly-detection  (not in the requested list — real, built Phase 23)
    └── Event Dispatch         — event-dispatch     (not in the requested list — real, built Phase 27)
```

**"Analytics" is corrected out of this tree, not just renamed.** Every
report in this app (Management Report, Dashboard figures, the Anomalies
page) queries live on each page load — there is no cached or
pre-aggregated figure anywhere that a scheduled job would refresh. A job
named "Analytics" here would run on a timer and do nothing, because
nothing waits for it. If a future report genuinely needs pre-aggregation
(a materialized view for a very large institute, say), that's the moment
an Analytics job would earn a place in this list — not before.

**"Backups" is real but narrower than its name.** It verifies the database
is alive and row counts haven't dropped unexpectedly; it does not itself
take a backup. Real backups are Supabase's automatic daily backups
(dashboard-configured) and the migration files in this repo, with an
optional on-demand encrypted local export as a third leg. Full reasoning
and the actual recovery procedure: `docs/BACKUP_AND_RECOVERY.md`.

**Two jobs exist beyond the requested seven** because they were built in
response to specific, separate requests earlier (anomaly detection —
Phase 23; the event bus's reliability sweep — Phase 27) and are real,
tested, and already in production use — cut from this diagram, they'd
just be missing from the map, not from the system.

## Standing risk, unchanged from the last full review

The ~20 pre-multi-tenancy `SECURITY DEFINER` functions flagged in the
Phase 21 audit as never having been individually re-checked are still the
largest known risk in this codebase. Every phase since that audit that
touched money, stock, or academic records has found at least one more
institute-boundary bug in *new* code written after the audit — that
pattern is worth treating as a standing item, not a closed finding.
