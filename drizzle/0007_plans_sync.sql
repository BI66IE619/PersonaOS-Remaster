-- Make the plan tab's tables able to carry what the app actually holds.
--
-- events, tasks, habits and habit_days all exist with RLS and were never written to:
-- the app keeps the calendar, the task list and the habit grid in localStorage, and
-- /api/sync has never offered them. A second device starts with an empty plan.
--
-- The mismatch to fix is shape, not plumbing.
--
-- events gains start_min, duration_min, note and category, and loses starts_at_utc.
-- The app stores a start as minutes-from-midnight on a local day — the same clock
-- the user reads the calendar with — and a UTC instant would force a timezone
-- conversion that the device that wrote it already knows the answer to. starts_at_utc
-- was never written to, so dropping it loses nothing.
--
-- events also gains the client index every other synced table has. Without a unique
-- (user_id, client_id) there is nothing to upsert against, and a retried push would
-- insert the same event twice — once per retry.
--
-- tasks gains note and category, and day becomes nullable. "Someday" — a task with
-- no due date — is a first-class state in the app, and a NOT NULL day column made it
-- unrepresentable. The migration for it is a no-op for existing rows, which is why
-- this is a plain ALTER rather than a rewrite.
--
-- habit_days is untouched. A day row's client id is the habit's client id with the
-- day appended, which makes the pair a fact with an identity — the same property the
-- mentor turns needed — and the habit uuid it references is resolved server-side,
-- which the device has never seen.

ALTER TABLE "events"
	DROP COLUMN "starts_at_utc",
	ADD COLUMN "start_min" integer,
	ADD COLUMN "duration_min" integer,
	ADD COLUMN "note" text DEFAULT '' NOT NULL,
	ADD COLUMN "category" text DEFAULT 'other' NOT NULL;

CREATE UNIQUE INDEX "events_user_client_idx" ON "events" USING btree ("user_id","client_id");

ALTER TABLE "tasks"
	ALTER COLUMN "day" DROP NOT NULL,
	ADD COLUMN "note" text DEFAULT '' NOT NULL,
	ADD COLUMN "category" text DEFAULT 'other' NOT NULL;
