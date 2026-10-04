import { z } from "zod";
import { connect } from "@/lib/finance/simplefin";
import { requireUserId, Unauthenticated } from "@/lib/dal";

/**
 * Exchanges a SimpleFIN token for a stored credential.
 *
 * POST only, because the body is a one-time claim token: a GET would put a live
 * bank credential in a browser history entry, a server access log, and a Referer
 * header. Nothing about this route belongs in a URL.
 *
 * The token is not retained anywhere but this request. It is single-use on
 * SimpleFIN's side, so a failure here is not retryable with the same string.
 */
export async function POST(request: Request): Promise<Response> {
  /* requireUserId throws Unauthenticated rather than returning null, so the check
     has to be a catch or an unauthenticated request escapes as a 500 and tells the
     caller the route is broken instead of that they need to sign in. */
  const userId = await authenticated();
  if (!userId) return json({ error: "Not signed in." }, 401);

  const body = await request.json().catch(() => null);
  const parsed = Claim.safeParse(body);
  if (!parsed.success) {
    return json({ error: "A SimpleFIN token is required." }, 400);
  }

  try {
    const result = await connect(userId, parsed.data.claimUrl);
    return json(result);
  } catch (e) {
    /* 502 rather than 500: nothing about this is the app's fault, SimpleFIN
       refused or was unreachable, and the distinction matters to anyone reading
       the logs afterwards. The message is the bridge's own and carries no
       credential. */
    return json({ error: e instanceof Error ? e.message : "SimpleFIN request failed." }, 502);
  }
}

const Claim = z.object({
  claimUrl: z.string().trim().min(1).max(2000),
});

/** The user id, or null when there is no session. Never throws. */
async function authenticated(): Promise<string | null> {
  try {
    return await requireUserId();
  } catch (e) {
    /* Only Unauthenticated is swallowed. Anything else — a missing env var, a
       misconfigured Supabase client — is a real fault and has to stay visible
       rather than being reported to the user as "sign in again". */
    if (e instanceof Unauthenticated) return null;
    throw e;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}