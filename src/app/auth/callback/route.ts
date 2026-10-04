import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { coldEntryCookie } from "@/lib/cold-entry";

export const dynamic = "force-dynamic";

/**
 * Where Google sends the user back to, and the only public route in the app.
 *
 * The flow is PKCE. signInWithOAuth on the server mints a verifier, puts it in a
 * cookie, and returns the Google URL to redirect to. When Google returns with a
 * code, this exchanges it for a session. Nothing secret passes through the
 * browser: the verifier was never there.
 *
 * `next` is the one redirect target, and it is validated rather than trusted. An
 * open redirect here would be a way to bounce someone off a signed-in app to a
 * lookalike page, and the value arrives from a query string, so it is treated as
 * hostile input: anything not a single-slash-relative path is discarded. Note
 * that "starts with a slash" alone is not enough — "//evil.com" starts with a
 * slash and is a protocol-relative URL, which is why the second character is
 * checked too.
 *
 * The cookie set on the way out is the intro flag. See lib/cold-entry.ts for why
 * the timestamp is taken here rather than when the user clicked sign in: a
 * consent screen the user spent forty seconds on would otherwise expire the flag
 * before they ever came back.
 *
 * The redirect target is /home, not "/", so the intro plays there in full rather
 * than being split across two documents.
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams, origin } = new URL(request.url);

  const next = safeNext(searchParams.get("next"));
  const code = searchParams.get("code");

  /* Google reports a refusal by redirecting back with an error rather than a
     code. There is nothing to exchange, so this goes back to the sign-in card
     with the reason attached rather than to an error page — the user gets to try
     again from where they were. */
  if (!code) {
    const error = searchParams.get("error_description") ?? searchParams.get("error");
    return finish(origin, next, error);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) return finish(origin, next, error.message);

  return finish(origin, next, null);
}

function finish(origin: string, next: string, error: string | null): Response {
  const url = new URL(next, origin);
  /* The reason goes on the query so the sign-in card can say something better
     than a failed redirect. On error there is no session, so redirecting to the
     sign-in page keeps the message where the card lives; the proxy also clears
     search on redirects to "/" but we must send the user to "/" in that case. */
  if (error) {
    url.pathname = "/";
    url.searchParams.set("auth_error", error.slice(0, 200));
  }

  const res = NextResponse.redirect(url);

  /* Only a successful sign-in authorises the intro. On the error paths there is no
     session, the card is about to render, and a flag here would sit in the cookie
     authorising an intro for whoever reaches /home next — which, on a shared
     machine, is not necessarily the person who just declined to sign in. */
  if (!error) {
    res.headers.append("set-cookie", coldEntryCookie());
  }

  return res;
}

/**
 * A relative path, or "/home".
 *
 * "/" is not the default any more. Sending a freshly authenticated user back to
 * "/" put the two-document splash between the sign-in and the home page, which is
 * the thing the animation change was meant to remove: the whole intro should play
 * on /home, once. Going straight there is what makes that true.
 *
 * Not a URL parse, because URL would happily accept "//evil.com" and
 * "https://evil.com" as valid, and it is precisely those two that would make this
 * an open redirect.
 */
function safeNext(value: string | null): string {
  if (!value) return "/home";
  if (!value.startsWith("/")) return "/home";
  if (value.startsWith("//")) return "/home";
  return value;
}