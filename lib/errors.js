// A missing database object surfaces from Supabase in more than one wording,
// depending on exactly HOW it's missing:
//   - Postgres itself: '...does not exist' (e.g. calling a function that
//     was truly never created, in a context where Postgres's own error
//     reaches the client unwrapped)
//   - PostgREST, the far more common case for an RPC call from the JS
//     client: 'Could not find the function public.foo(...) in the schema
//     cache' — this fires whenever PostgREST's cached view of the schema
//     doesn't have a function matching that exact name AND parameter list,
//     which happens if the migration that creates it was never run, OR if
//     it WAS run but PostgREST's schema cache hasn't picked up the change
//     yet (normally automatic, but can lag after a raw SQL Editor run).
// Three call sites (students, finance/transactions, reports/pending-fees)
// were each checking only the first wording, so the friendly "run your
// migrations" hint silently failed to show for the far more common second
// one — exactly the message a real deployment was hitting.
export function isMissingDbObjectError(message) {
  if (!message) return false;
  const m = message.toLowerCase();
  return m.includes("does not exist") || m.includes("could not find the function") || m.includes("schema cache");
}
