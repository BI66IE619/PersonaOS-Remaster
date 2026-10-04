import { MentorScreen } from "@/components/mentor/mentor-screen";
import { JournalSync } from "@/components/journal-sync";
import { getProvider } from "@/lib/providers";
import { randomOpening } from "@/lib/mentor/openings";
import { getMentorChats, getMentorSettings, requireUserId } from "@/lib/dal";
import type { MentorSettingsPayload } from "@/lib/mentor/types";
import { loadMoney } from "@/lib/finance/money-data";
import { buildMoneyView } from "@/lib/finance/view";
import { generateTransactions } from "@/lib/finance/seed";
import { monthKey } from "@/lib/dates";

// Reads "now", so it must never be prerendered into a frozen day at build time.
export const dynamic = "force-dynamic";

/** The recents log and the sharing switches, read for the first paint.
 *
 *  Read here rather than fetched from the client so a second device does not render
 *  an empty mentor tab and then fill it in a moment later. The same rows the
 *  /api/sync pull will return, from the same DAL functions, so seeding from them and
 *  then pulling cannot disagree about what exists.
 *
 *  A failure is swallowed rather than raised: the mentor tab is usable with no
 *  server-side history at all, since the local record still holds everything on
 *  this device, and a database problem should not be an error page. The screen
 *  treats a null as "nothing to seed" and falls back to pulling. */
async function loadMentorHistory(userId: string): Promise<{
  chats: unknown[];
  settings: MentorSettingsPayload | null;
} | null> {
  try {
    const [rows, settings] = await Promise.all([
      getMentorChats(userId, 50),
      getMentorSettings(userId),
    ]);
    return {
      chats: rows.map((c) => ({
        clientId: c.clientId,
        title: c.title,
        updatedAt: c.updatedAt,
        turns: c.turns.map((t) => ({
          clientId: t.clientId,
          role: t.role,
          text: t.text,
          updatedAt: t.updatedAt,
        })),
      })),
      /* Null when nothing was ever written, which the client reads as "you decide"
         rather than as "off". See getMentorSettings. */
      settings: settings
        ? {
            shareNotes: settings.shareNotes,
            shareEvents: settings.shareEvents,
            updatedAt: settings.updatedAt.toISOString(),
          }
        : null,
    };
  } catch {
    /* Not a crash worth showing the user: their own chats are still on this device,
       and a mentor tab that renders is better than one that errors. The pull will
       try again a moment after first paint. */
    return null;
  }
}

export default async function MentorPage() {
  /* Resolved once, up front, and passed down.
   *
   * Two requireUserId() calls in one render would be two chances to read two
   * different answers — the proxy refreshes the session on every request, and a
   * refresh landing between two cookie reads is a real possibility. More to the
   * point, the screen needs this same id to bind the local mentor record to, and an
   * id that differed by a single character between the two reads would empty the
   * recents log. */
  const userId = await requireUserId();

  /* The whole view rather than just the date. The brief is computed on the
     client from the same readings the other tabs show, so passing the view
     keeps the provider seam in one place — a real provider swaps in here and
     the screen needs no change. */
  const view = await getProvider().getToday();
  /* Chosen here, on the server, for the reason given in @/lib/mentor/openings.
     The screen is a client component and would otherwise roll its own dice
     after paint, swapping the line the reader had already started reading. */
  const opening = randomOpening();

  /* The user's real finances, read server-side and passed down.
     *
     * This used to be generated from the seed on the client, and that was right
     * while there was no bank to read. Once real accounts were linked it became
     * the worst kind of bug: nothing failed, the brief still built, and the
     * mentor confidently discussed a fictional $1,563 of September spending
     * beside a real account spending $99.90. The generated figures were also
     * marked insufficient, so it hedged around numbers that were not the user's
     * at all. */
  const month = monthKey(new Date());
  let money = await generatedMoney(month);
  /* Whether the figures above are the user's own or placeholders. The brief says so
     in words, and it must be able to: the mentor is told not to treat placeholder
     money as real, and it can only do that if it knows which it is looking at. */
  let moneyIsReal = false;
  try {
    const data = await loadMoney(userId, month);
    /* Only the real view when a bank is actually linked. A null view means not
       connected, and falling through to the seed keeps the unlinked experience
       unchanged rather than showing an empty month. */
    if (data.linked && data.view) {
      money = data.view;
      moneyIsReal = true;
    }
  } catch {
    /* A database problem rather than a sign-in one — requireUserId() above would
       already have thrown for that. The seed stands in rather than the tab failing
       to render, and the brief labels the figures as placeholders. */
  }

  const history = await loadMentorHistory(userId);

  return (
    <>
      {/* The mentor brief reads notes, check-ins and weigh-ins, so bind the
          journal stores to the account before the screen builds its brief. */}
      <JournalSync userId={userId} />
      <MentorScreen
        view={view}
        opening={opening}
        money={money}
        moneyIsReal={moneyIsReal}
        initialChats={history?.chats ?? null}
        initialSettings={history?.settings ?? null}
        userId={userId}
      />
    </>
  );
}

/** Placeholder figures for a month with no linked account. */
async function generatedMoney(month: string) {
  return buildMoneyView(generateTransactions(new Date(`${month}-15T12:00:00Z`)), month);
}
