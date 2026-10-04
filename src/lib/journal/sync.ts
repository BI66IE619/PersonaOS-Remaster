import {
  acknowledgeDeletes as acknowledgeNoteDeletes,
  applyRemote as applyNotesRemote,
  currentNotesState,
  notePayload,
} from "@/lib/notes";
import {
  acknowledgeDeletes as acknowledgeCheckInDeletes,
  applyRemote as applyCheckInsRemote,
  checkinPayload,
  currentCheckInsState,
} from "@/lib/checkins";
import {
  acknowledgeDeletes as acknowledgeWeightDeletes,
  applyRemote as applyWeightRemote,
  currentWeightState,
  weightPayload,
} from "@/lib/weight-log";
import {
  acknowledgeDeletes as acknowledgeSportDeletes,
  applyRemote as applySportsRemote,
  currentSportsState,
  sportPayload,
} from "@/lib/sports";
import {
  acknowledgeDeletes as acknowledgeStrengthDeletes,
  applyRemote as applyStrengthRemote,
  currentStrengthState,
  exercisePayload,
  logPayload,
} from "@/lib/strength";
import { logKey } from "@/lib/types-strength";

/**
 * The journal half of /api/sync: notes, check-ins and weigh-ins.
 *
 * The same shape as the plan and mentor drivers — local record is the working
 * copy, writes never wait on a round trip, a failed sync changes nothing on the
 * device. One driver for all three because they arrive in one pull and one
 * cursor, and three cursors would mean three ways for the notes and the
 * check-in for the same day to disagree about how far back they had read.
 */
const CURSOR_PREFIX = "personaos:journal-cursor";

/** Per account, so a shared browser signing into a second account does not skip
 *  that account's history by reusing the first one's cursor. */
const cursorKey = (userId: string) => `${CURSOR_PREFIX}:${userId}`;

const DEBOUNCE_MS = 2_500;

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

async function syncNow(): Promise<void> {
  const notes = currentNotesState();
  const checkins = currentCheckInsState();
  const weight = currentWeightState();
  const sports = currentSportsState();
  const strength = currentStrengthState();

  /* Not until every store is claimed by the signed-in account. Pushing first
     would push whatever a previous account left on this device into this one's
     server history; pulling would read this account's data into somebody
     else's record. */
  if (
    !notes.owner ||
    notes.owner !== checkins.owner ||
    notes.owner !== weight.owner ||
    notes.owner !== sports.owner ||
    notes.owner !== strength.owner
  ) {
    return;
  }
  const userId = notes.owner;

  /* One row per movement per training day, carrying the whole set array. */
  const strengthLogs = [] as ReturnType<typeof logPayload>[];
  for (const [date, byExercise] of Object.entries(strength.days)) {
    for (const [exerciseId, sets] of Object.entries(byExercise)) {
      if (!sets.length) continue;
      const stamp = strength.logStamps[logKey(date, exerciseId)] ?? new Date(0).toISOString();
      strengthLogs.push(logPayload(date, exerciseId, sets, stamp));
    }
  }

  const payload = {
    notes: notes.entries.map(notePayload),
    checkins: checkins.entries.map(checkinPayload),
    weight: Object.entries(weight.logs).map(([date, lb]) =>
      weightPayload(date, lb, weight.stamps[date]),
    ),
    /* Manual sessions only. A device session's id is the phone's own Health
       Connect record, which the other device does not have — pushing it would
       add a second copy there rather than move this one. */
    sports: sports.sessions.filter((s) => s.source === "manual").map(sportPayload),
    strengthExercises: strength.exercises.map((e, i) => exercisePayload(e, i)),
    strengthLogs,
    deleted: {
      notes: notes.pendingDeletes,
      checkins: checkins.pendingDeletes,
      weight: weight.pendingDeletes,
      sports: sports.pendingDeletes,
      strengthExercises: strength.pendingDeletes.exercises,
      strengthLogs: strength.pendingDeletes.logs,
    },
  };

  let ok = false;
  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 401) return;
    if (!res.ok) return;
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    /* Confirmed by an explicit acknowledgement, not by the request having been
       answered — a device that cleared tombstones because "the call returned" and
       an endpoint that ignored them would leave the other device holding a note
       the user deleted, forever. */
    ok = body?.ok === true;
  } catch {
    return;
  }

  if (ok) {
    if (notes.pendingDeletes.length) acknowledgeNoteDeletes(notes.pendingDeletes);
    if (checkins.pendingDeletes.length) acknowledgeCheckInDeletes(checkins.pendingDeletes);
    if (weight.pendingDeletes.length) acknowledgeWeightDeletes(weight.pendingDeletes);
    if (sports.pendingDeletes.length) acknowledgeSportDeletes(sports.pendingDeletes);
    if (strength.pendingDeletes.exercises.length || strength.pendingDeletes.logs.length) {
      acknowledgeStrengthDeletes(strength.pendingDeletes);
    }
  }

  /* Now the other direction. */
  const key = cursorKey(userId);
  try {
    const cursor = localStorage.getItem(key);
    const url = cursor ? `/api/sync?since=${encodeURIComponent(cursor)}` : "/api/sync";
    const res = await fetch(url);
    if (!res.ok) return;
    const body = (await res.json()) as {
      notes?: unknown[];
      checkins?: unknown[];
      weight?: unknown[];
      sports?: unknown[];
      strengthExercises?: unknown[];
      strengthLogs?: unknown[];
      deleted?: string[];
      cursor?: string;
      hasMore?: boolean;
    };

    const deleted = Array.isArray(body.deleted) ? body.deleted : [];
    /* Each merge filters its own prefix out of the shared delete list, so a
       `note:` entry cannot clear a `checkin:` on the same day. */
    applyNotesRemote({ notes: body.notes ?? [], deleted });
    applyCheckInsRemote({ checkins: body.checkins ?? [], deleted });
    applyWeightRemote({ weight: body.weight ?? [], deleted });
    applySportsRemote({ sports: body.sports ?? [], deleted });
    applyStrengthRemote({
      exercises: body.strengthExercises ?? [],
      logs: body.strengthLogs ?? [],
      deleted,
    });

    /* The cursor advances only on a pull that came back cleanly. Absent when the
       server found nothing, which leaves it alone. */
    if (body.cursor) {
      try {
        localStorage.setItem(key, body.cursor);
      } catch {
        /* private mode: the next pull re-reads everything, which is correct but
           wasteful. */
      }
    }

    if (body.hasMore) queueMicrotask(() => void syncNow());
  } catch {
    /* Left alone. The next change or open retries. */
  }
}

/** Run a sync after a change, coalescing bursts. */
export function scheduleJournalSync(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    /* One at a time. Two overlapping syncs could interleave a push and a pull and
       let the pull overwrite a row the push just landed. */
    inFlight = inFlight
      ? inFlight.then(() => syncNow())
      : syncNow().finally(() => {
          inFlight = null;
        });
  }, DEBOUNCE_MS);
}

/** Sync now and wait, for a page load and the tests. */
export async function syncJournalNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await syncNow();
}

/** Clears a stored cursor. Only for tests. */
export function forgetJournalCursor(userId?: string): void {
  try {
    if (userId) {
      localStorage.removeItem(cursorKey(userId));
      return;
    }
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(CURSOR_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* nothing to forget */
  }
}
