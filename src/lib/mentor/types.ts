import type { CheckIn, JournalEntry, TodayView } from "@/lib/types";
import type { CalEvent, Task } from "@/lib/types-tasks";
import type { Habit } from "@/lib/types-habits";
import type { StrengthState } from "@/lib/types-strength";
import type { SportSession } from "@/lib/sports";
import type { WeightLogs } from "@/lib/weight-log";
import type { MoneyView } from "@/lib/finance/types";

/**
 * What the mentor is allowed to know.
 *
 * Every number here is computed by the same functions the panels on the other
 * tabs use, so the brief is assembled on the device from conclusions the app
 * already drew. The model talks about them; it never measures. That is the whole
 * reason a chat can be trusted in an app built on refusing to print a claim it
 * cannot stand behind.
 *
 * `sufficient` carries each source's own minimum-N gate. A finding the app
 * itself would stay quiet about arrives marked false rather than omitted, which
 * turns silence into something the prompt can be taught instead of a gap it has
 * to infer.
 */
export type Finding = {
  key: string;
  label: string;
  read: string;
  facts: string[];
  sample: string;
  sufficient: boolean;
};

export type NoteExcerpt = {
  date: string;
  text: string;
  tags: string[];
};

export type MentorBrief = {
  today: string;
  findings: Finding[];
  /** Empty unless the user has turned note reading on. */
  notes: NoteExcerpt[];
  notesShared: boolean;
  /** Empty unless the user has turned calendar sharing on. */
  calendar: CalendarLine[];
  calendarShared: boolean;
};

/**
 * One event as the model sees it.
 *
 * The title is the user's own typing, which is the reason this is behind a
 * switch rather than redacted: an event can name a person, and the app has no
 * field to tell people apart from anything else. The consent is the switch, and
 * the switch says in as many words that titles go too.
 */
export type CalendarLine = {
  date: string;
  title: string;
  /** "all day" rather than a clock time, matching the app's own reading of a
   *  null start. */
  when: string;
  category: string;
};

export type BriefInput = {
  today: string;
  view: TodayView;
  habits: readonly Habit[];
  strength: StrengthState;
  checkIns: readonly CheckIn[];
  notes: readonly JournalEntry[];
  weightLogs: WeightLogs;
  sports: readonly SportSession[];
  money: MoneyView;
  /**
   * Whether `money` is the user's own ledger or generated placeholders.
   *
   * The brief says so in words, and it has to be able to: the prompt tells the
   * mentor not to reason about money that is not real, which is unenforceable
   * unless the brief marks which kind it is carrying. */
  moneyIsReal: boolean;
  tasks: readonly Task[];
  events: readonly CalEvent[];
  shareNotes: boolean;
  shareEvents: boolean;
};

export type MentorRole = "user" | "mentor";

export type MentorTurn = {
  id: string;
  role: MentorRole;
  text: string;
  at: string;
};

/**
 * Set by the route, not by the model.
 *
 * The model is asked to notice distress and to say nothing else, and the honest
 * version of that is not to trust the notice. If it fires, the app shows a fixed
 * message with a real number. Generated crisis copy is the one place where being
 * creatively helpful is the worst possible outcome, so there is nothing here for
 * it to be creative with.
 */
export type CrisisFlag = { crisis: true };

export type MentorSettings = {
  /** Whether notes go with the brief. Off until the user says so, because notes
   *  are the only unstructured thing in the app and the only input that is not
   *  already a number the user chose to log. */
  notes: boolean;
  /** Whether calendar events go with the brief, titles included. Off until the
   *  user says so, for the same reason and then some: an event title is free
   *  text that may name someone who had no say in any of this. */
  events: boolean;
};

/** The settings as they cross the wire, with the clock they were last written at.
 *
 *  Named for what it is rather than reusing MentorSettings, because the two are
 *  genuinely different: this one has `shareNotes`/`shareEvents` and a timestamp,
 *  the other has `notes`/`events` and no notion of when. Passing a MentorSettings
 *  where this is expected would compile only if the field names matched, and they
 *  do not — which is the point of a type here. */
export type MentorSettingsPayload = {
  shareNotes: boolean;
  shareEvents: boolean;
  updatedAt: string;
};

export type MentorChat = {
  id: string;
  turns: MentorTurn[];
  /** A name the user gave this chat, or null while it still has none. Null is
   *  not an empty string: it means the recents log falls back to the preview
   *  built out of the first message, and clearing a name is how you get back
   *  to that rather than being stuck with a blank row. */
  title: string | null;
  /** When the chat was born — the timestamp of its first message. Kept as its
   *  own field because old turns are pruned, and a fifteen-chat-deep log should
   *  still be able to say when the first one started. */
  firstAt: string;
  /** The timestamp of the most recent turn. This is what the recents log sorts
   *  by, and it is updated on every message even when pruning drops the older
   *  ones. */
  lastAt: string;
  /** The last moment anything about this chat changed, including a rename.
   *
   *  Separate from `lastAt` because they answer different questions. `lastAt` is
   *  "when did this conversation last have something said in it", which is what
   *  ordering the recents log wants, and a rename must not jump a chat to the top
   *  of a list the user reads as "what I was just talking about". `modifiedAt` is
   *  "when did this row last change", which is what the sync conflict rule needs.
   *
   *  They were the same field once and renaming a chat did not sync at all: the
   *  server saw an unchanged timestamp, decided the incoming row was not newer, and
   *  discarded the new name. A name the user typed silently not existing on the
   *  other device. */
  modifiedAt: string;
};

export type MentorState = {
  /** The auth account this record belongs to, or null while nobody has claimed it.
   *
   *  Chats are the most private thing in the app, and localStorage is keyed by
   *  origin, not by account. Without this, signing out and signing in as someone
   *  else on a shared browser would show them the previous account's mentor
   *  conversations — and, worse, the first sync would push them into their own
   *  server account, making a leak on one device into a leak in the cloud.
   *
   *  Stored rather than used as a storage key because the store is read at module
   *  load, before any page has asked who is signed in. The claim happens on the
   *  first render instead, and a mismatch empties the record. */
  owner: string | null;
  /** When the sharing switches were last changed on this device.
   *
   *  Its own clock, separate from any chat's, because a switch is not part of a
   *  conversation and does not belong to any one of them. It was previously carried
   *  on the newest chat, which meant a toggle sent nothing the server would accept
   *  (the chat's stamp had not moved, so last-write-wins rejected it) and could not
   *  express turning sharing *off* (a false value is not "newer" than anything).
   *  As its own field, "off, later" is expressible and outranks "on, earlier". */
  settingsAt: string;
  /** Every chat kept on this device. There are none until the first message of
   *  the first chat is sent — an empty store is `chats: []`, not a chat with no
   *  turns in it. */
  chats: MentorChat[];
  /** Which chat is on screen, or null while sitting on a fresh one. Null is
   *  what "new chat" means: it does not delete anything and cannot be an id. */
  active: string | null;
  settings: MentorSettings;
  /**
   * Chat ids deleted here that the server has not confirmed yet.
   *
   * A tombstone the device still owes. Deleting a chat removes it from `chats`
   * immediately, so without this list the delete could not be pushed: the row the
   * server needs to be told about is exactly the row that was just dropped, and
   * the other device would keep showing a conversation this one has deleted.
   *
   * Held as ids rather than deleted chats, so the server is not sent the contents
   * of something the user asked to be gone. An id in here is dropped as soon as a
   * push succeeds, which is also what stops the list growing forever.
   */
  pendingDeletes: string[];
};
