import { cache } from "react";
import { eq, and, isNull, isNotNull, gt, inArray, desc, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getUserId } from "@/lib/supabase/server";

/**
 * The only place that reads or writes user data in Postgres.
 *
 * The one rule this file exists to enforce: every query is scoped to a user id
 * that came from a verified session, and that id is never accepted as an argument
 * from outside. Callers ask for "my notes", not "the notes of user X". There is
 * deliberately no function here that takes a userId parameter, because the day
 * one appears it will be called with something from a request body.
 *
 * This is not defence-in-depth behind RLS. The app connects as `postgres`, which
 * bypasses row-level security entirely, so these where-clauses are the only thing
 * between one account's rows and another's. RLS is still enabled on the tables,
 * for the case where a query eventually runs as a non-privileged role, but it is
 * not what is protecting anything today.
 *
 * The session lookup is wrapped in React's cache() so a page that asks for notes,
 * tasks and habits resolves the session once rather than three times. Per request
 * only — it is not a cross-request cache, and must not become one.
 */

/** Thrown when there is no session. Callers that expect it translate it. */
export class Unauthenticated extends Error {
  constructor() {
    super("Not signed in.");
    this.name = "Unauthenticated";
  }
}

/**
 * The signed-in user's id, or Unauthenticated.
 *
 * React cache() on top of getUserId, so one render asks Supabase once. getClaims
 * verifies the JWT signature, so this is an id the server checked rather than one
 * a cookie claimed.
 */
export const requireUserId = cache(async (): Promise<string> => {
  const id = await getUserId();
  if (!id) throw new Unauthenticated();
  return id;
});

/**
 * Ensures a profiles row exists and returns it.
 *
 * Insert-or-return rather than insert-then-select, because two requests racing on
 * a first sign-in would otherwise both miss and one would fail on the primary key.
 * onConflictDoNothing followed by a read gets the same row either way.
 *
 * displayName and timezone are not touched once the row exists. Google sends
 * them on first sign-in and it should be the last word; a later sync must not be
 * able to rewrite them.
 */
export async function ensureProfile(userId: string) {
  await db
    .insert(schema.profiles)
    .values({ id: userId })
    .onConflictDoNothing();

  const [row] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.id, userId))
    .limit(1);

  return row ?? null;
}

/** The profile row, or null when one has not been created yet.
 *
 *  A read rather than ensureProfile, for the callers on a render path. ensureProfile
 *  is insert-or-nothing, so calling it here would mean every Vitality page load
 *  spent a statement proving the row exists. The one field the real provider needs
 *  from it is the timezone, and a missing profile should read as "UTC" rather than
 *  fail the page. */
export async function getProfile(userId: string) {
  const [row] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.id, userId))
    .limit(1);
  return row ?? null;
}

/* Reads. Each one filters on user_id and, unless told otherwise, on
   deleted_at being null — a tombstoned row is still in the table, and serving it
   is the same as never having received the delete. */

export async function getNotes(userId: string, fromDay?: string) {
  const live = isNull(schema.notes.deletedAt);
  return fromDay
    ? db
        .select()
        .from(schema.notes)
        .where(and(eq(schema.notes.userId, userId), live, gt(schema.notes.day, fromDay)))
        .orderBy(schema.notes.day)
    : db
        .select()
        .from(schema.notes)
        .where(and(eq(schema.notes.userId, userId), live))
        .orderBy(schema.notes.day);
}

export async function getCheckins(userId: string, fromDay?: string) {
  const live = isNull(schema.checkins.deletedAt);
  return fromDay
    ? db
        .select()
        .from(schema.checkins)
        .where(and(eq(schema.checkins.userId, userId), live, gt(schema.checkins.day, fromDay)))
        .orderBy(schema.checkins.day)
    : db
        .select()
        .from(schema.checkins)
        .where(and(eq(schema.checkins.userId, userId), live))
        .orderBy(schema.checkins.day);
}

export async function getHabits(userId: string) {
  return db
    .select()
    .from(schema.habits)
    .where(and(eq(schema.habits.userId, userId), isNull(schema.habits.deletedAt)))
    .orderBy(schema.habits.position);
}

export async function getHabitDays(userId: string, fromDay?: string) {
  const live = isNull(schema.habitDays.deletedAt);
  return fromDay
    ? db
        .select()
        .from(schema.habitDays)
        .where(and(eq(schema.habitDays.userId, userId), live, gt(schema.habitDays.day, fromDay)))
    : db
        .select()
        .from(schema.habitDays)
        .where(and(eq(schema.habitDays.userId, userId), live));
}

export async function getWeightLog(userId: string, fromDay?: string) {
  const live = isNull(schema.weightLog.deletedAt);
  return fromDay
    ? db
        .select()
        .from(schema.weightLog)
        .where(and(eq(schema.weightLog.userId, userId), live, gt(schema.weightLog.day, fromDay)))
        .orderBy(schema.weightLog.day)
    : db
        .select()
        .from(schema.weightLog)
        .where(and(eq(schema.weightLog.userId, userId), live))
        .orderBy(schema.weightLog.day);
}

export async function getTasks(userId: string, fromDay?: string) {
  const live = isNull(schema.tasks.deletedAt);
  return fromDay
    ? db
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.userId, userId), live, gt(schema.tasks.day, fromDay)))
        .orderBy(schema.tasks.day, schema.tasks.position)
    : db
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.userId, userId), live))
        .orderBy(schema.tasks.day, schema.tasks.position);
}

export async function getEvents(userId: string, fromDay?: string) {
  const live = isNull(schema.events.deletedAt);
  return fromDay
    ? db
        .select()
        .from(schema.events)
        .where(and(eq(schema.events.userId, userId), live, gt(schema.events.day, fromDay)))
    : db
        .select()
        .from(schema.events)
        .where(and(eq(schema.events.userId, userId), live));
}

export async function getSportSessions(userId: string, fromDay?: string) {
  const live = isNull(schema.sportSessions.deletedAt);
  return fromDay
    ? db
        .select()
        .from(schema.sportSessions)
        .where(
          and(
            eq(schema.sportSessions.userId, userId),
            live,
            gt(schema.sportSessions.day, fromDay),
          ),
        )
        .orderBy(schema.sportSessions.day)
    : db
        .select()
        .from(schema.sportSessions)
        .where(and(eq(schema.sportSessions.userId, userId), live))
        .orderBy(schema.sportSessions.day);
}

/** Live strength movements, in the order the user arranged them. Read whole,
 *  not cursor-filtered: a movement list is a handful of rows and re-sending it is
 *  cheaper than paging it. */
export async function getStrengthExercises(userId: string) {
  return db
    .select()
    .from(schema.strengthExercises)
    .where(and(eq(schema.strengthExercises.userId, userId), isNull(schema.strengthExercises.deletedAt)))
    .orderBy(schema.strengthExercises.position);
}

/** Live day/movement set rows, read whole. */
export async function getStrengthLogs(userId: string) {
  return db
    .select()
    .from(schema.strengthLogs)
    .where(and(eq(schema.strengthLogs.userId, userId), isNull(schema.strengthLogs.deletedAt)));
}

/** Tombstoned movements, for the delete list. */
export async function getDeletedStrengthExercises(userId: string, limit: number) {
  return db
    .select({ clientId: schema.strengthExercises.clientId, updatedAt: schema.strengthExercises.updatedAt })
    .from(schema.strengthExercises)
    .where(and(eq(schema.strengthExercises.userId, userId), isNotNull(schema.strengthExercises.deletedAt)))
    .orderBy(desc(schema.strengthExercises.updatedAt))
    .limit(limit);
}

/** Tombstoned day/movement set rows, for the delete list. */
export async function getDeletedStrengthLogs(userId: string, limit: number) {
  return db
    .select({ clientId: schema.strengthLogs.clientId, updatedAt: schema.strengthLogs.updatedAt })
    .from(schema.strengthLogs)
    .where(and(eq(schema.strengthLogs.userId, userId), isNotNull(schema.strengthLogs.deletedAt)))
    .orderBy(desc(schema.strengthLogs.updatedAt))
    .limit(limit);
}

/** Tombstoned sport sessions, for the pull's delete list. Newest first, bounded
 *  like the other tombstone reads: it is a ceiling on how many deletes a device
 *  can miss at once, not a page size. */
export async function getDeletedSportSessions(userId: string, limit: number) {
  return db
    .select({ clientId: schema.sportSessions.clientId, updatedAt: schema.sportSessions.updatedAt })
    .from(schema.sportSessions)
    .where(and(eq(schema.sportSessions.userId, userId), isNotNull(schema.sportSessions.deletedAt)))
    .orderBy(desc(schema.sportSessions.updatedAt))
    .limit(limit);
}

/** Health data for a window. The read side of the Health Connect pair. */
export async function getHealthDaily(userId: string, fromDay: string, toDay: string) {
  return db
    .select()
    .from(schema.healthDaily)
    .where(
      and(
        eq(schema.healthDaily.userId, userId),
        gt(schema.healthDaily.day, fromDay),
        sql`${schema.healthDaily.day} <= ${toDay}`,
      ),
    )
    .orderBy(schema.healthDaily.day);
}

export async function getHealthSessions(userId: string, fromDay: string, toDay: string) {
  return db
    .select()
    .from(schema.healthSessions)
    .where(
      and(
        eq(schema.healthSessions.userId, userId),
        gt(schema.healthSessions.day, fromDay),
        sql`${schema.healthSessions.day} <= ${toDay}`,
      ),
    )
    .orderBy(schema.healthSessions.startedAtUtc);
}

/** Whether any real health data has landed yet. Drives the mock-to-real swap. */
export async function hasHealthData(userId: string): Promise<boolean> {
  const rows = await db
    .select({ one: sql`1` })
    .from(schema.healthDaily)
    .where(eq(schema.healthDaily.userId, userId))
    .limit(1);
  return rows.length > 0;
}

/* Health Connect landings.
 *
 * The conflict target is (user_id, source_record_id) rather than a client_id,
 * because there is no client-generated identity here at all. The id belongs to
 * whichever app wrote the record into Health Connect — Samsung Health, the watch —
 * and it is stable across re-reads, which is the property an idempotent upsert
 * needs. A generated uuid here would insert a second row on every phone sync and
 * the daily totals would double.
 *
 * The same strictly-newer guard as the synced tables, for the same reason: a retry
 * that arrives after a fresher read must not overwrite it with what it read
 * earlier. No deletedAt, because these tables are never deleted — a measurement
 * that Health Connect stops offering was revoked upstream, not removed here, and
 * the caller resolves that by re-reading rather than by a tombstone.
 */

type PushedHealthDaily = Omit<
  typeof schema.healthDaily.$inferInsert,
  "userId" | "id" | "updatedAt"
> & { updatedAt: string | number | Date };

type PushedHealthSession = Omit<
  typeof schema.healthSessions.$inferInsert,
  "userId" | "id" | "updatedAt"
> & { updatedAt: string | number | Date };

/** A null stays null rather than becoming 0, so a metric the watch does not
 *  measure cannot read as a measurement of zero. */
function optional(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** As optional, rounded — for the minute and count columns that are integers. */
function optionalInt(value: number | null | undefined) {
  const n = optional(value);
  return n === null ? null : Math.round(n);
}

export async function upsertHealthDaily(userId: string, pushed: PushedHealthDaily[]) {
  if (pushed.length === 0) return;
  const rows = pushed.map((r) => ({
    sourceRecordId: r.sourceRecordId,
    day: asDay(r.day, r.sourceRecordId),
    dataOrigin: r.dataOrigin,
    steps: optionalInt(r.steps),
    activeMin: optionalInt(r.activeMin),
    restingHr: optionalInt(r.restingHr),
    hrvRmssd: optional(r.hrvRmssd),
    spo2: optional(r.spo2),
    respiratoryRate: optional(r.respiratoryRate),
    sleepTotalMin: optionalInt(r.sleepTotalMin),
    sleepDeepMin: optionalInt(r.sleepDeepMin),
    sleepRemMin: optionalInt(r.sleepRemMin),
    sleepLightMin: optionalInt(r.sleepLightMin),
    sleepStartUtc: r.sleepStartUtc ?? null,
    sleepEndUtc: r.sleepEndUtc ?? null,
    activeKcal: optional(r.activeKcal),
    updatedAt: asDate(r.updatedAt),
  }));
  await db
    .insert(schema.healthDaily)
    .values(rows.map((r) => ({ ...r, userId })))
    .onConflictDoUpdate({
      target: [schema.healthDaily.userId, schema.healthDaily.sourceRecordId],
      set: {
        day: sql`excluded.day`,
        dataOrigin: sql`excluded.data_origin`,
        steps: sql`excluded.steps`,
        activeMin: sql`excluded.active_min`,
        restingHr: sql`excluded.resting_hr`,
        hrvRmssd: sql`excluded.hrv_rmssd`,
        spo2: sql`excluded.spo2`,
        respiratoryRate: sql`excluded.respiratory_rate`,
        sleepTotalMin: sql`excluded.sleep_total_min`,
        sleepDeepMin: sql`excluded.sleep_deep_min`,
        sleepRemMin: sql`excluded.sleep_rem_min`,
        sleepLightMin: sql`excluded.sleep_light_min`,
        sleepStartUtc: sql`excluded.sleep_start_utc`,
        sleepEndUtc: sql`excluded.sleep_end_utc`,
        activeKcal: sql`excluded.active_kcal`,
        updatedAt: sql`excluded.updated_at`,
      },
      where: sql`excluded.updated_at > health_daily.updated_at`,
    });
}

export async function upsertHealthSessions(userId: string, pushed: PushedHealthSession[]) {
  if (pushed.length === 0) return;
  const rows = pushed.map((r) => ({
    sourceRecordId: r.sourceRecordId,
    day: asDay(r.day, r.sourceRecordId),
    dataOrigin: r.dataOrigin,
    activity: r.activity,
    startedAtUtc: asDate(r.startedAtUtc),
    durationMin: Math.round(r.durationMin),
    activeMin: optionalInt(r.activeMin),
    energyKcal: optional(r.energyKcal),
    distanceM: optional(r.distanceM),
    avgHr: optional(r.avgHr),
    maxHr: optional(r.maxHr),
    updatedAt: asDate(r.updatedAt),
  }));
  await db
    .insert(schema.healthSessions)
    .values(rows.map((r) => ({ ...r, userId })))
    .onConflictDoUpdate({
      target: [schema.healthSessions.userId, schema.healthSessions.sourceRecordId],
      set: {
        day: sql`excluded.day`,
        dataOrigin: sql`excluded.data_origin`,
        activity: sql`excluded.activity`,
        startedAtUtc: sql`excluded.started_at_utc`,
        durationMin: sql`excluded.duration_min`,
        activeMin: sql`excluded.active_min`,
        energyKcal: sql`excluded.energy_kcal`,
        distanceM: sql`excluded.distance_m`,
        avgHr: sql`excluded.avg_hr`,
        maxHr: sql`excluded.max_hr`,
        updatedAt: sql`excluded.updated_at`,
      },
      where: sql`excluded.updated_at > health_sessions.updated_at`,
    });
}

/** Every live chat with its turns, newest conversation first.
 *
 *  Two queries rather than one join because the turn count per chat is unbounded
 *  and a join would multiply the chat rows by it. The cap is per store and the
 *  route pages on it, so a long history arrives over several pulls rather than as
 *  one enormous response.
 */
export async function getMentorChats(userId: string, limit: number, since?: Date | null) {
  const chats = await db
    .select()
    .from(schema.mentorChats)
    .where(
      since
        ? and(
            eq(schema.mentorChats.userId, userId),
            isNull(schema.mentorChats.deletedAt),
            gt(schema.mentorChats.updatedAt, since),
          )
        : and(eq(schema.mentorChats.userId, userId), isNull(schema.mentorChats.deletedAt)),
    )
    .orderBy(desc(schema.mentorChats.updatedAt))
    .limit(limit);

  if (chats.length === 0) return [];

  const turns = await db
    .select()
    .from(schema.mentorTurns)
    .where(
      and(
        eq(schema.mentorTurns.userId, userId),
        inArray(schema.mentorTurns.chatId, chats.map((c) => c.id)),
        isNull(schema.mentorTurns.deletedAt),
      ),
    )
    .orderBy(schema.mentorTurns.createdAt, schema.mentorTurns.id);

  const byChat = new Map<string, typeof turns>();
  for (const t of turns) {
    const list = byChat.get(t.chatId);
    if (list) list.push(t);
    else byChat.set(t.chatId, [t]);
  }
  /* Every live turn for a live chat, so nothing is silently dropped when a chat
     was pruned on the other device. Ordering is by the turn's own timestamp, which
     is what the device recorded, and id breaks the tie for two turns written in the
     same millisecond — the order they were actually sent in is not recoverable
     here, and an arbitrary but stable one beats an unstable one.

     `since` filters on the chat row only, which is sufficient because a chat whose
     turns grew is a chat whose updated_at moved: the device pushes the chat row
     alongside its turns on every sync, with the newest turn's moment as the stamp.
     Filtering the turns themselves would be redundant work and would also make a
     chat re-send its whole history on every pull.

     The tie case worth naming: two chats sharing one timestamp, with the cursor
     landing exactly on it, would leave the ones after it on the next page
     unread. A timestamp cursor cannot tell them apart, and the alternative — a
     composite (timestamp, id) cursor — is not worth the complexity at 25 chats.
     Both chats would still arrive on the next full pull, which is what the device
     does when it signs in fresh. */
  return chats.map((c) => ({ ...c, turns: byChat.get(c.id) ?? [] }));
}

/**
 * The sharing switches, or null when this user has never set them.
 *
 * Null rather than a row of false booleans, because "never set" and "set, and off"
 * are the same answer today and not the same answer to a sync: a device that has
 * never chosen should take the server's word for it, and the server's word is a real
 * value only once something has been written. Returning the row whenever it exists
 * and null when it does not is what lets the client distinguish them without the
 * server having to invent a row for every user who has never opened the settings.
 */
export async function getMentorSettings(userId: string) {
  const [row] = await db
    .select()
    .from(schema.mentorSettings)
    .where(eq(schema.mentorSettings.userId, userId))
    .limit(1);
  return row ?? null;
}

/** Write the sharing switches, newest write winning.
 *
 *  The conflict target is the user id alone, so this is an upsert into the single row
 *  that can exist for them rather than an insert that would fail on the second
 *  device. The WHERE clause is the same last-write-wins as everywhere else, and the
 *  strictness matters here more than it does elsewhere: a switch being turned *off*
 *  is the only write in this table that looks like "no data" to a naive merge, and
 *  `>` rather than `>=` is what stops a device that has been off for a week from
 *  being flipped back on by its own stale push.
 */
export async function upsertMentorSettings(
  userId: string,
  pushed: { shareNotes?: boolean; shareEvents?: boolean; updatedAt: string | number | Date },
) {
  await db
    .insert(schema.mentorSettings)
    .values({
      userId,
      shareNotes: pushed.shareNotes === true,
      shareEvents: pushed.shareEvents === true,
      updatedAt: asDate(pushed.updatedAt),
    })
    .onConflictDoUpdate({
      target: schema.mentorSettings.userId,
      set: {
        shareNotes: sql`excluded.share_notes`,
        shareEvents: sql`excluded.share_events`,
        updatedAt: sql`excluded.updated_at`,
      },
      where: sql`excluded.updated_at > mentor_settings.updated_at`,
    });
}

/** Deleted chat ids, so the other device can be told to forget them.
 *
 *  A tombstone is what carries a delete to a second device; without it the phone
 *  that pressed delete would keep showing a conversation the laptop still has. */
export async function getDeletedMentorChats(userId: string, limit: number) {
  const rows = await db
    .select({ clientId: schema.mentorChats.clientId, updatedAt: schema.mentorChats.updatedAt })
    .from(schema.mentorChats)
    .where(and(eq(schema.mentorChats.userId, userId), isNotNull(schema.mentorChats.deletedAt)))
    .orderBy(desc(schema.mentorChats.updatedAt))
    .limit(limit);
  return rows;
}

/* Writes.
 *
 * Every upsert keys on (user_id, client_id) and carries the user id from the
 * session, never from the payload. A push that names a different user_id is not
 * rejected outright — it would leak the existence of another row through the
 * conflict behaviour — the user id is simply overwritten with the caller's, so
 * the row can only ever belong to whoever sent it.
 *
 * updated_at is taken from the client rather than from now(), and that is a real
 * decision rather than a shortcut: the whole conflict rule is "newer wins", and
 * the device that made the edit is the only one that knows when. A server clock
 * would make a laptop with a wrong timezone win over the phone that actually
 * typed it.
 */

/** A pushed row as it arrives from a device, before the session id is applied.
 *
 *  The generic is deliberately unconstrained. Constraining it to something with a
 *  required `updatedAt: Date` does not compile, because $inferInsert marks every
 *  column with a default as optional — including updated_at — so the type it
 *  produces cannot satisfy its own constraint. Spelled out per column instead.
 */
type Pushed<T> = Omit<T, "userId" | "updatedAt" | "id" | "deletedAt"> & {
  updatedAt: string | number | Date;
};

/** Invalid or missing dates must not become Invalid Date, which Postgres
 *  rejects in a way that surfaces as a 500 on an otherwise valid push. */
function asDate(value: string | number | Date | undefined | null): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const parsed = new Date(value ?? NaN);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** Exactly YYYY-MM-DD, or a throw.
 *
 *  This used to return 1970-01-01 for anything unparseable, which was wrong in a
 *  way that would have been very hard to notice: the row would sync successfully,
 *  appear in no 120-day window, and never be shown again. A bad day reaching here
 *  means the route's validation missed something, and a 500 naming the bad value is
 *  the only response that surfaces that. Coercing it to "now" would have been
 *  nearly as bad — a note would quietly jump to the wrong date. */
function asDay(value: unknown, clientId: string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  throw new Error(`Bad day for ${clientId}: ${JSON.stringify(value)}`);
}

/*
 * The conflict clause is spelled out per table rather than factored into a shared
 * constant. `excluded` and the target table have to be named literally in the SQL
 * for Postgres to resolve them, so a shared helper would have to take the table
 * name as a string and interpolate it — putting an identifier the compiler
 * cannot check into every write. Four copies of one comparison is the cheaper
 * trade.
 *
 * What the clause buys, since it is easy to read `where:` as noise:
 *
 * `excluded.updated_at` is what the device claims it did at; the column on the
 * right is what is already stored. Strictly-greater rather than
 * greater-or-equal, so a retried request that already succeeded does not churn.
 *
 * It is also the whole reason a delete survives. A tombstone is a row with
 * deleted_at set and updated_at bumped, so it competes on the same clock as any
 * other change. A device that still holds an item and re-pushes it with a stale
 * timestamp loses to the tombstone and cannot resurrect it; a real edit made after
 * the delete has a newer timestamp and revives the row. Reversed either way, the
 * user gets an item that "came back" or one that vanished for good.
 */

export async function upsertNotes(userId: string, pushed: Pushed<typeof schema.notes.$inferInsert>[]) {
  if (pushed.length === 0) return;
  const rows = pushed.map((r) => ({
    clientId: r.clientId,
    day: asDay(r.day, r.clientId),
    text: r.text,
    tags: Array.isArray(r.tags) ? r.tags : [],
    updatedAt: asDate(r.updatedAt),
  }));
  await db
    .insert(schema.notes)
    .values(rows.map((r) => ({ ...r, userId })))
    .onConflictDoUpdate({
      target: [schema.notes.userId, schema.notes.clientId],
      set: {
        text: sql`excluded.text`,
        day: sql`excluded.day`,
        tags: sql`excluded.tags`,
        updatedAt: sql`excluded.updated_at`,
        /* Reset, because a push that won the clock comparison is an edit, and an
           edit to a deleted row brings it back. The stale re-push never reaches
           here — NEWER rejected it, leaving the tombstone alone. */
        deletedAt: null,
      },
      where: sql`excluded.updated_at > notes.updated_at`,
    });
}

export async function upsertCheckins(
  userId: string,
  pushed: Pushed<typeof schema.checkins.$inferInsert>[],
) {
  if (pushed.length === 0) return;
  const rows = pushed.map((r) => ({
    clientId: r.clientId,
    day: asDay(r.day, r.clientId),
    text: r.text ?? "",
    mood: r.mood ?? null,
    energy: r.energy ?? null,
    soreness: r.soreness ?? null,
    updatedAt: asDate(r.updatedAt),
  }));
  await db
    .insert(schema.checkins)
    .values(rows.map((r) => ({ ...r, userId })))
    .onConflictDoUpdate({
      target: [schema.checkins.userId, schema.checkins.clientId],
      set: {
        text: sql`excluded.text`,
        day: sql`excluded.day`,
        mood: sql`excluded.mood`,
        energy: sql`excluded.energy`,
        soreness: sql`excluded.soreness`,
        updatedAt: sql`excluded.updated_at`,
        deletedAt: null,
      },
      where: sql`excluded.updated_at > checkins.updated_at`,
    });
}

export async function upsertWeightLog(
  userId: string,
  pushed: Pushed<typeof schema.weightLog.$inferInsert>[],
) {
  if (pushed.length === 0) return;
  const rows = pushed.map((r) => ({
    clientId: r.clientId,
    day: asDay(r.day, r.clientId),
    kg: r.kg,
    bodyFatPct: r.bodyFatPct ?? null,
    updatedAt: asDate(r.updatedAt),
  }));
  await db
    .insert(schema.weightLog)
    .values(rows.map((r) => ({ ...r, userId })))
    .onConflictDoUpdate({
      target: [schema.weightLog.userId, schema.weightLog.clientId],
      set: {
        day: sql`excluded.day`,
        kg: sql`excluded.kg`,
        bodyFatPct: sql`excluded.body_fat_pct`,
        updatedAt: sql`excluded.updated_at`,
        deletedAt: null,
      },
      where: sql`excluded.updated_at > weight_log.updated_at`,
    });
}

/** Sport sessions. Only manual rows ever reach here — the driver leaves device
 *  rows out, because their Health Connect ids are local to one phone. */
export async function upsertSportSessions(
  userId: string,
  pushed: Pushed<typeof schema.sportSessions.$inferInsert>[],
) {
  if (pushed.length === 0) return;
  const rows = pushed.map((r) => ({
    clientId: r.clientId,
    day: asDay(r.day, r.clientId),
    name: r.name,
    minutes: r.minutes,
    kind: r.kind ?? "practice",
    intensity: r.intensity ?? null,
    source: r.source ?? "manual",
    deviceId: r.deviceId ?? null,
    avgHr: r.avgHr ?? null,
    calories: r.calories ?? null,
    updatedAt: asDate(r.updatedAt),
  }));
  await db
    .insert(schema.sportSessions)
    .values(rows.map((r) => ({ ...r, userId })))
    .onConflictDoUpdate({
      target: [schema.sportSessions.userId, schema.sportSessions.clientId],
      set: {
        day: sql`excluded.day`,
        name: sql`excluded.name`,
        minutes: sql`excluded.minutes`,
        kind: sql`excluded.kind`,
        intensity: sql`excluded.intensity`,
        source: sql`excluded.source`,
        deviceId: sql`excluded.device_id`,
        avgHr: sql`excluded.avg_hr`,
        calories: sql`excluded.calories`,
        updatedAt: sql`excluded.updated_at`,
        deletedAt: null,
      },
      where: sql`excluded.updated_at > sport_sessions.updated_at`,
    });
}

export async function upsertStrengthExercises(
  userId: string,
  pushed: Pushed<typeof schema.strengthExercises.$inferInsert>[],
) {
  if (pushed.length === 0) return;
  const rows = pushed.map((r) => ({
    clientId: r.clientId,
    name: r.name,
    position: r.position ?? 0,
    usualReps: r.usualReps ?? 0,
    targetSets: r.targetSets ?? 0,
    weightLb: r.weightLb ?? 0,
    updatedAt: asDate(r.updatedAt),
  }));
  await db
    .insert(schema.strengthExercises)
    .values(rows.map((r) => ({ ...r, userId })))
    .onConflictDoUpdate({
      target: [schema.strengthExercises.userId, schema.strengthExercises.clientId],
      set: {
        name: sql`excluded.name`,
        position: sql`excluded.position`,
        usualReps: sql`excluded.usual_reps`,
        targetSets: sql`excluded.target_sets`,
        weightLb: sql`excluded.weight_lb`,
        updatedAt: sql`excluded.updated_at`,
        deletedAt: null,
      },
      where: sql`excluded.updated_at > strength_exercises.updated_at`,
    });
}

export async function upsertStrengthLogs(
  userId: string,
  pushed: Pushed<typeof schema.strengthLogs.$inferInsert>[],
) {
  if (pushed.length === 0) return;
  const rows = pushed.map((r) => ({
    clientId: r.clientId,
    day: asDay(r.day, r.clientId),
    exerciseClientId: r.exerciseClientId,
    sets: Array.isArray(r.sets) ? r.sets : [],
    updatedAt: asDate(r.updatedAt),
  }));
  await db
    .insert(schema.strengthLogs)
    .values(rows.map((r) => ({ ...r, userId })))
    .onConflictDoUpdate({
      target: [schema.strengthLogs.userId, schema.strengthLogs.clientId],
      set: {
        day: sql`excluded.day`,
        exerciseClientId: sql`excluded.exercise_client_id`,
        sets: sql`excluded.sets`,
        updatedAt: sql`excluded.updated_at`,
        deletedAt: null,
      },
      where: sql`excluded.updated_at > strength_logs.updated_at`,
    });
}

/* Tasks, calendar entries and habits — the plan tab.
 *
 * Replaces the older upsertTasks, which wrote the day-keyed task shape and is gone:
 * keeping two writers for one table would mean the nullable day and the note and
 * category were handled in two places, and they would drift apart on the first change
 * to either. The route accepts both wire shapes and calls the single writer below. */

/**
 * Tombstones rather than deletes, so the removal can be replicated.
 *
 * Separate functions per table rather than one taking a table argument. A
 * polymorphic version needs casts that erase exactly the column types this file
 * exists to get right, and four short functions are cheaper than that.
 */
export async function tombstoneNotes(userId: string, clientIds: string[]) {
  if (clientIds.length === 0) return;
  await db
    .update(schema.notes)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(schema.notes.userId, userId),
        inArray(schema.notes.clientId, clientIds),
        isNull(schema.notes.deletedAt),
      ),
    );
}

export async function tombstoneCheckins(userId: string, clientIds: string[]) {
  if (clientIds.length === 0) return;
  await db
    .update(schema.checkins)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(schema.checkins.userId, userId),
        inArray(schema.checkins.clientId, clientIds),
        isNull(schema.checkins.deletedAt),
      ),
    );
}

export async function tombstoneTasks(userId: string, clientIds: string[]) {
  if (clientIds.length === 0) return;
  await db
    .update(schema.tasks)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(schema.tasks.userId, userId),
        inArray(schema.tasks.clientId, clientIds),
        isNull(schema.tasks.deletedAt),
      ),
    );
}

export async function tombstoneWeightLog(userId: string, clientIds: string[]) {
  if (clientIds.length === 0) return;
  await db
    .update(schema.weightLog)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(schema.weightLog.userId, userId),
        inArray(schema.weightLog.clientId, clientIds),
        isNull(schema.weightLog.deletedAt),
      ),
    );
}

export async function tombstoneSportSessions(userId: string, clientIds: string[]) {
  if (clientIds.length === 0) return;
  await db
    .update(schema.sportSessions)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(schema.sportSessions.userId, userId),
        inArray(schema.sportSessions.clientId, clientIds),
        isNull(schema.sportSessions.deletedAt),
      ),
    );
}

export async function tombstoneStrengthExercises(userId: string, clientIds: string[]) {
  if (clientIds.length === 0) return;
  await db
    .update(schema.strengthExercises)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(schema.strengthExercises.userId, userId),
        inArray(schema.strengthExercises.clientId, clientIds),
        isNull(schema.strengthExercises.deletedAt),
      ),
    );
}

export async function tombstoneStrengthLogs(userId: string, clientIds: string[]) {
  if (clientIds.length === 0) return;
  await db
    .update(schema.strengthLogs)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(schema.strengthLogs.userId, userId),
        inArray(schema.strengthLogs.clientId, clientIds),
        isNull(schema.strengthLogs.deletedAt),
      ),
    );
}

/* The mentor.
 *
 * Chat and turn ids arrive as the device's own strings and are kept in client_id
 * rather than being cast to uuid, because a local record may already hold ids the
 * server minted and replacing them would orphan the turns that point at them.
 *
 * Two details are not like the other stores. First, the turn conflict target
 * includes chat_id, so a push for a chat the server has never seen cannot collide
 * with a same-numbered turn in a different conversation. Second, a chat is written
 * before its turns in every call path, because the turns reference it: a turn whose
 * chat has not landed yet fails on the foreign key, and the retry would carry the
 * chat along with it. */

type PushedChat = {
  clientId: string;
  title?: string | null;
  updatedAt: string | number | Date;
};

export async function upsertMentorChats(userId: string, pushed: PushedChat[]) {
  if (pushed.length === 0) return;
  await db
    .insert(schema.mentorChats)
    .values(
      pushed.map((c) => ({
        userId,
        clientId: c.clientId,
        /* null and "" are different states: null means the recents log falls back
           to the preview, and an empty title would render as a blank row. */
        title: c.title?.trim() ? c.title.trim() : null,
        updatedAt: asDate(c.updatedAt),
      })),
    )
    .onConflictDoUpdate({
      target: [schema.mentorChats.userId, schema.mentorChats.clientId],
      set: {
        title: sql`excluded.title`,
        updatedAt: sql`excluded.updated_at`,
        /* An edit to a deleted chat brings it back. The stale re-push never gets
           here, because NEWER rejected it and left the tombstone alone. */
        deletedAt: null,
      },
      where: sql`excluded.updated_at > mentor_chats.updated_at`,
    });
}

type PushedTurn = {
  clientId: string;
  chatId: string;
  role: string;
  text: string;
  updatedAt: string | number | Date;
};

export async function upsertMentorTurns(userId: string, pushed: PushedTurn[]) {
  if (pushed.length === 0) return;

  /* Resolving chat_client_id -> chat_id in one round trip rather than a lookup per
     turn. The upsert cannot do this itself: it would have to name the parent uuid,
     which the device has never seen. Rows whose chat is missing are skipped rather
     than inserted, because the foreign key would reject the whole batch and lose
     every turn in it rather than just the orphans. */
  const chatIds = [...new Set(pushed.map((t) => t.chatId))];
  const chats = await db
    .select({ id: schema.mentorChats.id, clientId: schema.mentorChats.clientId })
    .from(schema.mentorChats)
    .where(
      and(
        eq(schema.mentorChats.userId, userId),
        inArray(schema.mentorChats.clientId, chatIds),
        isNull(schema.mentorChats.deletedAt),
      ),
    );
  const byClientId = new Map(chats.map((c) => [c.clientId, c.id]));

  const rows = pushed.flatMap((t) => {
    const chatUuid = byClientId.get(t.chatId);
    if (!chatUuid) return [];
    const stamp = asDate(t.updatedAt);
    return [
      {
        userId,
        chatId: chatUuid,
        clientId: t.clientId,
        role: t.role,
        text: t.text,
        updatedAt: stamp,
        /* created_at is the device's own moment for the turn, not the moment the
           server happened to receive it.

           That matters because a sync pushes every turn of a chat in one
           statement, so a server-assigned now() would give a whole conversation
           the same timestamp and leave the read order to fall back on the uuid
           primary key — a random tie-break, which reorders the user's own
           conversation differently on each device. Taking the stamp the device
           recorded makes the order the one the user actually typed in.

           Set on insert only. An edit to a sent message is not meant to move the
           turn to the end of the chat, and the conflict clause below deliberately
           leaves created_at alone. */
        createdAt: stamp,
      },
    ];
  });
  if (rows.length === 0) return;

  await db
    .insert(schema.mentorTurns)
    .values(rows)
    .onConflictDoUpdate({
      target: [schema.mentorTurns.userId, schema.mentorTurns.chatId, schema.mentorTurns.clientId],
      set: { text: sql`excluded.text`, updatedAt: sql`excluded.updated_at`, deletedAt: null },
      where: sql`excluded.updated_at > mentor_turns.updated_at`,
    });
}

export async function tombstoneMentorChats(userId: string, clientIds: string[]) {
  if (clientIds.length === 0) return;
  await db
    .update(schema.mentorChats)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.mentorChats.userId, userId),
        inArray(schema.mentorChats.clientId, clientIds),
        isNull(schema.mentorChats.deletedAt),
      ),
    );
}

/* The plan tab: calendar entries, tasks and habits.
 *
 * Same three rules as every other synced store — rows are keyed by the device's
 * own client id, `updated_at` comes from the device that changed the row, and
 * deletes are tombstones so they can be replicated.
 *
 * Two things are specific to these tables.
 *
 * First, `day` is nullable on tasks and required on events. A task with no due
 * date is the "someday" bucket, a first-class state in the app rather than a
 * missing value. An event always happens on a day, so there is nothing to
 * express.
 *
 * Second, a habit's days are a second table. The habit row carries the habit,
 * and habit_days carries one row per day with its own client id formed from the
 * habit's client id and the day — so the pair is a fact with an identity, and a
 * winning habit replaces its days wholesale. The device never sees either uuid;
 * the parent is resolved from client_id below, the same way the mentor resolves
 * a turn's chat. */

/** The plan reads take the cursor as a Date, like the mentor's.
 *
 *  A string is accepted because the route hands one straight out of its parsed query,
 *  and re-parsing it here would mean the two layers could disagree about what an
 *  invalid cursor means: silently "no cursor", which reads everything. An
 *  unparseable value therefore reads everything, which is the same answer an absent
 *  cursor gives and the same thing a fresh device wants. */
function planCursor(since?: string): Date | undefined {
  if (!since) return undefined;
  const at = new Date(since);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

export async function getPlanEvents(userId: string, since?: string) {
  const live = isNull(schema.events.deletedAt);
  const from = planCursor(since);
  return from
    ? db
        .select()
        .from(schema.events)
        .where(and(eq(schema.events.userId, userId), live, gt(schema.events.updatedAt, from)))
        .orderBy(schema.events.day, schema.events.position, schema.events.clientId)
    : db
        .select()
        .from(schema.events)
        .where(and(eq(schema.events.userId, userId), live))
        .orderBy(schema.events.day, schema.events.position, schema.events.clientId);
}

export async function getPlanTasks(userId: string, since?: string) {
  const live = isNull(schema.tasks.deletedAt);
  const from = planCursor(since);
  return from
    ? db
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.userId, userId), live, gt(schema.tasks.updatedAt, from)))
        .orderBy(schema.tasks.day, schema.tasks.position, schema.tasks.clientId)
    : db
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.userId, userId), live))
        .orderBy(schema.tasks.day, schema.tasks.position, schema.tasks.clientId);
}

export async function getPlanHabits(userId: string, since?: string) {
  const live = isNull(schema.habits.deletedAt);
  const from = planCursor(since);
  return from
    ? db
        .select()
        .from(schema.habits)
        .where(and(eq(schema.habits.userId, userId), live, gt(schema.habits.updatedAt, from)))
        .orderBy(schema.habits.position, schema.habits.clientId)
    : db
        .select()
        .from(schema.habits)
        .where(and(eq(schema.habits.userId, userId), live))
        .orderBy(schema.habits.position, schema.habits.clientId);
}

/** Live days for the habits being pushed, keyed by the habit's client id.
 *
 *  Read after the habits are written, so a brand new habit's days resolve on its
 *  own first push. Only live habits come back: pushing days for a habit this
 *  device has just deleted would resurrect the habit's grid behind the
 *  tombstone. */
/** Tombstoned plan rows across all three tables, newest first.
 *
 *  Three tables rather than one, returned with the store named as `kind`, because a
 *  device id is only unique within its own store: an event and a task can both hold
 *  "a3f9", and a device that was told "a3f9 is deleted" without being told which one
 *  would drop the wrong row. Naming the kind here is what lets the route namespace the
 *  ids on the way out.
 *
 *  Not cursor-filtered, and the caller passes its own ceiling rather than sharing the
 *  page size. A pull asks only for rows newer than the cursor it holds, so a delete
 *  older than that cursor can never be returned by the ordinary reads — the rows are
 *  gone from them. Reading them separately is the only way a delete is not missed, and
 *  capping that read by the caller's page size would make the miss more likely the
 *  deeper the history runs. */
export async function getDeletedPlanRows(userId: string, limit: number) {
  const rows = await Promise.all([
    db
      .select({
        kind: sql`'task'`.as("kind"),
        clientId: schema.tasks.clientId,
        updatedAt: schema.tasks.updatedAt,
      })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.userId, userId), isNotNull(schema.tasks.deletedAt)))
      .orderBy(desc(schema.tasks.updatedAt))
      .limit(limit),
    db
      .select({
        kind: sql`'event'`.as("kind"),
        clientId: schema.events.clientId,
        updatedAt: schema.events.updatedAt,
      })
      .from(schema.events)
      .where(and(eq(schema.events.userId, userId), isNotNull(schema.events.deletedAt)))
      .orderBy(desc(schema.events.updatedAt))
      .limit(limit),
    db
      .select({
        kind: sql`'habit'`.as("kind"),
        clientId: schema.habits.clientId,
        updatedAt: schema.habits.updatedAt,
      })
      .from(schema.habits)
      .where(and(eq(schema.habits.userId, userId), isNotNull(schema.habits.deletedAt)))
      .orderBy(desc(schema.habits.updatedAt))
      .limit(limit),
  ]);
  return rows.flat();
}

/** Live habit days, keyed by the habit's client id rather than its uuid.
 *
 *  The join is what lets the route answer "which days does this habit have?" for a
 *  device that has never seen a uuid, and filtering habits.deleted_at is what stops
 *  a deleted habit's leftover days from being handed out as a grid for a habit that
 *  no longer exists. */
export async function getPlanHabitDays(
  userId: string,
): Promise<{ habitClientId: string; day: string }[]> {
  return db
    .select({ habitClientId: schema.habits.clientId, day: schema.habitDays.day })
    .from(schema.habitDays)
    .innerJoin(schema.habits, eq(schema.habitDays.habitId, schema.habits.id))
    .where(
      and(
        eq(schema.habitDays.userId, userId),
        isNull(schema.habitDays.deletedAt),
        eq(schema.habits.userId, userId),
        isNull(schema.habits.deletedAt),
      ),
    );
}

export async function habitUuidsByClientId(
  userId: string,
  clientIds: string[],
): Promise<Map<string, string>> {
  if (clientIds.length === 0) return new Map();
  const habits = await db
    .select({ id: schema.habits.id, clientId: schema.habits.clientId })
    .from(schema.habits)
    .where(
      and(
        eq(schema.habits.userId, userId),
        inArray(schema.habits.clientId, clientIds),
        isNull(schema.habits.deletedAt),
      ),
    );
  return new Map(habits.map((h) => [h.clientId, h.id]));
}

type PushedEvent = {
  clientId: string;
  day: unknown;
  title: string;
  /* Nullish rather than `number | null`, because the route validates these with
     .nullish() and zod then reports the key as absent when it was not sent at all —
     so a well-formed push that simply omits them arrives here without the property
     rather than with a null. */
  startMin?: number | null;
  durationMin?: number | null;
  position: number;
  note: string;
  category: string;
  updatedAt: string | number | Date;
};

export async function upsertPlanEvents(userId: string, pushed: PushedEvent[]) {
  if (pushed.length === 0) return;
  const rows = pushed.map((r) => ({
    clientId: r.clientId,
    day: asDay(r.day, r.clientId),
    title: r.title,
    startMin: r.startMin,
    durationMin: r.durationMin,
    position: r.position,
    note: r.note,
    category: r.category,
    updatedAt: asDate(r.updatedAt),
  }));
  await db
    .insert(schema.events)
    .values(rows.map((r) => ({ ...r, userId })))
    .onConflictDoUpdate({
      target: [schema.events.userId, schema.events.clientId],
      set: {
        day: sql`excluded.day`,
        title: sql`excluded.title`,
        startMin: sql`excluded.start_min`,
        durationMin: sql`excluded.duration_min`,
        position: sql`excluded.position`,
        note: sql`excluded.note`,
        category: sql`excluded.category`,
        updatedAt: sql`excluded.updated_at`,
        /* An edit to a deleted event brings it back. A stale re-push never gets
           here, because the conflict clause below rejected it and left the
           tombstone alone. */
        deletedAt: null,
      },
      where: sql`excluded.updated_at > events.updated_at`,
    });
}

/** A pushed task. `day` is nullable here and only here — see the note above. */
type PushedPlanTask = {
  clientId: string;
  day: unknown;
  title: string;
  done: boolean;
  position: number;
  note: string;
  category: string;
  updatedAt: string | number | Date;
};

export async function upsertPlanTasks(userId: string, pushed: PushedPlanTask[]) {
  if (pushed.length === 0) return;
  const rows = pushed.map((r) => ({
    clientId: r.clientId,
    /* The one nullable day in this file. Anything that is neither a valid day nor
       null is a bad push and must not be turned into some other date, so it goes
       through asDay and throws. */
    day: r.day === null ? null : asDay(r.day, r.clientId),
    title: r.title,
    done: r.done,
    position: r.position,
    note: r.note,
    category: r.category,
    updatedAt: asDate(r.updatedAt),
  }));
  await db
    .insert(schema.tasks)
    .values(rows.map((r) => ({ ...r, userId })))
    .onConflictDoUpdate({
      target: [schema.tasks.userId, schema.tasks.clientId],
      set: {
        day: sql`excluded.day`,
        title: sql`excluded.title`,
        done: sql`excluded.done`,
        position: sql`excluded.position`,
        note: sql`excluded.note`,
        category: sql`excluded.category`,
        updatedAt: sql`excluded.updated_at`,
        deletedAt: null,
      },
      where: sql`excluded.updated_at > tasks.updated_at`,
    });
}

type PushedHabit = {
  clientId: string;
  name: string;
  days: string[];
  position: number;
  updatedAt: string | number | Date;
};

/**
 * Habits, then their days.
 *
 * The days are replaced rather than merged, inside a transaction, because the
 * habit is the conflict unit: the local record of "done" is a list of days with
 * no stamps of its own, so there is no per-day clock to reconcile two devices
 * that toggled different days on. The winner's list is the truth, which means
 * the loser's toggle is lost rather than quietly resurrected by a merge.
 *
 * A habit whose push lost the clock comparison must not have its days touched:
 * upsertHabits returns which habits were actually written, and only those have
 * their day rows replaced. Otherwise a stale push could overwrite the winning
 * device's grid with older days while its own row stayed unchanged, and the next
 * pull would restore the grid — so the two devices would disagree until the next
 * sync, which is exactly the flapping this design is meant to avoid.
 */
export async function upsertPlanHabits(userId: string, pushed: PushedHabit[]) {
  if (pushed.length === 0) return new Set<string>();

  const rows = pushed.map((h) => ({
    clientId: h.clientId,
    name: h.name,
    position: h.position,
    updatedAt: asDate(h.updatedAt),
  }));

  /* Written one statement at a time so the winner of each row can be identified.
     `returning` gives exactly the rows the conflict clause let through, which is
     the set allowed to rewrite its days. */
  const written = new Set<string>();
  for (const row of rows) {
    const res = await db
      .insert(schema.habits)
      .values({ ...row, userId })
      .onConflictDoUpdate({
        target: [schema.habits.userId, schema.habits.clientId],
        set: {
          name: sql`excluded.name`,
          position: sql`excluded.position`,
          updatedAt: sql`excluded.updated_at`,
          deletedAt: null,
        },
        where: sql`excluded.updated_at > habits.updated_at`,
      })
      .returning({ clientId: schema.habits.clientId });
    for (const r of res) written.add(r.clientId);
  }

  if (written.size === 0) return written;

  const uuids = await habitUuidsByClientId(userId, [...written]);
  const wanted: { habitId: string; clientId: string; day: string; updatedAt: Date }[] = [];
  for (const h of pushed) {
    const uuid = uuids.get(h.clientId);
    if (!uuid) continue;
    const stamp = asDate(h.updatedAt);
    for (const day of h.days) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      wanted.push({ habitId: uuid, clientId: `${h.clientId}:${day}`, day, updatedAt: stamp });
    }
  }

  await db.transaction(async (tx) => {
    /* Only the habits this push actually won, and only their days. Scoped to the
       habit rather than to a habit id list so an unrelated habit keeps its grid
       even if two of them were pushed in the same batch. */
    for (const clientId of written) {
      const uuid = uuids.get(clientId);
      if (!uuid) continue;
      await tx
        .delete(schema.habitDays)
        .where(and(eq(schema.habitDays.userId, userId), eq(schema.habitDays.habitId, uuid)));
    }
    if (wanted.length === 0) return;
    await tx
      .insert(schema.habitDays)
      .values(wanted.map((w) => ({ userId, ...w })))
      /* habit_id, day is the real key of a day — one row per day per habit —
         and the insert can name it because the uuid came back from the query
         above rather than from the device. The conflict clause still holds the
         clock: a habit pushed twice in a row must not fail on the second
         insert, and only a newer push may replace a day. */
      .onConflictDoUpdate({
        target: [schema.habitDays.habitId, schema.habitDays.day],
        set: { updatedAt: sql`excluded.updated_at`, deletedAt: null },
        where: sql`excluded.updated_at > habit_days.updated_at`,
      });
  });

  return written;
}

export async function tombstoneEvents(userId: string, clientIds: string[]) {
  if (clientIds.length === 0) return;
  await db
    .update(schema.events)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.events.userId, userId),
        inArray(schema.events.clientId, clientIds),
        isNull(schema.events.deletedAt),
      ),
    );
}

export async function tombstoneHabits(userId: string, clientIds: string[]) {
  if (clientIds.length === 0) return;
  /* The days go with the habit. The foreign key already cascades for a real
     delete, but a tombstone is not a delete — the row stays — so the orphaned
     days are cleared explicitly, or a pull would read them back and hand the
     device a habit grid for a habit that no longer exists. */
  const habits = await habitUuidsByClientId(userId, clientIds);
  const uuids = [...habits.values()];
  if (uuids.length > 0) {
    await db
      .delete(schema.habitDays)
      .where(and(eq(schema.habitDays.userId, userId), inArray(schema.habitDays.habitId, uuids)));
  }
  await db
    .update(schema.habits)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.habits.userId, userId),
        inArray(schema.habits.clientId, clientIds),
        isNull(schema.habits.deletedAt),
      ),
    );
}

export { db, schema };