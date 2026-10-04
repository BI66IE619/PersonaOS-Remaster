import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { coldEntryCookie } from "@/lib/cold-entry";

export const dynamic = "force-dynamic";

/**
 * Email and password sign-in, used by the automated suites.
 *
 * This is not a way around the auth check — it is the same check, reached by a
 * different door. signInWithPassword verifies the password against Supabase's
 * auth server and, on success, sets the same session cookie the Google flow sets.
 * Nothing here asserts an identity; the identity comes back from Supabase or it
 * does not, and there is no branch that continues without it.
 *
 * It exists because Google cannot be automated. The OAuth consent screen needs a
 * real account picker and a real human, so every suite would otherwise have no way
 * to reach a page behind the proxy — and a suite that navigates without a session
 * does not fail cleanly, it asserts against the sign-in card. That is not a
 * hypothetical: test-cold-start.mjs passed its first four checks that way, because
 * the sign-in card reuses the splash's Mark and carries the same data-splash-p.
 *
 * Off unless EMAIL_SIGNIN is set, so a deployment has no password door unless
 * someone deliberately opens it. Google remains the only visible option.
 *
 * Two things are deliberately absent. There is no rate limit here beyond
 * Supabase's own, and no account creation — this signs in, it does not register,
 * so a suite cannot bring a database into existence by accident.
 */
export async function POST(request: Request): Promise<Response> {
  if (process.env.EMAIL_SIGNIN !== "1") {
    return new Response("Not found.", { status: 404 });
  }

  let email: string;
  let password: string;
  try {
    const form = await request.formData();
    email = String(form.get("email") ?? "");
    password = String(form.get("password") ?? "");
  } catch {
    return NextResponse.redirect(new URL("/?auth_error=Bad+request", request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    /* The message goes to the query and back to the sign-in card rather than
       being logged, because Supabase's own wording distinguishes "no such user"
       from "wrong password". Either way the answer here is the same string, so the
       form cannot be used to find out which accounts exist. */
    return NextResponse.redirect(new URL("/?auth_error=Could+not+sign+in", request.url));
  }

  const res = NextResponse.redirect(new URL("/home", request.url));
  res.headers.append("set-cookie", coldEntryCookie());
  return res;
}