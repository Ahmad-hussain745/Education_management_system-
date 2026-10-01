import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";

// "Never expose database backups to normal users" — enforced twice here,
// deliberately redundant:
//   1. The page that links here (app/(app)/automation/backup-export) is
//      wrapped in requireRole(["Super Admin"]) like the rest of the
//      Automation Center.
//   2. This route re-checks the role itself, independently. A page guard
//      only stops someone clicking through the UI — this URL is directly
//      reachable by anyone who knows it, so the real boundary has to live
//      here, not just in the page.
//
// This uses the NORMAL (non-admin) Supabase client, not the service-role
// one — every query below is still subject to RLS. That's deliberate: even
// if the role check above had a bug, RLS's institute_id isolation
// (0035/0036) is what actually stops a query from ever returning another
// institute's rows. The role check decides WHO can export; RLS decides
// WHAT their own session is even allowed to see.
//
// The passphrase arrives in the POST body, is used once to derive an
// AES-256 key via PBKDF2, and is never written to a log, a table, or a
// variable that outlives this function call. If it's lost, the export is
// unrecoverable — there is no server-side copy or reset mechanism, by
// design; a "forgot password" path for a backup's own encryption key
// would just be a second way in.
const TABLES = [
  "students", "teachers", "classes", "sections",
  "fee_structures", "fee_records", "fee_payments", "fee_discounts",
  "expenses", "salary_records", "salary_items",
  "student_attendance", "inventory_items", "inventory_stock_movements",
];

const PAGE_SIZE = 1000; // Supabase/PostgREST's own default cap per request

async function fetchAllRows(supabase, table, instituteId) {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("institute_id", instituteId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    all = all.concat(data || []);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

export async function POST(request) {
  const roleContext = await getRoleContext();
  if (!roleContext || roleContext.roleName !== "Super Admin") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  if (!roleContext.instituteId) {
    return NextResponse.json({ error: "No institute linked to this account." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const passphrase = body?.passphrase;
  if (!passphrase || passphrase.length < 12) {
    return NextResponse.json({ error: "Passphrase must be at least 12 characters." }, { status: 400 });
  }

  const supabase = await createClient();
  const dataset = {};
  const rowCounts = {};

  try {
    for (const table of TABLES) {
      const rows = await fetchAllRows(supabase, table, roleContext.instituteId);
      dataset[table] = rows;
      rowCounts[table] = rows.length;
    }
  } catch (err) {
    // A partial export that LOOKS complete is worse than an outright
    // failure — someone restoring from it later has no way to know a
    // table silently came back empty. Fail the whole export instead.
    return NextResponse.json({ error: `Export failed while reading ${err.message}` }, { status: 500 });
  }

  const manifest = {
    exported_at: new Date().toISOString(),
    institute_id: roleContext.instituteId,
    institute_name: roleContext.instituteName,
    exported_by: roleContext.name,
    row_counts: rowCounts,
    format_version: 1,
  };

  const plaintext = Buffer.from(JSON.stringify({ manifest, data: dataset }), "utf-8");

  // AES-256-GCM: authenticated encryption, so a corrupted or tampered file
  // fails to decrypt loudly rather than silently returning wrong data — a
  // property a database restore file specifically needs. PBKDF2 with a
  // high iteration count (210,000, roughly OWASP's current baseline) and a
  // random salt makes each export's key unique even if the same passphrase
  // is reused across exports.
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(passphrase, salt, 210000, 32, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // File layout: 4-byte magic, 1-byte version, salt(16), iv(12), authTag(16),
  // then ciphertext. Fixed-size fields so the decrypt script can read it
  // without needing a separate manifest file to travel alongside it.
  const header = Buffer.concat([
    Buffer.from("MSAB", "ascii"),
    Buffer.from([1]),
    salt,
    iv,
    authTag,
  ]);
  const fileBuffer = Buffer.concat([header, ciphertext]);

  const filename = `${(roleContext.instituteName || "institute").replace(/[^a-z0-9]+/gi, "-")}-backup-${manifest.exported_at.slice(0, 10)}.msabak`;

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
