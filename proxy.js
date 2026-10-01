import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

// Renamed from middleware.js/middleware() to proxy.js/proxy() by the
// official Next.js 16 upgrade codemod (`npx @next/codemod@canary upgrade
// latest`) — Next 16 renamed the convention; the exported `config.matcher`
// below and everything this function does are unchanged.
//
// Runs on every request. Refreshes the Supabase auth session (so it never
// silently expires mid-use) and redirects signed-out users away from
// protected pages to /login. This is a UX convenience — the REAL security
// boundary is Row Level Security in Postgres (see supabase/migrations),
// which is enforced even if someone bypasses this middleware entirely.
export async function proxy(request) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getSession() reads the session straight from the auth cookie and only
  // hits the network when the access token is actually near/past expiry
  // (to use the refresh token) — unlike getUser(), which makes a round trip
  // to the Supabase Auth server on every single request, adding latency to
  // every page navigation in the app. That distinction matters here because
  // this check is UX-only: the comment above already establishes that RLS,
  // not this middleware, is the real security boundary — so trusting the
  // cookie-derived session for a "should I bounce to /login" decision is
  // safe. (Never use getSession() as the basis for an authorization
  // decision inside RLS-bypassing code, e.g. the admin client — there,
  // stick with getUser().)
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  // /register (see app/register/actions.js) must be reachable by someone
  // who is, by definition, not signed in yet — that's the entire point of
  // a self-service "request an account" page. Omitting it here means every
  // unauthenticated visitor who clicks "Request one" on the login page
  // gets bounced straight back to /login before the register page ever
  // renders, silently breaking the one flow this check exists to protect.
  const isPublic = request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname === "/register" ||
    request.nextUrl.pathname.startsWith("/auth");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
