import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { coldEntryCookieParts } from "@/lib/cold-entry";

/**
 * Keeps the session alive, and turns away requests that have no session.
 *
 * Next.js 16 renamed this file convention from middleware to proxy. It has to be
 * proxy.ts and not middleware.ts, and that is not a stylistic choice: this
 * project is on Next 16, a middleware.ts is never invoked, no session ever
 * refreshes, and the user is silently signed out after an hour with nothing in
 * the console to say why. See
 * https://nextjs.org/docs/app/api-reference/file-conventions/proxy
 *
 * Two jobs, in order:
 *
 * 1. Refresh the access token. Calling getClaims() does it as a side effect when
 *    the token is near expiry. The refreshed token then has to reach both the
 *    server components rendering this request and the browser holding the old
 *    one, which is what request.cookies.set and response.cookies.set do. Miss
 *    either and the user is signed out on the next navigation — a failure that
 *    looks random because it happens minutes after everything appeared to work.
 *
 * 2. Redirect signed-out visitors to "/", which is the only page that renders
 *    for them and holds the sign-in card. "/" itself and "/auth/callback" are
 *    excluded, since gating the callback would make sign-in impossible.
 *
 * The response built by setAll must be the one returned. An earlier response
 * does not carry the refreshed cookies.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  /* getClaims verifies the token signature, which is what makes the answer
     below trustworthy. getSession would only read the cookie, and a forged
     cookie would pass it.

     Note there is no `user` on the result. getClaims verifies a JWT and returns
     the parsed claims — { claims, header, signature } — not a user object. Code
     written against getUser's shape compiles nowhere and, if it were written
     against getSession's shape, would be reading a cookie and trusting it. The
     subject is the claim that identifies the account. */
  const { data, error } = await supabase.auth.getClaims();
  const userId = error ? null : (data?.claims?.sub ?? null);

  /* The set that matters is not the page: it is /auth/signin. Redirecting that
     would bounce the POST that starts OAuth straight back to the sign-in card, so
     the button would appear to do nothing. The callback is excluded for the same
     reason — gating the exchange would make signing in impossible. */
  /* Everything the proxy must not redirect, and the list is short on purpose:
   * every entry is a route that has to run while signed out to establish a
   * session.
   *
   * /auth/password belongs here for a non-obvious reason. It returns 404 unless
   * EMAIL_SIGNIN is set, and leaving it out looked harmless — the route was
   * unreachable either way. It is not harmless: without this entry the proxy
   * answered 307 to "/", so the route's own guard never executed and a 404 was
   * never possible. A test asserting "the password door is closed when the flag is
   * off" would have passed for the wrong reason, or failed confusingly depending
   * on which layer it landed on. Listed here so the flag is what decides, rather
   * than the matcher. */
  const OPEN = new Set(["/", "/auth/signin", "/auth/callback", "/auth/password", "/auth/signout"]);

  if (!userId && !OPEN.has(request.nextUrl.pathname)) {
    /* Redirect, not a 401: this is a page request and the browser needs
       somewhere to go. The API routes handle their own 401, because a redirect
       is the wrong answer to fetch(). Preserve auth_error if it somehow reached
       a protected path; the sign-in card can still show it. */
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    if (request.nextUrl.searchParams.has("auth_error")) {
      url.searchParams.set("auth_error", request.nextUrl.searchParams.get("auth_error")!);
    }
    return NextResponse.redirect(url);
  }

  /* A signed-in visitor arriving at the front door is entitled to the intro, and
     this is the only place in the request path that can grant it: a server
     component cannot write a cookie and there is no sessionStorage on the server.
     Setting it on the way past, rather than on /home, is what keeps the flag
     off refreshes — /home itself never sets anything, so reloading it finds
     nothing to read. */
  if (userId && request.nextUrl.pathname === "/") {
    response.cookies.set(coldEntryCookieParts());
  }

  return response;
}

export const config = {
  /* Everything except the sign-in page, the OAuth callback, static assets and
     the image optimizer. Without the negative match this runs on every CSS and
     JS request, which is both slow and a chance to redirect a stylesheet. */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|auth/callback|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};