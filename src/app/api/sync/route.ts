import { z } from "zod";
import { desc, eq, gt, and } from "drizzle-orm";
import {
  db,
  schema,
  requireUserId,
  Unauthenticated,
  ensureProfile,
  upsertNotes,
  upsertCheckins,
  upsertPlanTasks,
  upsertPlanEvents,
  upsertPlanHabits,
  upsertWeightLog,
  upsertSportSessions,
  upsertStrengthExercises,
  upsertStrengthLogs,
  upsertMentorChats,
  upsertMentorTurns,
  upsertMentorSettings,
  tombstoneNotes,
  tombstoneCheckins,
  tombstoneTasks,
  tombstoneEvents,
  tombstoneHabits,
  tombstoneWeightLog,
  tombstoneSportSessions,
  tombstoneStrengthExercises,
  tombstoneStrengthLogs,
  tombstoneMentorChats,
  getMentorChats,
  getPlanTasks,
  getPlanEvents,
  getPlanHabits,
  getPlanHabitDays,
  getDeletedPlanRows,
  getSportSessions,
  getDeletedSportSessions,
  getStrengthExercises,
  getStrengthLogs,
  getDeletedStrengthExercises,
  getDeletedStrengthLogs,
  getMentorSettings,
  getDeletedMentorChats,
} from "@/lib/dal";

export const dynamic = "force-dynamic";

/**
 * Sync, both directions, one endpoint per direction.
 *
 * One endpoint rather than one per store because the alternative is a request per
 * store on every sync, which on a phone is a request per store on every wake.
 *
 * The cursor is a timestamp and the rule is "everything strictly newer". That is
 * last-write-wins with a shared clock. It is enough for two personal devices and
 * it is not enough for concurrent edits to the same row — if a note is renamed on
 * the laptop while the phone renames it differently, one of those edits is lost
 * with no record that it happened. A vector clock or a CRDT would fix it and would
 * also mean shipping conflict-resolution UI. Worth it when there is a second
 * person, which there is not.
 *
 * The subtlety is that the timestamp has to be the *device's* clock, not the
 * server's. updated_at comes from the payload for exactly that reason: the server
 * does not know when the edit happened, only when it heard about it, and a laptop
 * with a wrong timezone would otherwise win every conflict against the phone that
 * actually did the typing.
 *
 * The consequence worth knowing: a device whose clock is far in the future pushes
 * changes the server will never offer back to it, and a clock behind can miss
 * them. Having the phone's date set automatically is enough to avoid it.
 */

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Stamp = z.union([z.string().min(1), z.number()]);

const Row = {
  clientId: z.string().min(1).max(200),
  updatedAt: Stamp,
};

const NoteRow = z.object({
  ...Row,
  day: Day,
  /* Optional name for the day's entry. */
  title: z.string().max(200).default(""),
  text: z.string().max(10_000),
  /* Capped at the store's own limits — 8 tags of 24 characters — so the server
     cannot be made to hold a longer list than any device would ever show. */
  tags: z.array(z.string().max(24)).max(8).default([]),
});
const CheckinRow = z.object({
  ...Row,
  day: Day,
  /* The check-in moved its writing to Notes, so this is empty from the app and
     only carries a value from an older client. Optional with a blank default
     rather than required, so a check-in is a set of scales and nothing else. */
  text: z.string().max(10_000).default(""),
  mood: z.number().int().min(1).max(5).nullish(),
  energy: z.number().int().min(1).max(5).nullish(),
  soreness: z.number().int().min(1).max(5).nullish(),
});
/* A task's day is nullable and only this one is: no due date is the "someday"
   bucket, a real state in the app. `day.nullable()` rather than Day.nullish(), so
   an absent day is rejected instead of being read as someday — a device that
   forgot the field would otherwise land a task in a bucket the user never put it
   in. */
const PlanTaskRow = z.object({
  ...Row,
  day: Day.nullable(),
  title: z.string().max(500),
  done: z.boolean(),
  note: z.string().max(500).default(""),
  category: z.string().max(60).default("other"),
  position: z.number().int().min(0).max(10_000),
});
/* The older day-keyed task shape, which is what /api/sync used to accept. Both are
   accepted because the plan tab now sends the nullable-day shape and nothing else
   in the app calls this endpoint, but rejecting the old one would turn a stale
   client mid-deploy into a 400 rather than a store that quietly stops syncing. */
const TaskRow = z.union([
  PlanTaskRow,
  z.object({
    ...Row,
    day: Day,
    title: z.string().max(500),
    done: z.boolean(),
    /* Same defaults as the other branch, so both arms of the union reach
       upsertPlanTasks with the same fields filled in and it never has to ask
       which shape it was given. */
    note: z.string().max(500).default(""),
    category: z.string().max(60).default("other"),
    position: z.number().int().min(0).max(10_000),
  }),
]);
/* start_min and duration_min are nullable because an all-day event has no start.
   Bounded at a day in both directions so an out-of-range value is a 400 rather
   than a row that renders off the end of the calendar forever. */
const EventRow = z.object({
  ...Row,
  day: Day,
  title: z.string().max(500),
  startMin: z.number().int().min(0).max(24 * 60 - 1).nullish(),
  durationMin: z.number().int().min(1).max(24 * 60).nullish(),
  note: z.string().max(500).default(""),
  category: z.string().max(60).default("other"),
  position: z.number().int().min(0).max(10_000),
});
/* The full day list travels with the habit, because the server stores a habit and
   its days as two tables and the habit's clock is the only one of the two — there
   is no per-day timestamp to resolve two devices by. Bounded well above the longest
   streak a person is likely to keep, because refusing a push because the habit is
   old would be worse than a larger body. */
const HabitRow = z.object({
  ...Row,
  name: z.string().max(200),
  days: z.array(Day).max(10_000).default([]),
  position: z.number().int().min(0).max(10_000),
});
const WeightRow = z.object({
  ...Row,
  day: Day,
  kg: z.number().min(0).max(1000),
  bodyFatPct: z.number().min(0).max(100).nullish(),
});
/* A sport session. `source` is accepted rather than hard-coded so a device row
   from a future client is not silently rewritten as manual — but the app's own
   driver only ever pushes manual ones. `minutes` is bounded at a day, matching
   the store's own validation. */
const SportRow = z.object({
  ...Row,
  day: Day,
  name: z.string().min(1).max(40),
  kind: z.enum(["practice", "game"]).default("practice"),
  minutes: z.number().int().min(1).max(24 * 60),
  intensity: z.number().int().min(1).max(5).nullish(),
  source: z.enum(["manual", "device"]).default("manual"),
  deviceId: z.string().max(200).nullish(),
  avgHr: z.number().int().min(0).max(300).nullish(),
  calories: z.number().int().min(0).max(100_000).nullish(),
});
/* A strength movement. weightLb is pounds, matching the store. */
const StrengthExerciseRow = z.object({
  ...Row,
  name: z.string().min(1).max(120),
  position: z.number().int().min(0).max(10_000).default(0),
  usualReps: z.number().int().min(0).max(1000).default(0),
  targetSets: z.number().int().min(0).max(100).default(0),
  weightLb: z.number().min(0).max(10_000).default(0),
});
const StrengthSetShape = z.object({
  reps: z.number().int().min(0).max(1000),
  weightLb: z.number().min(0).max(10_000).nullable(),
});
/* One movement's sets for one day. The whole array is the unit of change, so it
   travels together and the row carries a single clock. */
const StrengthLogRow = z.object({
  ...Row,
  day: Day,
  exerciseClientId: z.string().min(1).max(200),
  sets: z.array(StrengthSetShape).max(100),
});

const Ids = z.array(z.string().min(1).max(200)).max(500);

/* A turn id is the device's own string, and so is the chat id it belongs to.
   Both are bounded well above what uid() produces and well below what a uuid
   column would take, because they are stored as text rather than cast. */
const MentorChatRow = z.object({
  ...Row,
  title: z.string().max(500).nullish(),
});
const MentorTurnRow = z.object({
  ...Row,
  chatId: z.string().min(1).max(200),
  role: z.enum(["user", "mentor"]),
  /* The same ceiling the device enforces at MAX_CHARS, so the two cannot drift
     into the server holding a longer message than any device would show. */
  text: z.string().max(4000),
});

/* The switches, as one object rather than a list. Both booleans are required, so a
   payload that carried neither is rejected instead of being read as "off" — which
   would let a caller who sent nothing quietly turn sharing off, and turning sharing
   off is the one write here that looks like an absence of data. */
const MentorSettingsRow = z.object({
  shareNotes: z.boolean(),
  shareEvents: z.boolean(),
  updatedAt: Stamp,
});

const Body = z.object({
  notes: z.array(NoteRow).max(500).optional(),
  checkins: z.array(CheckinRow).max(500).optional(),
  tasks: z.array(TaskRow).max(500).optional(),
  events: z.array(EventRow).max(500).optional(),
  habits: z.array(HabitRow).max(200).optional(),
  weight: z.array(WeightRow).max(500).optional(),
  sports: z.array(SportRow).max(500).optional(),
  strengthExercises: z.array(StrengthExerciseRow).max(200).optional(),
  strengthLogs: z.array(StrengthLogRow).max(2000).optional(),
  /* Capped lower than the other stores. 25 chats by 80 turns is 2,000 rows, and a
     conversation is the largest thing in the app by a wide margin; the local cap
     bounds what a push can ever carry, so this is the number that keeps a push
     from being a 2,000-row body. */
  mentorChats: z.array(MentorChatRow).max(50).optional(),
  mentorTurns: z.array(MentorTurnRow).max(500).optional(),
  mentorSettings: MentorSettingsRow.optional(),
  deleted: z
    .object({
      notes: Ids.optional(),
      checkins: Ids.optional(),
      tasks: Ids.optional(),
      events: Ids.optional(),
      /* Habit ids, and a habit's days go with the habit — through the cascade, and
         explicitly in tombstoneHabits, because a tombstone is not a delete. Half a
         habit is not a state the schema can hold. */
      habits: Ids.optional(),
      weight: Ids.optional(),
      /* Manual sport sessions only. A device session is never pushed, so it never
         needs a tombstone here. */
      sports: Ids.optional(),
      strengthExercises: Ids.optional(),
      strengthLogs: Ids.optional(),
      /* Chat ids, not turn ids. Turns have no independent life — they go when
         their chat does, through the cascade — so tombstoning them separately
         would let a delete be half-applied. */
      mentorChats: Ids.optional(),
    })
    .optional(),
});

/** Rows per store on a pull. */
const LIMIT = 200;

/** Tombstones read per pull.
 *
 *  Deliberately larger than LIMIT and not shared with it: a device paging through a
 *  large history must not also be paging through its deletes, because the delete it
 *  misses is the one that comes back from the dead. The number is a ceiling on how
 *  far back a tombstone can be missed, not a page size — every pull reads the newest
 *  this many, and a delete older than that is a delete this design has given up on.
 *
 *  At one delete per chat and 25 chats kept locally, a user would have to delete some
 *  number of thousands of conversations, across devices, before this bit. It is here
 *  to make the bound explicit rather than to pretend the list is unbounded. */
const TOMBSTONE_LIMIT = 2_000;

async function userIdOr401(): Promise<string | Response> {
  try {
    return await requireUserId();
  } catch (e) {
    if (e instanceof Unauthenticated) {
      return Response.json({ error: "Not signed in." }, { status: 401 });
    }
    throw e;
  }
}

export async function POST(request: Request): Promise<Response> {
  const userId = await userIdOr401();
  if (userId instanceof Response) return userId;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid sync payload." }, { status: 400 });
  }

  const {
    notes,
    checkins,
    tasks,
    events,
    habits,
    weight,
    sports,
    strengthExercises,
    strengthLogs,
    mentorChats,
    mentorTurns,
    mentorSettings,
    deleted,
  } = parsed.data;

  /* Every table below carries user_id as a foreign key onto profiles.id, and the
     profile is created lazily by /api/me rather than at sign-in. A user's first
     write can therefore land on a user with no profile row and fail on the
     constraint. Guaranteed here instead, before any write, so the first push after
     a fresh sign-in works on any entry point into the app. Insert-or-nothing, so
     this costs one statement and is a no-op for anyone who already has a profile. */
  await ensureProfile(userId);

  /* Push first. Doing it the other way round would mean a pull in the same
     request could hand back the pre-push state of a row the client just sent. */
  if (notes?.length) await upsertNotes(userId, notes);
  if (checkins?.length) await upsertCheckins(userId, checkins);
  /* Tasks go through upsertPlanTasks whichever of the two shapes they arrived in.
     Both arms of the TaskRow union are accepted so a client mid-deploy is not turned
     into a 400 by this change, and both are written by one function so the nullable
     day and the note are handled in exactly one place — two writers for one table
     would drift apart on the first change to either. */
  if (tasks?.length) await upsertPlanTasks(userId, tasks);
  if (events?.length) await upsertPlanEvents(userId, events);
  if (habits?.length) await upsertPlanHabits(userId, habits);
  if (weight?.length) await upsertWeightLog(userId, weight);
  if (sports?.length) await upsertSportSessions(userId, sports);
  if (strengthExercises?.length) await upsertStrengthExercises(userId, strengthExercises);
  if (strengthLogs?.length) await upsertStrengthLogs(userId, strengthLogs);

  /* Chats before turns, always. A turn references its chat, so a batch that
     arrives the other way round fails on the foreign key and takes every turn in
     it down, not only the ones whose chat was missing. */
  if (mentorChats?.length) await upsertMentorChats(userId, mentorChats);
  if (mentorTurns?.length) await upsertMentorTurns(userId, mentorTurns);
  /* After the chats, and independently of them. The switches used to ride on the
     newest chat row, which meant they were only written when a conversation also
     changed — and a toggle changes no conversation, so it was never written at all.
     They also could not be turned off, because a value of false is not newer than
     anything. */
  if (mentorSettings) await upsertMentorSettings(userId, mentorSettings);

  /* Tombstones after the pushes, so a push and a delete of the same id in one
     request resolves to the delete. The other order would resurrect the row. */
  if (deleted?.notes?.length) await tombstoneNotes(userId, deleted.notes);
  if (deleted?.checkins?.length) await tombstoneCheckins(userId, deleted.checkins);
  if (deleted?.tasks?.length) await tombstoneTasks(userId, deleted.tasks);
  if (deleted?.events?.length) await tombstoneEvents(userId, deleted.events);
  if (deleted?.habits?.length) await tombstoneHabits(userId, deleted.habits);
  if (deleted?.weight?.length) await tombstoneWeightLog(userId, deleted.weight);
  if (deleted?.sports?.length) await tombstoneSportSessions(userId, deleted.sports);
  if (deleted?.strengthExercises?.length)
    await tombstoneStrengthExercises(userId, deleted.strengthExercises);
  if (deleted?.strengthLogs?.length) await tombstoneStrengthLogs(userId, deleted.strengthLogs);
  if (deleted?.mentorChats?.length) await tombstoneMentorChats(userId, deleted.mentorChats);

  /* ok:true is what tells the device its tombstones landed, and it is the only
     signal it clears them on. The endpoint having returned at all is not enough of a
     signal to build on: an acknowledgement read from the response body is something
     a future change to this handler can actually get wrong, and getting it wrong
     means either a delete that is re-pushed forever or one that is dropped before
     the other device hears about it. The counts are for the tests and for anyone
     debugging a device that is not syncing. */
  return Response.json({
    ok: true,
    pushed: {
      notes: notes?.length ?? 0,
      checkins: checkins?.length ?? 0,
      tasks: tasks?.length ?? 0,
      events: events?.length ?? 0,
      habits: habits?.length ?? 0,
      weight: weight?.length ?? 0,
      sports: sports?.length ?? 0,
      strengthExercises: strengthExercises?.length ?? 0,
      strengthLogs: strengthLogs?.length ?? 0,
      mentorChats: mentorChats?.length ?? 0,
      mentorTurns: mentorTurns?.length ?? 0,
    },
  });
}

const Query = z.object({
  since: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/**
 * Everything that changed since a cursor, tombstones included.
 *
 * GET rather than POST, because pulling has no side effects and can be retried
 * freely.
 */
export async function GET(request: Request): Promise<Response> {
  const userId = await userIdOr401();
  if (userId instanceof Response) return userId;

  const url = new URL(request.url);
  const parsed = Query.safeParse({
    since: url.searchParams.get("since") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: "Invalid cursor." }, { status: 400 });
  }

  /* Omitting the cursor reads everything, which is what the first sync after
     sign-in does. There is no enforced window on it: refusing to read someone's
     own history back to them would be a worse failure than a large response. */
  const raw = parsed.data.since;
  const at = raw ? new Date(raw) : null;
  const since = at && !Number.isNaN(at.getTime()) ? at : null;
  const limit = parsed.data.limit ?? LIMIT;

  /* "Since" goes in the WHERE clause rather than being applied by slicing in JS.
     Slicing would mean reading every row the user has ever written on every pull,
     which grows without bound — the whole purpose of the cursor is that it does
     not. The user_id half is not optional: the cursor is the only thing scoping a
     pull, and without it this would return other accounts' rows to anyone with a
     timestamp. */
  const rows = await Promise.all([
    db
      .select()
      .from(schema.notes)
      .where(
        since
          ? and(eq(schema.notes.userId, userId), gt(schema.notes.updatedAt, since))
          : eq(schema.notes.userId, userId),
      )
      .orderBy(desc(schema.notes.updatedAt))
      .limit(limit),
    db
      .select()
      .from(schema.checkins)
      .where(
        since
          ? and(eq(schema.checkins.userId, userId), gt(schema.checkins.updatedAt, since))
          : eq(schema.checkins.userId, userId),
      )
      .orderBy(desc(schema.checkins.updatedAt))
      .limit(limit),
    db
      .select()
      .from(schema.weightLog)
      .where(
        since
          ? and(eq(schema.weightLog.userId, userId), gt(schema.weightLog.updatedAt, since))
          : eq(schema.weightLog.userId, userId),
      )
      .orderBy(desc(schema.weightLog.updatedAt))
      .limit(limit),
    /* Sports are read whole rather than cursor-filtered. A personal log is small,
       and a session is a few hundred bytes, so re-sending the live set on each
       pull costs less than the bookkeeping to page it — the merge ignores anything
       not newer, so a repeat is a no-op on the device. */
    getSportSessions(userId),
    /* Strength read whole too: a movement list is a handful of rows, and the log
       is one row per movement per training day. */
    getStrengthExercises(userId),
    getStrengthLogs(userId),
    getMentorChats(userId, limit, since),
    /* The plan tab's three stores, cursor-filtered like everything else. Ordered by
       day then position rather than by recency, unlike the stores above: the plan is
       read as a calendar and a list, and the order the user arranged things in is part
       of what they are looking at. */
    getPlanTasks(userId, since?.toISOString()),
    getPlanEvents(userId, since?.toISOString()),
    getPlanHabits(userId, since?.toISOString()),
    /* Habit days are not cursor-filtered. A day row carries the habit's clock, not its
       own, so "changed since" is a question about the parent — and the parent rows are
       already filtered above. Filtering the days by their own updated_at would drop a
       day whose parent was renamed on another device, since the day row was rewritten
       with the habit's new stamp only if the habit actually won. Read every live day
       instead: a grid is small, and it is the only way the answer can be right. */
    getPlanHabitDays(userId),
    /* Plan tombstones are read in full on every pull, past the cursor and past the
       caller's page size, for the same reason the chat tombstones are: a delete older
       than this device's cursor is a delete this device would otherwise miss, and a
       missed delete is a row that comes back from the dead. The plan stores are
       deliberately read here rather than relying on the plan reads above, because
       those filter out deleted rows — the tombstones are precisely the rows they
       exclude. Same ceiling as the chats, and the same honesty about it: this is how
       many deletes can be missed at once, not a page size. */
    getDeletedPlanRows(userId, TOMBSTONE_LIMIT),
    getDeletedSportSessions(userId, TOMBSTONE_LIMIT),
    getDeletedStrengthExercises(userId, TOMBSTONE_LIMIT),
    getDeletedStrengthLogs(userId, TOMBSTONE_LIMIT),
    /* Deliberately not cursor-filtered, and deliberately not on the caller's page
       size. A pull with a cursor returns chats whose updated_at moved since; a chat
       whose *turns* grew is exactly a chat whose updated_at moved, so that part is
       covered. But the delete list is the one thing that must never be missed: a
       chat deleted on another device while this cursor sits past it is a chat that
       comes back from the dead. Every pull reads the whole tombstone list.

       Which means it needs a ceiling of its own. Sharing the caller's `limit` would
       cap tombstones at 200 while paging through 2,000 live rows, and a delete older
       than that window would be silently dropped — on a device that had already
       moved its cursor past it, so nothing would ever bring it back. The bound here
       is a promise about how many deletes can be missed at once rather than a page
       size, and it is read past, never skipped. See forgetMentorHistory for what
       happens when it is exceeded. */
    getDeletedMentorChats(userId, TOMBSTONE_LIMIT),
    /* The switches come back on every pull, not behind the cursor. A one-row table
       read on every sync is a rounding error against the conversation rows beside
       it, and gating it on the cursor would mean a device that missed the change
       never learned about it: the cursor would have moved past it on some earlier
       pull, and every later pull asks only for what is newer. The client does its
       own comparison against its own clock, so re-reading a value it already has is
       free of consequence. */
    getMentorSettings(userId),
  ]);
  const [
  notes,
  checkins,
  weight,
  sports,
  strengthExercises,
  strengthLogs,
  chats,
  planTasks,
  planEvents,
  planHabits,
  habitDays,
  planDeletes,
  deletedSports,
  deletedStrengthExercises,
  deletedStrengthLogs,
  deletedChats,
  settings,
] = rows;

  /* Tombstones are collected across the stores into one list. A client applying
     deletes needs to know an id is gone, not which table it was in — client ids
     are unique per user across the whole pull.
   *
   * Namespaced per store. This used to fold notes, check-ins and weight under one
   * `row:` prefix, which was safe only while none of them synced. Every one of the
   * three now keys a row by its day, so `row:2026-09-01` would be a note on one
   * device and a check-in on another, and deleting either would take both. The
   * prefix restores which store the delete belongs to. Chat and plan rows carry
   * their own prefixes for the same reason. */
  const deleted = [
    ...notes.filter((r) => r.deletedAt !== null).map((r) => `note:${r.clientId}`),
    ...checkins.filter((r) => r.deletedAt !== null).map((r) => `checkin:${r.clientId}`),
    ...weight.filter((r) => r.deletedAt !== null).map((r) => `weight:${r.clientId}`),
    ...deletedSports.map((r) => `sport:${r.clientId}`),
    ...deletedStrengthExercises.map((r) => `strengthExercise:${r.clientId}`),
    ...deletedStrengthLogs.map((r) => `strengthLog:${r.clientId}`),
    ...deletedChats.map((c) => `chat:${c.clientId}`),
    /* Plan rows are namespaced like the chats, and for the same reason plus one
       more: an event id, a task id and a habit id are all bare strings the device
       minted, so three different stores can hold the same eight characters. A delete
       list that passed them through unqualified would have the client drop a task
       because an event with the same id was deleted. Prefixed by store and split
       again on the client. */
    ...planDeletes
      .filter((d) => d.kind === "task")
      .map((d) => `task:${d.clientId}`),
    ...planDeletes
      .filter((d) => d.kind === "event")
      .map((d) => `event:${d.clientId}`),
    ...planDeletes
      .filter((d) => d.kind === "habit")
      .map((d) => `habit:${d.clientId}`),
  ];

  const live = <T extends { deletedAt: Date | null }>(rows: T[]) =>
    rows.filter((r) => r.deletedAt === null);

  /* The cursor is the newest updated_at seen, tombstoned or not. A deleted row
     still moved the cursor forward, which is what stops the same delete being
     offered again on every pull.

     Left out of the response entirely when nothing came back, rather than filled in
     with the current time. A pull that read nothing has not observed the present, it
     has observed that nothing is newer than the cursor the device already holds —
     and writing "now" into the cursor would skip anything pushed in the gap between
     the query and this line, with nothing left to bring it back. The device keeps
     the cursor it had, and the next pull asks the same question.

     The switches are deliberately not in this list. They are read on every pull
     regardless of the cursor (see above), and folding a row nobody filters on into
     the cursor would mean a settings write moved every device's cursor forward on a
     pull that was meant to be reading about notes. */
  const newest = [
  notes,
  checkins,
  weight,
  sports,
  strengthExercises,
  strengthLogs,
  ...chats,
  ...planTasks,
  ...planEvents,
  ...planHabits,
]
    .flat()
    .map((r) => r.updatedAt)
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  /* Chat rows only. Turns are not a paged set in their own right — they arrive whole
     with their chat — so counting them here would compare a conversation's length
     against a page size, and hasMore would be true on every pull forever. */
  const counts = [
  notes,
  checkins,
  weight,
  sports,
  strengthExercises,
  strengthLogs,
  chats,
  planTasks,
  planEvents,
  planHabits,
].map((r) => r.length);

  /* Habit days folded onto their habits, so the device receives a habit and the grid
     that belongs to it as one value rather than as a second list it has to join. The
     client id is carried rather than the uuid, so a device that has never seen a uuid
     can still use the answer. Days for a habit that is not in this page are dropped:
     the habit row and its days are written in one transaction, so a habit missing from
     the page has no days to lose. */
  const daysByHabit = new Map<string, string[]>();
  for (const d of habitDays) {
    const list = daysByHabit.get(d.habitClientId);
    if (list) list.push(d.day);
    else daysByHabit.set(d.habitClientId, [d.day]);
  }

  const habitsOut = planHabits.map((h) => ({
    clientId: h.clientId,
    name: h.name,
    days: daysByHabit.get(h.clientId) ?? [],
    updatedAt: h.updatedAt,
    position: h.position,
  }));

  /* Flatten chats into the shape the device expects: id is the chat's client id and
     turns carry the device's client ids. */
  const mentorChatsOut = chats.map((c) => ({
    clientId: c.clientId,
    title: c.title,
    updatedAt: c.updatedAt,
    turns: c.turns.map((t) => ({
      clientId: t.clientId,
      chatId: c.clientId,
      role: t.role as "user" | "mentor",
      text: t.text,
      updatedAt: t.updatedAt,
    })),
  }));

  return Response.json({
    /* Absent rather than "now" when the pull read nothing — see newest above. The
       device only writes the cursor when it is handed one, so omitting it is what
       keeps a lagging device's cursor honest. */
    ...(newest ? { cursor: newest.toISOString() } : {}),
    notes: live(notes),
    checkins: live(checkins),
    /* The plan tab's rows, in the shape the plan tab pushes them.
     *
       Named planTasks rather than tasks on purpose. The old response field was
       `tasks`, read from the same table with a cursor and a `limit` — so a client
       that took it would be taking rows that the plan store has no idea how to key
       (they carry no note, no category and a non-null day). Renaming rather than
       replacing, because a name the old client understands and this one does not is
       a null read, and a null read is a tab that quietly stops syncing. */
    events: live(planEvents).map((e) => ({
      clientId: e.clientId,
      day: e.day,
      title: e.title,
      startMin: e.startMin,
      durationMin: e.durationMin,
      position: e.position,
      note: e.note,
      category: e.category,
      updatedAt: e.updatedAt,
    })),
    planTasks: live(planTasks).map((t) => ({
      clientId: t.clientId,
      day: t.day,
      title: t.title,
      done: t.done,
      position: t.position,
      note: t.note,
      category: t.category,
      updatedAt: t.updatedAt,
    })),
    habits: habitsOut,
    weight: live(weight),
    sports: live(sports).map((s) => ({
      clientId: s.clientId,
      day: s.day,
      name: s.name,
      kind: s.kind as "practice" | "game",
      minutes: s.minutes,
      intensity: s.intensity,
      source: s.source as "manual" | "device",
      deviceId: s.deviceId,
      avgHr: s.avgHr,
      calories: s.calories,
      updatedAt: s.updatedAt,
    })),
    strengthExercises: live(strengthExercises).map((e) => ({
      clientId: e.clientId,
      name: e.name,
      position: e.position,
      usualReps: e.usualReps,
      targetSets: e.targetSets,
      weightLb: e.weightLb,
      updatedAt: e.updatedAt,
    })),
    strengthLogs: live(strengthLogs).map((l) => ({
      clientId: l.clientId,
      day: l.day,
      exerciseClientId: l.exerciseClientId,
      sets: l.sets,
      updatedAt: l.updatedAt,
    })),
    mentorChats: mentorChatsOut,
    /* Null rather than a row of false booleans when nothing has ever been written.
       The client reads null as "you decide" and keeps its own defaults, which is
       the only correct answer for a user who has never opened the settings —
       sending a row of false would be indistinguishable from a deliberate "off",
       and a device that had turned sharing on would be told, by a server that had
       simply never been told either, that the user had turned it off. */
    mentorSettings: settings
      ? {
          shareNotes: settings.shareNotes,
          shareEvents: settings.shareEvents,
          updatedAt: settings.updatedAt,
        }
      : null,
    deleted: [...new Set(deleted)],
    /* True when any store came back full, meaning there may be more on the next
       page. Worth stating honestly rather than as a per-store total: a client
       that pages until it is false converges, and one that assumes false on the
       first page silently truncates. */
    hasMore: counts.some((n) => n >= limit),
  });
}