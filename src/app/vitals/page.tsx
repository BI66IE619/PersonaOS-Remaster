import { TodayPage } from "@/components/today-page";
import { JournalSync } from "@/components/journal-sync";
import { requireUserId } from "@/lib/dal";
import { getProvider } from "@/lib/providers";

// Reads "now", so it must never be prerendered into a frozen day at build time.
export const dynamic = "force-dynamic";

export default async function VitalsPage() {
  const [view, userId] = await Promise.all([getProvider().getToday(), requireUserId()]);
  return (
    <>
      {/* Binds the check-in and weigh-in stores to this account before the
          panels below read them. */}
      <JournalSync userId={userId} />
      <TodayPage view={view} />
    </>
  );
}
