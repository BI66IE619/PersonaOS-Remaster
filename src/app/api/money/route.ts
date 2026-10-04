import { requireUserId, Unauthenticated } from "@/lib/dal";
import { loadMoney } from "@/lib/finance/money-data";

/**
 * Serves the money screen's data.
 *
 * The screen used to generate its own transactions from a seeded PRNG, which meant
 * every visitor saw the same fabricated ledger. This route replaces that with the
 * real cached rows, and the screen falls back to the seed only when no bank is
 * linked — so an unlinked account still has something to judge the layout against,
 * clearly marked as not being their money.
 *
 * Aggregation happens here rather than on the client for one reason: the
 * transactions themselves never cross the wire. The screen draws summaries, and
 * what it needs is those summaries, not a ledger it would only re-reduce in the
 * browser.
 *
 * The page renders this on the server already, so this route exists for the
 * refetches that follow a connect or a sync. Both go through loadMoney, so the
 * two cannot drift.
 */
export async function GET(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (e) {
    if (e instanceof Unauthenticated) return json({ error: "Not signed in." }, 401);
    throw e;
  }

  const data = await loadMoney(userId, new URL(request.url).searchParams.get("month"));
  return json(data);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    /* No caching. The response is per-user and changes on every sync, and a
       cached copy would show one person's balances to the next person who hit the
       same URL. */
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}