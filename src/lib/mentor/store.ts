import { createStore } from "@/lib/create-store";
import type {
  MentorChat,
  MentorRole,
  MentorSettings,
  MentorState,
  MentorTurn,
} from "@/lib/mentor/types";

const KEY = "personaos:mentor";

const isStr = (v: unknown): v is string => typeof v === "string";
const uid = () => Math.random().toString(36).slice(2, 10);

/** A name is a label on a log row, not prose. Longer than this and the row is
 *  truncated anyway, so the rest is stored for nobody. */
export const MAX_TITLE = 60;

/** The floor for a stamp that has never been set.
 *
 *  Written out rather than left null so every comparison against it is a
 *  comparison of two numbers, and so a first-ever push of "sharing is off" is
 *  newer than the epoch rather than being treated as having nothing to say. */
const EPOCH = new Date(0).toISOString();

export const EMPTY_MENTOR: MentorState = {
  owner: null,
  settingsAt: EPOCH,
  chats: [],
  active: null,
  settings: { notes: false, events: false },
  pendingDeletes: [],
};

/**
 * Per chat, so one marathon conversation cannot starve the recents log.
 *
 * Applied again in mergeRemote: a pull can bring back more turns than the cap
 * allows if the other device had not pruned yet, and honouring the cap only
 * locally would let a sync quietly undo it.
 */
const MAX_TURNS = 80;
const MAX_CHARS = 2000;
/** A hard ceiling on the recents log. Oldest by last activity goes first when
 *  it is hit; the log is a door back to last week, not a full archive. */
const MAX_CHATS = 25;
/** Pending tombstones kept. Well above MAX_CHATS, because a device that deletes
 *  a chat with no connection still owes the server every one of them. */
const MAX_PENDING_DELETES = 100;

function reviveTurns(raw: unknown): MentorTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .flatMap((t) => {
      const role: MentorRole | null =
        t.role === "user" ? "user" : t.role === "mentor" ? "mentor" : null;
      if (!role || !isStr(t.text) || !t.text.trim()) return [];
      return [
        {
          id: isStr(t.id) ? t.id : uid(),
          role,
          text: t.text.slice(0, MAX_CHARS),
          at: isStr(t.at) ? t.at : new Date().toISOString(),
        },
      ];
    })
    .slice(-MAX_TURNS);
}

/** Keep the newest chats by last activity, newest kept and oldest shed. */
function capChats(chats: MentorChat[]): MentorChat[] {
  return [...chats]
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    .slice(0, MAX_CHATS);
}

/**
 * The pure core of the store, kept free of I/O so the recents log's logic can
 * be tested without a browser. The store's exported functions are one-line
 * callers of these.
 *
 * A chat is born when a message is sent with no active chat: `appendTurn` on a
 * state with `active: null` prepends a fresh chat and points `active` at it.
 * There is no "create chat" action to call — typing the first line already is
 * one.
 */
export function appendTurn(state: MentorState, role: MentorRole, text: string): MentorState {
  const turn: MentorTurn = {
    id: uid(),
    role,
    text: text.slice(0, MAX_CHARS),
    at: new Date().toISOString(),
  };
  let active = state.active;
  let chats = state.chats;
  let found = chats.find((c) => c.id === active);
  if (!found) {
    /* First message of a fresh chat, or `active` pointed at a chat that was
       deleted from another tab. Either way this is a new conversation, not a
       stray reply in an empty box. */
    found = {
      id: uid(),
      title: null,
      turns: [],
      firstAt: turn.at,
      lastAt: turn.at,
      modifiedAt: turn.at,
    };
    chats = [found, ...chats];
    active = found.id;
  }
  const updated: MentorChat = {
    ...found,
    turns: [...found.turns, turn].slice(-MAX_TURNS),
    lastAt: turn.at,
    /* A message is the chat moving forward in time, so both clocks advance. */
    modifiedAt: turn.at,
  };
  return {
    ...state,
    chats: capChats(chats.map((c) => (c.id === found.id ? updated : c))),
    active,
  };
}

/**
 * The body to push for one chat.
 *
 * `updatedAt` is the chat's `modifiedAt`, not its `lastAt`. The two are the same
 * moment for every message and differ only for a rename, and the server's conflict
 * rule needs the one that moved. Pushing `lastAt` meant a renamed chat arrived
 * looking unchanged and was discarded.
 *
 * The sharing booleans are not carried here at all. They belong to the user rather
 * than to any conversation, and giving them a chat to ride on meant a toggle was
 * only synced if the chat it rode on also moved — which a switch never does.
 * `settingsPayload` sends them with their own clock instead.
 */
export function chatPayload(chat: MentorChat) {
  return {
    clientId: chat.id,
    title: chat.title,
    updatedAt: chat.modifiedAt,
  };
}

/** The body to push for the sharing switches.
 *
 *  Its own row and its own clock, so a toggle is never a question about which chat
 *  happened to be touched most recently. "Off, and later" outranks "on, and earlier"
 *  — which is the case that matters, and the one a chat-carried flag could not
 *  express at all. */
export function settingsPayload(state: MentorState) {
  return {
    shareNotes: state.settings.notes,
    shareEvents: state.settings.events,
    updatedAt: state.settingsAt,
  };
}

/** A turn as pushed.
 *
 * Carries its chat's client id rather than a server uuid the device has never
 * seen. updatedAt is the turn's own clock, not the chat's: a chat's lastAt is
 * later than every turn inside it, so using that would push all of them with one
 * timestamp and leave the conflict rule nothing to compare.
 */
export function turnPayload(turn: MentorTurn, chatId: string) {
  return {
    clientId: turn.id,
    chatId,
    role: turn.role,
    text: turn.text,
    updatedAt: turn.at,
  };
}

/** A new chat is active staying on the fresh screen, not clearing anything:
 *  the conversation stays in the list and is one tap from the recents log. */
export function startNewChat(state: MentorState): MentorState {
  return { ...state, active: null };
}

/** Reopen a saved chat. Ids the store does not hold are not trusted; the app
 *  stays wherever it was rather than following a pointer to nothing. */
export function activateChat(state: MentorState, id: string): MentorState {
  return state.chats.some((c) => c.id === id) ? { ...state, active: id } : state;
}

/** Give a saved chat a name, or take it back.
 *
 *  A blank name is not a name: it clears the field so the log falls back to the
 *  preview it was showing before, which is the only way back to a row that
 *  names itself.
 *
 *  The turns, the timestamps of those turns, and which chat is open are all left
 *  exactly as they were — a name is a caption on a conversation, not an edit to it,
 *  and renaming should not float it back to the top of a recents log the user reads
 *  as recency of conversation. `modifiedAt` is the exception, and has to move or the
 *  new name never leaves this device.
 */
export function renameChat(state: MentorState, id: string, raw: string): MentorState {
  const name = raw.trim().slice(0, MAX_TITLE);
  const found = state.chats.find((c) => c.id === id);
  if (!found) return state;
  /* A rename to the name it already has is not a change, and saying so keeps the
     clock from moving on a keystroke-by-keystroke save of an unchanged label. */
  if ((found.title ?? "") === name) return state;
  const modifiedAt = new Date().toISOString();
  return {
    ...state,
    chats: state.chats.map((c) =>
      c.id === id ? { ...c, title: name || null, modifiedAt } : c,
    ),
  };
}

/** Change the sharing switches and move their clock.
 *
 *  The clock is what makes the change travel. Without it a device that turned note
 *  reading on pushed the new value against an unchanged timestamp, the server
 *  concluded it was not newer, and the switch quietly stayed off everywhere else.
 */
export function setSettings(state: MentorState, settings: MentorSettings): MentorState {
  if (state.settings.notes === settings.notes && state.settings.events === settings.events) {
    return state;
  }
  return { ...state, settings, settingsAt: new Date().toISOString() };
}

/** Forget a chat, and owe the server a tombstone for it.
 *
 * The id goes on `pendingDeletes` rather than being simply dropped, because the
 * row the server needs to be told about is exactly the row that was just removed.
 * A delete that cannot be carried leaves the other device showing a conversation
 * this one has thrown away, with no way for the user to tell that from a chat they
 * have not synced yet.
 */
export function dropChat(state: MentorState, id: string): MentorState {
  if (!state.chats.some((c) => c.id === id)) return state;
  return {
    ...state,
    chats: capChats(state.chats.filter((c) => c.id !== id)),
    /* Deleting the chat in front of you falls back to a fresh one. The log
       only deals you this while there is nothing active, but another tab could
       force the case, so the store handles it rather than the screen. */
    active: state.active === id ? null : state.active,
    pendingDeletes: [...new Set([...state.pendingDeletes, id])].slice(-MAX_PENDING_DELETES),
  };
}

/** Forget tombstones the server has confirmed, so the list does not grow without
 *  bound and a re-push cannot resurrect a delete the other device already applied. */
export function clearPendingDeletes(state: MentorState, ids: string[]): MentorState {
  if (ids.length === 0) return state;
  const done = new Set(ids);
  const pendingDeletes = state.pendingDeletes.filter((id) => !done.has(id));
  return pendingDeletes.length === state.pendingDeletes.length ? state : { ...state, pendingDeletes };
}

/** A chat as it arrives from the server, before it is merged in.
 *
 *  Same untrusted treatment as localStorage: a chat with no sayable turn in it is
 *  dropped rather than shown as an empty row, and a role the app did not write is
 *  not passed on to a renderer that would have to guess at it.
 */
function reviveRemoteChat(raw: unknown): MentorChat | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isStr(o.clientId) || !o.clientId) return null;

  const turns = Array.isArray(o.turns)
    ? o.turns
        .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
        .flatMap((t) => {
          const role: MentorRole | null =
            t.role === "user" ? "user" : t.role === "mentor" ? "mentor" : null;
          if (!role || !isStr(t.text) || !t.text.trim()) return [];
          return [
            {
              id: isStr(t.clientId) ? t.clientId : uid(),
              role,
              text: t.text.slice(0, MAX_CHARS),
              at: isStr(t.updatedAt) ? t.updatedAt : new Date().toISOString(),
            },
          ];
        })
        .slice(-MAX_TURNS)
    : [];

  if (turns.length === 0) return null;
  /* The server sends one stamp per chat — the moment the row last changed — so it
     serves as both clocks here. That is sound because a rename leaves the turns
     exactly as they were: a chat whose name changed and whose last message did not
     should win the recents slot nowhere and should still win the name. When the
     server is talking about a conversation rather than a label, the two are the
     same moment anyway. */
  const modifiedAt = isStr(o.updatedAt) ? o.updatedAt : turns[turns.length - 1].at;
  return {
    id: o.clientId,
    turns,
    title: isStr(o.title) ? o.title.trim().slice(0, MAX_TITLE) || null : null,
    firstAt: turns[0].at,
    lastAt: turns[turns.length - 1].at,
    modifiedAt,
  };
}

/**
 * Fold a server pull into the local state.
 *
 * Last-write-wins per chat on the row's own clock, and last-write-wins again for the
 * sharing switches on theirs. A chat the server does not mention is left alone
 * rather than removed: a pull with a cursor returns only what changed, so treating
 * silence as a delete would wipe the whole log on every pull. Deletion is carried
 * explicitly, by tombstone, and only that.
 *
 * Returns the same object when nothing changed, so a no-op pull does not re-render
 * the tab — `useSyncExternalStore` compares by reference.
 */
export function mergeRemote(
  state: MentorState,
  remote: {
    chats: unknown[];
    deleted: string[];
    settings?: unknown;
  },
): MentorState {
  let chats = state.chats;

  for (const raw of remote.chats) {
    const incoming = reviveRemoteChat(raw);
    if (!incoming) continue;
    const existing = chats.find((c) => c.id === incoming.id);

    if (!existing) {
      chats = [...chats, incoming];
      continue;
    }

    if (incoming.modifiedAt > existing.modifiedAt) {
      /* Only the newer side wins, and the winning side's turns are taken whole.
         Merging turn lists instead would be wrong in the only case that matters:
         the other device pruned to its cap, so a union would resurrect every turn
         this device deliberately dropped. */
      chats = chats.map((c) => (c.id === incoming.id ? incoming : c));
      continue;
    }

    if (incoming.modifiedAt < existing.modifiedAt) {
      /* The local row is the newer one. Ignored outright — folding in the server's
         older turns anyway would append a reply from before the conversation this
         device is looking at, and an out-of-order message is worse than one that
         arrives a pull later. */
      continue;
    }

    /* Equal stamps, so neither side has won — but a pull can carry a turn this
       device has never seen on a chat whose row itself did not move, because a
       turn written inside the same millisecond as the previous one leaves the
       chat's clock where it was. Union just the missing ids. */
    const have = new Set(existing.turns.map((t) => t.id));
    const extra = incoming.turns.filter((t) => !have.has(t.id));
    if (extra.length) {
      chats = chats.map((c) =>
        c.id === incoming.id ? { ...c, turns: [...c.turns, ...extra].slice(-MAX_TURNS) } : c,
      );
    }
  }

  /* Chat tombstones come prefixed from the route, because a chat id and a note id
     are both bare strings and the device has to know which store to act on. */
  const goneChats = remote.deleted
    .filter((d): d is string => d.startsWith("chat:"))
    .map((d) => d.slice(5));
  if (goneChats.length) {
    const gone = new Set(goneChats);
    chats = capChats(chats.filter((c) => !gone.has(c.id)));
  }

  const sorted = capChats([...chats].sort((a, b) => b.lastAt.localeCompare(a.lastAt)));
  /* `active` is a local pointer, not synced state. A chat that arrived from another
     device is never opened automatically — that would yank the user out of the
     conversation they are reading. A pointer to something that has since been
     deleted falls back to a fresh screen rather than dangling. */
  const active = state.active && sorted.some((c) => c.id === state.active) ? state.active : null;

  /* The switches, on their own clock and their own last-write-wins.
   *
   * Strictly greater, which is what lets "off" travel. The earlier version only
   * accepted a remote value when one of the booleans was true, on the reasoning that
   * a record of everything-off carries no information — which is precisely backwards:
   * all-off is the value a user reaches by turning sharing off, and it is the one
   * case where silence is a decision rather than an absence. Reading it as "no
   * change" meant a device that switched everything off never switched it off
   * anywhere else, while the devices that had it on kept the user's notes going to
   * the model after they said stop.
   *
   * Local wins a tie, so a pull cannot flip a switch the user moved in the same
   * millisecond the pull landed. */
  let settings = state.settings;
  let settingsAt = state.settingsAt;
  const incoming = remote.settings;
  if (incoming && typeof incoming === "object") {
    const s = incoming as Record<string, unknown>;
    const at = isStr(s.updatedAt) ? s.updatedAt : null;
    if (at && (s.shareNotes === true || s.shareNotes === false) &&
        (s.shareEvents === true || s.shareEvents === false) &&
        at > settingsAt) {
      settings = { notes: s.shareNotes === true, events: s.shareEvents === true };
      settingsAt = at;
    }
  }

  const sameChats =
    sorted.length === state.chats.length && sorted.every((c, i) => c === state.chats[i]);
  const sameSettings =
    settings.notes === state.settings.notes && settings.events === state.settings.events;
  if (sameChats && sameSettings) return state;

  return { ...state, chats: sorted, active, settings, settingsAt };
}

/**
 * Untrusted localStorage, like every other store in the app: anything that
 * does not match the shape is dropped rather than trusted, so a hand-edited
 * or half-written record cannot crash a render.
 *
 * Two shapes are accepted. The record this app wrote for its first months was
 * `{ turns, settings }` — one conversation, no log. That migrates into a
 * single saved chat under the new shape (all migrations stay one-way: the new
 * shape is written from then on, so the branch below stops mattering as soon
 * as the record is touched again).
 */
export function revive(raw: unknown): MentorState {
  if (!raw || typeof raw !== "object") return EMPTY_MENTOR;
  const o = raw as Record<string, unknown>;

  /* Null when the record predates ownership. That is not the same as empty: it means
     nobody has claimed it yet, and the first render decides. Treating a missing
     owner as "owned by nobody" would mean the chats behind it are unreachable
     rather than merely unclaimed. */
  const owner = isStr(o.owner) && o.owner ? o.owner : null;

  const settings = o.settings as Record<string, unknown> | undefined;
  /* Note and calendar reading are opt-in and both start off. A record written
     before the calendar switch existed has no `events` key at all, and reads
     as off rather than as undefined being truthy. */
  const mentorSettings: MentorSettings = {
    notes: settings?.notes === true,
    events: settings?.events === true,
  };

  /* A record written before the switches had their own clock falls back to the
     epoch, which makes the next server value win by default. The switch that
     matters — turning sharing off — is exactly the one that would otherwise never
     be picked up, so the fallback is set to lose. */
  const settingsAt = isStr(o.settingsAt) ? o.settingsAt : EPOCH;

  /* The new shape: a list of chats and the one being looked at. */
  /* Untrusted in the same way as the rest, and the ids are filtered rather than
     trusted: a tombstone list from a previous version of this app, or from a
     hand-edited record, must not put a non-string into a Set that gets sent back
     to the server. */
  const pendingDeletes = Array.isArray(o.pendingDeletes)
    ? [...new Set(o.pendingDeletes.filter(isStr))].slice(-MAX_PENDING_DELETES)
    : [];

  if (Array.isArray(o.chats)) {
    const chats = o.chats
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
      .flatMap((c) => {
        const turns = reviveTurns(c.turns);
        /* A chat with nothing sayable in it is dropped outright: an id with no
           turns is not a conversation, it is a stub. */
        if (!isStr(c.id) || turns.length === 0) return [];
        const lastAt = isStr(c.lastAt) ? c.lastAt : turns[turns.length - 1].at;
        const chat: MentorChat = {
          id: c.id,
          turns,
          /* A title is user typing, so it gets the same untrusted treatment as
             a message: trimmed, capped, and a blank one read as none rather
             than as an empty string. */
          title: isStr(c.title) ? c.title.trim().slice(0, MAX_TITLE) || null : null,
          firstAt: isStr(c.firstAt) ? c.firstAt : turns[0].at,
          lastAt,
          /* A record from before this field existed has no separate clock, so the
             recency of its last message stands in. Slightly generous — it makes the
             chat beat an equal-stamped rename elsewhere — and the alternative,
             refusing the chat, loses a conversation over a bookkeeping field. */
          modifiedAt: isStr(c.modifiedAt) ? c.modifiedAt : lastAt,
        };
        return [chat];
      })
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
      .slice(0, MAX_CHATS);
    const active =
      isStr(o.active) && chats.some((c) => c.id === o.active) ? o.active : null;
    return { owner, settingsAt, chats, active, settings: mentorSettings, pendingDeletes };
  }

  /* The old shape: one conversation and a settings object. */
  const turns = reviveTurns(o.turns);
  if (turns.length === 0) {
    return { owner, settingsAt, chats: [], active: null, settings: mentorSettings, pendingDeletes };
  }
  const chat: MentorChat = {
    id: uid(),
    turns,
    title: null,
    firstAt: turns[0].at,
    lastAt: turns[turns.length - 1].at,
    modifiedAt: turns[turns.length - 1].at,
  };
  return {
    owner,
    settingsAt,
    chats: [chat],
    active: chat.id,
    settings: mentorSettings,
    pendingDeletes,
  };
}

const store = createStore<MentorState>(KEY, EMPTY_MENTOR, revive);

export const { getSnapshot, subscribe } = store;

const SERVER_STATE: MentorState = {
  owner: null,
  settingsAt: EPOCH,
  chats: [],
  active: null,
  settings: { notes: false, events: false },
  pendingDeletes: [],
};
/** Stable identity matters: useSyncExternalStore compares snapshots by reference. */
export const getServerSnapshot = (): MentorState => SERVER_STATE;

/**
 * Bind this device's mentor record to the signed-in account.
 *
 * Called on every render of the mentor screen with the user id the server read from
 * the session, which is the only place in the app that knows who is signed in
 * authoritatively — a client-side read of the profile could be stale, and a stale
 * "yes, same person" is the exact case this has to catch.
 *
 * A mismatch empties the record rather than merging into it. The chats on this
 * device belong to somebody who is no longer signed in; carrying them forward would
 * show one account's private conversations to another, and the next sync would copy
 * them into the wrong account's server-side history, which is a leak in a place the
 * user cannot delete from by signing out. Their server copy is untouched, so signing
 * back in gets them back.
 *
 * Returns the state either way, so the caller can read what is now current rather
 * than re-reading the snapshot and hoping it matches.
 */
export function claimMentorOwnership(userId: string): MentorState {
  if (store.getSnapshot().owner === userId) return store.getSnapshot();
  /* Built from EMPTY_MENTOR rather than from the current state, so nothing from the
     previous account survives — not the chats, not the sharing switches, and not the
     tombstones, which are the sharpest edge here: an id left over from somebody
     else's delete list would be pushed into this account and tombstone a chat id
     that happened to collide. */
  store.update(() => ({ ...EMPTY_MENTOR, owner: userId }));
  return store.getSnapshot();
}

/** The account the current record belongs to, or null if nobody has claimed it yet. */
export function mentorOwner(): string | null {
  return store.getSnapshot().owner;
}

export function setNoteReading(on: boolean) {
  store.update((s) => setSettings(s, { ...s.settings, notes: on }));
}

export function setEventSharing(on: boolean) {
  store.update((s) => setSettings(s, { ...s.settings, events: on }));
}

export function addTurn(role: MentorRole, text: string) {
  store.update((s) => appendTurn(s, role, text));
}

export function newChat() {
  store.update(startNewChat);
}

export function openChat(id: string) {
  store.update((s) => activateChat(s, id));
}

export function deleteChat(id: string) {
  store.update((s) => dropChat(s, id));
}

export function setChatTitle(id: string, title: string) {
  store.update((s) => renameChat(s, id, title));
}

export function currentState(): MentorState {
  return store.getSnapshot();
}

/** Fold in a server pull. Exported rather than only used internally so the screen
 *  can apply one without re-reading the snapshot a second time. */
export function applyRemote(remote: {
  chats: unknown[];
  deleted: string[];
  settings?: unknown;
}) {
  store.update((s) => mergeRemote(s, remote));
}

/** Drop tombstones a push has confirmed. */
export function acknowledgeDeletes(ids: string[]) {
  store.update((s) => clearPendingDeletes(s, ids));
}