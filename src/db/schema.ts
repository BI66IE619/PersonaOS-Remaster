import {
  pgTable,
  text,
  uuid,
  date,
  integer,
  real,
  boolean,
  timestamp,
  primaryKey,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";

/**
 * The Postgres schema.
 *
 * Shape of it, and why:
 *
 * - Everything is keyed to auth.users via user_id. There is no "find the user"
 *   logic anywhere, because the id arrives from a verified session and never from
 *   a request parameter.
 * - Every mutable table has updated_at and deleted_at. Deletes are tombstones
 *   rather than row removals, because a delete that does not replicate leaves the
 *   other device showing an item the first device no longer has, and the only way
 *   to tell that apart from "not synced yet" is for the delete to be a thing that
 *   can be carried.
 * - client_id is the caller-supplied id, unique per user. That is what makes a
 *   sync idempotent: pushing the same row twice is an upsert on a key the server
 *   already has, not a duplicate.
 * - RLS is enabled on every table by a hand-written migration,
 *   drizzle/0001_row_level_security.sql, NOT by this file. It lives there because
 *   the interesting part is the table that gets no policy at all
 *   (finance_connections, which holds the bank credential), and a generated policy
 *   block per table would have buried that. The app connects with the postgres
 *   role, which bypasses RLS, so the scoping in lib/dal.ts is not optional
 *   defence-in-depth — it is the only thing between one account's rows and
 *   another's for the app's own queries. RLS is not protecting the app; it is
 *   protecting the database from anyone using the publishable key, which ships in
 *   the client bundle.
 */

const stamped = {
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

/**
 * For every table that mirrors something a device holds.
 *
 * client_id is required, not nullable, because a device row without one has no
 * identity to be idempotent against: pushing it twice would insert twice. Anything
 * arriving here without a client id is a bug upstream, and lib/dal.ts rejects it
 * rather than inventing one — a fabricated id would silently work once and then
 * split into two rows on the next push.
 */
const synced = {
  clientId: text("client_id").notNull(),
  ...stamped,
};

/** One row per signed-in person, created on first sign-in. */
export const profiles = pgTable(
  "profiles",
  {
    /* The auth.users id, verbatim. There is no separate surrogate key: the primary
       key and the identity are the same value, which is what lets every child table
       reference this instead of guessing at a lookup. */
    id: uuid("id").primaryKey(),
    email: text("email"),
    displayName: text("display_name"),
    timezone: text("timezone").notNull().default("UTC"),
    /** Whether the mentor may send anything at all. Off until asked. */
    mentorEnabled: boolean("mentor_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    ...stamped,
  },
  /* The id is already unique as the primary key. An index on (id, client_id) was
     here and served nothing — the two columns are never queried together, and
     uniqueIndex on the primary key itself is not expressible. */
  (t) => [index("profiles_updated_at_idx").on(t.updatedAt)],
);

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    /** Optional name for the day's entry. "" when the user has not named it. */
    title: text("title").notNull().default(""),
    text: text("text").notNull(),
    /** The device's tag list, in the order the user sees it. jsonb rather than a
     *  join table: a tag has no identity of its own, and the whole list is replaced
     *  whenever the note is edited. */
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    ...synced,
  },
  (t) => [
    /* The sync key. Without it there is nothing for an upsert to conflict on,
       and every push of the same row would insert a second copy. */
    uniqueIndex("notes_user_client_idx").on(t.userId, t.clientId),
    index("notes_user_day_idx").on(t.userId, t.day),
  ],
);

export const checkins = pgTable(
  "checkins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    /** Free text as typed. Kept for the older shape; the app no longer writes it,
     *  and mood/energy/soreness are the whole current record. */
    text: text("text").notNull(),
    /** Mood 1-5, if the user gave one. */
    mood: integer("mood"),
    energy: integer("energy"),
    /** Soreness 1-5, if rated. Nullable because "not rated" is a real answer and
     *  distinct from a 1. */
    soreness: integer("soreness"),
    ...synced,
  },
  (t) => [
    uniqueIndex("checkins_user_client_idx").on(t.userId, t.clientId),
    index("checkins_user_day_idx").on(t.userId, t.day),
  ],
);

export const habits = pgTable(
  "habits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Order in the list, since there is nothing else to sort by. */
    position: integer("position").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...synced,
  },
  (t) => [
    uniqueIndex("habits_user_client_idx").on(t.userId, t.clientId),
    index("habits_user_idx").on(t.userId),
  ],
);

/**
 * A habit on a day, rather than a completed boolean on the habit.
 *
 * The difference matters for sync. "Is this done?" is a bit, and a bit cannot be
 * told apart from "this was never synced"; a row that exists is a fact that can
 * be replicated, and a row's absence is meaningful in a way a false is not.
 */
export const habitDays = pgTable(
  "habit_days",
  {
    habitId: uuid("habit_id")
      .notNull()
      .references(() => habits.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    completed: boolean("completed").notNull().default(true),
    ...synced,
  },
  (t) => [
    primaryKey({ columns: [t.habitId, t.day] }),
    index("habit_days_user_day_idx").on(t.userId, t.day),
  ],
);

/**
 * Weigh-ins.
 *
 * Separate from the generated DayRecord.weightKg on purpose: that is 120 days of
 * seed data standing in for a health provider, and this is what the scale
 * actually said. Mixing them would mean the baselines are computed from fiction,
 * which is the one thing the verdict is not allowed to do.
 */
export const weightLog = pgTable(
  "weight_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    /** kg, to the precision a scale reports. */
    kg: real("kg").notNull(),
    bodyFatPct: real("body_fat_pct"),
    ...synced,
  },
  (t) => [
    uniqueIndex("weight_log_user_client_idx").on(t.userId, t.clientId),
    index("weight_log_user_day_idx").on(t.userId, t.day),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** The due date, or null for "someday" — a task with no day is still a task. */
    day: date("day"),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
    /** Where in the day's order. */
    position: integer("position").notNull().default(0),
    note: text("note").notNull().default(""),
    category: text("category").notNull().default("other"),
    ...synced,
  },
  (t) => [
    uniqueIndex("tasks_user_client_idx").on(t.userId, t.clientId),
    index("tasks_user_day_idx").on(t.userId, t.day),
  ],
);

/**
 * Calendar entries, distinct from tasks because they recur and carry a start
 * time, so "did I do the thing" and "when was it" are not the same question.
 *
 * The start is stored as minutes-from-midnight on the local day — the same clock
 * the user reads the calendar with — rather than as a UTC instant, which would
 * force a timezone conversion the device that wrote it already knows the answer to.
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    title: text("title").notNull(),
    /** Minutes from midnight on `day`, or null for all-day. */
    startMin: integer("start_min"),
    durationMin: integer("duration_min"),
    /** Where in the day's order. The calendar sorts by start time and leaves the
     *  all-day entries first, so the order inside a day is this — the array order
     *  a device has to be able to reproduce from a pull. */
    position: integer("position").notNull().default(0),
    note: text("note").notNull().default(""),
    category: text("category").notNull().default("other"),
    ...synced,
  },
  (t) => [
    uniqueIndex("events_user_client_idx").on(t.userId, t.clientId),
    index("events_user_day_idx").on(t.userId, t.day),
  ],
);

export const strengthExercises = pgTable(
  "strength_exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Order in the list. */
    position: integer("position").notNull().default(0),
    /** Reps new sets prefill with. 0 = not set. */
    usualReps: integer("usual_reps").notNull().default(0),
    /** Sets the movement is worked to in a session. 0 = no target. */
    targetSets: integer("target_sets").notNull().default(0),
    /** Weight the movement is loaded to, in pounds. 0 = bodyweight. */
    weightLb: real("weight_lb").notNull().default(0),
    ...synced,
  },
  (t) => [uniqueIndex("strength_exercises_user_client_idx").on(t.userId, t.clientId)],
);

/**
 * A movement's sets for one day, as one row.
 *
 * Not one row per set: a logged set has no identity in the store beyond its
 * position in the array, and giving each one a client id would mean every
 * strength component minting and carrying one. The whole array for a movement on
 * a day is the unit of change, so it is the unit of sync — last write wins. See
 * 0012_strength_sync.sql.
 */
export const strengthLogs = pgTable(
  "strength_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    /** The movement's client id, not its uuid — the device may never have seen a uuid. */
    exerciseClientId: text("exercise_client_id").notNull(),
    /** The array of logged sets: { reps, weightLb }. */
    sets: jsonb("sets")
      .$type<{ reps: number; weightLb: number | null }[]>()
      .notNull()
      .default([]),
    ...synced,
  },
  (t) => [
    uniqueIndex("strength_logs_user_client_idx").on(t.userId, t.clientId),
    index("strength_logs_user_day_idx").on(t.userId, t.day),
  ],
);

export const sportSessions = pgTable(
  "sport_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    name: text("name").notNull(),
    minutes: integer("minutes").notNull(),
    /** practice | game. What the watch cannot know, so it is always practice there. */
    kind: text("kind").notNull().default("practice"),
    /** 1-5, the same scale the survey asks for. Null on rows written before it existed. */
    intensity: integer("intensity"),
    /** manual | device. Only manual rows are pushed — a device row is re-derived
     *  from each phone's own Health Connect, and its id is local to that phone. */
    source: text("source").notNull().default("manual"),
    /** The provider's workout id, for a device row. */
    deviceId: text("device_id"),
    avgHr: integer("avg_hr"),
    calories: integer("calories"),
    /** Legacy, never written by the app. */
    loadScore: integer("load_score"),
    ...synced,
  },
  (t) => [
    uniqueIndex("sport_sessions_user_client_idx").on(t.userId, t.clientId),
    index("sport_sessions_user_day_idx").on(t.userId, t.day),
  ],
);

/**
 * Health Connect landings.
 *
 * Written by the ingest route only, never by a sync push — these are not the
 * user's typed data and have no client counterpart to reconcile against. That is
 * why the id here is the record's own Health Connect id rather than a clientId:
 * re-uploading the same record has to be a no-op, and Health Connect ids are
 * stable across exports where a generated uuid would not be.
 *
 * dataOrigin matters more than it looks. Several apps write to Health Connect —
 * Samsung Health, a watch, a manual entry — and the same measurement arrives more
 * than once from different places. Keeping the source lets the read path
 * deduplicate instead of counting a walk three times.
 */
export const healthDaily = pgTable(
  "health_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    /** Health Connect's own record id, unique per user. The dedupe key. */
    sourceRecordId: text("source_record_id").notNull(),
    /** Package name of the app that wrote it. */
    dataOrigin: text("data_origin").notNull(),
    steps: integer("steps"),
    activeMin: integer("active_min"),
    restingHr: integer("resting_hr"),
    hrvRmssd: real("hrv_rmssd"),
    spo2: real("spo2"),
    respiratoryRate: real("respiratory_rate"),
    /** Sleep totals, minutes. */
    sleepTotalMin: integer("sleep_total_min"),
    sleepDeepMin: integer("sleep_deep_min"),
    sleepRemMin: integer("sleep_rem_min"),
    sleepLightMin: integer("sleep_light_min"),
    /** When the night started and ended. The totals above cannot produce the
     *  "9:12 PM -> 6:41 AM" line Vitality shows, nor the timestamp the staleness
     *  chip compares against now. */
    sleepStartUtc: timestamp("sleep_start_utc", { withTimezone: true }),
    sleepEndUtc: timestamp("sleep_end_utc", { withTimezone: true }),
    /** Measured activity energy. BMR is added on top of this at read time. */
    activeKcal: real("active_kcal"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* One row per record per user, so a re-export updates rather than inserts. */
    uniqueIndex("health_daily_source_idx").on(t.userId, t.sourceRecordId),
    index("health_daily_user_day_idx").on(t.userId, t.day),
  ],
);

/** Workout sessions, which carry a type and a duration rather than day totals. */
export const healthSessions = pgTable(
  "health_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    dataOrigin: text("data_origin").notNull(),
    /** Health Connect's activity type, verbatim. */
    activity: text("activity").notNull(),
    startedAtUtc: timestamp("started_at_utc", { withTimezone: true }).notNull(),
    durationMin: integer("duration_min").notNull(),
    activeMin: integer("active_min"),
    energyKcal: real("energy_kcal"),
    distanceM: real("distance_m"),
    /** Intensity is bucketed from avgHr, so a session without heart rate cannot
     *  be scored against a baseline and would otherwise flatten the load line. */
    avgHr: real("avg_hr"),
    maxHr: real("max_hr"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("health_sessions_source_idx").on(t.userId, t.sourceRecordId),
    index("health_sessions_user_day_idx").on(t.userId, t.day),
  ],
);

/**
 * SimpleFIN connection.
 *
 * The access URL holds the bank credential in its userinfo segment, so this is
 * the most sensitive row in the database and the reason the column is named to
 * discourage anyone putting it in a log or an error message. It is read only by
 * the money sync route, never by a client component, and never leaves the server.
 *
 * lastSyncedAt is not decoration. SimpleFIN allows roughly 24 requests a day and
 * disables the token for sustained overuse, so "have we fetched this recently" is
 * a question the app has to be able to answer before it reaches out at all.
 */
export const financeConnections = pgTable("finance_connections", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  /** Basic Auth credentials for the SimpleFIN bridge. Secret. */
  accessUrl: text("access_url").notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * Which account drives the month's numbers, chosen by the user.
   *
   * Null means "not chosen yet", and the money screen then treats every account as
   * contributing — the behaviour from before this existed. Defaulting to a guess
   * instead would mean the wrong account silently drives the category chart and the
   * net figure, and the user would have no idea why the numbers looked odd.
   *
   * Not a foreign key to finance_accounts: it holds a bank's own account id, which
   * arrives per-connection and is not the surrogate primary key of that table.
   */
  mainAccountId: text("main_account_id"),
});

/**
 * Bank transactions, cached server-side.
 *
 * Not synced, and not readable by the client directly. The money screen is served
 * a computed view by the money route rather than these rows, so what crosses the
 * wire is the summary the screen draws and not the ledger behind it.
 *
 * amountCents is signed with the same convention the app already uses for
 * Transaction — positive is money in — so buildMoneyView does not have to know
 * where the row came from.
 */
export const financeTransactions = pgTable(
  "finance_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** SimpleFIN's transaction id, unique within an account. */
    sourceId: text("source_id").notNull(),
    accountId: text("account_id").notNull(),
    /** Local calendar day, matching the app's own Transaction.date. */
    day: date("day").notNull(),
    amountCents: integer("amount_cents").notNull(),
    /** Payee or description as the bank gave it. */
    note: text("note").notNull(),
    /** App category id, resolved server-side. */
    categoryId: text("category_id"),
    pending: boolean("pending").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("finance_tx_source_idx").on(t.userId, t.accountId, t.sourceId),
    index("finance_tx_user_day_idx").on(t.userId, t.day),
  ],
);

/** Account balances, kept apart from transactions because they are not additive. */
export const financeAccounts = pgTable(
  "finance_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    name: text("name").notNull(),
    org: text("org").notNull(),
    currency: text("currency").notNull().default("USD"),
    /** Ledger balance, in cents. */
    balanceCents: integer("balance_cents").notNull(),
    /**
     * Spendable balance, in cents, and not the same number as balanceCents.
     *
     * A credit union share account can hold $305.16 of ledger balance while only
     * $300.16 is spendable, because $5 is committed to pending authorisations. The
     * banking app the user checks their figure against shows the spendable one, so
     * storing and displaying only the ledger figure reads as the app being wrong by
     * exactly that difference.
     *
     * Not null and not defaulted to balanceCents: a server that omits the field
     * should show the ledger balance, which is what it used before, rather than a
     * zero that would look like the account had been drained.
     */
    availableBalanceCents: integer("available_balance_cents"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("finance_accounts_idx").on(t.userId, t.accountId)],
);

/**
 * One mentor conversation.
 *
 * The sharing switches that used to live here are in mentor_settings. They cannot
 * work on a chat row: a user with no chats has nowhere to put a toggle, and a toggle
 * changes no chat, so last-write-wins discarded every write.
 */
export const mentorChats = pgTable(
  "mentor_chats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** What the user named this chat, or null while it still has none. */
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    ...synced,
  },
  (t) => [uniqueIndex("mentor_chats_client_idx").on(t.userId, t.clientId)],
);

/**
 * One turn of a mentor conversation.
 *
 * Synced, which the original note here argued against on privacy grounds — the
 * reasoning being that the brief already crosses the network on every message so
 * replicating the conversation adds a second copy for no benefit. That was sound
 * while chats were device-local by choice. It stopped describing reality once the
 * user asked for their history to follow their Google account to a second device,
 * which is the same promise every other tab in the app makes.
 *
 * client_id is what makes the push idempotent. Without it a retried sync would
 * insert the same turn twice, and a mentor that repeats itself back at you is
 * worse than one that loses a reply.
 */
export const mentorTurns = pgTable(
  "mentor_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => mentorChats.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** "user" or "mentor". */
    role: text("role").notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    ...synced,
  },
  (t) => [uniqueIndex("mentor_turns_client_idx").on(t.userId, t.chatId, t.clientId)],
);

/**
 * The mentor's sharing switches: one row per user, not per conversation.
 *
 * These were on mentor_chats, which could not work. A user with no chats yet had
 * nowhere to put a toggle, and once they did have chats the flags were only written
 * when a chat also changed — so the server's last-write-wins rule saw an unchanged
 * timestamp and threw the new value away. Sharing could be turned on from the device
 * that toggled it and would not turn off anywhere at all.
 *
 * The primary key is the user, so there is exactly one row and a push cannot create
 * a second. updatedAt is the device's clock, for the same reason as every other
 * synced table.
 */
export const mentorSettings = pgTable("mentor_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  /** Whether notes go with the brief. Off until the user says so. */
  shareNotes: boolean("share_notes").notNull().default(false),
  /** Whether calendar events, titles included, go with the brief. */
  shareEvents: boolean("share_events").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Profile = typeof profiles.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type Checkin = typeof checkins.$inferSelect;
export type WeightLog = typeof weightLog.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type HealthDaily = typeof healthDaily.$inferSelect;

/** Not exported on purpose. A caller that imports the schema object gets every
 *  table including financeConnections, and the type is how a whole-table import
 *  happens by accident. */
export type SelectShape<T> = T extends { $inferSelect: infer R } ? R : never;

export type FinanceAccountShape = SelectShape<typeof financeAccounts>;
export type FinanceTransactionShape = SelectShape<typeof financeTransactions>;
export type FinanceConnectionShape = SelectShape<typeof financeConnections>;