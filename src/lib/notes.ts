import { createStore } from "@/lib/create-store";
import { dayKey } from "@/lib/dates";
import { MAX_PENDING_DELETES, reviveIds, stampAfter } from "@/lib/sync-stamp";
import type { JournalEntry } from "@/lib/types";

/**
 * The old check-in kept a single entry under one key, so saving a new day
 * overwrote the previous one and no history could ever exist. This holds an
 * array instead, one entry per day, so writing about yesterday is safe.
 *
 * One note per calendar day, so the day is the row's identity — the client id
 * pushed to the server is the date itself. That is what lets a note be edited on
 * two devices and reconciled: both sides agree on the key, and the later clock
 * wins. It also means a delete is a tombstone for a date, not for a random id.
 */
const KEY = "personaos:notes";

const isStr = (v: unknown): v is string => typeof v === "string";
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export const TAG_LIMIT = 8;
const TAG_MAX = 24;

/**
 * One place that decides what a tag list is, because tags arrive from three
 * routes: the composer's chip input, saved storage, and hand-edited
 * localStorage. Trim, drop blanks, cap the length, dedupe case-insensitively so
 * "Essay" and "essay" cannot both sit in the list, and cap the count.
 */
export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (!isStr(t)) continue;
    const tag = t.trim().slice(0, TAG_MAX);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length === TAG_LIMIT) break;
  }
  return out;
}

/** A note as this device stores it. `updatedAt` is the sync clock; `date` is
 *  both the day and the row's identity. */
export type StoredNote = JournalEntry & { updatedAt: string };

function normalizeEntry(raw: unknown): StoredNote | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isDay(o.date)) return null;
  const note = isStr(o.note) ? o.note.slice(0, 20000) : "";
  /* No text is not a note. */
  if (!note.trim()) return null;
  return {
    date: o.date,
    note,
    tags: normalizeTags(o.tags),
    /* A note saved before the clock existed reads as long ago, so a stale push
       from this device loses to anything the server already knows. */
    updatedAt: isStr(o.updatedAt) ? o.updatedAt : new Date(0).toISOString(),
  };
}

export type NotesState = {
  entries: StoredNote[];
  seeded: boolean;
  /** The auth account this record belongs to, or null while nobody has claimed
   *  it. Without it a sign-in as somebody else would show their notes. */
  owner: string | null;
  /** Day keys deleted here that the server has not confirmed. The row is gone
   *  from `entries`, so this is the only record that the delete still owes. */
  pendingDeletes: string[];
};

const EMPTY: NotesState = { entries: [], seeded: false, owner: null, pendingDeletes: [] };

function revive(raw: unknown): NotesState {
  if (!raw || typeof raw !== "object") return EMPTY;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.entries)) {
    return {
      ...EMPTY,
      owner: isStr(o.owner) && o.owner ? o.owner : null,
      seeded: typeof o.seeded === "boolean" ? o.seeded : false,
      pendingDeletes: reviveIds(o.pendingDeletes),
    };
  }

  const seen = new Set<string>();
  /* Only the client ever calls revive, so this is the user's real today. A
     note cannot be written about a day that has not happened yet, whatever
     the stored value claims. */
  const today = dayKey(new Date());
  const entries = o.entries
    .map(normalizeEntry)
    .filter((e): e is StoredNote => e !== null)
    .filter((e) => e.date <= today)
    .filter((e) => {
      if (seen.has(e.date)) return false;
      seen.add(e.date);
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return {
    entries,
    seeded: typeof o.seeded === "boolean" ? o.seeded : false,
    owner: isStr(o.owner) && o.owner ? o.owner : null,
    pendingDeletes: reviveIds(o.pendingDeletes),
  };
}

const store = createStore<NotesState>(KEY, EMPTY, revive);

export const { getSnapshot, subscribe } = store;

const SERVER_STATE: NotesState = { entries: [], seeded: true, owner: null, pendingDeletes: [] };
/** Stable identity matters: useSyncExternalStore compares snapshots by reference. */
export const getServerSnapshot = (): NotesState => SERVER_STATE;

/**
 * Bind this device's notes to the signed-in account.
 *
 * A mismatch empties the record rather than merging, and clears the tombstones
 * with it — an id left from somebody else's delete list could tombstone a note
 * that happened to share a date. Their server copy is untouched.
 */
export function claimNotesOwnership(userId: string): NotesState {
  const s = store.getSnapshot();
  if (s.owner === userId) return s;
  /* First claim adopts what is already on this device: a record nobody owns is
     this person's own notes from before they ever signed in, and emptying it
     here would lose them. A record owned by a different account is cleared
     instead, tombstones included — an id from somebody else's delete list could
     tombstone a note that happened to share a date. */
  if (s.owner === null) {
    const adopted = { ...s, owner: userId };
    store.set(adopted);
    return adopted;
  }
  store.set({ ...EMPTY, owner: userId });
  return store.getSnapshot();
}

export const byDate = (entries: JournalEntry[], date: string): JournalEntry | undefined =>
  entries.find((e) => e.date === date);

/**
 * Substring match over the whole body and the tags. Entries are already sorted
 * newest first by the store, so the result keeps that order. A plain filter is
 * the right tool here: a personal archive is hundreds of entries, not millions,
 * and an index would be more code than it ever saves.
 */
export function searchEntries(
  entries: JournalEntry[],
  query: string,
  tag: string | null,
): JournalEntry[] {
  const q = query.trim().toLowerCase();
  const wanted = tag?.toLowerCase() ?? null;
  return entries.filter((e) => {
    if (wanted && !e.tags.some((t) => t.toLowerCase() === wanted)) return false;
    if (!q) return true;
    return e.note.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q));
  });
}

/** Every tag in use, most used first then alphabetical, for the filter row. */
export function allTags(entries: JournalEntry[]): string[] {
  const counts = new Map<string, { tag: string; n: number }>();
  for (const e of entries) {
    for (const t of e.tags) {
      const key = t.toLowerCase();
      const hit = counts.get(key);
      if (hit) hit.n++;
      else counts.set(key, { tag: t, n: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag))
    .map((c) => c.tag);
}

/**
 * A window of text around the first match, rather than the first line of the
 * note. Searching for a word on line five and being shown line one is the
 * difference between a useful result and a confusing one.
 */
export function snippet(note: string, query: string, width = 110): string {
  const q = query.trim().toLowerCase();
  const flat = note.replace(/\s+/g, " ").trim();
  if (!q) return flat.length > width ? `${flat.slice(0, width)}…` : flat;

  const at = flat.toLowerCase().indexOf(q);
  if (at < 0) return flat.length > width ? `${flat.slice(0, width)}…` : flat;

  /* Start a little before the hit, snapped to a word boundary so the snippet
     does not begin mid-word. */
  let start = Math.max(0, at - Math.floor(width / 3));
  if (start > 0) {
    const space = flat.indexOf(" ", start);
    if (space !== -1 && space < at) start = space + 1;
  }
  const end = Math.min(flat.length, start + width);
  const body = flat.slice(start, end);
  return `${start > 0 ? "…" : ""}${body}${end < flat.length ? "…" : ""}`;
}

/** Newest first. */
const sortDesc = (a: JournalEntry, b: JournalEntry) => b.date.localeCompare(a.date);

const withTombstone = (state: NotesState, date: string, entries: StoredNote[]): NotesState => ({
  ...state,
  seeded: true,
  entries,
  pendingDeletes: [...new Set([...state.pendingDeletes, date])].slice(-MAX_PENDING_DELETES),
});

export function saveEntry(date: string, patch: Partial<Omit<JournalEntry, "date">>) {
  const s = store.getSnapshot();
  const note = isStr(patch.note) ? patch.note.slice(0, 20000) : "";
  const existing = s.entries.find((e) => e.date === date);
  /* Emptied-out text should drop the day rather than sit in the archive as a
     blank row, otherwise deleting the last line leaves a ghost behind — and the
     drop has to owe the server a tombstone, or the other device keeps the row. */
  if (!note.trim()) {
    if (!existing) return;
    store.set(withTombstone(s, date, s.entries.filter((e) => e.date !== date)));
    return;
  }
  const next: StoredNote = {
    date,
    note,
    tags: normalizeTags(patch.tags),
    updatedAt: stampAfter(existing?.updatedAt),
  };
  store.set({
    ...s,
    seeded: true,
    entries: [next, ...s.entries.filter((e) => e.date !== date)].sort(sortDesc),
  });
}

export function removeEntry(date: string) {
  const s = store.getSnapshot();
  if (!s.entries.some((e) => e.date === date)) return;
  store.set(withTombstone(s, date, s.entries.filter((e) => e.date !== date)));
}

export function clearNotes() {
  /* Wiping is a delete of everything, and the tombstones are what carry that to
     the server. Dropping them would leave every other device showing notes this
     one threw away. */
  store.update((s) => ({
    ...EMPTY,
    owner: s.owner,
    seeded: true,
    pendingDeletes: [
      ...new Set([...s.pendingDeletes, ...s.entries.map((e) => e.date)]),
    ].slice(-MAX_PENDING_DELETES),
  }));
}

/* --------------------------------------------------------------------------
 * The sync half. Mirrors the plan stores: a pure merge, a payload builder, and
 * thin store callers, so the merge can be tested without a browser.
 * ------------------------------------------------------------------------ */

/** A note as it arrives from the server. Untrusted: anything not matching the
 *  shape is dropped. The server's `day` is the identity, carried as `date`. */
function reviveRemote(raw: unknown): StoredNote | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const day = isStr(o.day) ? o.day : isStr(o.clientId) ? o.clientId : null;
  if (!day || !isDay(day)) return null;
  const note = isStr(o.text) ? o.text.slice(0, 20000) : "";
  if (!note.trim()) return null;
  return {
    date: day,
    note,
    tags: normalizeTags(o.tags),
    updatedAt: isStr(o.updatedAt) ? o.updatedAt : new Date(0).toISOString(),
  };
}

/** Last-write-wins per day. A day the pull does not mention is left alone:
 *  a cursor pull returns only what changed, so silence is not a delete. */
export function mergeRemote(
  state: NotesState,
  remote: { notes: unknown[]; deleted: string[] },
): NotesState {
  let entries = state.entries;
  for (const raw of remote.notes) {
    const incoming = reviveRemote(raw);
    if (!incoming) continue;
    const existing = entries.find((e) => e.date === incoming.date);
    if (!existing) entries = [...entries, incoming];
    else if (incoming.updatedAt > existing.updatedAt) {
      entries = entries.map((e) => (e.date === incoming.date ? incoming : e));
    }
  }
  /* Deletes arrive namespaced `note:` — notes, check-ins and weights all key a
     row by its day, so a bare date would be ambiguous between the three. */
  const gone = new Set(
    remote.deleted
      .filter((d): d is string => typeof d === "string" && d.startsWith("note:"))
      .map((d) => d.slice(5)),
  );
  if (gone.size) entries = entries.filter((e) => !gone.has(e.date));
  if (entries === state.entries) return state;
  return { ...state, entries: entries.sort(sortDesc) };
}

/** A note as pushed. The date is the client id. */
export function notePayload(n: StoredNote) {
  return {
    clientId: n.date,
    day: n.date,
    text: n.note,
    tags: n.tags,
    updatedAt: n.updatedAt,
  };
}

export function applyRemote(remote: { notes: unknown[]; deleted: string[] }) {
  store.update((s) => mergeRemote(s, remote));
}

export function acknowledgeDeletes(ids: string[]) {
  if (ids.length === 0) return;
  const gone = new Set(ids);
  store.update((s) => ({
    ...s,
    pendingDeletes: s.pendingDeletes.filter((id) => !gone.has(id)),
  }));
}

export function currentNotesState(): NotesState {
  return store.getSnapshot();
}
