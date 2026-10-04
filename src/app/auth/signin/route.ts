import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Starts the Google hand-off.
 *
 * A route handler rather than a client call, for one reason that matters: the PKCE
 * verifier. signInWithOAuth has to write a cookie for the callback to exchange
 * the code, and calling it from a server keeps the verifier in the Set-Cookie of
 * a redirect Next issues itself, with no intermediate document in between that
 * could drop it.
 *
 * `next` is carried through unvalidated on the way out. It comes from the same
 * page that built the URL, and it is validated where it is actually used — in
 * auth/callback, which discards anything that is not a relative path. Validating
 * in both places would mean two implementations of the same rule.
 */
export async function POST(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  /* "/home" rather than "/", matching the callback's own default. Naming "/" here
     would be validated as a perfectly good relative path by the callback's
     safeNext and honoured, so the user would land on "/", which then redirects to
     "/home" — two hops instead of one, and an extra request through the proxy on
     the one request where a stray Set-Cookie would be easiest to miss. */
  const next = new URL(request.url).searchParams.get("next") ?? "/home";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data.url) {
    return Response.json(
      { error: "Sign-in could not be started. Please try again." },
      { status: 500 },
    );
  }

  /* 303, so the browser follows it with GET. signInWithOAuth has just set the
     verifier cookie, and a 307 would re-POST to Google's token endpoint. */
  return NextResponse.redirect(data.url, 303);
}