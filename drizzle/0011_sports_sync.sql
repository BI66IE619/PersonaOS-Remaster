-- sport_sessions catches up to the store it mirrors.
--
-- The table was created for an earlier, thinner session — a name, a duration and a
-- load score — and the store has since grown a kind, an intensity, a source, and
-- the device fields. None of it could sync, so the table is empty and this is a
-- safe reshape rather than a migration of live rows.
--
-- client_id is what makes a push idempotent: the session's own id from the device,
-- unique per user, exactly like notes and tasks.
--
-- source distinguishes a survey entry the user typed from a workout the watch
-- wrote. Only manual sessions are synced: a device session is re-derived from
-- whichever phone holds the Health Connect record, and its id is local to that
-- phone, so pushing it would add a second copy on the other device rather than
-- moving the first. The column exists so the read path can keep them apart.
--
-- Everything is IF NOT EXISTS: a previous run applied the columns before the CLI
-- recorded the migration, so a replay must be a no-op rather than an error. load_score
-- is left in place — unused, but dropping a column is the one change that cannot be undone.

ALTER TABLE "sport_sessions" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'practice' NOT NULL;
ALTER TABLE "sport_sessions" ADD COLUMN IF NOT EXISTS "intensity" integer;
ALTER TABLE "sport_sessions" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'manual' NOT NULL;
ALTER TABLE "sport_sessions" ADD COLUMN IF NOT EXISTS "device_id" text;
ALTER TABLE "sport_sessions" ADD COLUMN IF NOT EXISTS "avg_hr" integer;
ALTER TABLE "sport_sessions" ADD COLUMN IF NOT EXISTS "calories" integer;
ALTER TABLE "sport_sessions" ADD COLUMN IF NOT EXISTS "client_id" text;

-- No-op when the column is already NOT NULL, which it is after the manual run.
ALTER TABLE "sport_sessions" ALTER COLUMN "client_id" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "sport_sessions_user_client_idx"
	ON "sport_sessions" ("user_id", "client_id");
