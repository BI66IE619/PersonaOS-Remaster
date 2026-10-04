import { MoneyScreen } from "@/components/money/money-screen";
import { PageShell } from "@/components/page-shell";
import { requireUserId } from "@/lib/dal";
import { loadMoney, normalizeMonth } from "@/lib/finance/money-data";

export const dynamic = "force-dynamic";

/**
 * Loads the ledger on the server rather than having the screen fetch it on mount.
 *
 * The proxy already guarantees a session for this route, so a throw here means the
 * session went away between the proxy and the render, which is not something to
 * show a person as an error page.
 */
export default async function MoneyPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const userId = await requireUserId();
  const data = await loadMoney(userId, normalizeMonth(params.month ?? null));

  return (
    <PageShell>
      {/* Passed as a prop rather than fetched in an effect: the data is already
          here, and a client fetch would re-request it on every visit and flash an
          empty ledger first. The screen still refetches after a connect or sync. */}
      <MoneyScreen now={new Date().toISOString()} initial={data} />
    </PageShell>
  );
}