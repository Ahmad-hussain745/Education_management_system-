import { defineConfig } from "vitest/config";
import path from "path";

// Offline code (lib/offline/**) uses Dexie, which needs a real IndexedDB —
// fake-indexeddb provides one in Node so these tests run without a
// browser. Nothing here talks to a real Supabase project: every test
// either exercises pure logic directly, or mocks the Supabase client
// explicitly (see each test file's own comment on what it does and
// doesn't cover) — a genuine end-to-end test against Postgres RPCs
// (record_fee_payment, is_month_closed, etc.) needs a live database this
// sandbox doesn't have, and the SQL test files in supabase/tests/ are
// where those live, run manually against a real project.
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.js"],
    include: ["**/__tests__/**/*.test.js"],
    exclude: ["node_modules", ".next"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
