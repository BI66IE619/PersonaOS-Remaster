import { NotesScreen } from "@/components/notes/notes-screen";
import { AccountSync } from "@/components/account-sync";
import { requireUserId } from "@/lib/dal";
import { getProvider } from "@/lib/providers";

// Reads "now", so it must never be prerendered into a frozen day at build time.
export const dynamic = "force-dynamic";

export default async function NotesPage() {
  const [view, userId] = await Promise.all([getProvider().getToday(), requireUserId()]);
  return (
    <>
      {/* Above the screen, so the journal stores are bound to this account
          before the screen reads a snapshot of them. */}
      <AccountSync userId={userId} />
      <NotesScreen today={view.date} />
    </>
  );
}
