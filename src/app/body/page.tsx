import { BodyScreen } from "@/components/body/body-screen";
import { JournalSync } from "@/components/journal-sync";
import { requireUserId } from "@/lib/dal";
import { getProvider } from "@/lib/providers";

// Reads "now", so it must never be prerendered into a frozen day at build time.
export const dynamic = "force-dynamic";

export default async function BodyPage() {
  const [view, userId] = await Promise.all([getProvider().getToday(), requireUserId()]);
  return (
    <>
      {/* The weigh-in log is read from this page, so bind it to the account
          before BodyScreen renders. */}
      <JournalSync userId={userId} />
      <BodyScreen view={view} userId={userId} />
    </>
  );
}
