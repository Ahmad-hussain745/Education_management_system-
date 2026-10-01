# Next.js 16 / React 19 upgrade — what was done and verified

Followed the official path (`npx @next/codemod@canary upgrade latest`), then
**actually ran `npm install`, `npm run build`, and `npm test` against the
result** in a real environment (Node 22, which satisfies Next 16's Node
20.9+ requirement) rather than just applying the codemod and assuming it
worked — that's what surfaced the three issues below, none of which the
codemod could fix on its own.

## Do this on your machine first

This was done in an isolated environment, not against your git history —
I have no access to your repository or its commit history. Before you pull
these changes in:

```
git checkout -b upgrade-next16
node -v          # must be 20.9+
```

Then either replace your `package.json`/`package-lock.json`/source with
what's in this zip, or replay the same steps yourself:

```
npx @next/codemod@canary upgrade latest
npm install
npm run build
npm test
```

## What actually changed

**`package.json`**: `next` 14.2.35 → **16.3.5**, `react`/`react-dom` 18.3.1
→ **19.3.0**, `eslint-config-next` bumped to match, added an `engines.node
>=20.9.0` field so the requirement is enforced/documented rather than just
implied. `lint` now runs `eslint .` against the codemod-generated
`eslint.config.mjs` (flat config) instead of the old `.eslintrc`.

**`middleware.js` → `proxy.js`**: the codemod's automatic rename —
`export async function middleware(...)` became `export async function
proxy(...)`, matching Next 16's renamed convention. `config.matcher` is
untouched.

**`lib/supabase/server.js` — the real breaking change.** `cookies()` from
`next/headers` has required awaiting since Next 15; Next 16 makes this a
hard build failure instead of a warning. The codemod correctly detected
every place this mattered but can't safely auto-fix it, since
`createClient()` is called from 122 files and making it async is a
cascading change, not a local one. Fixed by hand:
- `createClient()` is now `async`, awaiting `cookies()` internally.
- All 118 call sites that needed it now `await createClient()`.
- Two call sites that chained directly (`await
  createClient().auth.signOut()`) needed the parens moved, not just an
  `await` added — `await x().y()` awaits the *whole chain's result*, not
  `x()` alone, so `.auth` would otherwise be accessed on a pending Promise.
  Fixed to `(await createClient()).auth.signOut()`.
- The 4 files that call only `createAdminClient()` (the cron routes,
  which run with the service-role key and have no user cookies to read)
  were correctly left untouched — that function was never async and
  didn't need to become so.

**`next.config.js` / build scripts — a real, currently-unresolved ecosystem
gap.** Next 16 defaults to Turbopack. `@ducanh2912/next-pwa` (10.2.9, the
latest published version as of this upgrade) is webpack-only — there is no
Turbopack-compatible release to upgrade to. Building with Turbopack and
this plugin's webpack config present fails outright, by design (Next 16
treats an unrecognized webpack config under Turbopack as a mistake worth
stopping for, not silently ignoring). Per Next's own suggested fix in that
error message, `package.json`'s `dev`/`build` scripts now pass `--webpack`
explicitly: `next dev --webpack` / `next build --webpack`. This opts back
into the pre-16 bundler on purpose, scoped to this project, rather than
either breaking the PWA build or silently getting whatever Turbopack does
with a webpack config it doesn't understand. Revisit this once
`@ducanh2912/next-pwa` (or an alternative) ships Turbopack support — search
its changelog/issues before removing `--webpack`.

**Cache Components opt-out, added and then removed.** The codemod
inserted `export const instant = false;` into 80 page files as a
conservative default for projects adopting Next 16's new Cache Components
model. This build enables it in exactly zero places
(`next.config.js` has no `cacheComponents` flag), and `instant` is only a
valid export *with* that flag on — so the build failed outright until this
was resolved. Since adopting Cache Components is a deliberate, separate
architectural decision (deciding what in a financial app is safe to
cache vs. must stay fully dynamic per-request) and not something a version
upgrade should silently opt into, all 80 inserted blocks were removed
rather than turning the feature on. Every route still builds as `ƒ`
(server-rendered on demand) exactly as before — verified in the build
output, not assumed. Adopting Cache Components properly is a good
candidate for its own future phase, not bundled into this one.

## Verified, not assumed

```
✓ npm run build   — all 83 routes compile; every dynamic route still
                     shows ƒ (server-rendered), none went static
✓ npm test        — 13/13 tests pass (vitest, unchanged)
```

One caveat on the build verification: this environment has no network
access to `fonts.googleapis.com`, so `app/layout.js`'s `next/font/google`
Inter import was temporarily stubbed out to get a real build running,
then reverted to the original import before this zip was written —
`app/layout.js` in this zip is unchanged from before the upgrade. Your own
`npm run build`, with real network access, is the first time that
particular line gets exercised against this Next 16 install — everything
else was verified for real here.
