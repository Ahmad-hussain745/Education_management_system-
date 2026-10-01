import { db } from "../db";
import * as outbox from "./outbox";
import * as attendanceRepo from "../repositories/attendance";
import * as expensesRepo from "../repositories/expenses";
import * as inventoryRepo from "../repositories/inventory";
import * as paymentsRepo from "../repositories/payments";
import * as studentsRepo from "../repositories/students";
import { getConnectivity } from "../connectivity";

const MAX_ATTEMPTS_BEFORE_FLAGGING = 5;

// Entities whose local record needs to visibly reflect "this specific
// thing didn't sync" — not just a generic conflicts-list entry — because a
// human already acted on the local copy (handed a receipt to a parent,
// filled out intake paperwork for a student) before sync could confirm or
// reject it. See each repo's own markConflict() for why.
const CONFLICT_AWARE_REPOS = { payments: paymentsRepo, students: studentsRepo };

// The local Dexie store is named "attendance" for simplicity (matches the
// requested store list), but the real table is student_attendance — this
// is the one place that mapping lives.
const REMOTE_TABLE = { attendance: "student_attendance", expenses: "expenses" };

async function pushOne(supabase, entry) {
  await outbox.markSyncing(entry.id);

  try {
    if (entry.entity === "attendance") {
      // Delete-then-insert, scoped to just this one student's row — NOT a
      // plain insert relying on the unique constraint, because
      // section_id/subject_id are nullable and Postgres never treats two
      // NULLs as equal for uniqueness, so a plain insert would silently
      // accumulate duplicate rows across corrections instead of the
      // "last write wins" the online action (delete-then-insert for the
      // WHOLE day) already relies on. See repositories/attendance.js's file
      // comment for the full reasoning. Scoping the delete to this single
      // student (not the whole day) matters here specifically because the
      // outbox processes one row per student — a whole-day delete would
      // wipe out a sibling entry from the SAME batch that already landed.
      let delQuery = supabase
        .from(REMOTE_TABLE.attendance)
        .delete()
        .eq("student_id", entry.payload.student_id)
        .eq("date", entry.payload.date)
        .eq("class_id", entry.payload.class_id);
      delQuery = entry.payload.section_id ? delQuery.eq("section_id", entry.payload.section_id) : delQuery.is("section_id", null);
      delQuery = entry.payload.subject_id ? delQuery.eq("subject_id", entry.payload.subject_id) : delQuery.is("subject_id", null);
      const { error: delError } = await delQuery;
      if (delError) throw delError;

      const { error } = await supabase.from(REMOTE_TABLE.attendance).insert(entry.payload);
      if (error) throw error;
      await attendanceRepo.markSynced(entry.entity_id);
    } else if (entry.entity === "expenses") {
      // Goes through request_expense() (0056_approval_workflows.sql), not
      // a raw insert — that RPC is the ONLY place that knows about the
      // institute's large-expense threshold. A raw upsert straight into
      // `expenses` here would let an offline-recorded large expense skip
      // the whole approval workflow and post straight to the ledger —
      // exactly the loophole that migration's own comment calls out.
      // Idempotency still works the same way, just via the RPC's own
      // p_idempotency_key handling (checks both `expenses` and
      // `expense_requests` for an existing row before creating either).
      const { data, error } = await supabase.rpc("request_expense", {
        p_category: entry.payload.category,
        p_description: entry.payload.description,
        p_amount: entry.payload.amount,
        p_method: entry.payload.method,
        p_expense_date: entry.payload.expense_date,
        p_idempotency_key: entry.idempotency_key,
      });
      if (error) throw error;
      await expensesRepo.markSynced(entry.entity_id, data);
    } else if (entry.entity === "inventory") {
      // Goes through the RPC, not a raw insert — record_stock_movement()
      // is where the live stock-availability check happens, and (as of
      // 0041) also where p_idempotency_key short-circuits a retry of an
      // already-applied movement before re-checking availability.
      const { error } = await supabase.rpc("record_stock_movement", {
        ...entry.payload,
        p_idempotency_key: entry.idempotency_key,
      });
      if (error) throw error;
      await inventoryRepo.markSynced(entry.entity_id);
    } else if (entry.entity === "inventory_purchase") {
      // record_inventory_purchase() does the expense insert, the purchase
      // row, and the stock movement in ONE transaction (0028, made
      // idempotent in 0044), so a purchase can't half-apply — either the
      // money and the stock both land, or neither does. The ledger and
      // audit entries follow from the expense insert via the existing
      // trg_expenses_ledger trigger, exactly as they would online.
      const { error: purchaseError } = await supabase.rpc("record_inventory_purchase", {
        ...entry.payload,
        p_idempotency_key: entry.idempotency_key,
      });
      if (purchaseError) throw purchaseError;
      await inventoryRepo.markSynced(entry.entity_id);
    } else if (entry.entity === "payments") {
      // record_fee_payment() (0042_payment_idempotency.sql) — the same RPC
      // the online Payment Entry form calls, with the same idempotency_key
      // handling: if this exact key already landed (this device's own
      // retry, or the response from an earlier attempt got lost), it hands
      // back that existing row instead of erroring. It also still runs the
      // real BEFORE INSERT triggers (amount-vs-live-remaining, month-open)
      // that the offline cap in payments.js only approximated — this call
      // is where a stale local guess either gets confirmed for real or
      // gets caught.
      const { data, error } = await supabase.rpc("record_fee_payment", {
        ...entry.payload,
        p_idempotency_key: entry.idempotency_key,
      });
      if (error) throw error;
      await paymentsRepo.markSynced(entry.entity_id, data);
    } else if (entry.entity === "students") {
      // create_student() (0043_offline_student_registration.sql) — same
      // idempotency handling as record_fee_payment() above, and this is
      // also where the OFFICIAL student_code finally gets assigned: the
      // local record has never had one (see registerStudentOffline() in
      // repositories/students.js), only a local_id/local_ref. markSynced()
      // below is what turns "offline://device-a1b2c3/550e8400..." into
      // "MSA-2026-00127" in the UI.
      const { data, error } = await supabase.rpc("create_student", {
        ...entry.payload,
        p_idempotency_key: entry.idempotency_key,
      });
      if (error) throw error;
      await studentsRepo.markSynced(entry.entity_id, data);
    } else if (entry.entity === "student_contact") {
      // Phase 31 — low-risk fields (guardian_name/guardian_phone/address):
      // deliberately last-write-wins. A plain UPDATE, no RPC, no
      // idempotency check, no sync_conflicts entry possible — whichever
      // device's update reaches the server last is simply correct, by
      // design (see repositories/students.js's queueContactUpdate() for
      // the full reasoning). If this update legitimately fails (RLS
      // denies it because this person's role changed, or the student was
      // deleted server-side), it falls through to handleFailure() below
      // like anything else and gets retried/flagged the normal way — the
      // "no conflict resolution" choice is specifically about not treating
      // *another device's* concurrent edit as something to detect, not
      // about ignoring real errors.
      const { error } = await supabase
        .from("students")
        .update({
          guardian_name: entry.payload.guardian_name,
          guardian_phone: entry.payload.guardian_phone,
          address: entry.payload.address,
        })
        .eq("id", entry.payload.student_id);
      if (error) throw error;
      await outbox.markSynced(entry.id);
      return { status: "synced", entry };
    } else {
      throw new Error(`Unknown outbox entity: ${entry.entity}`);
    }
    await outbox.markSynced(entry.id);
    return { status: "synced", entry };
  } catch (err) {
    return await handleFailure(entry, err);
  }
}

async function handleFailure(entry, err) {
  const message = err?.message || String(err);

  // A genuine business-rule rejection that needs a human, not a retry —
  // insufficient stock, an overpayment race, the accounting month having
  // been closed by someone else before this synced, an offline
  // registration with a blank name somehow reaching this point, or
  // (payments/students only) a role change server-side that revoked this
  // person's authorization between acting offline and syncing.
  if (
    message.includes("INSUFFICIENT_STOCK") ||
    message.includes("PAYMENT_EXCEEDS_REMAINING") ||
    message.includes("MONTH_CLOSED") ||
    message.includes("INVALID_NAME") ||
    (CONFLICT_AWARE_REPOS[entry.entity] && message.includes("NOT_AUTHORIZED"))
  ) {
    await db.sync_conflicts.add({
      entity: entry.entity,
      entity_id: entry.entity_id,
      payload: entry.payload,
      reason: message,
      created_at: new Date().toISOString(),
      resolved: false,
    });
    await outbox.markConflict(entry.id, message);
    // A rejected payment or registration isn't a "try again later" state
    // the way a rejected expense or attendance mark might be — a human
    // already acted on the local copy, so this needs to show as needing
    // attention on that specific local record, not just in the generic
    // conflicts list.
    if (CONFLICT_AWARE_REPOS[entry.entity]) await CONFLICT_AWARE_REPOS[entry.entity].markConflict(entry.entity_id, message);
    return { status: "conflict", entry, message };
  }

  await outbox.markFailed(entry.id, message);

  if ((entry.attempts || 0) + 1 >= MAX_ATTEMPTS_BEFORE_FLAGGING) {
    const flaggedReason = `Failed to sync after ${MAX_ATTEMPTS_BEFORE_FLAGGING} attempts: ${message}`;
    await db.sync_conflicts.add({
      entity: entry.entity,
      entity_id: entry.entity_id,
      payload: entry.payload,
      reason: flaggedReason,
      created_at: new Date().toISOString(),
      resolved: false,
    });
    if (CONFLICT_AWARE_REPOS[entry.entity]) await CONFLICT_AWARE_REPOS[entry.entity].markConflict(entry.entity_id, flaggedReason);
  }

  return { status: "retry_later", entry, message };
}

let syncing = false;

export async function runSync(supabase) {
  if (syncing) return { status: "already_running" };
  if (!getConnectivity()) return { status: "offline" };

  syncing = true;
  const results = [];
  try {
    const pending = await outbox.listPending();
    for (const entry of pending) {
      results.push(await pushOne(supabase, entry));
    }
  } finally {
    syncing = false;
  }
  return { status: "done", results };
}

export function isSyncing() {
  return syncing;
}
