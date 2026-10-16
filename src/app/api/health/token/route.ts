import { randomBytes } from "node:crypto";
import { ensureProfile, setIngestToken } from "@/lib/dal";
import { getUserId } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Mints the background worker's credential.
 *
 * Session-authenticated, so only the signed-in user can ask for a token for
 * themselves. The plaintext is returned once and the server keeps only its hash.
 * Calling again mints a fresh token and retires the old one, which is exactly how a
 * phone whose worker token was revoked picks up a new one on the next open.
 *
 * Deliberately its own route rather than folded into sign-in: the WebView holds the
 * cookie, but the thing that needs the token is the native worker, which has no
 * cookie jar — so the flow is "the browser asks, then hands it to native", and this
 * is the ask.
 */
export async function POST(): Promise<Response> {
  const userId = await getUserId();
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  /* The profile is created lazily, so a first run may have no row for the update
     to land on. Same guard as the ingest route. */
  await ensureProfile(userId);

  const token = randomBytes(32).toString("base64url");
  await setIngestToken(userId, token);
  return Response.json({ token });
}
