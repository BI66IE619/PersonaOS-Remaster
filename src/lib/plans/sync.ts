import {
  acknowledgeDeletes as acknowledgeTaskDeletes,
  applyRemote as applyTaskRemote,
  currentTasksState,
  eventPayload,
  taskPayload,
} from "@/lib/tasks";
import {
  acknowledgeDeletes as acknowledgeHabitDeletes,
  applyRemote as applyHabitRemote,
  currentHabitsState,
  habitPayload,
} from "@/lib/habits";

/**
 * The plan tab's half of /api/sync.
 *
 * The same shape as the mentor's driver, and for the same reasons: the local record
 * is the working copy, writes never wait on a round trip, and a sync that fails
 * changes nothing on the device. A task ticked off on the train has to be ticked off
 * before the tunnel, not after.
 *
 * One cursor for all three stores rather than one each, because they sync together:
 * three cursors would mean three pulls and three chances for the habit grid to be
 * one pull behind the calendar. A shared cursor over one account's rows is still a
 * true statement, because a cursor does not say *which* rows — only "everything
 * written before this moment", which is one moment for all three.
 */

const CURSOR_PREFIX = "personaos:plans-cursor";

/** Per account, not one global cursor.
 *
 *  Reused across a sign-out, a cursor would tell the next account's first pull that
 *  it already had everything written before a moment it never asked about — and a
 *  device signing in for the first time on a browser someone else had used would
 *  show an empty plan with no way to correct it, because every later pull asks the
 *  same "anything newer?" question and keeps getting the right answer for the wrong
 *  person's history. */
const cursorKey = (userId: string) => `${CURSOR_PREFIX}:${userId}`;

/** Coalescing a burst. Adding a task fires one push, not one per field of the form;
 *  toggling several days of a habit in a row is one push too. */
const DEBOUNCE_MS = 2_500;

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

async function syncNow(): Promise<void> {
  const tasks = currentTasksState();
  const habits = currentHabitsState();

  /* Neither store is synced until it has been claimed by a render for the signed-in
     account. Pushing first would push whatever the previous account left on this
     device into this one's server history, and pulling would read this account's plan
     into somebody else's record. */
  if (tasks.owner !== habits.owner || !tasks.owner) return;

  const userId = tasks.owner;
  const payload = {
    events: tasks.events.map((e, i) => eventPayload(e, i)),
    /* `tasks`, not `planTasks` — the pull renames the field but the push does not.
       Asymmetric on purpose: the old `tasks` field on a pull was the wrong shape for
       this client, so it was replaced rather than reused, while the push's task rows
       are the same rows the old shape held and nothing reads them. */
    tasks: tasks.tasks.map((t, i) => taskPayload(t, i)),
    habits: habits.habits.map((h, i) => habitPayload(h, i)),
    deleted: {
      events: tasks.pendingDeletes.events,
      tasks: tasks.pendingDeletes.tasks,
      habits: habits.pendingDeletes,
    },
  };

  let ok = false;
  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    /* A 401 means signed out. The local records are deliberately kept — they are the
       user's — and the next sign-in pushes them. */
    if (res.status === 401) return;
    if (!res.ok) return;
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    /* The tombstones are confirmed by an explicit acknowledgement, not by the
       request having been answered. An endpoint that returned "I ignored that" and a
       device that cleared its list anyway would leave the other device holding a task
       the user deleted, permanently. */
    ok = body?.ok === true;
  } catch {
    return;
  }

  if (ok) {
    if (tasks.pendingDeletes.events.length || tasks.pendingDeletes.tasks.length) {
      acknowledgeTaskDeletes({
        events: tasks.pendingDeletes.events,
        tasks: tasks.pendingDeletes.tasks,
      });
    }
    if (habits.pendingDeletes.length) acknowledgeHabitDeletes(habits.pendingDeletes);
  }

  /* Now the other direction. */
  const key = cursorKey(userId);
  try {
    const cursor = localStorage.getItem(key);
    const url = cursor ? `/api/sync?since=${encodeURIComponent(cursor)}` : "/api/sync";
    const res = await fetch(url);
    if (!res.ok) return;
    const body = (await res.json()) as {
      events?: unknown[];
      planTasks?: unknown[];
      habits?: unknown[];
      deleted?: string[];
      cursor?: string;
      hasMore?: boolean;
    };

    if (Array.isArray(body.events) || Array.isArray(body.planTasks) || Array.isArray(body.deleted)) {
      applyTaskRemote({
        events: body.events ?? [],
        tasks: body.planTasks ?? [],
        deleted: body.deleted ?? [],
      });
    }
    if (Array.isArray(body.habits) || Array.isArray(body.deleted)) {
      applyHabitRemote({
        habits: body.habits ?? [],
        /* Habit ids come back namespaced as `habit:` because an event, a task and a
           habit can all hold the same eight characters. Stripped here and the event
           and task prefixes left for the other store to ignore. */
        deleted: (body.deleted ?? [])
          .filter((d): d is string => typeof d === "string" && d.startsWith("habit:"))
          .map((d) => d.slice(6)),
      });
    }

    /* The cursor advances only on a pull that came back cleanly. If a merge threw or
       the response was unreadable, it stays put and the next pull asks the same
       question rather than skipping the window it failed to apply. Absent from the
       response when the server found nothing, which leaves it alone for the same
       reason. */
    if (body.cursor) {
      try {
        localStorage.setItem(key, body.cursor);
      } catch {
        /* private mode: the next pull re-reads everything, which is correct but
           wasteful, and is not worth failing a habit over. */
      }
    }

    /* Paging until it is false is what converges. Assuming the first page is all of
       it is how a plan silently truncates. */
    if (body.hasMore) queueMicrotask(() => void syncNow());
  } catch {
    /* Left alone. The next change or open retries, and until then the local record is
       still correct for this device. */
  }
}

/** Run a sync after a change, coalescing bursts. */
export function schedulePlansSync(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    /* One at a time. Two overlapping syncs could interleave a push and a pull and let
       the pull's merge overwrite a row the push had just landed, which looks exactly
       like a lost task. */
    inFlight = inFlight ? inFlight.then(() => syncNow()) : syncNow().finally(() => { inFlight = null; });
  }, DEBOUNCE_MS);
}

/** Sync now and wait, for the tests and for a page load. */
export async function syncPlansNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await syncNow();
}

/** Clears a stored cursor. Only for tests. */
export function forgetPlansCursor(userId?: string): void {
  try {
    if (userId) {
      localStorage.removeItem(cursorKey(userId));
      return;
    }
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(CURSOR_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* nothing to forget */
  }
}