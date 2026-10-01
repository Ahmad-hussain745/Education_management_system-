import { createBrowserClient } from "@supabase/ssr";

// Use this inside Client Components ("use client").
// It talks to Supabase with the signed-in user's session, so every query is
// automatically subject to Row Level Security — the frontend never sees more
// than the user's role is allowed to.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
