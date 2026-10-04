import { createServerClient } from "@supabase/ssr";
/* Aliased because createClient below is this file's own cookie-backed factory,
   and a bearer-token call wants the other one. */
import { createClient as createSupabaseAuthClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * The server-side Supabase client, reading and writing the session cookie.
 *
 * A NEW instance per call, deliberately. The cookies adapter closes over the
 * request, so a cached instance would hold one request's cookies and answer
 * another user's request with them. Creating one is cheap — it configures a
 * fetch call — so this is not a thing to cache.
 *
 * setAll cannot actually write here, because server components are not allowed
 * to mutate cookies. That is fine and is why src/proxy.ts exists: the proxy runs
 * on the Node runtime with permission to write, and it refreshes the session and
 * sets the new cookie on every request before any component reads it. The
 * try/catch is the documented way to say "someone else handles this."
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            /* Server components cannot write cookies. The proxy does it. */
          }
        },
      },
    },
  );
}

/**
 * Whether anyone is signed in, verified rather than assumed.
 *
 * getSession() reads the cookie and believes it. Anyone can forge that cookie,
 * so it is not evidence of identity and must never gate anything. getClaims()
 * checks the JWT signature on every call — locally against the project's public
 * keys on new projects, or by asking the Auth server on older ones — so what
 * comes back is something the server verified rather than something a browser
 * claimed.
 *
 * Returns null for signed out. It does not throw, because "not signed in" is an
 * ordinary state that callers need to branch on, not an error.
 */
export async function getUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data) return null;
    return data.claims?.sub ?? null;
  } catch {
    /* A missing env var throws inside the client constructor. Treat that as
       signed out so a misconfigured deploy shows a sign-in card rather than a
       crash, and let the caller deal with the fact that nobody can sign in. */
    return null;
  }
}

/**
 * The signed-in user's id, from a bearer token instead of the session cookie.
 *
 * The cookie path above is the right shape for a browser, where @supabase/ssr
 * keeps the cookie in sync with the session. It is the wrong shape for the
 * Health Connect phone app, which has no cookie jar and no reason to grow one:
 * a native app already holds an access token in whatever auth layer it uses, and
 * the only reason to make it also carry and refresh a web cookie is that the
 * server happened to be written for a browser first.
 *
 * getUser(token) asks the Auth server who the token belongs to, so this is the
 * same verification getClaims() does — verified identity, not a decoded
 * assertion — which is why it is allowed to gate writes. It costs a network
 * round trip the cookie path does not, hence the cookie being tried first.
 *
 * A plain client rather than createClient() above, because that one is built
 * around a cookie adapter and would find no cookie to read. persistSession is
 * off so a verification call cannot quietly become a stored session.
 */
export async function getUserIdFromBearer(
  request: Request,
): Promise<string | null> {
  const header = request.headers.get("authorization");
  if (!header) return null;
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice("bearer ".length).trim();
  if (!token) return null;

  try {
    const supabase = createSupabaseAuthClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    /* Same reasoning as getUserId: a misconfigured deploy is signed out, not a
       500. The caller turns null into a 401 either way. */
    return null;
  }
}