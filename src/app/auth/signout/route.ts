import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Signs the user out.
 *
 * POST only, and that is a security decision rather than an ergonomic one. A GET
 * would let any page on the internet sign the user out with an <img> tag — CSRF,
 * with the only consequence being an unwanted logout, which is the mild version of
 * the bug and still a bug. The form in the nav posts here instead.
 *
 * The cookies have to be cleared here rather than left to the proxy. signOut()
 * tells Supabase to invalidate the refresh token, but the session cookie lives in
 * this browser and signOut cannot reach it from a server component — which is the
 * same limitation that made the proxy necessary in the first place. So every
 * cookie this client is holding is expired explicitly on the way out. Without that
 * the user lands on "/" still holding a cookie the proxy may accept as valid, and
 * appears to be signed in while the server considers them signed out.
 *
 * Not a redirect to /home, obviously. "/" is the only page that renders signed out,
 * and it is where the proxy sends everyone else anyway.
 */
export async function POST(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;

  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    /* Fall through to the cookie clear below. Even if the network call fails, the
       local session has to go: a logout that leaves the browser holding a valid
       cookie has not logged anyone out. */
  }

  const res = NextResponse.redirect(origin + "/");

  /* Names the auth client actually writes, rather than whatever a version bump
     happens to use. Anything left behind here is a credential that outlives the
     logout. */
  for (const name of [
    "sb-access-token",
    "sb-refresh-token",
    "sb-access-token-legacy",
    "sb-refresh-token-legacy",
  ]) {
    res.cookies.set(name, "", { path: "/", maxAge: 0 });
  }

  /* Any cookie whose name begins with the project id is one of this project's,
     whatever suffix it carries. Cleared last and by prefix, so a name this build
     does not know about still cannot survive the logout. */
  const projectRef = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(
    /https:\/\/([a-z0-9]+)\.supabase\./,
  )?.[1];

  if (projectRef) {
    for (const cookie of (await cookiesFrom(request)).filter((c) =>
      c.name.startsWith(`sb-${projectRef}-auth-token`),
    )) {
      res.cookies.set(cookie.name, "", { path: cookie.path || "/", maxAge: 0 });
    }
  }

  return res;
}

/** The request's own cookies, without depending on next/headers. */
function cookiesFrom(request: Request): { name: string; value: string; path?: string }[] {
  const header = request.headers.get("cookie");
  if (!header) return [];
  return header.split(";").flatMap((pair) => {
    const [name, ...rest] = pair.trim().split("=");
    if (!name) return [];
    return [{ name, value: rest.join("=") }];
  });
}