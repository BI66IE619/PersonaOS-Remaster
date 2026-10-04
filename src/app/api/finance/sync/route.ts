import { z } from "zod";
import { sync } from "@/lib/finance/simplefin";
import { requireUserId, Unauthenticated } from "@/lib/dal";

/**
 * Pulls transactions and balances from SimpleFIN and caches them server-side.
 *
 * POST rather than GET, and the reason is the quota. SimpleFIN allows roughly 24
 * requests a day and disables the token for sustained overuse, so a GET that
 * something on a page could trigger — a prefetch, a crawler, a browser retry — is
 * how a connection gets switched off. A POST is not fired speculatively.
 *
 * The rate limit inside sync() is the real guard; force is here for a deliberate
 * user-initiated refresh, and is still clamped to the same daily ceiling by
 * SimpleFIN itself if it is overused.
 */
export async function POST(request: Request): Promise<Response> {
  /* requireUserId throws rather than returning null, so an unauthenticated request
     would otherwise surface as a 500 and read as "this endpoint is broken". */
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (e) {
    if (e instanceof Unauthenticated) return json({ error: "Unauthorized" }, 401);
    throw e;
  }

  const body = await request.json().catch(() => ({}));
  const parsed = Options.safeParse(body ?? {});
  if (!parsed.success) return json({ error: "Invalid sync options." }, 400);

  try {
    const result = await sync(userId, {
      force: parsed.data.force,
      days: parsed.data.days,
    });
    return json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed.";
    /* 429 is the app's own rate limit rather than SimpleFIN's, and 502 is SimpleFIN
       refusing us. The client shows different copy for each. */
    const status = message.includes("daily limit") ? 429 : 502;
    return json({ error: message }, status);
  }
}

const Options = z.object({
  force: z.boolean().optional(),
  /* Clamped to 90 days inside the bridge; bounded here so the number cannot be
     absurd before it gets there. */
  days: z.number().int().min(1).max(90).optional(),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}