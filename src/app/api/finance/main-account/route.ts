import { z } from "zod";
import { setMainAccount } from "@/lib/finance/simplefin";
import { requireUserId, Unauthenticated } from "@/lib/dal";

/**
 * Chooses which linked account drives the month's figures.
 *
 * POST rather than GET because this changes stored state. It also costs no SimpleFIN
 * request, so it is not quota limited: the choice only filters rows already cached.
 */
export async function POST(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (e) {
    /* Only Unauthenticated is swallowed. A missing env var or a broken Supabase
       client is a real fault and has to stay visible rather than being reported to
       the user as "sign in again". */
    if (e instanceof Unauthenticated) return json({ error: "Not signed in." }, 401);
    throw e;
  }

  const body = await request.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) return json({ error: "An account id is required." }, 400);

  try {
    await setMainAccount(userId, parsed.data.accountId);
    return json({ ok: true, mainAccountId: parsed.data.accountId });
  } catch (e) {
    /* 400 rather than 500: the id named an account this user does not have, which
       is a bad request and not a server fault. The message says so without echoing
       the id back. */
    const message = e instanceof Error ? e.message : "Could not set that account.";
    return json({ error: message }, 400);
  }
}

const Body = z.object({
  /** null clears the choice, putting every account back into the month. */
  accountId: z.string().trim().min(1).max(200).nullable(),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}