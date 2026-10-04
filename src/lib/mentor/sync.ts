import {
  acknowledgeDeletes,
  applyRemote,
  chatPayload,
  currentState,
  getSnapshot,
  settingsPayload,
  turnPayload,
} from "@/lib/mentor/store";

/**
 * The mentor's half of /api/sync.
 *
 * Writes are local and immediate, and this pushes them in the background — the
 * local record is the working copy, and a mentor that refused to reply until a
 * round trip finished would be worse than one that occasionally shows a chat from
 * a second device a few seconds later.
 *
 * Every store in the app is local-first, so this is the same shape as any of them:
 * a push of everything that has not been confirmed, then a pull of what the server
 * has that this device does not. There is no dirty-tracking table because the whole
 * record is small — 25 chats, 80 turns each — so re-pushing it is cheaper than
 * knowing what changed, and the upserts make a repeat push a no-op.
 *
 * Nothing here throws. A sync that fails must leave the chat exactly as it was,
 * because the alternative is a mentor that loses a reply to a network error on a
 * phone.
 */

const CURSOR_PREFIX = "personaos:mentor-cursor";

/** Per account, not one global cursor.
 *
 *  A cursor says "I have everything up to here", which is only a true statement
 *  about one account's rows. Reused across a sign-out, it would tell the next
 *  account's first pull that it already had everything written before a moment it
 *  never asked about — and a device signing in for the first time on a browser
 *  someone else had used would show an empty recents log with no way to correct
 *  it, because every later pull asks the same "anything newer?" question and
 *  keeps getting the right answer for the wrong person's history. */
const cursorKey = (userId: string) => `${CURSOR_PREFIX}:${userId}`;

/** Sent at most this often after a change, so typing five messages in a row costs
 *  one push rather than five. */
const DEBOUNCE_MS = 2_500;

type PushResult = { ok: boolean; deleted?: string[] };

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

/**
 * Push everything, then pull back.
 *
 * Chats before turns inside one payload, and the order matters: the route writes
 * them in the order given, and a turn whose chat has not landed would fail on the
 * foreign key and take the rest of the batch with it.
 *
 * Cursor handling is deliberately conservative. The cursor only advances after a
 * pull that also succeeded, so a failed push means the next one re-sends
 * everything, and nothing is lost.
 */
async function syncNow(): Promise<void> {
  const state = currentState();

  /* Nothing to sync until a render has claimed this record for the signed-in
     account. Pushing first would push whatever the previous account left here into
     this one's server history, and pulling would read this account's chats into
     somebody else's record. The screen claims ownership before it can schedule a
     sync, so this is a guard against a caller that forgets rather than a state the
     app sits in. */
  if (!state.owner) return;

  const payload = {
    mentorChats: state.chats.map((c) => chatPayload(c)),
    /* Newest chat first, so that if a turn's chat is not in this push — a chat
       just deleted, say — the turns are still attempted rather than dropped by
       the route's own cap. */
    mentorTurns: [...state.chats]
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
      .flatMap((c) => c.turns.map((t) => turnPayload(t, c.id))),
    /* The switches, on their own clock. Sent on every push rather than when they
       change because there is no dirty-tracking anywhere in this design, and it is
       two booleans. */
    mentorSettings: settingsPayload(state),
    deleted: { mentorChats: state.pendingDeletes },
  };

  let pushed: PushResult | null = null;
  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    /* A 401 means signed out. The local record is deliberately kept — the chats
       are the user's and a dropped session is not their decision — but there is no
       point pulling, and the next sign-in will push them. */
    if (res.status === 401) return;
    if (!res.ok) return;
    pushed = (await res.json().catch(() => null)) as PushResult | null;
  } catch {
    return;
  }

  /* The tombstones are confirmed by the push having been accepted. Not by the
     response echoing them back: an endpoint that returned "I ignored that" and the
     device cleared its list anyway would leave the other device holding a
     conversation the user deleted, permanently. */
  if (pushed?.ok && state.pendingDeletes.length) {
    acknowledgeDeletes(state.pendingDeletes);
  }

  /* Now the other direction. */
  const key = cursorKey(state.owner);
  try {
    const cursor = localStorage.getItem(key);
    const url = cursor ? `/api/sync?since=${encodeURIComponent(cursor)}` : "/api/sync";
    const res = await fetch(url);
    if (!res.ok) return;
    const body = (await res.json()) as {
      mentorChats?: unknown[];
      mentorSettings?: unknown;
      deleted?: string[];
      cursor?: string;
      hasMore?: boolean;
    };

    if (
      Array.isArray(body.mentorChats) ||
      Array.isArray(body.deleted) ||
      body.mentorSettings
    ) {
      applyRemote({
        chats: body.mentorChats ?? [],
        deleted: body.deleted ?? [],
        settings: body.mentorSettings,
      });
    }

    /* The cursor advances only on a pull that came back cleanly. If the merge threw
       or the response was unreadable, the cursor stays put and the next pull asks
       the same question again rather than skipping the window it failed to apply.
       Absent from the response when the server found nothing, which leaves it alone
       for the same reason. */
    if (body.cursor) {
      try {
        localStorage.setItem(key, body.cursor);
      } catch {
        /* private mode: the next pull re-reads everything, which is correct but
           wasteful, and is not worth failing the chat over. */
      }
    }

    /* More to come. Paging until it is false is what converges; assuming the
       first page is the whole thing is how a history silently truncates. */
    if (body.hasMore) queueMicrotask(() => void syncNow());
  } catch {
    /* Left alone. The next open or message retries, and until then the local
       record is still correct for this device. */
  }
}

/** Run a sync after a change, coalescing bursts.
 *
 *  A chat is written by two events in quick succession — the user's message, then
 *  the reply — and syncing on each would be two round trips for one exchange.
 */
export function scheduleMentorSync(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    /* One at a time. Two overlapping syncs could interleave a push and a pull and
       let the pull's merge overwrite a turn the push had just landed, which looks
       exactly like a lost message. */
    inFlight = inFlight
      ? inFlight.then(() => syncNow())
      : syncNow().finally(() => {
          inFlight = null;
        });
  }, DEBOUNCE_MS);
}

/** Sync now and wait, for the tests and for a page load. */
export async function syncMentorNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await syncNow();
}

/** Exposed for tests: the state a sync would push. */
export function pendingSnapshot() {
  return getSnapshot();
}

/** Clears a stored cursor. Only for tests. */
export function forgetCursor(userId?: string): void {
  try {
    if (userId) {
      localStorage.removeItem(cursorKey(userId));
      return;
    }
    /* Every cursor, for a test that does not want to care whose it was. */
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(CURSOR_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* nothing to forget */
  }
}
